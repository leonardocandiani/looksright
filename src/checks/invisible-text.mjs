/** Findings shown individually before the run collapses the rest into a count. */
const SHOWN = 8;

/**
 * Below this contrast ratio the text is not "hard to read", it is gone. 1.0 is
 * literally the same color as the background; 1.35 still reads as a smudge on
 * a good monitor and as nothing at all on a laptop screen in daylight. The
 * contrast check owns everything above it, at 4.5:1, and reports it as a warn.
 */
const INVISIBLE_RATIO = 1.35;

/** A text color this faint paints a couple of levels away from the background. */
const MIN_ALPHA = 0.15;

/** Longest quote we put inside the message itself. */
const QUOTE = 42;

/**
 * Text painted in the same color as the thing behind it.
 *
 * This is the half-finished theme bug: someone styled the light palette, the
 * dark one inherited a hardcoded near-black, and a heading, a price or a
 * button label simply stopped existing. It survives code review because the
 * DOM is correct and the text really is there, and it survives a screenshot
 * diff on the light theme because that theme is fine.
 *
 * It is filed as an error, not as a contrast warning, on purpose: at these
 * ratios nobody squints and reads it anyway.
 */
export default {
  id: 'invisible-text',
  title: 'Invisible text',
  level: 'error',

  async run({ page, theme, config }) {
    const hits = await page.evaluate(findInvisibleText, {
      ignoreSelectors: config?.ignoreSelectors ?? [],
      theme,
      invisibleRatio: INVISIBLE_RATIO,
      minAlpha: MIN_ALPHA,
    });

    if (!hits.length) return [];

    const mode = theme === 'dark' ? 'dark mode' : 'light mode';
    const findings = hits.slice(0, SHOWN).map((hit) => ({
      message: describe(hit, mode),
      selector: hit.selector,
      text: hit.text,
      detail: {
        color: hit.color,
        background: hit.background,
        ratio: hit.ratio,
        alpha: hit.alpha,
        reason: hit.reason,
      },
    }));

    if (hits.length > SHOWN) {
      findings.push({
        level: 'warn',
        message: `And ${hits.length - SHOWN} more elements whose text is invisible against its background in ${mode}.`,
        detail: { total: hits.length },
      });
    }

    return findings;
  },
};

function describe(hit, mode) {
  const quote = hit.text.length > QUOTE ? `${hit.text.slice(0, QUOTE - 3)}...` : hit.text;

  if (hit.reason === 'transparent') {
    return `Text is invisible in ${mode}: '${quote}' is painted with color: transparent on a ${hit.background} background, and nothing fills it in (no background-clip: text).`;
  }
  if (hit.reason === 'faded') {
    return `Text is invisible in ${mode}: '${quote}' is ${hit.color} at ${Math.round(hit.alpha * 100)}% alpha on a ${hit.background} background, which lands at ${hit.ratio}:1.`;
  }
  return `Text is invisible in ${mode}: '${quote}' is ${hit.color} on a ${hit.background} background (${hit.ratio}:1).`;
}

/**
 * Runs inside the page. Everything it needs arrives in `args`, because none of
 * the module scope above exists in the browser.
 */
