/**
 * Markup that reached the screen as text.
 *
 * `*teste*` in a chat bubble, `**Total**` in a summary, `<br>` inside a
 * paragraph, `&amp;` in a title, `{{user.name}}` in a greeting. Every one of
 * these is a string that was supposed to be interpreted by something and was
 * printed instead. None of them throw, all of them are visible to whoever is
 * reading the page, and they are the kind of thing a person notices in a
 * screenshot three days after shipping.
 *
 * The check is deliberately narrow. Documentation shows markup on purpose, code
 * samples are full of angle brackets, and a currency conversion table legitimately
 * contains `~`. So: nothing inside `<code>`, `<pre>`, `<kbd>`, `<samp>` or
 * anything a page marked as a code editor, and every pattern has to look like
 * markup wrapping actual words, not like punctuation that happens to be nearby.
 */
const SCRIPT = String.raw`
(() => {
  const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/[^\w-]/g, '\\$&'));
  const shape = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return tag + '#' + esc(el.id);
    return tag + [...el.classList].slice(0, 2).map((c) => '.' + esc(c)).join('');
  };
  const describe = (el) => {
    const self = shape(el);
    const parent = el.parentElement;
    if (el.id || !parent || parent === document.body) return self;
    const scope = parent.id ? '#' + esc(parent.id) : parent.classList[0] && '.' + esc(parent.classList[0]);
    return scope ? parent.tagName.toLowerCase() + scope + ' > ' + self : self;
  };

  const CODE = 'code, pre, kbd, samp, textarea, [contenteditable], .hljs, .cm-editor, .monaco-editor, .shiki, .highlight';

  // Each pattern needs a name a person can act on and an example of the exact
  // string that matched, because "found markup" alone sends nobody anywhere.
  const PATTERNS = [
    { id: 'bold', label: 'Markdown bold', re: /\*\*(?=\S)([^*\n]{1,80}?)\*\*/ },
    { id: 'whatsapp-bold', label: 'WhatsApp bold', re: /(?:^|[\s(\[{"'])\*(?=\S)([^*\n]{1,80}?[^\s*])\*(?=$|[\s.,!?;:)\]}"'])/ },
    { id: 'italic', label: 'Markdown italic', re: /(?:^|[\s(\[{"'])_(?=\S)([^_\n]{1,80}?[^\s_])_(?=$|[\s.,!?;:)\]}"'])/ },
    { id: 'strike', label: 'WhatsApp strikethrough', re: /(?:^|[\s(\[{"'])~(?=\S)([^~\n]{1,80}?[^\s~])~(?=$|[\s.,!?;:)\]}"'])/ },
    { id: 'link', label: 'Markdown link', re: /\[([^\]\n]{1,60})\]\((https?:\/\/|\/)[^)\s]{1,120}\)/ },
    { id: 'heading', label: 'Markdown heading', re: /^#{1,6}\s+\S/ },
    { id: 'tag', label: 'HTML tag', re: /<\/?(?:div|span|p|br|b|i|strong|em|ul|li|a|img|h[1-6]|table|tr|td)\b[^<>]{0,120}>/i },
    { id: 'entity', label: 'HTML entity', re: /&(?:amp|lt|gt|quot|apos|nbsp|#\d{2,5});/ },
    { id: 'placeholder', label: 'Unfilled placeholder', re: /\{\{\s*[\w.$[\]]{1,60}\s*\}\}|\$\{\s*[\w.$[\]]{1,60}\s*\}/ },
    { id: 'undefined', label: 'Undefined value', re: /(?:^|[\s>])(?:undefined|null|NaN|\[object Object\])(?:$|[\s<.,!?])/ },
  ];

  const seen = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;

  while ((node = walker.nextNode())) {
    const raw = node.nodeValue;
    if (!raw || raw.trim().length < 3) continue;

    const el = node.parentElement;
    if (!el || el.closest(CODE)) continue;

    // Off screen or hidden text is not something a person is reading.
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const box = el.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;

    const text = raw.replace(/\s+/g, ' ').trim();
    for (const p of PATTERNS) {
      const hit = p.re.exec(text);
      if (!hit) continue;
      seen.push({
        id: p.id,
        label: p.label,
        sample: hit[0].trim().slice(0, 60),
        selector: describe(el),
        top: Math.round(box.top),
      });
      break;
    }
    if (seen.length >= 40) break;
  }

  return seen;
})()
`;

export default {
  id: 'leaked-markup',
  title: 'Markup on screen',
  level: 'error',

  async run({ page }) {
    const found = await page.evaluate(SCRIPT);
    if (!found.length) return [];

    // One finding per kind, counted. Ten bubbles with the same unrendered bold
    // are one bug in one component, and ten lines would bury everything else.
    const byKind = new Map();
    for (const item of found) {
      const group = byKind.get(item.id) ?? { ...item, count: 0 };
      group.count++;
      byKind.set(item.id, group);
    }

    return [...byKind.values()].map((g) => ({
      message:
        g.count > 1
          ? `${g.label} is printed as text in ${g.count} places instead of being rendered, first one reading ${JSON.stringify(g.sample)}.`
          : `${g.label} is printed as text instead of being rendered, reading ${JSON.stringify(g.sample)}.`,
      selector: g.selector,
      detail: { kind: g.id, sample: g.sample, count: g.count },
    }));
  },
};
