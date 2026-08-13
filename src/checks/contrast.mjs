/** How many distinct color problems to spell out before saying "and N more". */
const SHOWN = 8;

/**
 * Text nobody can comfortably read, measured against the background actually
 * painted behind it.
 *
 * This is the check most likely to cry wolf, so it is deliberately timid: every
 * situation where the real background cannot be read off the DOM (images,
 * gradients, blend modes, filters, text effects) is skipped instead of guessed.
 * A tool that flags a legitimate hero section over a photo gets uninstalled the
 * same day.
 */
export default {
  id: 'contrast',
  title: 'Text contrast',
  level: 'warn',

  async run({ page, config, theme }) {
    const groups = await page.evaluate(runInPage, {
      ignoreSelectors: config?.ignoreSelectors ?? [],
      theme,
    });

    if (!groups.length) return [];

    const findings = groups.slice(0, SHOWN).map((g) => ({
      message: message(g),
      selector: g.selector,
      text: g.text,
      detail: {
        ratio: g.ratio,
        required: g.required,
        color: g.color,
        background: g.background,
        fontSize: `${g.size}px`,
        fontWeight: g.weight,
        occurrences: g.count,
      },
    }));

    if (groups.length > SHOWN) {
      const rest = groups.slice(SHOWN);
      const elements = rest.reduce((sum, g) => sum + g.count, 0);
      findings.push({
        message: `And ${rest.length} more text colors below the WCAG AA minimum on this page, across ${elements} element${elements === 1 ? '' : 's'}. The worst of them is ${rest[0].ratio}:1.`,
        // Points at the worst of the ones not spelled out, so the reader still
        // has somewhere concrete to start.
        selector: rest[0].selector,
        detail: { groups: rest.length, elements },
      });
    }

    return findings;
  },
};

function message(g) {
  const where = g.text ? `on "${g.text}"` : `on ${g.selector}`;
  const size = `${g.size}px${g.weight >= 700 ? ' bold' : ''}`;
  const also = g.count > 1 ? ` Same colors on ${g.count} elements.` : '';
  return `Text contrast is ${g.ratio}:1 ${where}, below the ${g.required}:1 minimum for ${size} text (${g.color} on ${g.background}).${also}`;
}

/**
 * Everything below runs inside the browser, so it takes its inputs as one
 * argument and can only use DOM APIs.
 */
