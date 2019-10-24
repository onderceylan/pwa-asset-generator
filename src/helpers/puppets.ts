import { Browser } from 'puppeteer-core';
import { LaunchedChrome } from 'chrome-launcher';
import constants from '../config/constants';
import url from './url';
import file from './file';
import images from './images';
import browserHelper from './browser';
import preLogger from './logger';
import { Options } from '../models/options';
import {
  DeviceFactorSpec,
  Dimension,
  LaunchScreenSpec,
  SplashScreenSpec,
} from '../models/spec';
import { Image, SavedImage } from '../models/image';

const killBrowser = async (
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

const getAppleSplashScreenData = async (
  browser: Browser,
  options: Options,
): Promise<LaunchScreenSpec[]> => {
  const logger = preLogger(getAppleSplashScreenData.name, options);
  const page = await browser.newPage();
  await page.setUserAgent(constants.EMULATED_USER_AGENT);
  logger.log(
    `Navigating to Apple Human Interface Guidelines website - ${constants.APPLE_HIG_SPLASH_SCR_SPECS_URL}`,
  );

  await page.goto(constants.APPLE_HIG_SPLASH_SCR_SPECS_URL, {
    waitUntil: 'networkidle0',
  });

  logger.log('Waiting for the data table to be loaded');

  try {
    await page.waitForSelector('table', {
      timeout: constants.WAIT_FOR_SELECTOR_TIMEOUT,
    });
  } catch (e) {
    logger.error(
      `Could not find the table on the page within timeout ${constants.WAIT_FOR_SELECTOR_TIMEOUT}ms`,
    );
    throw e;
  }

  const splashScreenData = await page.evaluate(
    ({ selector }) => {
      const scrapeSplashScreenDataFromHIGPage = (): LaunchScreenSpec[] =>
        Array.from(document.querySelectorAll(selector)).map(tr => {
          return Array.from(tr.querySelectorAll('td')).reduce(
            (acc, curr, index) => {
              const appleLaunchScreenTableColumnOrder = [
                'device',
                'portrait',
                'landscape',
              ];
              const dimensionRegex = new RegExp(/(\d*)[^\d]+(\d*)[^\d]+/gm);

              const keyToUpdate = appleLaunchScreenTableColumnOrder[index];
              const execDimensionRegex = (
                val: string,
              ): RegExpExecArray | null => {
                return dimensionRegex.exec(val);
              };

              const getDimensions = (val: string): Dimension => {
                const regexMatch = execDimensionRegex(val);

                if (regexMatch && regexMatch.length) {
                  return {
                    width: parseInt(regexMatch[1], 10),
                    height: parseInt(regexMatch[2], 10),
                  };
                }

                return {
                  width: 1,
                  height: 1,
                };
              };

              return {
                ...acc,
                [keyToUpdate]:
                  index > 0
                    ? getDimensions((curr as HTMLElement).innerText)
                    : (curr as HTMLElement).innerText,
              };
            },
            {
              device: '',
              portrait: { width: 0, height: 0 },
              landscape: { width: 0, height: 0 },
            },
          ) as LaunchScreenSpec;
        });
      return scrapeSplashScreenDataFromHIGPage();
    },
    { selector: constants.APPLE_HIG_SPLASH_SCR_SPECS_DATA_GRID_SELECTOR },
  );

  if (!splashScreenData.length) {
    const err = `Failed scraping the data on web page ${constants.APPLE_HIG_SPLASH_SCR_SPECS_URL}`;
    logger.error(err);
    throw Error(err);
  }

  logger.log('Retrieved splash screen data');
  return splashScreenData;
};

const getDeviceScaleFactorData = async (
  browser: Browser,
  options: Options,
): Promise<DeviceFactorSpec[]> => {
  const logger = preLogger(getDeviceScaleFactorData.name, options);
  const page = await browser.newPage();
  await page.setUserAgent(constants.EMULATED_USER_AGENT);
  logger.log(
    `Navigating to Apple Human Interface Guidelines website - ${constants.APPLE_HIG_DEVICE_SCALE_FACTOR_SPECS_URL}`,
  );
  await page.goto(constants.APPLE_HIG_DEVICE_SCALE_FACTOR_SPECS_URL, {
    waitUntil: 'networkidle0',
  });

  try {
    await page.waitForSelector('table', {
      timeout: constants.WAIT_FOR_SELECTOR_TIMEOUT,
    });
  } catch (e) {
    const err = `Could not find the table on the page within timeout ${constants.WAIT_FOR_SELECTOR_TIMEOUT}ms`;
    logger.error(err);
    throw Error(err);
  }

  const scaleFactorData = await page.evaluate(
    ({ selector }) => {
      const scrapeScaleFactorDataFromHIGPage = (): DeviceFactorSpec[] =>
        Array.from(document.querySelectorAll(selector)).map(tr => {
          return Array.from(tr.querySelectorAll('td')).reduce(
            (acc, curr, index) => {
              const appleScaleFactorTableColumnOrder = [
                'device',
                'scaleFactor',
              ];
              const scaleFactorRegex = new RegExp(/[^\d]+(\d*)[^\d]+/gm);

              const execScaleFactorRegex = (
                val: string,
              ): RegExpExecArray | null => {
                return scaleFactorRegex.exec(val);
              };

              const keyToUpdate = appleScaleFactorTableColumnOrder[index];

              const getScaleFactor = (val: string): number => {
                const regexMatch = execScaleFactorRegex(val);

                if (regexMatch && regexMatch.length) {
                  return parseInt(regexMatch[1], 10);
                }
                return 1;
              };

              return {
                ...acc,
                [keyToUpdate]:
                  index > 0
                    ? getScaleFactor((curr as HTMLElement).innerText)
                    : (curr as HTMLElement).innerText,
              };
            },
            { device: '', scaleFactor: 1 },
          ) as DeviceFactorSpec;
        });
      return scrapeScaleFactorDataFromHIGPage();
    },
    { selector: constants.APPLE_HIG_SPLASH_SCR_SPECS_DATA_GRID_SELECTOR },
  );

  if (!scaleFactorData.length) {
    const err = `Failed scraping the data on web page ${constants.APPLE_HIG_DEVICE_SCALE_FACTOR_SPECS_URL}`;
    logger.error(err);
    throw Error(err);
  }

  logger.log('Retrieved scale factor data');
  return scaleFactorData;
};

const getSplashScreenMetaData = async (
  options: Options,
): Promise<SplashScreenSpec[]> => {
  const logger = preLogger(getSplashScreenMetaData.name, options);

  if (!options.scrape) {
    logger.log(`Skipped scraping - using static data`);
    return constants.APPLE_HIG_SPLASH_SCREEN_FALLBACK_DATA;
  }

  logger.log(
    'Initialising puppeteer to load latest splash screen metadata',
    '🤖',
  );

  const { browser, chrome } = await browserHelper.getBrowserInstance({
    timeout: 5000,
  });
  let splashScreenUniformMetaData;

  try {
    const splashScreenData = await getAppleSplashScreenData(browser, options);
    const scaleFactorData = await getDeviceScaleFactorData(browser, options);
    splashScreenUniformMetaData = images.getSplashScreenScaleFactorUnionData(
      splashScreenData,
      scaleFactorData,
    );
    logger.success('Loaded metadata for iOS platform');
  } catch (e) {
    splashScreenUniformMetaData =
      constants.APPLE_HIG_SPLASH_SCREEN_FALLBACK_DATA;
    logger.error(e);
    logger.warn(
      `Failed to fetch latest specs from Apple Human Interface guidelines - using static fallback data`,
    );
  }

  await killBrowser(browser, chrome);

  return splashScreenUniformMetaData;
};

const canNavigateTo = (source: string): boolean =>
  (url.isUrl(source) && !file.isImageFile(source)) || file.isHtmlFile(source);

const saveImages = async (
  imageList: Image[],
  source: string,
  output: string,
  options: Options,
): Promise<SavedImage[]> => {
  let address: string;
  let shellHtml: string;

  const logger = preLogger(saveImages.name, options);
  logger.log('Initialising puppeteer to take screenshots', '🤖');

  if (canNavigateTo(source)) {
    address = await url.getAddress(source, options);
  } else {
    shellHtml = await url.getShellHtml(source, options);
  }

  return (
    imageList
      .map(async ({ name, width, height, scaleFactor, orientation }) => {
        const { browser, chrome } = await browserHelper.getBrowserInstance({
          defaultViewport: {
            width,
            height,
          },
          timeout: constants.BROWSER_SHELL_TIMEOUT,
        });

        const { type, quality } = options;
        const path = file.getImageSavePath(name, output, type);

        try {
          const page = await browser.newPage();

          if (address) {
            await page.goto(address);
          } else {
            await page.setContent(shellHtml);
          }

          await page.screenshot({
            path,
            omitBackground: !options.opaque,
            type: options.type,
            ...(type !== 'png' ? { quality } : {}),
          });

          logger.success(`Saved image ${name}`);
          await killBrowser(browser, chrome);

          return { name, width, height, scaleFactor, path, orientation };
        } catch (e) {
          await killBrowser(browser, chrome);
          logger.error(e.message);
          throw Error(`Failed to save image ${name}`);
        }
      })
      // Resolving array of promises in sequential manner to kill chrome instances properly
      .reduce(
        (acc, promise: Promise<SavedImage>) =>
          acc.then(result => promise.then(Array.prototype.concat.bind(result))),
        Promise.resolve([] as SavedImage[]),
      )
  );
};

const generateImages = async (
  source: string,
  output: string,
  options: Options,
): Promise<SavedImage[]> => {
  const logger = preLogger(generateImages.name, options);
  const splashScreenMetaData = await getSplashScreenMetaData(options);
  const allImages = [
    ...(!options.iconOnly
      ? images.getSplashScreenImages(splashScreenMetaData, options)
      : []),
    ...(!options.splashOnly ? images.getIconImages(options) : []),
  ];

  if (!(await file.pathExists(output, file.WRITE_ACCESS))) {
    logger.warn(
      `Looks like folder ${output} doesn't exist. Created one for you`,
    );
    await file.makeDir(output);
  }

  // Increase MaxListeners and suppress MaxListenersExceededWarning
  process.setMaxListeners(0);

  return saveImages(allImages, source, output, options);
};

export default {
  getSplashScreenMetaData,
  saveImages,
  generateImages,
};