function findInvisibleText({ ignoreSelectors, theme, invisibleRatio, minAlpha }) {
  /**
   * Elements hidden on purpose so a screen reader still announces them.
   * Reporting these is the fastest way to get the tool uninstalled: the
   * developer did the accessible thing and the tool called it a bug.
   */
  const A11Y_HIDDEN = [
    '.sr-only',
    '.sr-only-focusable',
    '.visually-hidden',
    '.visuallyhidden',
    '.visually-hidden-focusable',
    '.screen-reader-text',
    '.screen-reader-only',
    '.screenreader-only',
    '.a11y-hidden',
    '.accessibly-hidden',
    '.hidden-visually',
    '.hide-visually',
    '.element-invisible',
  ].join(',');

  /** Tags whose text we never paint, or that the OS paints for us. */
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD',
    'OPTION', 'OPTGROUP', 'SELECT', 'IFRAME', 'CANVAS',
  ]);

  const CLEAR = { r: 0, g: 0, b: 0, a: 0 };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const DARK_CANVAS = { r: 18, g: 18, b: 18, a: 1 };

  const parseColor = (value) => {
    const v = String(value || '').trim().toLowerCase();
    if (v === 'transparent') return CLEAR;
    // A color space other than srgb needs a real conversion, and a wrong
    // conversion here means a wrong accusation. Report it as unknown instead.
    const srgb = v.startsWith('color(srgb');
    if (!srgb && !v.startsWith('rgb')) return null;
    const n = (v.match(/-?\d*\.?\d+/g) || []).map(Number);
    if (n.length < 3) return null;
    const scale = srgb ? 255 : 1;
    const alpha = n.length > 3 ? Math.min(1, Math.max(0, n[3])) : 1;
    return { r: n[0] * scale, g: n[1] * scale, b: n[2] * scale, a: alpha };
  };

  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a <= 0) return CLEAR;
    const mix = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
  };

  const channel = (c) => {
    const s = Math.min(255, Math.max(0, c)) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const hex = (c) => {
    const part = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
    return `#${part(c.r)}${part(c.g)}${part(c.b)}`;
  };

  const safeName = (name) => /^[A-Za-z][\w-]*$/.test(name);

  const shortLabel = (el) => {
    if (el.id && safeName(el.id)) return `${el.tagName.toLowerCase()}#${el.id}`;
    const classes = [...el.classList].filter((c) => safeName(c) && c.length < 30).slice(0, 2);
    return el.tagName.toLowerCase() + classes.map((c) => `.${c}`).join('');
  };

  /** tag + id or two classes, one level of parent, and a nth-of-type only when needed. */
  const selectorFor = (el) => {
    let base = shortLabel(el);
    const parent = el.parentElement;
    if (!parent) return base;

    const twins = [...parent.children].filter((c) => c.matches(base));
    if (twins.length > 1) {
      const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName);
      base += `:nth-of-type(${sameTag.indexOf(el) + 1})`;
    }

    const parentTag = parent.tagName.toLowerCase();
    if (parentTag === 'body' || parentTag === 'html') return base;
    return `${shortLabel(parent)} > ${base}`;
  };

  const matchesIgnored = (el) => ignoreSelectors.some((sel) => {
    try {
      return Boolean(el.closest(sel));
    } catch {
      return false;
    }
  });

  const directText = (el) => {
    let out = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) out += node.nodeValue;
    }
    return out.replace(/\s+/g, ' ').trim();
  };

  /**
   * The text this element paints itself, or null when the element is out of
   * scope: hidden from everyone, hidden for everyone except screen readers,
   * ignored by config, or holding nothing but decoration.
   */
  const visibleText = (el) => {
    if (SKIP_TAGS.has(el.tagName)) return null;
    if (el.closest('[aria-hidden="true"], [hidden]')) return null;
    if (el.closest(A11Y_HIDDEN)) return null;
    if (matchesIgnored(el)) return null;

    const text = directText(el);
    // A lone glyph from an icon font or a stray bullet is not the bug we hunt,
    // and its color usually comes from a pseudo element we cannot read.
    if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  };

  /**
   * The clip trick behind every hand-rolled sr-only helper. The legacy `clip`
   * property has no use left other than hiding, and `inset(50%)` clips the box
   * down to nothing, so both mean the text was hidden on purpose even when the
   * element still measures full size.
   */
  const isClipped = (style) => {
    if (style.position !== 'absolute' && style.position !== 'fixed') return false;
    if (style.clip && style.clip !== 'auto') return true;
    return style.clipPath === 'inset(50%)';
  };

  /**
   * Off in the margins of the document: another deliberate way to hide text,
   * and also where carousels park the slides nobody is looking at.
   */
  const isParked = (rect) => {
    const docWidth = document.documentElement.scrollWidth;
    return rect.right < -600 || rect.left > docWidth + 600 || rect.bottom < -2000;
  };

  const isRendered = (el) => {
    if (typeof el.checkVisibility !== 'function') return true;
    return el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
  };

  /**
   * Something from another subtree is sitting on this spot: a modal, a cookie
   * banner, a decorative layer. Whatever the text color is, the background we
   * computed is not what ends up behind it.
   */
  const isCovered = (el, rect) => {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    if (!top || top === el) return false;
    return !el.contains(top) && !top.contains(el);
  };

  /** Does this element occupy a box a person could actually look at? */
  const hasVisibleBox = (el, style) => {
    if (!isRendered(el)) return false;
    if (style.display === 'none' || style.visibility !== 'visible') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    return !isParked(rect) && !isClipped(style) && !isCovered(el, rect);
  };

  /** Ways of hiding or outlining text that are deliberate, not a color bug. */
  const isDeliberate = (style) => {
    if (parseFloat(style.fontSize) < 1) return true;
    // The pre-CSS way of replacing a heading with a logo image.
    if (parseFloat(style.textIndent) <= -100) return true;
    // A shadow or a stroke can carry text that matches its own background,
    // which is an outlined look on purpose and not a broken theme.
    if (style.textShadow && style.textShadow !== 'none') return true;
    return parseFloat(style.webkitTextStrokeWidth) > 0;
  };

  /** The style that paints this text, or null when we have no business judging it. */
  const paintStyle = (el) => {
    const style = getComputedStyle(el);
    if (!hasVisibleBox(el, style) || isDeliberate(style)) return null;
    return style;
  };

  /** Anything that repaints the pixels after we computed them. */
  const repaints = (style) =>
    (style.backgroundImage && style.backgroundImage !== 'none') ||
    (style.filter && style.filter !== 'none') ||
    (style.backdropFilter && style.backdropFilter !== 'none') ||
    (style.mixBlendMode && style.mixBlendMode !== 'normal');

  /**
   * An element lifted out of the normal flow. Crossing one on the way up to
   * the background means a sibling we never looked at may be painting in
   * between, which is how a hero with a video or a canvas behind white text
   * looks exactly like white text on a white section.
   */
  const floats = (style) => {
    if (style.position === 'absolute' || style.position === 'fixed' || style.position === 'sticky') return true;
    return style.position !== 'static' && style.zIndex !== 'auto';
  };

  const noteLayer = (state, style) => {
    if (repaints(style)) state.unknownPaint = true;
    if (style.backgroundClip === 'text' || style.webkitBackgroundClip === 'text') state.gradientText = true;
    state.opacity *= Number(style.opacity) || 0;
  };

  const stackBackground = (state, style) => {
    const bg = parseColor(style.backgroundColor);
    if (!bg) {
      state.unknownPaint = true;
      return;
    }
    if (bg.a > 0) {
      state.background = over(state.background, bg);
      state.opaqueFound = state.background.a >= 0.999;
    }
    if (!state.opaqueFound && floats(style)) state.unknownPaint = true;
  };

  /**
   * One walk up the tree collects everything the verdict depends on: the
   * background actually behind the text, and the reasons to stay quiet.
   */
  const inspectAncestry = (el) => {
    const state = { background: CLEAR, opacity: 1, opaqueFound: false, unknownPaint: false, gradientText: false };
    for (let node = el; node; node = node.parentElement) {
      // Everything above the first opaque background is behind a wall: a
      // `filter` or `background-image` on <body> cannot affect text painted
      // over an opaque card, and letting it set `unknownPaint` there silenced
      // the whole check for every element on the page.
      if (state.opaqueFound) break;
      const style = getComputedStyle(node);
      noteLayer(state, style);
      stackBackground(state, style);
    }
    return state;
  };

  /**
   * What the browser paints behind everything when nothing in the chain is
   * opaque. Guessing it from the theme is wrong whenever the page opts out of
   * dark backgrounds, so we ask the browser: the `Canvas` system color
   * resolves against the root's used color-scheme. The probe element lives for
   * one style read and is always removed.
   */
  const canvasColor = () => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;background-color:Canvas;';
    try {
      document.documentElement.appendChild(probe);
      return parseColor(getComputedStyle(probe).backgroundColor) || WHITE;
    } catch {
      return theme === 'dark' ? DARK_CANVAS : WHITE;
    } finally {
      probe.remove();
    }
  };

  const usable = (ancestry) => {
    if (ancestry.unknownPaint || ancestry.gradientText) return false;
    // Anything mid-fade or sitting under a translucent parent gets a pass: we
    // cannot tell a settled state from an animation frame.
    return ancestry.opacity >= 0.98;
  };

  const reasonFor = (fill, ratio) => {
    if (fill.a === 0) return 'transparent';
    if (fill.a < minAlpha) return 'faded';
    return ratio < invisibleRatio ? 'same-color' : null;
  };

  const judge = (el, text, fill, ancestry, canvas) => {
    const background = ancestry.opaqueFound ? ancestry.background : over(ancestry.background, canvas);
    const ratio = contrast(over(fill, background), background);

    const reason = reasonFor(fill, ratio);
    if (!reason) return null;

    return {
      selector: selectorFor(el),
      text,
      color: fill.a === 0 ? 'transparent' : hex(fill),
      background: hex(background),
      alpha: Math.round(fill.a * 100) / 100,
      ratio: Math.round(ratio * 100) / 100,
      reason,
    };
  };

  const inspect = (el, canvas) => {
    const text = visibleText(el);
    if (!text) return null;
    const style = paintStyle(el);
    if (!style) return null;
    const ancestry = inspectAncestry(el);
    if (!usable(ancestry)) return null;
    // -webkit-text-fill-color wins over color whenever both are set.
    const fill = parseColor(style.webkitTextFillColor) || parseColor(style.color);
    if (!fill) return null;
    return judge(el, text, fill, ancestry, canvas);
  };

  /** Elements that own a non-empty text node, which is who paints that text. */
  const collectCandidates = () => {
    const found = new Set();
    const root = document.body || document.documentElement;
    if (!root) return found;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue && node.nodeValue.trim() && node.parentElement) found.add(node.parentElement);
      if (found.size >= 3000) break;
    }
    return found;
  };

  const canvas = canvasColor();
  const hits = [];
  for (const el of collectCandidates()) {
    const hit = inspect(el, canvas);
    if (hit) hits.push(hit);
  }

  hits.sort((a, b) => a.ratio - b.ratio);
  return hits;
}
