/**
 * The screen that never stops loading.
 *
 * A spinner that spins forever, a skeleton that never becomes content, an
 * eternal "Loading...". The build is green, the request came back 200, and the
 * user is staring at a page that never arrives.
 *
 * The whole check hangs on one idea: a loading indicator is only a bug if it
 * persists. So we look twice. The first pass tags every candidate with a marker
 * attribute, we wait, and the second pass asks who is still there. A skeleton
 * that disappeared in between did exactly what it was supposed to do and is
 * never reported.
 */

/** How long to wait between the two readings. Long enough for a normal fetch to land. */
const WAIT_MS = 1200;

/** Attribute used to recognize the same element on the second pass. Removed afterwards. */
const MARKER = 'data-looksright-seen';

/** How many culprits to name in `detail`, so a page of skeletons stays one finding. */
const MAX_SAMPLES = 8;

export default {
  id: 'stuck-loading',
  title: 'Stuck loading',
  level: 'error',

  async run({ page, config }) {
    const args = { marker: MARKER, ignore: config?.ignoreSelectors ?? [] };

    const before = await evaluateQuietly(page, { ...args, phase: 'mark', prev: null });
    if (!before || before.skipped) return [];

    await page.waitForTimeout(WAIT_MS);

    const after = await evaluateQuietly(page, { ...args, phase: 'verify', prev: before.seen });
    if (!after || after.skipped) return [];

    const findings = [];

    if (after.stuck.length) {
      const first = after.stuck[0];
      const total = after.stuck.length;
      findings.push({
        message: total > 1
          ? `${total} loading indicators were still on screen ${WAIT_MS}ms later, so the page never finished rendering. The first one is ${first.selector} (${first.label}).`
          : `A loading indicator was still on screen ${WAIT_MS}ms later, so the page never finished rendering: ${first.selector} (${first.label}).`,
        selector: first.selector,
        text: first.text || undefined,
        detail: {
          stuck: total,
          waitedMs: WAIT_MS,
          disappeared: after.disappeared,
          samples: after.stuck.slice(0, MAX_SAMPLES).map((s) => ({ selector: s.selector, label: s.label })),
        },
      });
    }

    // Two readings here too: `interactive` on the first pass is normal, it only
    // means something if the document is still not `complete` after the wait.
    if (before.readyState !== 'complete' && after.readyState !== 'complete') {
      findings.push({
        message: `The document never finished loading: readyState is still "${after.readyState}" ${WAIT_MS}ms after the page settled, so a script, image or font is still pending.`,
        detail: { readyStateBefore: before.readyState, readyStateAfter: after.readyState, waitedMs: WAIT_MS },
      });
    }

    return findings;
  },
};

/**
 * A page that navigates between the two readings destroys the execution context
 * mid-check. booking.com does exactly that. There is nothing to conclude about a
 * document that no longer exists, so the check stands down instead of crashing
 * the whole run.
 */
async function evaluateQuietly(page, args) {
  try {
    return await page.evaluate(scan, args);
  } catch {
    return null;
  }
}

/**
 * Runs in the browser, twice.
 *
 * `phase: 'mark'` finds candidates and tags them. `phase: 'verify'` reads the
 * tags back, keeps whoever is still visible, and cleans every tag it wrote.
 */
