import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { openBrowser, openPage } from './browser.mjs';
import { CHECKS } from './checks/index.mjs';
import { urlFor } from './config.mjs';

/**
 * @typedef {Object} Finding
 * @property {string} check
 * @property {'error'|'warn'} level
 * @property {string} message   One sentence, written for a person.
 * @property {string} [selector]
 * @property {string} [text]    The offending content, trimmed.
 * @property {Object} [detail]  Numbers behind the claim.
 */

/**
 * @typedef {Object} Scene
 * @property {Object} route
 * @property {Object} viewport
 * @property {'light'|'dark'} theme
 * @property {string} url
 * @property {Finding[]} findings
 * @property {string} [screenshot]
 * @property {string} [error]
 * @property {number} ms
 */

/** Runs every check against every route, viewport and theme. */
export async function run(config, { onScene, headed = false, channel = null } = {}) {
  const checks = CHECKS.filter((c) => !config.skip.includes(c.id));
  const browser = await openBrowser({ headed, channel });
  /** @type {Scene[]} */
  const scenes = [];

  if (config.screenshots) await mkdir(config.screenshots, { recursive: true });

  try {
    for (const route of config.routes) {
      for (const viewport of config.viewports) {
        for (const theme of config.themes) {
          const scene = await visit({ config, checks, browser, route, viewport, theme });
          scenes.push(scene);
          onScene?.(scene);
        }
      }
    }
  } finally {
    await browser.close();
  }

  return { scenes, checks: checks.map((c) => c.id) };
}

async function visit({ config, checks, browser, route, viewport, theme }) {
  const url = urlFor(route, config.baseUrl);
  const started = Date.now();
  const { page, context, signals } = await openPage(browser, {
    viewport,
    theme,
    ignoreConsole: config.ignoreConsole,
  });

  /** @type {Scene} */
  const scene = { route, viewport, theme, url, findings: [], ms: 0 };

  try {
    // `networkidle` never fires on a page holding an SSE or websocket open, and
    // those are exactly the apps people want checked.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout });
    if (route.waitFor) {
      await page.waitForSelector(route.waitFor, { timeout: config.timeout });
    }
    await page.waitForTimeout(config.settle);

    for (const check of checks) {
      try {
        const found = await check.run({ page, viewport, theme, signals, config, route });
        for (const f of found ?? []) {
          scene.findings.push({ ...f, check: check.id, level: levelFor(check, f, config) });
        }
      } catch (e) {
        scene.findings.push({
          check: check.id,
          level: 'warn',
          message: `The "${check.id}" check could not run here: ${e.message}`,
        });
      }
    }

    if (config.screenshots) {
      const name = `${slug(route.name ?? route.path)}-${viewport.name}-${theme}.png`;
      scene.screenshot = join(config.screenshots, name);
      await page.screenshot({ path: scene.screenshot, fullPage: false });
    }
  } catch (e) {
    scene.error = e.message;
    scene.findings.push({
      check: 'navigation',
      level: 'error',
      message: `Could not open the page: ${firstLine(e.message)}`,
    });
  } finally {
    scene.ms = Date.now() - started;
    await context.close();
  }

  return scene;
}

function levelFor(check, finding, config) {
  if (config.warnOnly.includes(check.id)) return 'warn';
  return finding.level ?? check.level ?? 'error';
}

function slug(value) {
  return String(value).replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
}

function firstLine(message) {
  return String(message).split('\n')[0].slice(0, 160);
}

/** True when nothing at `error` level survived. */
export function passed(scenes) {
  return !scenes.some((s) => s.findings.some((f) => f.level === 'error'));
}

export function countBy(scenes, level) {
  return scenes.reduce((n, s) => n + s.findings.filter((f) => f.level === level).length, 0);
}
