import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { check } from '../src/index.mjs';
import { serveFixtures } from './server.mjs';

/**
 * The two tests that matter, in this order.
 *
 * A checker is only useful if it is right on both sides: silent on a page that
 * is fine, and specific on a page that is not. Coverage without the first half
 * is a tool nobody keeps installed.
 */
let site;

before(async () => {
  site = await serveFixtures();
});

after(async () => {
  await site?.close();
});

describe('a page with nothing wrong', () => {
  it('reports no findings at all, in every viewport and theme', async () => {
    const result = await check(site.url('clean.html'));

    assert.equal(
      result.findings.length,
      0,
      `expected silence, got:\n${result.findings.map((f) => `  ${f.check} @ ${f.viewport}/${f.theme}: ${f.message}`).join('\n')}`,
    );
    assert.equal(result.ok, true);
    assert.equal(result.scenes.length, 6, 'three viewports times two themes');
  });
});

describe('a full screen app shell', () => {
  // The regression that made this a test: measuring the body box called every
  // `position: fixed` shell blank, which is the normal shape of a chat app or a
  // dashboard, the exact software this tool exists for.
  it('is not called blank just because the body box is zero tall', async () => {
    const result = await check(site.url('fullscreen.html'), { viewports: ['desktop'], themes: ['light'] });
    const blank = result.findings.filter((f) => f.check === 'blank-page');
    assert.equal(blank.length, 0, blank.map((f) => f.message).join(' | '));
  });
});

describe('a page whose content is clipped to nothing', () => {
  it('is reported as blank, because that is what the screen shows', async () => {
    const result = await check(site.url('colapsada.html'), { viewports: ['desktop'], themes: ['light'] });
    assert.ok(
      result.findings.some((f) => f.check === 'blank-page'),
      'a height:0 wrapper hiding all the content went unreported',
    );
  });
});

describe('a page with planted problems', () => {
  let byCheck;
  let result;

  before(async () => {
    result = await check(site.url('broken.html'));
    byCheck = new Map();
    for (const f of result.findings) {
      byCheck.set(f.check, [...(byCheck.get(f.check) ?? []), f]);
    }
  });

  it('fails the run', () => {
    assert.equal(result.ok, false);
    assert.ok(result.errors > 0, 'at least one error level finding');
  });

  const expected = [
    ['horizontal-overflow', /scrolls sideways|too wide|past the right edge/i],
    ['contrast', /below the 4\.5:1|contrast is/i],
    ['invisible-text', /invisible/i],
    ['clipped-text', /cut off|clipped/i],
    ['broken-images', /failed to load/i],
    ['tiny-targets', /px|target/i],
    ['missing-labels', /no accessible name|no label|no alt|no title/i],
    ['console-errors', /logged an error/i],
    ['failed-requests', /404/],
    ['stuck-loading', /loading indicator/i],
  ];

  for (const [id, pattern] of expected) {
    it(`finds the planted ${id}`, () => {
      const found = byCheck.get(id) ?? [];
      assert.ok(found.length > 0, `${id} found nothing`);
      assert.ok(
        found.some((f) => pattern.test(f.message)),
        `${id} message did not read as expected: ${found.map((f) => f.message).join(' | ')}`,
      );
    });
  }

  // Not every finding can name an element: "the page scrolls sideways" is about
  // the document. What has to hold is that each of these checks points at
  // something at least once, otherwise the reader is told there is a problem
  // and left to find it.
  for (const id of ['horizontal-overflow', 'contrast', 'invisible-text', 'clipped-text', 'tiny-targets']) {
    it(`${id} points at an element`, () => {
      const found = byCheck.get(id) ?? [];
      assert.ok(found.some((f) => f.selector), `${id} never produced a selector`);
    });
  }

  it('writes every message as a sentence a person can act on', () => {
    for (const f of result.findings) {
      assert.ok(f.message.length > 20, `too terse: ${f.message}`);
      // A quoted value can close the sentence, as in ...(reading "map").
      assert.ok(/[.!)"']$/.test(f.message.trim()), `not a sentence: ${f.message}`);
      assert.ok(!/—/.test(f.message), `em dash in: ${f.message}`);
    }
  });
});
