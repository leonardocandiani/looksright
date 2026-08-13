/**
 * Buttons and links too small to hit with a thumb.
 *
 * This is the bug you only find by holding the phone: on a mouse-driven desktop
 * a 16px icon button is fine, on a 390px screen it is a coin toss. So the check
 * runs on narrow viewports only, where the pointer is a finger.
 *
 * Two thresholds, because there are two standards and both are useful. Apple's
 * HIG asks for 44x44 CSS px, which is what actually feels good under a thumb,
 * and missing it is a warning. WCAG 2.2 AA (2.5.8) asks for 24x24, which is the
 * floor a page has to clear to be accessible at all, and missing that is an
 * error. The spec grants an exception we honour: an undersized target still
 * passes when nothing else sits within 24px of it, so a lonely 20px button is a
 * warning while the same button flush against its neighbour is an error.
 *
 * The hard part is not measuring, it is knowing when a small box is fine. Most
 * of the code below is exclusions: a small link inside a card that is itself
 * clickable, a checkbox sitting next to its label, a link in the middle of a
 * sentence, a slide parked outside a carousel, the 1x1 input that screen reader
 * markup leaves behind. Each one is a place where naive measuring shouts about
 * something a real user has no trouble tapping.
 */

/** Apple HIG comfortable size. Under this is a warning. */
const COMFORTABLE = 44;

/** WCAG 2.2 AA minimum (2.5.8 Target Size), when the spacing exception fails. */
const WCAG_MIN = 24;

/** Above this width we assume a mouse, and the criterion does not apply. */
const TOUCH_MAX_WIDTH = 600;

/** How many targets to name before collapsing the rest into a count. */
const SHOWN = 8;

export default {
  id: 'tiny-targets',
  title: 'Touch target size',
  level: 'warn',

  async run({ page, viewport, config }) {
    // A desktop viewport means a mouse, and a mouse hits a 16px icon fine. The
    // whole criterion is about fingers, so on a wide screen there is nothing to
    // say and reporting anything here would be noise.
    if (viewport.width >= TOUCH_MAX_WIDTH) return [];

    const found = await page.evaluate(measureTargets, {
      comfortable: COMFORTABLE,
      wcagMin: WCAG_MIN,
      ignoreSelectors: config?.ignoreSelectors ?? [],
    });

    const findings = found.items.slice(0, SHOWN).map((item) => ({
      level: breaksWcag(item) ? 'error' : 'warn',
      message: describe(item),
      selector: item.selector,
      text: item.name || undefined,
      detail: {
        width: item.width,
        height: item.height,
        wcagMin: WCAG_MIN,
        comfortable: COMFORTABLE,
        crowded: item.crowded,
        viewportWidth: viewport.width,
      },
    }));

    if (found.items.length > SHOWN) {
      const rest = found.items.length - SHOWN;
      findings.push({
        level: 'warn',
        message: `And ${rest} more touch ${rest === 1 ? 'target' : 'targets'} smaller than ${COMFORTABLE}x${COMFORTABLE} px on this ${viewport.width}px screen.`,
        detail: { total: found.items.length },
      });
    }

    return findings;
  },
};

/** Undersized AND packed tight against a neighbour: no WCAG exception applies. */
function breaksWcag(item) {
  return (item.width < WCAG_MIN || item.height < WCAG_MIN) && item.crowded;
}

function describe(item) {
  const who = item.name
    ? `The "${trim(item.name)}" ${item.kind}`
    : `An unlabelled ${item.kind} (${item.selector})`;
  const undersized = item.width < WCAG_MIN || item.height < WCAG_MIN;
  const size = `${item.width}x${item.height} px${tightSide(item, undersized ? WCAG_MIN : COMFORTABLE)}`;

  if (breaksWcag(item)) {
    return `${who} is ${size}, under the ${WCAG_MIN}x${WCAG_MIN} px minimum touch target size required by WCAG 2.2 AA, with another target less than ${WCAG_MIN} px away (${COMFORTABLE}x${COMFORTABLE} px is the size that feels right under a thumb).`;
  }
  if (undersized) {
    return `${who} is ${size}, under the ${COMFORTABLE}x${COMFORTABLE} px touch target size recommended for phones (it clears WCAG 2.2 AA only because nothing else sits within ${WCAG_MIN} px of it).`;
  }
  return `${who} is ${size}, under the ${COMFORTABLE}x${COMFORTABLE} px touch target size recommended for phones (it does clear the ${WCAG_MIN}x${WCAG_MIN} px WCAG minimum).`;
}

/**
 * Names the side that fails when only one of them does. "113x18 px" reads like
 * a big target until you notice which number is the problem.
 */
