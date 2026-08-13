/** Below this, the "overflow" is rounding, a descender or a border, not lost words. */
const MIN_HIDDEN_PX = 4;

/** How many places to name before collapsing the rest into a count. */
const SHOWN = 8;

/** Characters of the cut-off text to quote back, so the string is findable in the source. */
const SAMPLE = 48;

/** Work budget, so one page of 10k nodes cannot stall the run. */
const MAX_BOXES = 200;
const MAX_TEXT_PER_BOX = 300;

const EDGE = {
  right: 'past the right edge of',
  left: 'past the left edge of',
  bottom: 'below the bottom of',
  top: 'above the top of',
};

/**
 * Text that is in the DOM but cut off by the box it sits in.
 *
 * The sentence is there, the screen reader reads it, the test asserting
 * `toHaveText` passes, and the person looking at the page sees "Continue to
 * chec". Nothing throws, so this survives every suite that never looks at the
 * pixels.
 *
 * Two shapes are reported, worst first:
 *
 *   1. `white-space: nowrap` + `overflow: hidden` with no `text-overflow`. The
 *      line stops mid word with nothing to signal there is more, so the reader
 *      cannot even tell they are missing something.
 *   2. Any clipped box (`overflow: hidden` or `clip`) where whole lines fall
 *      outside it and there is no scrollbar to reach them.
 *
 * The clipping box is often not the element holding the text: a card with a
 * fixed height cutting off its own paragraph is the most common version of this
 * bug. So the scan starts from boxes that clip and overflow, then measures the
 * real line rectangles of the text inside them. Every finding is confirmed
 * twice, once from the box (`scrollHeight` beyond `clientHeight`) and once from
 * the text itself, which is what keeps an absolutely positioned child or a
 * collapsed margin from being reported as clipped prose.
 *
 * Known blind spot, on purpose: text clipped by two nested boxes at once is
 * measured against the nearest one only, so a card that is itself half outside
 * a scroller is not reported. Under-reporting beats crying wolf.
 */
