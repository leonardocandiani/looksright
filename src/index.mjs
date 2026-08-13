/**
 * LooksRight, as a library.
 *
 * The CLI is the front door, but a test file or a CI script often wants the
 * findings as data instead of as text on a terminal.
 *
 * @example
 * import { check } from 'looksright';
 * const result = await check('http://localhost:3000', { viewports: ['phone'] });
 * if (!result.ok) throw new Error(result.summary);
 */
import { DEFAULTS, normalize } from './config.mjs';
import { countBy, passed, run } from './run.mjs';

export { CHECKS, BY_ID } from './checks/index.mjs';
export { loadConfig, DEFAULT_VIEWPORTS } from './config.mjs';
export { toJson, toMarkdown, toTerminal } from './report.mjs';
export { run, passed, countBy } from './run.mjs';

/**
 * Checks one URL and returns the result.
 *
 * @param {string} url
 * @param {Partial<import('./config.mjs').Config>} [options]
 */
export async function check(url, options = {}) {
  const target = new URL(url);
  const config = {
    ...DEFAULTS,
    ...normalize(options),
    baseUrl: target.origin,
    routes: options.routes ?? [{ path: target.pathname + target.search }],
  };

  const result = await run(config, options);
  const errors = countBy(result.scenes, 'error');
  const warnings = countBy(result.scenes, 'warn');

  return {
    ...result,
    ok: passed(result.scenes),
    errors,
    warnings,
    summary: passed(result.scenes)
      ? `Looks right across ${result.scenes.length} scenes.`
      : `${errors} errors and ${warnings} warnings across ${result.scenes.length} scenes.`,
    /** Every finding, flattened, with the scene it came from. */
    findings: result.scenes.flatMap((s) =>
      s.findings.map((f) => ({ ...f, url: s.url, viewport: s.viewport.name, theme: s.theme })),
    ),
  };
}
