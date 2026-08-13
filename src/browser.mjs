import { chromium } from 'playwright-core';

/**
 * Finds a browser without downloading one.
 *
 * The whole point is that `npx looksright` works on a machine that has never
 * run Playwright. Chrome or Edge is already installed almost everywhere, so we
 * try the installed channels first and only then the Playwright download.
 */
const CHANNELS = ['chrome', 'msedge', 'chromium'];

export async function openBrowser({ headed = false, channel = null } = {}) {
  const tries = channel ? [channel] : CHANNELS;
  const problems = [];

  for (const name of tries) {
    try {
      return await chromium.launch({ channel: name, headless: !headed });
    } catch (e) {
      problems.push(`${name}: ${firstLine(e.message)}`);
    }
  }

  // Bundled Chromium, for CI images that ran `playwright install`.
  try {
    return await chromium.launch({ headless: !headed });
  } catch (e) {
    problems.push(`bundled: ${firstLine(e.message)}`);
  }

  throw new Error(
    [
      'No browser found. LooksRight drives a real Chrome, it does not ship one.',
      'Install Google Chrome, or run: npx playwright install chromium',
      '',
      'Tried:',
      ...problems.map((p) => `  - ${p}`),
    ].join('\n'),
  );
}

function firstLine(message) {
  return String(message).split('\n')[0].slice(0, 120);
}

/**
 * A page wired to record the things a check cannot ask for after the fact.
 *
 * Console errors and failed requests only exist while the page is loading. By
 * the time a check runs, they are gone unless someone was listening.
 */
export async function openPage(browser, { viewport, theme, ignoreConsole = [] }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale ?? 1,
    colorScheme: theme,
    // A phone viewport with a desktop user agent still gets the desktop layout
    // on sites that sniff, which would hide the exact bug we are looking for.
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });

  const page = await context.newPage();
  return { page, context, signals: listen(page, ignoreConsole) };
}

function listen(page, ignoreConsole) {
  const signals = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  const noise = (text) => ignoreConsole.some((re) => re.test(text));

  page.on('console', (msg) => {
    if (msg.type() === 'error' && !noise(msg.text())) signals.consoleErrors.push(msg.text());
  });

  page.on('pageerror', (err) => {
    const text = err.message ?? String(err);
    if (!noise(text)) signals.pageErrors.push(text);
  });

  page.on('response', (res) => {
    if (res.status() >= 400 && !noise(res.url())) {
      signals.failedRequests.push({ url: res.url(), status: res.status() });
    }
  });

  page.on('requestfailed', (req) => {
    // An aborted request is usually the page navigating away, not a failure.
    const reason = req.failure()?.errorText ?? 'failed';
    if (!reason.includes('ABORTED') && !noise(req.url())) {
      signals.failedRequests.push({ url: req.url(), status: 0, reason });
    }
  });

  return signals;
}