function tightSide(item, limit) {
  const narrow = item.width < limit;
  const short = item.height < limit;
  if (narrow === short) return '';
  return narrow ? `, only ${item.width} px wide` : `, only ${item.height} px tall`;
}

function trim(value) {
  const line = String(value).replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${line.slice(0, 57)}...` : line;
}

/**
 * Runs in the page. Everything it needs arrives in `args`, since none of the
 * module scope above exists inside the browser.
 */
function measureTargets(args) {
  const { comfortable, wcagMin, ignoreSelectors } = args;

  const INTERACTIVE = [
    'a[href]',
    'button',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="tab"]',
    '[tabindex]:not([tabindex="-1"])',
    'summary',
    'label[for]',
  ].join(',');

  /** An ancestor matching one of these makes the whole area tappable. */
  const CLICKABLE_ANCESTOR = 'a[href], button, label, summary, [role="button"], [role="link"], [onclick]';

  /** Blocks that hold running prose, where an inline link cannot be 44px tall. */
  const PROSE = 'p, blockquote, figcaption, dd, td, th, h1, h2, h3, h4, h5, h6';

  const NEVER = '[aria-hidden="true"], [hidden], [inert], template, script, style, noscript';

  const doc = document;
  const root = doc.documentElement;

  const safeCount = (selector) => {
    try {
      return doc.querySelectorAll(selector).length;
    } catch {
      return 99;
    }
  };

  const matchesIgnored = (el) => ignoreSelectors.some((selector) => {
    try {
      return Boolean(el.closest(selector));
    } catch {
      return false;
    }
  });

  const isVisible = (el) => {
    if (typeof el.checkVisibility === 'function') {
      const ok = el.checkVisibility({
        checkOpacity: true,
        checkVisibilityCSS: true,
        opacityProperty: true,
        visibilityProperty: true,
        contentVisibilityAuto: true,
      });
      if (!ok) return false;
    }
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility !== 'visible') return false;
    if (Number(style.opacity) === 0) return false;
    // Something painted on top handles the taps, so this element is decoration.
    if (style.pointerEvents === 'none') return false;
    return el.getClientRects().length > 0;
  };

  const isDisabled = (el) => el.disabled === true
    || el.getAttribute('aria-disabled') === 'true'
    || Boolean(el.closest('fieldset[disabled]'));

  /** Negative offsets on an absolutely positioned pseudo grow the hit area. */
  const negative = (value) => {
    const n = parseFloat(value);
    return Number.isFinite(n) && n < 0 ? -n : 0;
  };

  const withPseudoPadding = (el, rect) => {
    // A pseudo only grows THIS element's box when the element is its containing
    // block. On a static element the offsets resolve against some ancestor, so
    // they say nothing about the tap area here.
    if (getComputedStyle(el).position === 'static') return rect;

    let top = 0;
    let right = 0;
    let bottom = 0;
    let left = 0;
    for (const which of ['::before', '::after']) {
      const pseudo = getComputedStyle(el, which);
      if (!pseudo || pseudo.content === 'none' || pseudo.position !== 'absolute') continue;
      top = Math.max(top, negative(pseudo.top));
      right = Math.max(right, negative(pseudo.right));
      bottom = Math.max(bottom, negative(pseudo.bottom));
      left = Math.max(left, negative(pseudo.left));
    }
    if (!(top || right || bottom || left)) return rect;

    return {
      left: rect.left - left,
      top: rect.top - top,
      right: rect.right + right,
      bottom: rect.bottom + bottom,
      width: rect.width + left + right,
      height: rect.height + top + bottom,
    };
  };

  const asBox = (rect) => ({
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  });

  const labelFor = (el) => {
    if (!el.id) return null;
    try {
      return doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    } catch {
      return null;
    }
  };

  /**
   * A checkbox next to its own label is one target, not two: tapping the label
   * toggles the control. Only merge when they actually sit together, so a label
   * at the top of the form does not lend its width to a field far below.
   */
  const withLabel = (el, box) => {
    const label = labelFor(el);
    if (!label || !isVisible(label)) return box;

    const other = label.getBoundingClientRect();
    const gapX = Math.max(box.left - other.right, other.left - box.right, 0);
    const gapY = Math.max(box.top - other.bottom, other.top - box.bottom, 0);
    if (gapX > 8 || gapY > 8) return box;

    const left = Math.min(box.left, other.left);
    const top = Math.min(box.top, other.top);
    const right = Math.max(box.right, other.right);
    const bottom = Math.max(box.bottom, other.bottom);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  };

  /**
   * A small link inside a card that is itself clickable is not a small target.
   *
   * `cursor: pointer` counts as clickable alongside the real interactive tags,
   * because the most common big-target pattern on the web is a plain <div> row
   * wired up with addEventListener, which the DOM gives us no other way to see.
   * The walk stops at <body> so that a page setting the cursor globally cannot
   * silence the whole check.
   */
  const isClickableBox = (node) => {
    if (node.matches(CLICKABLE_ANCESTOR)) return true;
    return getComputedStyle(node).cursor === 'pointer';
  };

  const hasBigClickableAncestor = (el) => {
    let node = el.parentElement;
    while (node && node !== doc.body) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= comfortable && rect.height >= comfortable && isClickableBox(node)) return true;
      node = node.parentElement;
    }
    return false;
  };

  /** Real words sitting next to the element, inside the same parent. */
  const hasSiblingText = (parent) => {
    if (!parent) return false;
    for (const node of parent.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim().length > 1) return true;
    }
    return false;
  };

  /**
   * WCAG exempts targets in a sentence, and rightly so: a link inside running
   * text cannot be 44px tall without wrecking the line height.
   *
   * Both branches demand `display: inline` exactly. An inline-block or an
   * inline-flex can grow to 44px without disturbing the line, so exempting
   * either would quietly swallow every icon button that happens to sit next to
   * some text, which is where icon buttons usually sit.
   */
  const isInlineInText = (el) => {
    const { display } = getComputedStyle(el);
    if (display !== 'inline') return false;
    if (hasSiblingText(el.parentElement)) return true;
    return Boolean(el.closest(PROSE));
  };

  /** A slide parked outside its carousel, or a drawer translated off screen. */
  const isClippedAway = (el, box) => {
    const area = box.width * box.height;
    let node = el.parentElement;
    while (node && node !== doc.body) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const clip = node.getBoundingClientRect();
        const w = Math.min(box.right, clip.right) - Math.max(box.left, clip.left);
        const h = Math.min(box.bottom, clip.bottom) - Math.max(box.top, clip.top);
        if (w <= 0 || h <= 0) return true;
        if (w * h < area * 0.5) return true;
      }
      node = node.parentElement;
    }

    const absLeft = box.left + window.scrollX;
    const absTop = box.top + window.scrollY;
    return absLeft + box.width <= 0 || absTop + box.height <= 0 || absLeft >= root.scrollWidth;
  };

  /**
   * Covered by an overlay, a sticky bar, an open modal: nobody taps it.
   *
   * Always ask about the element's own rect, never the box we merged with a
   * label: the centre of a merged box lands on the label text, and treating
   * that as an obstruction would drop every checkbox that has one.
   */
  const isCovered = (el, box) => {
    const onScreen = box.top < window.innerHeight && box.bottom > 0
      && box.left < window.innerWidth && box.right > 0;
    if (!onScreen) return false;

    const x = Math.min(Math.max(box.left + box.width / 2, 1), window.innerWidth - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, 1), window.innerHeight - 1);
    const hit = doc.elementFromPoint(x, y);
    if (!hit) return true;
    if (hit === el || el.contains(hit) || hit.contains(el)) return false;

    // A label painted over its own control still activates it.
    const label = labelFor(el);
    return !(label && (hit === label || label.contains(hit)));
  };

  const textOf = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

  const labelledByText = (el) => (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/)
    .map((id) => doc.getElementById(id))
    .filter(Boolean)
    .map(textOf)
    .join(' ');

  const labelText = (el) => {
    const label = labelFor(el) || el.closest('label');
    return label ? textOf(label) : '';
  };

  /** An icon button carries its name on the image or the svg inside it. */
  const iconText = (el) => {
    const inner = el.querySelector('img[alt]:not([alt=""]), [aria-label], svg title');
    if (!inner) return '';
    return inner.getAttribute('alt') || inner.getAttribute('aria-label') || textOf(inner);
  };

  const attrText = (el) => ['title', 'value', 'placeholder', 'name']
    .map((attr) => el.getAttribute(attr))
    .find((value) => value && value.trim()) || '';

  // Same order the accessibility tree resolves a name in, first hit wins.
  const NAME_SOURCES = [
    (el) => el.getAttribute('aria-label'),
    labelledByText,
    textOf,
    labelText,
    iconText,
    attrText,
  ];

  const nameOf = (el) => {
    for (const source of NAME_SOURCES) {
      const value = (source(el) || '').replace(/\s+/g, ' ').trim();
      if (value) return value;
    }
    return '';
  };

  const kindOf = (el) => {
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'tab') return role;

    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'summary') return 'disclosure toggle';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'text field';
    if (tag === 'label') return 'label';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio button';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'input';
    }
    return 'control';
  };

  const partOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList]
      .filter((name) => name.length <= 24 && !/^(css|sc|jsx|emotion)-/.test(name))
      .slice(0, 2)
      .map((name) => `.${CSS.escape(name)}`)
      .join('');
    return tag + classes;
  };

  const selectorFor = (el) => {
    if (el.id && safeCount(`#${CSS.escape(el.id)}`) === 1) return `#${el.id}`;

    let selector = partOf(el);
    if (safeCount(selector) > 1 && el.parentElement) {
      const twins = [...el.parentElement.children].filter((c) => c.tagName === el.tagName);
      if (twins.length > 1) selector += `:nth-of-type(${twins.indexOf(el) + 1})`;
    }
    if (safeCount(selector) > 1 && el.parentElement && el.parentElement !== doc.body) {
      selector = `${partOf(el.parentElement)} > ${selector}`;
    }
    return selector;
  };

  /**
   * A label[for] shares its hit area with the control it points at. When that
   * control is visible it gets measured on its own and reporting both would be
   * the same finding twice; when it is hidden (the custom-toggle pattern) the
   * label IS the target, so it stays.
   */
  const isDuplicateLabel = (el) => {
    if (el.tagName !== 'LABEL') return false;
    const control = el.htmlFor ? doc.getElementById(el.htmlFor) : null;
    return Boolean(control) && isVisible(control);
  };

  /**
   * A box of a few pixels is never a target somebody aims at. It is the
   * screen-reader-only pattern: a 1x1 absolutely positioned input parked under
   * a custom control that does the real work. Calling that a tiny tap target
   * would be noise on a huge share of real forms, and no advice fits it.
   */
  const isVisuallyHidden = (box) => box.width <= 6 && box.height <= 6;

  /** Not something we judge at all: hidden, off, ignored by config, or a dupe. */
  const isOutOfScope = (el) => Boolean(el.closest(NEVER))
    || matchesIgnored(el)
    || isDisabled(el)
    || !isVisible(el)
    || isDuplicateLabel(el);

  /**
   * Nobody can reach it, so it is neither a finding nor a neighbour: leaving an
   * unreachable element in the list would let a button hidden under a modal
   * crowd a visible one and invent a spacing violation.
   *
   * Both questions are asked about the element's own rect, not the padded or
   * merged one, which describes the hit area rather than the pixels on screen.
   */
  const isUnreachable = (el, ownBox) => isClippedAway(el, ownBox) || isCovered(el, ownBox);

  /** Small on paper, fine in the hand. Still a target for spacing purposes. */
  const isExempt = (el) => hasBigClickableAncestor(el) || isInlineInText(el);

  const candidates = [];
  for (const el of new Set(doc.querySelectorAll(INTERACTIVE))) {
    if (isOutOfScope(el)) continue;

    const ownBox = asBox(el.getBoundingClientRect());
    if (isVisuallyHidden(ownBox) || isUnreachable(el, ownBox)) continue;

    const box = withLabel(el, withPseudoPadding(el, ownBox));
    if (box.width >= 1 && box.height >= 1) candidates.push({ el, box });
  }

  const targets = candidates.map(({ box }) => ({
    box,
    centre: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
    undersized: box.width < wcagMin || box.height < wcagMin,
  }));

  const distanceToBox = (point, box) => Math.hypot(
    Math.max(box.left - point.x, 0, point.x - box.right),
    Math.max(box.top - point.y, 0, point.y - box.bottom),
  );

  /**
   * The spacing exception in WCAG 2.5.8: an undersized target still passes when
   * a 24px circle centred on it reaches neither another target nor another
   * undersized target's circle. So a lonely 20px button in open space is not a
   * violation, while the same button wedged into a toolbar is.
   */
  const isCrowded = (index) => {
    const me = targets[index];
    return targets.some((other, j) => {
      if (j === index) return false;
      if (distanceToBox(me.centre, other.box) < wcagMin / 2) return true;
      const gap = Math.hypot(other.centre.x - me.centre.x, other.centre.y - me.centre.y);
      return other.undersized && gap < wcagMin;
    });
  };

  const items = [];
  candidates.forEach(({ el, box }, index) => {
    if (box.width >= comfortable && box.height >= comfortable) return;
    if (isExempt(el)) return;

    items.push({
      selector: selectorFor(el),
      name: nameOf(el).slice(0, 120),
      kind: kindOf(el),
      width: Math.round(box.width),
      height: Math.round(box.height),
      smallest: Math.min(box.width, box.height),
      crowded: isCrowded(index),
    });
  });

  // Real violations first, then smallest, so the eight we name are the eight
  // that matter.
  const weight = (item) => (item.smallest < wcagMin && item.crowded ? 0 : 1);
  items.sort((a, b) => weight(a) - weight(b) || a.smallest - b.smallest);
  return { items, wcagMin };
}
