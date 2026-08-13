import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * @typedef {Object} Viewport
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {number} [scale]
 */

/**
 * @typedef {Object} Route
 * @property {string} path      Appended to `baseUrl`, or a full URL.
 * @property {string} [name]    Shown in the report. Defaults to the path.
 * @property {string} [waitFor] CSS selector to wait for before checking.
 */

/**
 * @typedef {Object} Config
 * @property {string} [baseUrl]
 * @property {Route[]} routes
 * @property {Viewport[]} viewports
 * @property {Array<'light'|'dark'>} themes
 * @property {string[]} skip           Check ids to skip entirely.
 * @property {string[]} warnOnly       Check ids that never fail the run.
 * @property {string[]} ignoreSelectors Elements matching these are exempt.
 * @property {RegExp[]} ignoreConsole  Console messages that are known noise.
 * @property {number} timeout
 * @property {number} settle           Extra ms after load, for animations.
 * @property {string|null} screenshots Directory for screenshots, or null.
 */

/** Phone, tablet and laptop. Most "it broke on mobile" bugs die at 390px. */
export const DEFAULT_VIEWPORTS = [
  { name: 'phone', width: 390, height: 844, scale: 2 },
  { name: 'tablet', width: 820, height: 1180, scale: 2 },
  { name: 'desktop', width: 1440, height: 900, scale: 1 },
];

/** @type {Config} */
export const DEFAULTS = {
  routes: [{ path: '/' }],
  viewports: DEFAULT_VIEWPORTS,
  themes: ['light', 'dark'],
  skip: [],
  warnOnly: [],
  ignoreSelectors: [],
  ignoreConsole: [],
  timeout: 20_000,
  settle: 600,
  screenshots: null,
};

const FILES = [
  'looksright.config.json',
  'looksright.config.mjs',
  'looksright.config.js',
  '.looksrightrc',
  '.looksrightrc.json',
];

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${path} is not valid JSON: ${e.message}`);
  }
}

async function readModule(path) {
  try {
    const mod = await import(`file://${path}`);
    return mod.default ?? mod.config ?? null;
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND') return null;
    throw new Error(`${path} failed to load: ${e.message}`);
  }
}

/**
 * Reads the config file next to the project, if there is one.
 *
 * A missing config is the normal case: `looksright check <url>` has to work in
 * a repo that has never heard of this tool.
 */
export async function loadConfig(cwd = process.cwd(), explicit = null) {
  const candidates = explicit ? [resolve(cwd, explicit)] : FILES.map((f) => resolve(cwd, f));

  for (const path of candidates) {
    const raw = path.endsWith('.json') || path.endsWith('rc')
      ? await readJson(path)
      : await readModule(path);
    if (raw) return { ...DEFAULTS, ...normalize(raw), source: path };
  }
  if (explicit) throw new Error(`Config file not found: ${explicit}`);
  return { ...DEFAULTS, source: null };
}

/** Accepts the shapes people actually type: a string route, a viewport name. */
export function normalize(raw) {
  const out = { ...raw };

  if (Array.isArray(raw.routes)) {
    out.routes = raw.routes.map((r) => (typeof r === 'string' ? { path: r } : r));
  }
  if (Array.isArray(raw.viewports)) {
    out.viewports = raw.viewports.map((v) => {
      if (typeof v !== 'string') return v;
      const known = DEFAULT_VIEWPORTS.find((d) => d.name === v);
      if (!known) throw new Error(`Unknown viewport "${v}". Use phone, tablet, desktop, or an object.`);
      return known;
    });
  }
  if (Array.isArray(raw.ignoreConsole)) {
    out.ignoreConsole = raw.ignoreConsole.map((p) => (p instanceof RegExp ? p : new RegExp(p, 'i')));
  }
  return out;
}

/** Turns a route into an absolute URL, so CLI targets and config routes converge. */
export function urlFor(route, baseUrl) {
  if (/^https?:\/\//.test(route.path)) return route.path;
  if (!baseUrl) {
    throw new Error(
      `Route "${route.path}" needs a base URL. Pass a full one (looksright check http://localhost:3000) or set baseUrl in the config.`,
    );
  }
  return new URL(route.path, baseUrl).toString();
}