function runInPage({ ignoreSelectors, theme }) {
  /** Above this many text nodes the page is a data dump; the first slice is representative enough. */
  const MAX_NODES = 4000;
  /** Single characters are icons, bullets or decorative initials, not prose. */
  const MIN_CHARS = 3;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'HEAD', 'OPTION']);

  const styles = new Map();
  const css = (el) => {
    let s = styles.get(el);
    if (!s) {
      s = getComputedStyle(el);
      styles.set(el, s);
    }
    return s;
  };

  let ctx = null;
  const colorCache = new Map();

  /** Resolves any CSS color the browser understands, including oklch() and color(). */
  function parseColor(value) {
    if (!value) return null;
    if (colorCache.has(value)) return colorCache.get(value);

    let out = null;
    const legacy = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
    if (legacy) {
      const parts = legacy[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) {
        const a = parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
        out = { r: parts[0], g: parts[1], b: parts[2], a };
      }
    }

    if (!out) {
      // oklch/lab/color() computed values are common with modern CSS, and the
      // only conversion that is guaranteed correct is the browser's own.
      try {
        if (!ctx) ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        out = { r, g, b, a: a / 255 };
      } catch {
        out = null;
      }
    }

    colorCache.set(value, out);
    return out;
  }

  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  const luminance = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);

  const ratioOf = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  };

  const CLEAR = { r: 0, g: 0, b: 0, a: 0 };

  /**
   * Source-over with alpha on both sides, because the stack of layers behind a
   * glyph is not opaque until the last one. Over an opaque base this reduces to
   * the usual linear blend.
   */
  const over = (top, base) => {
    const a = top.a + base.a * (1 - top.a);
    if (a <= 0) return { ...CLEAR };
    const mix = (t, b) => (t * top.a + b * base.a * (1 - top.a)) / a;
    return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a };
  };

  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

  /**
   * Properties that can put an arbitrary color behind or over the glyphs.
   * Any of them on any layer means the painted color cannot be derived from the
   * CSS, and a measurement there would be a guess.
   */
  const UNMEASURABLE = ['backgroundImage', 'mixBlendMode', 'filter', 'backdropFilter'];
  const NEUTRAL = new Set(['none', 'normal', '']);
  const blocksMeasurement = (s) => UNMEASURABLE.some((prop) => !NEUTRAL.has(s[prop] ?? ''));

  const opacityOf = (s) => {
    const o = parseFloat(s.opacity);
    return Number.isFinite(o) ? o : 1;
  };

  function matchesIgnored(el) {
    for (const sel of ignoreSelectors) {
      try {
        if (el.closest(sel)) return true;
      } catch {
        // An invalid selector in the user config must not abort the run.
      }
    }
    return false;
  }

  function weightOf(value) {
    if (value === 'bold') return 700;
    if (value === 'normal') return 400;
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : 400;
  }

  /**
   * The color the user agent paints when no layer is opaque.
   *
   * White on every engine in light mode; in dark mode it depends on how the
   * page declares color-scheme, so there is no honest value to return.
   */
  function canvasColor() {
    const scheme = css(document.documentElement).colorScheme || '';
    if (theme === 'dark' || scheme.includes('dark')) return null;
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  /**
   * Walks up until it finds something opaque behind the text, painting the
   * text and its background through the same stack of layers.
   *
   * Returns null whenever a layer makes the real color unknowable, which is the
   * whole false positive defense: a gradient, a photo, a blend mode or a filter
   * can put any color behind the glyphs and measuring the CSS says nothing.
   */
  function compose(el, color) {
    // `opacity` fades a group: the element, its background and its descendants
    // are painted together and only then blended with what is behind them.
    // Carrying the text and its local background up the tree side by side is
    // what keeps that single fade from being counted twice, once on the text
    // and once on the background it sits on.
    let text = { ...color };
    let back = CLEAR;

    for (let node = el; node; node = node.parentElement) {
      const s = css(node);
      if (blocksMeasurement(s)) return null;

      const bg = parseColor(s.backgroundColor);
      if (!bg) return null;
      if (bg.a > 0) {
        back = over(back, bg);
        text = over(text, bg);
      }

      const o = opacityOf(s);
      if (o < 1) {
        back = { ...back, a: back.a * o };
        text = { ...text, a: text.a * o };
      }

      if (back.a >= 0.999) break;
    }

    if (back.a < 0.999) {
      const canvas = canvasColor();
      if (!canvas) return null;
      back = over(back, canvas);
      text = over(text, canvas);
    }

    return { text, back };
  }

  const PAINTING_TAGS = new Set(['IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'SVG', 'IFRAME']);

  const paints = (el) => {
    // SVG elements keep their lowercase local name, HTML ones are uppercased.
    if (PAINTING_TAGS.has(el.tagName.toUpperCase())) return true;
    const s = css(el);
    if (!NEUTRAL.has(s.backgroundImage ?? '')) return true;
    const bg = parseColor(s.backgroundColor);
    return Boolean(bg && bg.a > 0);
  };

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());

  /**
   * A sibling branch painting under the text, which the ancestor walk cannot
   * see: `<section><img class="hero-bg"><h1>white text</h1></section>` has a
   * fully transparent ancestor chain and a photo behind every glyph.
   */
  function foreignPainter(el, rect) {
    for (let a = el.parentElement; a; a = a.parentElement) {
      for (const kid of a.children) {
        if (kid.contains(el) || el.contains(kid)) continue;
        if (overlaps(kid.getBoundingClientRect(), rect) && paints(kid)) return true;
      }
    }
    return false;
  }

  /**
   * The browser's own hit test, which also catches layers living in another
   * branch of the tree. Only elements that actually paint count: transparent
   * full screen wrappers are everywhere, and vetoing on those would silence
   * the whole page.
   *
   * Foreign text at the same point counts as painting, because two stacked
   * copies of a headline (stripe.com ships one in green under a half
   * transparent blue one) show the eye a composite that neither computed
   * `color` describes.
   */
  function foreignInStack(el, rect) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return false;
    return document.elementsFromPoint(x, y)
      .some((n) => !n.contains(el) && !el.contains(n) && (paints(n) || hasOwnText(n)));
  }

  function selectorFor(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `${tag}#${el.id}`;

    const classes = [...el.classList]
      .filter((c) => /^[A-Za-z][\w-]*$/.test(c))
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');

    let base = tag + classes;
    const parent = el.parentElement;
    if (parent) {
      const twins = [...parent.children].filter((c) => c.tagName === el.tagName);
      if (twins.length > 1) base += `:nth-of-type(${twins.indexOf(el) + 1})`;
      const owner = parent.id && /^[A-Za-z][\w-]*$/.test(parent.id) ? `#${parent.id} > ` : '';
      return owner + base;
    }
    return base;
  }

  /**
   * Text hidden on purpose so a screen reader still announces it.
   *
   * Caught in the wild on a real app: a `span.sr-only` reading "Qual e o
   * caminhao" was reported at 2:1, because the developer did the accessible
   * thing and the tool called it a bug. Nobody keeps a tool that punishes that.
   *
   * The class list covers the named helpers; the clip test covers every
   * hand-rolled version, since absolute positioning plus `clip` or
   * `clip-path: inset(50%)` has no purpose left other than hiding.
   */
  const A11Y_HIDDEN = [
    '.sr-only', '.sr-only-focusable', '.visually-hidden', '.visuallyhidden',
    '.visually-hidden-focusable', '.screen-reader-text', '.screen-reader-only',
    '.screenreader-only', '.a11y-hidden', '.accessibly-hidden', '.hidden-visually',
    '.hide-visually', '.element-invisible',
  ].join(',');

  function isForScreenReadersOnly(el, s) {
    if (el.closest(A11Y_HIDDEN)) return true;
    if (s.position !== 'absolute' && s.position !== 'fixed') return false;
    if (s.clip && s.clip !== 'auto') return true;
    if (s.clipPath === 'inset(50%)') return true;
    // The other hand-rolled shape: a 1px box with the text overflowing out of it.
    const box = el.getBoundingClientRect();
    return box.width <= 1.5 && box.height <= 1.5;
  }

  function isVisible(el) {
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    } else {
      const s = css(el);
      if (s.display === 'none' || s.visibility !== 'visible') return false;
    }
    if (isForScreenReadersOnly(el, css(el))) return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  }

  /**
   * Glyphs repainted by something other than `color`, so the computed value is
   * not what the eye sees.
   */
  function hasTextEffects(s) {
    if (!NEUTRAL.has(s.textShadow ?? '')) return true;
    if (parseFloat(s.webkitTextStrokeWidth || '0') > 0) return true;
    return (s.backgroundClip || s.webkitBackgroundClip || '').includes('text');
  }

  /**
   * Text this check refuses to judge.
   *
   * Disabled controls are dimmed on purpose, so reporting them would be noise
   * on every form in the world. Placeholders never reach this walker at all:
   * they live in an attribute, not in a text node. SVG text is painted with
   * `fill`, not `color`, and `contenteditable` holds whatever the user typed.
   */
  const EXEMPT = [
    '[aria-hidden="true"]', '[hidden]', 'template', 'svg', '[contenteditable="true"]',
    '[aria-disabled="true"]', '[disabled]', 'fieldset[disabled]',
  ].join(', ');

  function isExempt(el) {
    if (hasTextEffects(css(el))) return true;
    if (el.closest(EXEMPT)) return true;
    try {
      return Boolean(el.closest(':disabled'));
    } catch {
      return false;
    }
  }

  const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
  const owners = new Map();
  let seen = 0;

  while (walker.nextNode() && seen < MAX_NODES) {
    const node = walker.currentNode;
    const raw = node.nodeValue ?? '';
    if (!raw.trim()) continue;

    const el = node.parentElement;
    if (!el || SKIP_TAGS.has(el.tagName)) continue;
    seen++;

    const prev = owners.get(el);
    owners.set(el, prev ? `${prev} ${raw}` : raw);
  }

  const groups = new Map();

  for (const [el, raw] of owners) {
    const text = raw.replace(/\s+/g, ' ').trim();
    if (text.replace(/\s/g, '').length < MIN_CHARS) continue;
    if (matchesIgnored(el) || isExempt(el) || !isVisible(el)) continue;

    const s = css(el);
    const fg = parseColor(s.webkitTextFillColor && s.webkitTextFillColor !== 'currentcolor' ? s.webkitTextFillColor : s.color);
    if (!fg) continue;

    // Fully transparent text is not a contrast problem, it is invisible text,
    // and `invisible-text` reports it with a much better message.
    if (fg.a <= 0.02) continue;

    const layers = compose(el, fg);
    if (!layers) continue;

    const painted = layers.text;
    const back = layers.back;
    if (painted.a <= 0.02) continue;

    const ratio = Math.round(ratioOf(painted, back) * 10) / 10;

    // Text the same color as its backdrop is not a contrast problem, it is
    // invisible text, and `invisible-text` says that far better than a ratio.
    if (ratio <= 1.05) continue;

    const size = parseFloat(s.fontSize) || 16;
    const weight = weightOf(s.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    if (ratio >= required) continue;

    // Only failing candidates pay for this, which keeps the walk cheap while
    // keeping what gets reported conservative.
    const rect = el.getBoundingClientRect();
    if (foreignInStack(el, rect) || foreignPainter(el, rect)) continue;

    const color = hex(painted);
    const background = hex(back);
    const key = `${color}|${background}|${Math.round(size)}|${weight}`;
    const found = groups.get(key);
    if (found) {
      found.count++;
      continue;
    }

    groups.set(key, {
      ratio,
      required,
      color,
      background,
      size: Math.round(size * 10) / 10,
      weight,
      text: text.length > 60 ? `${text.slice(0, 57)}...` : text,
      selector: selectorFor(el),
      count: 1,
    });
  }

  return [...groups.values()].sort((a, b) => a.ratio - b.ratio);
}
