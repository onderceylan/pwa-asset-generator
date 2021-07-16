import puppeteer, {
  BrowserFetcher,
  BrowserFetcherRevisionInfo,
} from 'puppeteer-core';
import ProgressBar from 'progress';
import preLogger from './logger';

let browserFetcher: BrowserFetcher;

// Override current environment proxy settings with npm configuration, if any.
const NPM_HTTPS_PROXY =
  process.env.npm_config_https_proxy || process.env.npm_config_proxy;
const NPM_HTTP_PROXY =
  process.env.npm_config_http_proxy || process.env.npm_config_proxy;
const NPM_NO_PROXY = process.env.npm_config_no_proxy;

if (NPM_HTTPS_PROXY) process.env.HTTPS_PROXY = NPM_HTTPS_PROXY;
if (NPM_HTTP_PROXY) process.env.HTTP_PROXY = NPM_HTTP_PROXY;
if (NPM_NO_PROXY) process.env.NO_PROXY = NPM_NO_PROXY;

const getBrowserFetcher = (): BrowserFetcher => {
  const downloadHost =
    process.env.PUPPETEER_DOWNLOAD_HOST ||
    process.env.npm_config_puppeteer_download_host ||
    process.env.npm_package_config_puppeteer_download_host;
  if (browserFetcher) {
    return browserFetcher;
  }

  // The next line uses a workaround for this issue: https://github.com/puppeteer/puppeteer/issues/7100
  browserFetcher = (
    puppeteer as unknown as puppeteer.PuppeteerNode
  ).createBrowserFetcher({ host: downloadHost });
  return browserFetcher;
};

const getPreferredBrowserRevisionInfo = (): BrowserFetcherRevisionInfo => {
  const revision =
    process.env.PUPPETEER_CHROMIUM_REVISION ||
    process.env.npm_config_puppeteer_chromium_revision ||
    process.env.npm_package_config_puppeteer_chromium_revision ||
    require('puppeteer-core/lib/cjs/puppeteer/revisions.js').PUPPETEER_REVISIONS
      .chromium;

  return getBrowserFetcher().revisionInfo(revision);
};

const { revision } = getPreferredBrowserRevisionInfo();
const revisionInfo = getBrowserFetcher().revisionInfo(revision);
const logger = preLogger('installer');

const toMegabytes = (bytes: number): string => {
  const mb = bytes / 1024 / 1024;
  return `${Math.round(mb * 10) / 10} Mb`;
};

const cleanUpOldRevisions = (revisions: string[]): Promise<void[]> => {
  const localRevisions = revisions.filter((rev) => revision !== rev);
  // Remove previous chromium revisions.
  const cleanupOldVersions = localRevisions.map((rev: string) =>
    getBrowserFetcher().remove(rev),
  );
  return Promise.all([...cleanupOldVersions]);
};

let progressBar: ProgressBar;
let lastDownloadedBytes = 0;
const onProgress = (downloadedBytes: number, totalBytes: number): void => {
  if (!progressBar) {
    progressBar = new ProgressBar(
      `Downloading Chromium r${revision} - ${toMegabytes(
        totalBytes,
      )} [:bar] :percent :etas `,
      {
        complete: '=',
        incomplete: ' ',
        width: 20,
        total: totalBytes,
      },
    );
  }
  const delta = downloadedBytes - lastDownloadedBytes;
  lastDownloadedBytes = downloadedBytes;
  progressBar.tick(delta);
};

const installPreferredBrowserRevision =
  async (): Promise<BrowserFetcherRevisionInfo> => {
    logger.warn(
      `Chromium is not found in module folder, gonna have to download r${revision} for you once`,
    );

    const installedRevision = await getBrowserFetcher().download(
      revision,
      onProgress,
    );
    logger.log(`Chromium downloaded to ${revisionInfo.folderPath}`);

    await getBrowserFetcher().localRevisions().then(cleanUpOldRevisions);

    return installedRevision;
  };

export default {
  getBrowserFetcher,
  installPreferredBrowserRevision,
  getPreferredBrowserRevisionInfo,
};
