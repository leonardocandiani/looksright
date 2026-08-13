/** How many findings to list before collapsing the rest into a count. */
const SHOWN = 8;

/** Images and elements inspected per page, to keep the evaluate payload small. */
const MAX_COLLECT = 600;

/**
 * Images that never arrived, and web fonts the browser gave up on.
 *
 * A broken image is the one defect a screenshot-free workflow always misses:
 * the markup is right, the build passes, and the page still shows an empty
 * frame where the product photo should be. Same for a `@font-face` that 404s,
 * which silently repaints the page in Times New Roman.
 *
 * The bar here is zero false positives, so anything ambiguous is skipped:
 * lazy images below the fold have not been asked to load yet, tracking pixels
 * are meant to be invisible, and a font that merely "might" have fallen back
 * is never reported, only one the browser itself marked as failed.
 */
export default {
  id: 'broken-images',
  title: 'Broken images',
  level: 'error',

  async run({ page, signals, config }) {
    const found = await page.evaluate(collect, {
      ignoreSelectors: config?.ignoreSelectors ?? [],
      maxCollect: MAX_COLLECT,
    });

    const failed = failedUrlIndex(signals?.failedRequests ?? []);

    return cap([
      ...found.broken.map(brokenFinding),
      ...found.noSource.map(noSourceFinding),
      ...backgroundFindings(found.backgrounds, failed),
      ...found.pending.map(pendingFinding),
      ...found.fonts.map(fontFinding),
    ]);
  },
};

/**
 * Runs in the browser. Everything it needs arrives as `args`, because it has
 * no access to the Node scope.
 */