export default {
  id: 'clipped-text',
  title: 'Clipped text',
  level: 'warn',

  async run({ page, config }) {
    const hits = await page.evaluate(({ ignore, minHidden, sample, shown, maxBoxes, maxTexts }) => {
      // Native controls clip by design, and svg text needs different math than
      // clientWidth, so neither is judged here.
      const SKIP = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'IFRAME', 'CANVAS',
        'SELECT', 'OPTION', 'OPTGROUP', 'TEXTAREA', 'INPUT', 'PROGRESS', 'METER',
      ]);

      const clips = (value) => value === 'hidden' || value === 'clip';
      const scrolls = (value) => value === 'auto' || value === 'scroll';
      const esc = (value) => (window.CSS?.escape ? CSS.escape(value) : value);
      const clamped = (style) => Boolean(style.webkitLineClamp) && style.webkitLineClamp !== 'none';

      const directTextNodes = (el) => {
        const out = [];
        for (const node of el.childNodes) {
          if (node.nodeType === 3 && node.nodeValue.trim()) out.push(node);
        }
        return out;
      };

      const ignored = (el) => {
        if (el.closest('[aria-hidden="true"], [hidden]')) return true;
        return ignore.some((selector) => {
          try {
            return el.closest(selector) !== null;
          } catch {
            return false;
          }
        });
      };

      // opacity does not inherit, so a faded ancestor has to be walked to.
      const faded = (el, style) => {
        let node = el;
        for (let depth = 0; node && depth < 12; depth += 1) {
          const value = node === el ? style.opacity : getComputedStyle(node).opacity;
          if (Number(value) === 0) return true;
          node = node.parentElement;
        }
        return false;
      };

      // Layout px and screen px only agree while the transform is a plain
      // translation. Anything scaled, rotated or skewed would make every number
      // below wrong, so it is left alone. `rotate` and `scale` are checked as
      // well: as standalone properties they never show up in `transform`.
      const distorted = (style) => {
        if (style.rotate !== 'none' || style.scale !== 'none') return true;
        if (style.transform === 'none') return false;
        const matrix = /^matrix\(([^)]+)\)$/.exec(style.transform);
        if (!matrix) return true;
        const [a, b, c, d] = matrix[1].split(',').map(Number);
        return a !== 1 || b !== 0 || c !== 0 || d !== 1;
      };

      const paddingBox = (el, style) => {
        const rect = el.getBoundingClientRect();
        const left = rect.left + (parseFloat(style.borderLeftWidth) || 0);
        const top = rect.top + (parseFloat(style.borderTopWidth) || 0);
        return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
      };

      const lineRects = (nodes) => {
        const range = document.createRange();
        const rects = [];
        for (const node of nodes) {
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) {
            if (r.width > 0 && r.height > 0) rects.push(r);
          }
        }
        return rects;
      };

      const union = (rects) => rects.reduce((box, r) => ({
        left: Math.min(box.left, r.left),
        right: Math.max(box.right, r.right),
        top: Math.min(box.top, r.top),
        bottom: Math.max(box.bottom, r.bottom),
      }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });

      /** Lines with more than half their height outside the visible box. */
      const linesOutside = (rects, box) => rects.filter((r) => {
        const visible = Math.min(r.bottom, box.bottom) - Math.max(r.top, box.top);
        return visible / r.height < 0.5;
      }).length;

      const beyond = (r, direction, edge) => {
        if (direction === 'right') return r.right > edge;
        if (direction === 'left') return r.left < edge;
        if (direction === 'bottom') return r.bottom > edge;
        return r.top < edge;
      };

      // The union rect of [0, offset] only grows, in every direction, so the
      // first offset that crosses the edge is the first character the reader
      // never sees. Holds for right-to-left text too, where the line grows left.
      const firstHiddenOffset = (nodes, edge, direction) => {
        const range = document.createRange();
        const past = (node, offset) => {
          range.setStart(node, 0);
          range.setEnd(node, offset);
          return beyond(range.getBoundingClientRect(), direction, edge);
        };
        let consumed = 0;
        for (const node of nodes) {
          const len = node.nodeValue.length;
          if (!past(node, len)) {
            consumed += len;
            continue;
          }
          let lo = 0;
          let hi = len;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (past(node, mid + 1)) hi = mid;
            else lo = mid + 1;
          }
          return consumed + lo;
        }
        return -1;
      };

      /** tag + up to two classes: the part that is identical for every twin. */
      const shape = (el) => {
        const tag = el.tagName.toLowerCase();
        if (el.id) return `${tag}#${esc(el.id)}`;
        return tag + [...el.classList].slice(0, 2).map((c) => `.${esc(c)}`).join('');
      };

      // Nine list items sharing a class would otherwise print the same selector,
      // and "which one?" is the first thing the reader would ask.
      const label = (el) => {
        const self = shape(el);
        if (el.id) return self;
        const siblings = [...(el.parentElement?.children ?? [])];
        const twins = siblings.filter((c) => c.tagName === el.tagName);
        if (twins.length < 2 || siblings.filter((c) => shape(c) === self).length < 2) return self;
        return `${self}:nth-of-type(${twins.indexOf(el) + 1})`;
      };

      const describe = (el) => {
        const self = label(el);
        const parent = el.parentElement;
        if (el.id || !parent || parent === document.body) return self;
        const scope = parent.id ? `#${esc(parent.id)}` : parent.classList[0] && `.${esc(parent.classList[0])}`;
        if (!scope) return self;
        return `${parent.tagName.toLowerCase()}${scope} > ${self}`;
      };

      /**
       * Walks from the text up to the clipping box.
       *
       * Returns null when the text is not this box's business, because a nearer
       * box clips it, a scrollbar reaches it, or a transform moved it. When it
       * does belong, `bleeds` says whether a block on the way is wider than the
       * clip box: a block is as wide as its container unless somebody made it
       * wider, so a wide one sticking out is a design decision (an oversized
       * mock, a slider track, a full-bleed panel) and not a sentence that ran
       * out of room. Height is the opposite, blocks grow to fit their text, so
       * this only ever suppresses the horizontal axis.
       */
      const chain = (el, host, width) => {
        let node = el;
        let bleeds = false;
        for (let depth = 0; node && node !== host && depth < 12; depth += 1) {
          const style = getComputedStyle(node);
          if (distorted(style) || clamped(style)) return null;
          if (clips(style.overflowX) || clips(style.overflowY)) return null;
          if (scrolls(style.overflowX) || scrolls(style.overflowY)) return null;
          if (node.scrollLeft !== 0 || node.scrollTop !== 0) return null;
          if (!style.display.startsWith('inline') && node.getBoundingClientRect().width > width + 4) {
            bleeds = true;
          }
          node = node.parentElement;
        }
        return node === host ? { bleeds } : null;
      };

      const measure = (clip, rects, spread, sideways) => {
        const box = clip.box;
        const out = { axis: null, direction: null, hidden: 0, lines: 0 };

        // Text with nothing inside the box is an off-screen carousel slide or a
        // closed panel, not a sentence somebody is trying to finish reading.
        const insideX = Math.min(spread.right, box.right) - Math.max(spread.left, box.left);
        const insideY = Math.min(spread.bottom, box.bottom) - Math.max(spread.top, box.top);
        if (insideX < 8 || insideY < 8) return out;

        if (clip.clipX && !sideways) {
          const right = spread.right - box.right;
          const left = box.left - spread.left;
          const hidden = Math.max(right, left);
          if (hidden >= minHidden) {
            out.axis = 'x';
            out.direction = right >= left ? 'right' : 'left';
            out.hidden = hidden;
          }
        }

        if (!clip.clipY) return out;

        const below = spread.bottom - box.bottom;
        const above = box.top - spread.top;
        const vertical = Math.max(below, above);
        // Half-leading and descenders push line boxes a couple of px past a
        // fixed height all the time, so a whole line has to be gone.
        const lines = linesOutside(rects, box);
        if (vertical < minHidden || lines < 1 || vertical <= out.hidden) return out;

        return { axis: 'y', direction: below >= above ? 'bottom' : 'top', hidden: vertical, lines };
      };

      /** Boxes that both clip and have something to clip. */
      const clipBoxes = () => {
        const found = [];
        // A page mid-navigation can have no body at all, and blank-page owns
        // that story anyway.
        if (!document.body) return found;
        for (const el of document.body.querySelectorAll('*')) {
          if (found.length >= maxBoxes) break;
          if (!(el instanceof HTMLElement) || SKIP.has(el.tagName)) continue;

          const overX = el.scrollWidth - el.clientWidth;
          const overY = el.scrollHeight - el.clientHeight;
          if (overX <= 1 && overY <= 1) continue;

          // The visually-hidden pattern (1px box, overflow hidden) is clipped
          // text on purpose and is the single biggest false positive here.
          if (el.clientWidth < 8 || el.clientHeight < 8) continue;

          // A non-zero scroll offset means something already drives this box, so
          // the content is reachable whatever the computed overflow says.
          if (el.scrollLeft !== 0 || el.scrollTop !== 0) continue;

          const style = getComputedStyle(el);
          const clipX = overX > 1 && clips(style.overflowX);
          const clipY = overY > 1 && clips(style.overflowY);
          if (!clipX && !clipY) continue;

          // overflow does nothing on a non-replaced inline box.
          if (style.display === 'inline' || style.display === 'contents') continue;
          if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
          if (el.getClientRects().length === 0 || faded(el, style)) continue;

          // Deliberate truncation, all of it: line clamp, the clip() and
          // clip-path() hiding tricks, and zoom, which breaks the px math.
          if (clamped(style) || style.clipPath !== 'none' || style.clip !== 'auto') continue;
          if (style.zoom && style.zoom !== '1') continue;

          const rect = el.getBoundingClientRect();
          if (Math.abs(rect.width - el.offsetWidth) > 1) continue;
          if (Math.abs(rect.height - el.offsetHeight) > 1) continue;

          // Parked off-screen to the left or above: not something a reader on
          // this page is missing.
          const box = paddingBox(el, style);
          if (box.right <= 0 || box.bottom <= 0) continue;
          if (ignored(el)) continue;

          // A single clamped line ending in "..." is a designed truncation: a
          // long name in a list is supposed to do that. Left out on purpose,
          // since reporting it would fire on half the well-built pages alive.
          const cutsX = clipX && !style.textOverflow.includes('ellipsis');
          if (!cutsX && !clipY) continue;

          found.push({ el, box, clipX: cutsX, clipY, overflowX: style.overflowX, overflowY: style.overflowY });
        }
        return found;
      };

      const candidates = [];

      for (const clip of clipBoxes()) {
        const scope = [clip.el, ...clip.el.querySelectorAll('*')].slice(0, maxTexts);

        for (const el of scope) {
          if (!(el instanceof HTMLElement) || SKIP.has(el.tagName)) continue;

          const nodes = directTextNodes(el);
          if (!nodes.length) continue;
          const text = nodes.map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
          if (text.length < 2) continue;

          const link = el === clip.el
            ? { bleeds: false }
            : (ignored(el) ? null : chain(el, clip.el, clip.box.right - clip.box.left));
          if (!link) continue;

          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
          if ((parseFloat(style.textIndent) || 0) <= -300) continue;
          if (faded(el, style)) continue;

          const rects = lineRects(nodes);
          if (!rects.length) continue;

          const cut = measure(clip, rects, union(rects), link.bleeds);
          if (!cut.axis) continue;

          const nowrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre';
          candidates.push({
            el,
            host: clip.el,
            nodes,
            box: clip.box,
            text,
            axis: cut.axis,
            direction: cut.direction,
            lines: cut.lines,
            harsh: cut.axis === 'x' && nowrap,
            hidden: Math.round(cut.hidden),
            whiteSpace: style.whiteSpace,
            overflow: cut.axis === 'x' ? clip.overflowX : clip.overflowY,
          });
        }
      }

      // One clipped component repeated down a list is one bug, not fifteen. The
      // worst instance speaks for the group, so the eight slots go to eight
      // different problems instead of eight copies of the first one.
      const groups = new Map();
      for (const hit of candidates) {
        const key = `${shape(hit.el)}|${shape(hit.host)}|${hit.direction}`;
        const seen = groups.get(key);
        if (!seen) groups.set(key, { ...hit, repeats: 1 });
        else if (hit.hidden > seen.hidden) groups.set(key, { ...hit, repeats: seen.repeats + 1 });
        else seen.repeats += 1;
      }

      const ranked = [...groups.values()].sort((a, b) => (b.harsh - a.harsh) || (b.hidden - a.hidden));

      // The cut point costs a handful of forced layouts per element, so it is
      // only measured for the ones that make it into the report.
      const reported = ranked.slice(0, shown).map((hit) => {
        const edges = { right: hit.box.right, left: hit.box.left, bottom: hit.box.bottom, top: hit.box.top };
        const offset = firstHiddenOffset(hit.nodes, edges[hit.direction], hit.direction);
        const raw = hit.nodes.map((n) => n.nodeValue).join('');
        const cut = offset >= 0 ? raw.slice(offset).replace(/\s+/g, ' ').trim().slice(0, sample) : '';
        return {
          selector: describe(hit.el),
          host: hit.el === hit.host ? null : describe(hit.host),
          text: hit.text.slice(0, 120),
          cut,
          axis: hit.axis,
          direction: hit.direction,
          hidden: hit.hidden,
          lines: hit.lines,
          harsh: hit.harsh,
          repeats: hit.repeats,
          whiteSpace: hit.whiteSpace,
          overflow: hit.overflow,
        };
      });

      return { total: candidates.length, places: ranked.length, reported };
    }, {
      ignore: config.ignoreSelectors ?? [],
      minHidden: MIN_HIDDEN_PX,
      sample: SAMPLE,
      shown: SHOWN,
      maxBoxes: MAX_BOXES,
      maxTexts: MAX_TEXT_PER_BOX,
    });

    if (!hits.total) return [];

    const findings = hits.reported.map((hit) => ({
      message: describeFinding(hit),
      selector: hit.selector,
      text: hit.text,
      detail: {
        hiddenPx: hit.hidden,
        direction: hit.direction,
        overflow: hit.overflow,
        whiteSpace: hit.whiteSpace,
        ...(hit.host ? { clippedBy: hit.host } : {}),
        ...(hit.lines ? { hiddenLines: hit.lines } : {}),
        ...(hit.repeats > 1 ? { sameElsewhere: hit.repeats } : {}),
        ...(hit.harsh ? { noEllipsis: true } : {}),
      },
    }));

    const rest = hits.places - SHOWN;
    if (rest > 0) {
      findings.push({
        message: rest === 1
          ? 'And 1 more place on this page where text is clipped by its own container.'
          : `And ${rest} more places on this page where text is clipped by its own container.`,
        detail: { places: hits.places, elements: hits.total },
      });
    }

    return findings;
  },
};

