/**
 * The page loaded and there is nothing on it.
 *
 * This is the failure that matters most, because every other check passes on a
 * blank page: no overflow, no contrast problem, no broken image. A run that
 * says "all good" about a white screen is worse than no run at all.
 */
export default {
  id: 'blank-page',
  title: 'Blank page',
  level: 'error',

  async run({ page }) {
    const state = await page.evaluate(() => {
      const body = document.body;
      if (!body) return { empty: true, reason: 'there is no body element' };

      const text = (body.innerText ?? '').trim();
      const painted = [...body.querySelectorAll('img, svg, canvas, video, input, button, [role="img"]')]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 8 && box.height > 8;
        }).length;

      // Whether anything actually reaches the screen, asked the way the browser
      // itself answers it: take the elements that hold content and hit test
      // their own centre.
      //
      // Measuring boxes fails in both directions here. `body.getBoundingClientRect()`
      // is 0 tall whenever the app lives in a `position: fixed` shell, the normal
      // shape of chat apps and dashboards, so that reads a healthy page as blank.
      // Child rects fail the other way: children of a `height: 0; overflow: hidden`
      // wrapper still report their full size while being clipped to nothing.
      // A fixed grid of probe points fails on short pages, where every probe
      // lands below the content. Hit testing each candidate where it claims to
      // be agrees with the eye in all three cases.
      const candidates = [];
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) && candidates.length < 40) {
        if (!(node.nodeValue ?? '').trim()) continue;
        const parent = node.parentElement;
        if (parent && !candidates.includes(parent)) candidates.push(parent);
      }
      for (const el of body.querySelectorAll('img, svg, canvas, video, input, button')) {
        if (candidates.length >= 60) break;
        if (!candidates.includes(el)) candidates.push(el);
      }

      let onScreen = 0;
      for (const el of candidates) {
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) continue;
        const x = Math.min(Math.max(box.left + box.width / 2, 1), window.innerWidth - 1);
        const y = Math.min(Math.max(box.top + box.height / 2, 1), window.innerHeight - 1);
        if (box.bottom < 0 || box.top > window.innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        // The element itself, something inside it, or the thing painting over it
        // (an overlay) all mean pixels are reaching that spot.
        if (hit && hit !== body && hit !== document.documentElement) onScreen++;
      }

      return {
        empty: text.length < 2 && painted === 0,
        collapsed: onScreen === 0 && (text.length > 0 || painted > 0),
        chars: text.length,
        candidates: candidates.length,
        painted,
        nodes: body.querySelectorAll('*').length,
      };
    });

    if (state.empty) {
      return [{
        message: state.reason
          ? `The page rendered nothing: ${state.reason}.`
          : `The page rendered nothing: no text and no visible image, canvas or control.`,
        detail: { nodes: state.nodes },
      }];
    }

    if (state.collapsed) {
      return [{
        message: `The page has ${state.chars} characters of text in the DOM but none of it reaches the screen: all ${state.candidates} content elements hit test as covered or clipped away. A collapsed or clipped wrapper is the usual cause.`,
        detail: { chars: state.chars, candidates: state.candidates },
      }];
    }

    return [];
  },
};
