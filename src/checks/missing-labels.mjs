/** Findings shown individually before the run collapses the rest into a count. */
const SHOWN = 8;

/** Longest attribute value (href, src, placeholder) we inline in a message. */
const QUOTE = 48;

/**
 * Controls nobody can name.
 *
 * The icon button is the whole story: someone shipped a header with a
 * hamburger, a search magnifier and a close X, all of them a <button> wrapping
 * an <svg>, none of them carrying a single word. It looks finished on screen,
 * it passes every visual review, and to a screen reader the page is three
 * buttons called "button". The same failure wears other clothes: an input whose
 * only hint is a placeholder that vanishes the moment you type, an <img> with
 * no alt attribute at all, an <iframe> announced as "frame".
 *
 * This check is deliberately narrow. It only reports controls where the
 * accessible name computation ends with nothing, and it stays quiet on every
 * case where the author expressed an intent we can see, even a weak one
 * (title, alt="", role="presentation"). Accessibility tooling that cries wolf
 * gets muted, and a muted checker finds nothing.
 */
export default {
  id: 'missing-labels',
  title: 'Unlabeled controls',
  level: 'warn',

  async run({ page, config }) {
    const hits = await page.evaluate(findUnlabeled, {
      ignoreSelectors: config?.ignoreSelectors ?? [],
      quote: QUOTE,
    });

    if (!hits.length) return [];

    const findings = hits.slice(0, SHOWN).map((hit) => ({
      message: describe(hit),
      selector: hit.selector,
      ...(hit.text ? { text: hit.text } : {}),
      detail: hit.detail,
    }));

    if (hits.length > SHOWN) {
      const byKind = {};
      for (const hit of hits) byKind[hit.kind] = (byKind[hit.kind] ?? 0) + 1;
      findings.push({
        message: `And ${hits.length - SHOWN} more elements with no accessible name (${summarize(byKind)}).`,
        detail: { total: hits.length, byKind },
      });
    }

    return findings;
  },
};

function summarize(byKind) {
  const words = {
    'labelledby-broken': 'broken aria-labelledby',
    button: 'buttons',
    link: 'links',
    field: 'form fields',
    image: 'images without alt',
    iframe: 'iframes without title',
  };
  return Object.entries(byKind)
    .map(([kind, n]) => `${n} ${words[kind] ?? kind}`)
    .join(', ');
}

function describe(hit) {
  const d = hit.detail;

  if (hit.kind === 'labelledby-broken') {
    const missing = d.missingIds?.length
      ? `no element on the page has ${d.missingIds.map((id) => `id="${id}"`).join(' or ')}`
      : `the referenced element${d.emptyIds?.length > 1 ? 's are' : ' is'} empty (${(d.emptyIds ?? []).map((id) => `id="${id}"`).join(', ')})`;
    return `The ${d.what} points aria-labelledby="${d.labelledby}" at nothing: ${missing}, so the control ends up with no name at all. A dangling aria-labelledby is worse than none, because it silently overrides the text and the aria-label that would otherwise have named it.`;
  }

  if (hit.kind === 'button') {
    const inside = d.contains
      ? `it contains only ${d.contains}`
      : 'it is empty';
    return `${d.what} has no accessible name: ${inside}, and there is no aria-label, aria-labelledby or title, so it is announced as just "button". Add aria-label="..." with the action it performs.`;
  }

  if (hit.kind === 'link') {
    const target = d.href ? ` to ${d.href}` : '';
    const inside = d.contains ? `it contains only ${d.contains}` : 'it has no text';
    return `Link${target} has no accessible name: ${inside}, and there is no aria-label or title. Add visible text, aria-label="...", or an alt on the image inside it.`;
  }

  if (hit.kind === 'field') {
    const where = d.name ? ` (name="${d.name}")` : '';
    const fix = d.placeholder
      ? `Its only hint is placeholder="${d.placeholder}", which disappears the moment someone types, so it does not count as a label: add <label for="..."> or aria-label="${d.placeholder}".`
      : 'Add a <label for="..."> pointing at it, wrap it in a <label>, or give it aria-label="...".';
    return `${d.what}${where} has no label: no <label> resolves to it and it has no aria-label or aria-labelledby. ${fix}`;
  }

  if (hit.kind === 'image') {
    const src = d.src ? ` (src="${d.src}")` : '';
    return `Image${src} has no alt attribute, so screen readers fall back to reading the file name out loud. Write alt="..." describing it, or alt="" if it is decorative.`;
  }

  return `iframe${d.src ? ` (src="${d.src}")` : ''} has no title attribute, so it is announced as an unnamed "frame" with no clue what is embedded. Add title="..." describing the embedded content.`;
}

