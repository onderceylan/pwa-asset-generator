import puppeteer, {
  Browser,
  PuppeteerNodeLaunchOptions,
  BrowserFetcherRevisionInfo,
} from 'puppeteer-core';
import {
  launch,
  LaunchedChrome,
  Options as ChromeLauncherOptions,
} from 'chrome-launcher';
import find from 'find-process';
import { get } from 'http';
import preLogger from './logger';
import constants from '../config/constants';
import installer from './installer';

interface BrowserVersionInfo {
  Browser: string;
  webSocketDebuggerUrl: string;
  'Protocol-Version': string;
  'User-Agent': string;
  'V8-Version': string;
  'Webkit-Version': string;
}

const isPreferredBrowserRevisionInstalled = (): boolean => {
  const revisionInfo = installer.getPreferredBrowserRevisionInfo();
  return revisionInfo.local;
};

const getLocalRevisionList = (): Promise<string[]> => {
  return installer.getBrowserFetcher().localRevisions();
};

const getLocalRevisionInfo = async (): Promise<
  BrowserFetcherRevisionInfo | undefined
> => {
  if (isPreferredBrowserRevisionInstalled()) {
    return installer.getPreferredBrowserRevisionInfo();
  }

  const localRevisions = await getLocalRevisionList();

  if (localRevisions.length > 0) {
    const lastRevision = localRevisions.pop() as string;
    return installer.getBrowserFetcher().revisionInfo(lastRevision);
  }

  return undefined;
};

const getLocalBrowserInstance = async (
  launchArgs: PuppeteerNodeLaunchOptions,
  noSandbox: boolean,
): Promise<Browser> => {
  let revisionInfo: BrowserFetcherRevisionInfo;
  const localRevisionInfo = await getLocalRevisionInfo();

  if (localRevisionInfo) {
    revisionInfo = localRevisionInfo;
  } else {
    revisionInfo = await installer.installPreferredBrowserRevision();
  }

  return puppeteer.launch({
    ...launchArgs,
    ...(noSandbox && {
      args: [
        ...(launchArgs.args ?? []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    }),
    executablePath: revisionInfo.executablePath,
  });
};

const launchSystemBrowser = (): Promise<LaunchedChrome> => {
  const launchOptions: ChromeLauncherOptions = {
    chromeFlags: constants.CHROME_LAUNCH_ARGS,
    logLevel: 'silent',
    maxConnectionRetries: constants.CHROME_LAUNCHER_MAX_CONN_RETRIES,
  };

  return launch(launchOptions);
};

const getLaunchedChromeVersionInfo = (
  chrome: LaunchedChrome,
): Promise<BrowserVersionInfo> => {
  return new Promise((resolve, reject) => {
    get(`http://localhost:${chrome.port}/json/version`, (res) => {
      let data = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    }).on('error', (err) => reject(err));
  });
};

const getSystemBrowserInstance = async (
  chrome: LaunchedChrome,
  launchArgs?: PuppeteerNodeLaunchOptions,
): Promise<Browser> => {
  const chromeVersionInfo = await getLaunchedChromeVersionInfo(chrome);

  return puppeteer.connect({
    ...launchArgs,
    browserWSEndpoint: chromeVersionInfo.webSocketDebuggerUrl,
  });
};

const getBrowserInstance = async (
  launchArgs: PuppeteerNodeLaunchOptions,
  noSandbox: boolean,
): Promise<{ chrome: LaunchedChrome | undefined; browser: Browser }> => {
  const LAUNCHER_CONNECTION_REFUSED_ERROR_CODE = 'ECONNREFUSED';
  const LAUNCHER_NOT_INSTALLED_ERROR_CODE = 'ERR_LAUNCHER_NOT_INSTALLED';
  const logger = preLogger(getBrowserInstance.name);

  let browser: Browser;
  let chrome: LaunchedChrome | undefined;

  try {
    chrome = await launchSystemBrowser();
    browser = await getSystemBrowserInstance(chrome, launchArgs);
  } catch (e) {
    // Kill chrome instance manually in case of connection error
    if (e.code === LAUNCHER_CONNECTION_REFUSED_ERROR_CODE) {
      logger.warn(
        `Chrome launcher could not connect to your system browser. Is your port ${e.port} accessible?`,
      );
      const prc = await find('port', e.port);
      prc.forEach((pr) => {
        logger.log(
          `Killing incompletely launched system chrome instance on pid ${pr.pid}`,
        );
        process.kill(pr.pid);
      });
    }

    // Inform user that system chrome is not found
    if (e.code === LAUNCHER_NOT_INSTALLED_ERROR_CODE) {
      logger.warn('Looks like Chrome is not installed on your system');
    }

    browser = await getLocalBrowserInstance(launchArgs, noSandbox);
  }

  return { browser, chrome };
};

export const killBrowser = async (
  browser: Browser,
  chrome: LaunchedChrome | undefined,
): Promise<void> => {
  if (chrome) {
    await browser.disconnect();
    await chrome.kill();
  } else {
    await browser.close();
  }
};

export default {
  getBrowserInstance,
  killBrowser,
};
