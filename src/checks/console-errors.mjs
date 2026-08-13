/** How many distinct messages to report before saying "and N more". */
const SHOWN = 5;

/**
 * Chrome logs a console error for every request that fails, worded so generically
 * that it says nothing on its own. The failed-requests check reports the same
 * event with the URL, the status and the host, so reporting both means every
 * broken image is counted twice and the real exception scrolls out of view.
 */
const ECHOES_A_REQUEST =
  /^Failed to load resource|^net::ERR_|the server responded with a status of \d{3}/i;

/**
 * Errors the page threw while loading.
 *
 * These are collected by a listener in `browser.mjs`, not read here: by the
 * time a check runs, the console is already in the past.
 */
export default {
  id: 'console-errors',
  title: 'Console errors',
  level: 'error',

  async run({ signals }) {
    const all = [...new Set([...signals.pageErrors, ...signals.consoleErrors])].filter(
      (m) => !ECHOES_A_REQUEST.test(m),
    );
    if (!all.length) return [];

    const findings = all.slice(0, SHOWN).map((message) => ({
      message: `The page logged an error: ${trim(message)}`,
      text: message,
    }));

    if (all.length > SHOWN) {
      findings.push({
        level: 'warn',
        message: `And ${all.length - SHOWN} more console errors on this page.`,
        detail: { total: all.length },
      });
    }

    return findings;
  },
};

function trim(message) {
  const line = String(message).split('\n')[0].trim();
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}
