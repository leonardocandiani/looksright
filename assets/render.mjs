/**
 * Renders the SVG assets to PNG with a real browser.
 *
 * ImageMagick without librsvg drops strokes and clip paths, which silently
 * produced a logo missing its check mark. Chrome renders what people will see.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));

const JOBS = [
  { svg: 'logo.svg', png: 'logo.png', width: 512, height: 512 },
  { svg: 'logo.svg', png: 'logo-128.png', width: 128, height: 128 },
  { svg: 'banner.svg', png: 'banner.png', width: 1280, height: 640 },
];

const browser = await chromium.launch({ channel: 'chrome' });

for (const job of JOBS) {
  const path = resolve(here, job.svg);
  let svg;
  try {
    svg = await readFile(path, 'utf8');
  } catch {
    console.log(`skipped ${job.svg} (not there yet)`);
    continue;
  }

  const page = await browser.newPage({
    viewport: { width: job.width, height: job.height },
    deviceScaleFactor: 2,
  });
  await page.setContent(
    `<html><body style="margin:0;display:grid;place-items:center;background:transparent">${svg}</body></html>`,
  );
  await page.evaluate(({ w, h }) => {
    const el = document.querySelector('svg');
    el.setAttribute('width', String(w));
    el.setAttribute('height', String(h));
  }, { w: job.width, h: job.height });

  const shot = await page.screenshot({ omitBackground: true });
  await writeFile(join(here, job.png), shot);
  await page.close();
  console.log(`${job.png} ${job.width}x${job.height}`);
}

await browser.close();