/**
 * Runs in the page. Nothing from the module scope above exists in here, so
 * everything it needs arrives in `args`.
 */
function findUnlabeled({ ignoreSelectors, quote }) {
  /** Order findings by how cheap and how certain the fix is. */
  const PRIORITY = {
    'labelledby-broken': 0,
    button: 1,
    link: 2,
    field: 3,
    image: 4,
    iframe: 5,
  };

  /**
   * Input types that are never named by a <label>: hidden is not rendered,
   * submit/reset/button take their name from `value` (and Chrome supplies a
   * default one), and image inputs are named by their own alt.
   */
  const UNLABELABLE_INPUTS = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

  /** An iframe smaller than this is a tracking pixel, not embedded content. */
  const IFRAME_MIN = 32;

  const short = (value) => {
    const v = String(value ?? '').replace(/\s+/g, ' ').trim();
    // An inlined data: URI is thousands of useless characters, and its first 48
    // are the same for every image on the page.
    if (v.startsWith('data:')) return `${v.slice(0, v.indexOf(';') > 0 ? v.indexOf(';') : 20)}...`;
    return v.length > quote ? `${v.slice(0, quote - 3)}...` : v;
  };

  const attr = (el, name) => (el.getAttribute(name) ?? '').trim();

  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `${tag}#${el.id}`;
    const classes = [...el.classList]
      .filter((c) => /^[A-Za-z][\w-]*$/.test(c) && c.length < 30)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    let base = tag + classes;
    const parent = el.parentElement;
    if (!parent) return base;

    const twins = [...parent.children].filter((c) => {
      try { return c.matches(base); } catch { return false; }
    });
    if (twins.length > 1) {
      const same = [...parent.children].filter((c) => c.tagName === el.tagName);
      base += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    const parentTag = parent.tagName.toLowerCase();
    if (parentTag === 'body' || parentTag === 'html') return base;
    const parentId = parent.id && /^[A-Za-z][\w-]*$/.test(parent.id) ? `#${parent.id}` : '';
    const parentClass = parentId
      ? ''
      : [...parent.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 1).map((c) => `.${c}`).join('');
    return `${parentTag}${parentId}${parentClass} > ${base}`;
  };

  /**
   * Text as the accessible name computation sees it: an aria-hidden subtree
   * contributes nothing, which is exactly why <button><span aria-hidden>x</span>
   * </button> is an unnamed button even though the DOM looks populated.
   */
  const textOf = (root) => {
    let out = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          out += child.nodeValue;
          continue;
        }
        if (child.nodeType !== Node.ELEMENT_NODE) continue;
        if (child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('hidden')) continue;
        if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'TEMPLATE') continue;
        walk(child);
      }
    };
    walk(root);
    return out.replace(/\s+/g, ' ').trim();
  };

  /**
   * A name made only of punctuation or a lone glyph ("x", an arrow, an emoji)
   * is what an icon button looks like when the icon happens to be a character
   * instead of an svg. Screen readers read it as the glyph's Unicode name, so
   * it names nothing.
   */
  const isRealName = (value) => /[\p{L}\p{N}]/u.test(value);

  /** Resolves aria-labelledby the way the browser does: by id, text or not. */
  const resolveLabelledby = (el) => {
    const raw = attr(el, 'aria-labelledby');
    if (!raw) return null;
    const ids = raw.split(/\s+/).filter(Boolean);
    if (!ids.length) return null;

    const missing = [];
    const empty = [];
    let text = '';
    for (const id of ids) {
      const target = document.getElementById(id);
      if (!target) {
        missing.push(id);
        continue;
      }
      // A referenced element may legitimately be hidden (the sr-only heading
      // pattern), so visibility is not part of this decision.
      const value = textOf(target)
        || attr(target, 'aria-label')
        || attr(target, 'alt')
        || (target.value ? String(target.value).trim() : '');
      if (value) text += `${text ? ' ' : ''}${value}`;
      else empty.push(id);
    }
    return { raw, text: text.trim(), missing, empty };
  };

  /** What the control has inside, in the words the message will use. */
  const contentSummary = (el) => {
    const text = textOf(el);
    if (text) return `the text "${short(text)}"`;

    // The trap worth naming out loud: the words are right there in the DOM,
    // but aria-hidden takes them out of the name computation.
    for (const hidden of el.querySelectorAll('[aria-hidden="true"]')) {
      const buried = hidden.textContent.replace(/\s+/g, ' ').trim();
      if (buried) return `the text "${short(buried)}" inside an aria-hidden element, which the name computation throws away`;
    }

    if (el.querySelector('svg')) return 'an <svg> icon';
    if (el.querySelector('img')) return 'an <img> with no usable alt';
    if (el.querySelector('canvas, video, picture')) return 'a media element';
    const style = getComputedStyle(el);
    if (style.backgroundImage && style.backgroundImage !== 'none') return 'a CSS background image';
    if (getComputedStyle(el, '::before').content !== 'none' || getComputedStyle(el, '::after').content !== 'none') {
      return 'an icon-font glyph from a pseudo element';
    }
    if (el.firstElementChild) return `empty markup (<${el.firstElementChild.tagName.toLowerCase()}>) and no text`;
    return '';
  };

  /**
   * The accessible name of a button or a link, in precedence order. It returns
   * the dangling aria-labelledby separately, because that case gets its own
   * message instead of the generic "has no name".
   */
  const nameOf = (el) => {
    const ref = resolveLabelledby(el);
    if (ref) {
      if (isRealName(ref.text)) return { name: ref.text };
      if (ref.missing.length || ref.empty.length) return { name: '', broken: ref };
    }

    const aria = attr(el, 'aria-label');
    if (isRealName(aria)) return { name: aria };

    const text = textOf(el);
    if (isRealName(text)) return { name: text };

    const title = attr(el, 'title');
    if (isRealName(title)) return { name: title };

    // An image inside a control lends it its alt text, and an svg lends it its
    // <title>. A descendant carrying aria-label is not strictly guaranteed to
    // be exposed, but it is unambiguous authoring intent, so we take it.
    for (const img of el.querySelectorAll('img[alt]')) {
      if (isRealName(img.getAttribute('alt').trim())) return { name: img.getAttribute('alt').trim() };
    }
    for (const svgTitle of el.querySelectorAll('svg > title, svg > desc')) {
      if (isRealName(textOf(svgTitle))) return { name: textOf(svgTitle) };
    }
    for (const labelled of el.querySelectorAll('[aria-label], [aria-labelledby]')) {
      const inner = nameOfShallow(labelled);
      if (isRealName(inner)) return { name: inner };
    }

    // An <input> acting as a button carries its name in `value`, not in text.
    if (el.tagName === 'INPUT' && isRealName(String(el.value ?? ''))) return { name: String(el.value) };

    return { name: '', text };
  };

  const nameOfShallow = (el) => {
    const ref = resolveLabelledby(el);
    if (ref && ref.text) return ref.text;
    return attr(el, 'aria-label');
  };

  /** Everything that makes an element none of our business. */
  const skipped = (el) => {
    if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return true;
    if (el.closest('svg')) return true;
    for (const sel of ignoreSelectors) {
      try { if (el.closest(sel)) return true; } catch { /* a bad selector in config is not a page bug */ }
    }
    const role = attr(el, 'role');
    if (role === 'presentation' || role === 'none') return true;

    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return true;
    }
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility !== 'visible') return true;
    return false;
  };

  const bigEnough = (el, min) => {
    const rect = el.getBoundingClientRect();
    return rect.width >= min && rect.height >= min;
  };

  /**
   * A disabled control outside any form is almost always a placeholder in a
   * half-built UI or a decorative state in a component gallery. Inside a form
   * it is a real field that will be enabled, so it still needs its label.
   */
  const parkedDisabled = (el) => el.disabled === true && !el.closest('form');

  /**
   * The search landmark pattern: <form role="search" aria-label="Search site">
   * with a bare input inside is the shape the pattern documents, and the form's
   * own name carries the field.
   */
  const inNamedSearch = (el) => {
    const region = el.closest('[role="search"]');
    if (!region) return false;
    return isRealName(nameOfShallow(region)) || isRealName(attr(region, 'title'));
  };

  const hits = [];
  const push = (kind, el, detail, text) => {
    hits.push({ kind, selector: selectorFor(el), detail, text });
  };

  const brokenRef = (el, what, ref) => {
    push('labelledby-broken', el, {
      what,
      labelledby: ref.raw,
      missingIds: ref.missing,
      emptyIds: ref.empty,
    });
  };

  const describeControl = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'Button';
    if (tag === 'a') return 'Link';
    return `Element <${tag} role="button">`;
  };

  const FIELD_NAMES = {
    select: 'Select',
    textarea: 'Textarea',
  };

  const fieldLabel = (el) => {
    const tag = el.tagName.toLowerCase();
    if (FIELD_NAMES[tag]) return FIELD_NAMES[tag];
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    return `Input type="${type}"`;
  };

  const elements = document.querySelectorAll(
    'button, [role="button"], a[href], input, select, textarea, img, iframe',
  );

  for (const el of elements) {
    if (hits.length >= 400) break;
    if (skipped(el)) continue;

    const tag = el.tagName.toLowerCase();
    const isControl = tag === 'button' || tag === 'a' || attr(el, 'role') === 'button';
    const isField = tag === 'input' || tag === 'select' || tag === 'textarea';

    if (isField && !isControl) {
      if (tag === 'input' && UNLABELABLE_INPUTS.has((el.getAttribute('type') || 'text').toLowerCase())) continue;
      if (parkedDisabled(el)) continue;
      if (inNamedSearch(el)) continue;
      if (!bigEnough(el, 4)) continue;

      const ref = resolveLabelledby(el);
      if (ref && isRealName(ref.text)) continue;
      if (ref && (ref.missing.length || ref.empty.length)) {
        brokenRef(el, `${fieldLabel(el).toLowerCase()}`, ref);
        continue;
      }
      if (isRealName(attr(el, 'aria-label'))) continue;

      // el.labels is the browser's own resolution and covers both <label for>
      // and a wrapping <label>, including the duplicate-id edge cases.
      const labels = el.labels ? [...el.labels] : [];
      const labelNames = (l) => [textOf(l), ...[...l.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt'))];
      if (labels.some((l) => labelNames(l).some((value) => isRealName(String(value ?? ''))))) continue;
      if (isRealName(attr(el, 'title'))) continue;

      push('field', el, {
        what: fieldLabel(el),
        name: attr(el, 'name') ? short(attr(el, 'name')) : '',
        placeholder: attr(el, 'placeholder') ? short(attr(el, 'placeholder')) : '',
        emptyLabels: labels.length,
      });
      continue;
    }

    if (isControl) {
      if (parkedDisabled(el)) continue;
      if (!bigEnough(el, 4)) continue;

      const result = nameOf(el);
      if (isRealName(result.name)) continue;
      if (result.broken) {
        brokenRef(el, describeControl(el).toLowerCase(), result.broken);
        continue;
      }

      const kind = tag === 'a' ? 'link' : 'button';
      push(kind, el, {
        what: describeControl(el),
        contains: contentSummary(el),
        href: tag === 'a' ? short(el.getAttribute('href')) : '',
      }, result.text || '');
      continue;
    }

    if (tag === 'img') {
      // alt="" is the correct way to say "decorative", so only a missing
      // attribute counts. An img named by aria-* or title is named already.
      if (el.hasAttribute('alt')) continue;
      if (attr(el, 'aria-label') || attr(el, 'aria-labelledby') || attr(el, 'title')) continue;
      if (!bigEnough(el, 4)) continue;
      // Inside a link or a button the alt is not the finding: either the
      // control is named some other way and nobody hears the difference, or the
      // control is already reported above and this would be the same bug twice.
      if (el.closest('a[href], button, [role="button"]')) continue;

      push('image', el, { src: short(el.getAttribute('src') || el.currentSrc || '') });
      continue;
    }

    if (tag === 'iframe') {
      if (isRealName(attr(el, 'title'))) continue;
      if (isRealName(attr(el, 'aria-label'))) continue;
      const ref = resolveLabelledby(el);
      if (ref && isRealName(ref.text)) continue;
      if (!bigEnough(el, IFRAME_MIN)) continue;

      push('iframe', el, { src: short(el.getAttribute('src') || '') });
    }
  }

  hits.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind]);
  return hits;
}