function collect({ ignoreSelectors, maxCollect }) {
  const URL_TOKEN = new RegExp('url\\(([^)]+)\\)', 'g');
  const QUOTES = new RegExp('^["\']|["\']$', 'g');
  const DATA_URI = new RegExp('^data:', 'i');
  // Build-tool class names like "css-1x9kd2" or "sc-bdVaJa" identify nothing.
  const HASHED_CLASS = new RegExp('^[a-z]{2,7}-[a-z0-9]{6,}$', 'i');

  const buckets = {
    broken: new Map(),
    noSource: new Map(),
    pending: new Map(),
    backgrounds: new Map(),
  };

  function ignored(el) {
    for (const sel of ignoreSelectors) {
      try {
        if (el.closest(sel)) return true;
      } catch {
        // An unparseable selector in the user config must not kill the check.
      }
    }
    return false;
  }

  function hidden(el) {
    if (el.closest('[aria-hidden="true"], [hidden], template, script, style, noscript')) return true;
    if (typeof el.checkVisibility === 'function') {
      return !el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
    }
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0;
  }

  function offscreen(box) {
    return box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth;
  }

  function signature(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${CSS.escape(el.id)}`;
    const classes = [...el.classList]
      .filter((c) => c && !HASHED_CLASS.test(c))
      .slice(0, 2)
      .map((c) => `.${CSS.escape(c)}`)
      .join('');
    return tag + classes;
  }

  function selectorFor(el) {
    const base = signature(el);
    const parent = el.parentElement;
    if (el.id || !parent) return base;
    // `:nth-of-type` only earns its place when a sibling looks identical,
    // otherwise it turns a readable selector into a coordinate.
    const twins = [...parent.children].filter((s) => s.tagName === el.tagName);
    const ambiguous = twins.filter((s) => signature(s) === base).length > 1;
    const self = ambiguous ? `${base}:nth-of-type(${twins.indexOf(el) + 1})` : base;
    return parent.id ? `#${CSS.escape(parent.id)} > ${self}` : self;
  }

  function push(bucket, key, el, box, url) {
    const existing = bucket.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    bucket.set(key, {
      url,
      selector: selectorFor(el),
      width: Math.round(box.width),
      height: Math.round(box.height),
      count: 1,
    });
  }

  function skipImage(img, box) {
    if (ignored(img) || hidden(img)) return true;
    // A 1x1 image is a tracking pixel, not a picture anyone expects to see.
    const tiny = Number(img.getAttribute('width')) === 1 && Number(img.getAttribute('height')) === 1;
    if (tiny || (box.width <= 2 && box.height <= 2)) return true;
    // Inline data URIs cannot 404, and a decode failure there surfaces in the
    // console instead, where console-errors already reports it.
    return DATA_URI.test((img.getAttribute('src') || '').trim());
  }

  function hasSource(img) {
    return Boolean((img.getAttribute('src') || '').trim() || (img.getAttribute('srcset') || '').trim());
  }

  function classifyMissingSource(img, box) {
    // A source-less img with no box at all is a placeholder waiting for its
    // data, not a hole the reader can see.
    if (box.width >= 4 && box.height >= 4) push(buckets.noSource, selectorFor(img), img, box, '');
  }

  function classifyLoadState(img, box) {
    const url = img.currentSrc || img.src;
    if (img.complete) {
      if (img.naturalWidth === 0 && img.naturalHeight === 0) push(buckets.broken, url, img, box, url);
      return;
    }
    // Lazy images below the fold are supposed to be unloaded at this point.
    if (img.loading === 'lazy' && offscreen(box)) return;
    push(buckets.pending, url, img, box, url);
  }

  function classifyImage(img) {
    const box = img.getBoundingClientRect();
    if (skipImage(img, box)) return;
    if (hasSource(img)) classifyLoadState(img, box);
    else classifyMissingSource(img, box);
  }

  function backgroundUrls(value) {
    const urls = [];
    for (const match of value.matchAll(URL_TOKEN)) {
      const raw = match[1].trim().replace(QUOTES, '');
      if (!raw || DATA_URI.test(raw)) continue;
      try {
        urls.push(new URL(raw, document.baseURI).href);
      } catch {
        // Relative URLs that do not resolve cannot be matched to a request.
      }
    }
    return urls;
  }

  function classifyBackground(el) {
    const value = getComputedStyle(el).backgroundImage;
    if (!value || !value.includes('url(')) return;
    const box = el.getBoundingClientRect();
    // A background needs real area to be missed; a 4px sliver is decoration.
    if (box.width < 8 || box.height < 8) return;
    if (ignored(el) || hidden(el)) return;
    for (const url of backgroundUrls(value)) {
      push(buckets.backgrounds, `${url}|${selectorFor(el)}`, el, box, url);
    }
  }

  function collectFonts() {
    const fonts = [];
    const seen = new Set();
    for (const face of document.fonts) {
      // `error` is the browser's own verdict that the file did not load. A font
      // that merely looks different is never reported, since that is a guess.
      if (face.status !== 'error') continue;
      const family = String(face.family || '').replace(QUOTES, '');
      const key = `${family}|${face.weight}|${face.style}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fonts.push({ family, weight: face.weight === 'normal' ? '' : ` ${face.weight}` });
    }
    return fonts;
  }

  for (const img of [...document.images].slice(0, maxCollect)) classifyImage(img);
  for (const el of [...document.querySelectorAll('*')].slice(0, maxCollect)) classifyBackground(el);

  return {
    broken: [...buckets.broken.values()],
    noSource: [...buckets.noSource.values()],
    pending: [...buckets.pending.values()],
    backgrounds: [...buckets.backgrounds.values()],
    fonts: collectFonts(),
  };
}

function brokenFinding(item) {
  return {
    message: `The image "${label(item.url)}" failed to load, so its ${size(item)} slot renders empty${times(item.count)}.`,
    selector: item.selector,
    detail: { url: item.url, width: item.width, height: item.height, occurrences: item.count },
  };
}

function noSourceFinding(item) {
  return {
    message: `This <img> has no src and no srcset, so its ${size(item)} slot can never render anything${times(item.count)}.`,
    selector: item.selector,
    detail: { width: item.width, height: item.height, occurrences: item.count },
  };
}

function pendingFinding(item) {
  return {
    level: 'warn',
    message: `The image "${label(item.url)}" had still not finished loading when the page settled, so its ${size(item)} slot is empty on screen${times(item.count)}.`,
    selector: item.selector,
    detail: { url: item.url, width: item.width, height: item.height, occurrences: item.count },
  };
}

function fontFinding(font) {
  return {
    message: `The web font "${font.family}"${font.weight} failed to load, so every element asking for it renders in a fallback family.`,
    detail: { family: font.family, weight: font.weight.trim() || undefined },
  };
}

/**
 * A background image has no `naturalWidth` to inspect, so the only honest
 * evidence that one is missing is the network telling us the request died.
 */
function backgroundFindings(items, failed) {
  const findings = [];
  for (const item of items) {
    const request = failed.get(stripHash(item.url));
    if (!request) continue;
    findings.push({
      message: `The CSS background image "${label(item.url)}" failed to load (${reason(request)}), leaving a ${size(item)} area without it.`,
      selector: item.selector,
      detail: { url: item.url, status: request.status, reason: request.reason, width: item.width, height: item.height },
    });
  }
  return findings;
}

function cap(findings) {
  if (findings.length <= SHOWN) return findings;
  return [
    ...findings.slice(0, SHOWN),
    {
      level: 'warn',
      message: `And ${findings.length - SHOWN} more broken images or fonts on this page.`,
      detail: { total: findings.length },
    },
  ];
}

function failedUrlIndex(requests) {
  const index = new Map();
  for (const request of requests) {
    if (request?.url) index.set(stripHash(request.url), request);
  }
  return index;
}

function stripHash(url) {
  const text = String(url);
  const cut = text.indexOf('#');
  return cut === -1 ? text : text.slice(0, cut);
}

/** The file name is what a person recognises; the query string is noise. */
function label(url) {
  let name;
  try {
    const parsed = new URL(url);
    name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '') || parsed.host;
  } catch {
    name = String(url).split('?')[0].split('/').filter(Boolean).pop() || String(url);
  }
  return name.length > 48 ? `${name.slice(0, 45)}...` : name;
}

function size(item) {
  return `${item.width}x${item.height}`;
}

function times(count) {
  return count > 1 ? ` (${count} places on this page)` : '';
}

function reason(request) {
  if (request.status) return `HTTP ${request.status}`;
  return request.reason ? String(request.reason) : 'request failed';
}