function scan({ marker, ignore, phase, prev }) {
  const doc = document;
  const root = doc.documentElement;

  // Opt out for the whole page, for apps that are legitimately a live dashboard
  // with a permanent activity indicator.
  if (!doc.body || root.hasAttribute('data-looksright-ignore') || doc.body.hasAttribute('data-looksright-ignore')) {
    return { skipped: true, readyState: doc.readyState, seen: {}, stuck: [], disappeared: 0 };
  }

  /** Class name fragments that only mean "loading" as a whole word. */
  const WORDS = new Set([
    'spinner', 'spinners', 'spin', 'loading', 'loader', 'loaders', 'preloader', 'preloading',
    'skeleton', 'skeletons', 'shimmer', 'shimmering', 'busy', 'carregando', 'carregar',
  ]);

  /**
   * Compound names that are unmistakable, but whose single words are not.
   * Anchored to a word start, because a loose "sk-" also lives inside
   * "task-list", "risk-badge" and "disk-usage".
   */
  const PHRASES = [
    { re: /(^|[^a-z0-9])placeholder-(glow|wave)/, label: 'skeleton placeholder' },
    { re: /(^|[^a-z0-9])animate-pulse/, label: 'pulsing placeholder' },
    { re: /(^|[^a-z0-9])(lds|sk)-[a-z]/, label: 'spinner' },
  ];

  /**
   * Values that mean the flag is off. Without this, `data-loading="false"` would
   * be read as a loading state by the attribute name alone.
   */
  const OFF = new Set(['false', '0', 'off', 'no', 'none', 'idle', 'done', 'complete', 'completed', 'loaded', 'ready', 'success', 'error', 'failed']);

  /**
   * Test hooks name the component, not its current state, and they stay on the
   * node after the content arrives. airbnb.com ships a rendered navigation bar
   * tagged `data-testid="shimmer-css-variable-index-0"`.
   */
  const TEST_HOOKS = new Set(['testid', 'test-id', 'test', 'cy', 'qa', 'qa-id', 'e2e', 'automation-id', 'tracking-id']);

  /**
   * Above this many characters of rendered text, a "skeleton" is not a skeleton.
   * Real placeholders are empty grey blocks; a node full of copy already has its
   * content, whatever its class is called.
   */
  const TEXT_IS_CONTENT = 40;

  const HIDDEN_ANCESTOR = '[aria-hidden="true"],[hidden],template,script,style,noscript,[data-looksright-ignore]';

  /**
   * Tailwind arbitrary values are CSS declarations, not state. vercel.com puts
   * `[--spinner-size:16px]` on every header button, and reading "spinner" out of
   * that accuses three links that are working perfectly.
   */
  function stripArbitrary(value) {
    return String(value).replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  }

  function words(value) {
    return String(value)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  function ignored(el) {
    for (const selector of ignore) {
      try {
        if (el.closest(selector)) return true;
      } catch {
        // A broken selector in someone's config must not take the run down.
      }
    }
    return false;
  }

  function painted(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility !== 'visible') return false;
    return Number(style.opacity) !== 0;
  }

  /**
   * Below the fold is not a stuck screen: infinite scroll sentinels and lazy
   * sections are supposed to sit there spinning until the user reaches them.
   */
  function onScreen(el) {
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    return box.top < innerHeight && box.bottom > 0 && box.left < innerWidth && box.right > 0;
  }

  function visible(el) {
    if (!el.isConnected || el.closest(HIDDEN_ANCESTOR)) return false;
    // checkVisibility walks ancestors, which catches a spinner inside a parent
    // that was hidden or faded out. Chrome has it; painted() is the fallback.
    if (typeof el.checkVisibility === 'function'
      && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    return painted(el) && onScreen(el);
  }

  function selectorFor(el) {
    const tag = el.tagName.toLowerCase();
    let out = tag;
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `${tag}#${el.id}`;
    const classes = (el.getAttribute('class') || '')
      .split(/\s+/)
      .filter((c) => c && /^[A-Za-z][\w-]*$/.test(c))
      .slice(0, 2);
    out += classes.map((c) => `.${c}`).join('');
    const parent = el.parentElement;
    if (parent) {
      const twins = [...parent.children].filter((s) => s.tagName === el.tagName);
      if (twins.length > 1) out += `:nth-of-type(${twins.indexOf(el) + 1})`;
    }
    return out;
  }

  /** Returns a human label for why this element looks like a loader, or null. */
  function classify(el) {
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (el.getAttribute('aria-busy') === 'true') return 'aria-busy region';

    // Only indeterminate progress bars count. A bar reporting a real percentage
    // is handled by the aria-valuenow comparison below, and a determinate bar
    // sitting still for one second is not enough evidence to accuse it.
    if (role === 'progressbar' && !el.hasAttribute('aria-valuenow')) return 'indeterminate progress bar';
    // A bar that reports a percentage is not a loader by itself: profile
    // completeness, storage used and skill meters are all determinate bars that
    // sit still forever by design. Only the aria-valuenow comparison below can
    // accuse one, and only when the value fails to move.
    if (role === 'progressbar') return null;

    const names = [stripArbitrary(el.getAttribute('class') || ''), el.id || ''];
    for (const attr of el.attributes) {
      if (!attr.name.startsWith('data-') || attr.name === marker) continue;
      const name = attr.name.slice(5);
      if (TEST_HOOKS.has(name)) continue;
      const value = attr.value.trim().toLowerCase();
      if (OFF.has(value)) continue;
      // Analytics payloads ride in data attributes as JSON. Their words describe
      // events, not the state of this element, so only short values are read.
      names.push(name);
      if (value.length <= 32 && !/^[[{]/.test(value)) names.push(value);
    }

    const text = (el.textContent || '').trim();
    if (text.length <= TEXT_IS_CONTENT) {
      const flat = names.join(' ').toLowerCase();
      for (const phrase of PHRASES) {
        if (phrase.re.test(flat)) return phrase.label;
      }
      for (const token of words(names.join(' '))) {
        if (!WORDS.has(token)) continue;
        if (token === 'skeleton' || token === 'skeletons' || token === 'shimmer' || token === 'shimmering') return 'skeleton placeholder';
        return 'spinner';
      }
    }

    // Loading copy, but only when the element is a leaf-ish node whose entire
    // text is the message. Otherwise an article that mentions "loading" in a
    // paragraph would be reported as a stuck screen.
    if (text && text.length <= 40 && el.children.length <= 1) {
      if (/^(loading|carregando|aguarde|please wait)\b/i.test(text)) return 'loading text';
    }

    return null;
  }

  /** An SVG turning forever with no end in sight is the classic spinner. */
  function spinningForever(el) {
    const style = getComputedStyle(el);
    if (!style.animationName || style.animationName === 'none') return false;
    if (!String(style.animationIterationCount).split(',').some((n) => n.trim() === 'infinite')) return false;
    return /spin|rotat|turn|circle/i.test(style.animationName);
  }

  if (phase === 'mark') {
    for (const stale of doc.querySelectorAll(`[${marker}]`)) stale.removeAttribute(marker);

    const found = new Set();
    const push = (el, looksLikeLoader) => {
      if (!looksLikeLoader || found.has(el)) return;
      if (ignored(el) || !visible(el)) return;
      found.add(el);
    };

    for (const el of doc.body.querySelectorAll('*')) push(el, classify(el));
    // getComputedStyle is expensive, so the animation sweep is limited to SVG,
    // where a forever-rotating shape is a loader and not a design flourish.
    for (const svg of doc.body.querySelectorAll('svg')) push(svg, spinningForever(svg));

    // A loading container and its inner dot are one problem, not two: keep the
    // outermost element of each nest so the count matches what a person sees.
    const outer = [...found].filter((el) => {
      for (let p = el.parentElement; p; p = p.parentElement) if (found.has(p)) return false;
      return true;
    });

    const seen = {};
    outer.forEach((el, i) => {
      const id = String(i);
      el.setAttribute(marker, id);
      seen[id] = {
        valuenow: el.getAttribute('aria-valuenow'),
        valuemax: el.getAttribute('aria-valuemax'),
      };
    });

    return { skipped: false, readyState: doc.readyState, seen, stuck: [], disappeared: 0 };
  }

  const marked = [...doc.querySelectorAll(`[${marker}]`)];
  const stuck = [];
  let survivors = 0;

  for (const el of marked) {
    const id = el.getAttribute(marker);
    const record = (prev && prev[id]) || null;
    el.removeAttribute(marker);
    if (!record) continue;
    if (!visible(el) || ignored(el)) continue;

    // The element must still look like a loader on the second read. An app that
    // flips aria-busy to false, or swaps the class from "skeleton" to "card",
    // reuses the same node to say it is done, and that is a success, not a bug.
    const label = classify(el) || (el.tagName === 'svg' && spinningForever(el) ? 'spinner' : null);
    if (!label) continue;
    survivors += 1;

    // A progress bar whose aria-valuenow moved is genuinely progressing, and one
    // that already sits at its maximum is finished. Neither is stuck.
    const valuenow = el.getAttribute('aria-valuenow');
    if (valuenow !== null) {
      if (valuenow !== record.valuenow) continue;
      const max = el.getAttribute('aria-valuemax') ?? record.valuemax ?? '100';
      if (Number(valuenow) >= Number(max)) continue;
    }

    stuck.push({
      selector: selectorFor(el),
      label,
      text: (el.textContent || '').trim().slice(0, 80),
    });
  }

  const total = prev ? Object.keys(prev).length : 0;
  return {
    skipped: false,
    readyState: doc.readyState,
    seen: {},
    stuck,
    disappeared: Math.max(0, total - survivors),
  };
}