function describeFinding(hit) {
  const subject = hit.host ? `of the text in ${hit.selector}` : 'of text';
  const container = hit.host ?? hit.selector;
  const repeats = hit.repeats > 1
    ? ` (and on ${hit.repeats - 1} more element${hit.repeats > 2 ? 's' : ''} like it)`
    : '';
  const where = `${EDGE[hit.direction]} ${container}${repeats}`;
  const starting = hit.cut ? `, starting at "${hit.cut}"` : `, in the text "${clamp(hit.text, 48)}"`;

  if (hit.harsh) {
    return `${hit.hidden}px ${subject} is cut off ${where} with nothing to signal it, because it sets white-space:${hit.whiteSpace} and overflow:${hit.overflow} without text-overflow:ellipsis${starting}.`;
  }

  if (hit.axis === 'y') {
    const many = hit.lines > 1;
    const count = many ? `${hit.lines} lines of text are` : '1 line of text is';
    const from = hit.host ? ` from ${hit.selector}` : '';
    return `${count} hidden${from} ${where} by overflow:${hit.overflow} (${hit.hidden}px), and there is no scrollbar to reach ${many ? 'them' : 'it'}${starting}.`;
  }

  return `${hit.hidden}px ${subject} is hidden ${where} by overflow:${hit.overflow}, and there is no scrollbar to reach it${starting}.`;
}

function clamp(value, max) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
