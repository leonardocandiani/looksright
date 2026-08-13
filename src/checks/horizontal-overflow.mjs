/** Culprits listed individually before the run collapses into "and N more". */
const SHOWN = 6;

/** Subpixel layout math lands a fraction of a pixel past the edge all the time. */
const TOLERANCE = 1;

/**
 * The page scrolls sideways.
 *
 * This is the classic "it broke on mobile": one wide table, one unbreakable
 * URL, one `width: 100vw` next to a scrollbar, and the whole layout slides
 * under the thumb. Nobody notices it on a desktop browser, and everybody
 * notices it on a phone.
 *
 * Finding that the document is too wide is the easy half. The half that makes
 * this check worth running is naming the element that did it, and staying
 * quiet about the many elements that sit past the viewport on purpose without
 * ever moving the page: fixed drawers, carousel rails, off canvas menus.
 */
export default {
  id: 'horizontal-overflow',
  title: 'Horizontal overflow',
  level: 'error',

  async run({ page, viewport, config = {} }) {
    const result = await page.evaluate(({ ignoreSelectors, tolerance, limit, requested }) => {
      const NAME_SHAPE = /^[A-Za-z_-][\w-]*$/;
      const GENERATED = /^(css-|sc-|emotion-|jsx-|svelte-|ng-|_[\w]{5,})|[a-z]-[a-f0-9]{6,}$/;
      const OFF_TREE = new Set(['TEMPLATE', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'LINK', 'META', 'TITLE']);
      const CONTAINS_X = new Set(['hidden', 'clip', 'auto', 'scroll']);

      const root = document.documentElement;
      const docWidth = Math.round(root.scrollWidth);

      // clientWidth, not window.innerWidth. Under the mobile emulation this tool
      // uses at phone sizes, innerWidth grows to match the overflowing content
      // (measured: 900 on a 390px phone holding a 900px child), so comparing
      // against it would call every broken page fine.
      const edge = root.clientWidth || window.innerWidth;

      // The layout viewport should be the width we asked the browser for. When it
      // is wider, a viewport meta put the page in a virtual window (980px is the
      // default when the tag is missing) and the phone zooms out to fit it. That
      // page does not scroll sideways, it just renders tiny, so there is nothing
      // here to measure and measuring anyway would report a clean bill of health.
      if (requested && edge > requested + 8) return { virtual: true, edge };

      if (docWidth <= edge + tolerance) return { overflows: false };

      const clips = (style) => style.overflowX === 'hidden' || style.overflowX === 'clip';
      const bodyStyle = document.body ? getComputedStyle(document.body) : null;

      // With overflow-x hidden or clip on the root, Chrome still reports a
      // scrollWidth larger than the viewport, but the page cannot actually be
      // scrolled. Content is being cut off instead, which is a different problem
      // for a different check. Saying "the page scrolls sideways" would be false.
      if (clips(getComputedStyle(root)) || (bodyStyle && clips(bodyStyle))) {
        return { overflows: false };
      }

      const ignored = (el) => ignoreSelectors.some((sel) => {
        try {
          return el.closest(sel) !== null;
        } catch {
          return false;
        }
      });

      const translated = (style) => {
        const t = style.transform;
        if (t === 'none') return false;
        // Computed transforms always arrive as matrix(a,b,c,d,tx,ty) or
        // matrix3d(...), where the x translation sits at index 4 and 12.
        const parts = t.slice(t.indexOf('(') + 1).split(',').map(Number);
        const tx = t.startsWith('matrix3d') ? parts[12] : parts[4];
        return Number.isFinite(tx) && Math.abs(tx) > 0.5;
      };

      const containedOrFixed = (el) => {
        for (let node = el; node && node !== root; node = node.parentElement) {
          const style = getComputedStyle(node);

          // Fixed boxes are laid out against the viewport and never extend the
          // scrollable area, however far out they sit: modals, toasts, sticky
          // bars, off canvas menus. They cannot be the reason the page scrolls.
          if (style.position === 'fixed') return true;

          // An ancestor that scrolls or clips on the x axis absorbs the overflow.
          // overflow-x computes to auto when overflow-y is hidden, so reading the
          // computed value covers that pairing for free.
          if (node !== el && CONTAINS_X.has(style.overflowX)) return true;
        }
        return false;
      };

      const each = (fn) => {
        const out = [];
        for (const el of document.querySelectorAll('*')) {
          // html and body are the page, not a thing on it: blaming them tells
          // nobody which element to go fix.
          if (OFF_TREE.has(el.tagName) || el === root || el === document.body) continue;
          const rect = el.getBoundingClientRect();
          // A zero sized box covers display:none and [hidden] too, and neither can
          // push the page anywhere.
          if (rect.width <= 0 || rect.height <= 0) continue;
          const item = fn(el, rect);
          if (item) out.push({ el, ignoredByConfig: ignored(el), ...item });
        }
        return out;
      };

      // Two different ways an element pushes the page out, and they need
      // opposite tie breakers, which is why they are labelled here and split
      // apart below.
      //
      // Note that visibility:hidden, opacity:0 and aria-hidden all stay in. They
      // hide a box from the eye or from a screen reader, not from the layout
      // engine, so a 1400px one really does scroll the page, and that is the
      // hardest kind of overflow to find by hand.
      const culprits = () => each((el, rect) => {
        const style = getComputedStyle(el);

        // A box parked entirely beyond the edge by a transform is a closed
        // drawer, an off stage carousel slide, a peek in panel. Real overflow
        // starts inside the viewport and runs out of it.
        const parked = rect.left >= edge && translated(style);
        const boxPast = !parked && rect.right > edge + tolerance
          ? Math.round(rect.right - edge)
          : 0;

        // Content wider than the box holding it: an unbreakable URL, or a grid
        // whose columns add up to more than the grid. The element's own
        // overflow-x has to be visible, otherwise the content spills into a
        // scrollbar or a clip of its own instead of onto the page.
        const spills = !CONTAINS_X.has(style.overflowX)
          && el.scrollWidth > el.clientWidth + tolerance;
        const contentRight = spills ? Math.round(rect.left + el.scrollWidth) : 0;
        const spillPast = contentRight > edge + tolerance ? contentRight - edge : 0;

        if (!boxPast && !spillPast) return null;
        if (containedOrFixed(el)) return null;

        const spill = boxPast === 0;
        return {
          spill,
          past: spill ? spillPast : boxPast,
          left: Math.round(rect.left),
          right: spill ? contentRight : Math.round(rect.right),
          width: spill ? el.scrollWidth : Math.round(rect.width),
          box: Math.round(rect.width),
          unseen: !spill && (style.visibility !== 'visible' || Number(style.opacity) === 0),
        };
      });

      const all = culprits();

      // A box that sticks out drags every box inside it along, so the outermost
      // one is the cause and the rest are consequence.
      const outermost = all.filter((item) => !item.spill
        && !all.some((other) => other !== item && !other.spill && other.el.contains(item.el)));

      // Spill runs the other way. scrollWidth reports the overflow of every
      // ancestor too, all the way up, so the outermost spiller is only ever a
      // wrapper: the innermost one is the element actually holding the content
      // that does not fit.
      const innermost = all.filter((item) => item.spill
        && !all.some((other) => other !== item && other.spill && item.el.contains(other.el)));

      // Between the two lists, an ancestor still wins: a grid whose columns
      // spill explains the column that sticks out, not the other way around.
      const merged = [...outermost, ...innermost];
      const kept = merged.filter((item) =>
        !merged.some((other) => other !== item && other.el.contains(item.el)));

      const found = {
        kept: kept.filter((i) => !i.ignoredByConfig),
        ignoredCount: kept.filter((i) => i.ignoredByConfig).length,
      };

      // Generated class names ("css-1x2y3z", "sc-hKgILt") name nothing a person
      // can look up, and framework internals ("ng-star-inserted") are noise.
      const readableName = (name) => NAME_SHAPE.test(name) && !GENERATED.test(name);

      const shortSelector = (el) => {
        const tag = el.tagName.toLowerCase();
        if (el.id && NAME_SHAPE.test(el.id)) return `${tag}#${el.id}`;
        const classes = [...el.classList].filter(readableName).slice(0, 2);
        return tag + classes.map((c) => `.${c}`).join('');
      };

      const disambiguate = (el, sel) => {
        const parent = el.parentElement;
        if (!parent) return sel;
        const twins = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (twins.length < 2) return sel;
        const ambiguous = twins.filter((c) => {
          try { return c.matches(sel); } catch { return false; }
        });
        return ambiguous.length > 1 ? `${sel}:nth-of-type(${twins.indexOf(el) + 1})` : sel;
      };

      const selectorFor = (el) => {
        const own = disambiguate(el, shortSelector(el));
        const parent = el.parentElement;
        // A bare "div" says nothing on its own, so it borrows one level of parent
        // for context. Anything already carrying an id or a class stands alone,
        // which is what keeps the selector short enough to read.
        const anonymous = !own.includes('#') && !own.includes('.');
        if (!anonymous || !parent || parent === document.body || parent === root) return own;
        return `${shortSelector(parent)} > ${own}`;
      };

      const label = (el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return text.length > 80 ? `${text.slice(0, 77)}...` : text;
      };

      return {
        overflows: true,
        docWidth,
        edge,
        ignoredCount: found.ignoredCount,
        total: found.kept.length,
        culprits: found.kept
          .sort((a, b) => b.past - a.past)
          .slice(0, limit)
          .map(({ el, ...rest }) => ({ ...rest, selector: selectorFor(el), text: label(el) })),
      };
    }, {
      ignoreSelectors: config.ignoreSelectors ?? [],
      tolerance: TOLERANCE,
      limit: SHOWN,
      requested: viewport?.width ?? 0,
    });

    if (result.virtual) {
      return [{
        level: 'warn',
        message: `This is not a phone layout: the page lays out in a ${result.edge}px window on a ${viewport.width}px screen, so the browser zooms out to fit and nothing here can be measured against the real thing. The usual cause is a missing <meta name="viewport" content="width=device-width, initial-scale=1">.`,
        detail: { layoutViewport: result.edge, requestedViewport: viewport.width },
      }];
    }

    if (!result.overflows) return [];

    // Every element pushing the page out is one the project asked to ignore, so
    // the scroll that is left is on purpose as far as this config is concerned.
    if (result.total === 0 && result.ignoredCount > 0) return [];

    const past = result.docWidth - result.edge;
    const where = viewport?.name ? ` on ${viewport.name}` : '';

    const findings = [{
      message: `The page scrolls sideways${where}: the document is ${result.docWidth}px wide inside a ${result.edge}px viewport, ${past}px too wide.`,
      detail: { documentWidth: result.docWidth, viewportWidth: result.edge, overflowPx: past },
    }];

    for (const c of result.culprits) {
      findings.push({
        message: describe(c, result.edge),
        selector: c.selector,
        text: c.text || undefined,
        detail: {
          elementLeft: c.left,
          elementRight: c.right,
          elementWidth: c.width,
          viewportWidth: result.edge,
          overflowPx: c.past,
        },
      });
    }

    if (result.total > result.culprits.length) {
      findings.push({
        level: 'warn',
        message: `And ${result.total - result.culprits.length} more elements pushing past the right edge of this page.`,
        detail: { total: result.total },
      });
    }

    return findings;
  },
};

function describe(c, edge) {
  if (c.spill) {
    return `${c.selector} fits the screen but its content does not: ${c.width}px of content inside a ${c.box}px box, spilling ${c.past}px past the right edge. Usually an unbreakable string or a fixed width child.`;
  }
  const unseen = c.unseen ? ', and it is invisible, so nothing on screen explains the scroll' : '';
  return `${c.selector} is ${c.width}px wide and runs ${c.past}px past the right edge of the ${edge}px viewport${unseen}.`;
}
