# The checks

Eleven checks, one page each. For every one: what it catches, why that matters, what it deliberately does not report, and how to turn it down.

The exclusions are the interesting part. A check that fires on legitimate code gets muted, and a muted check finds nothing, so each one gives up coverage on purpose in the places where a false positive was likely. Those give-ups are listed here in full, because a check you cannot predict is a check you cannot trust.

## How severity and silencing work

Each check has a default level, `error` or `warn`, and individual findings can override it. The exit code is 1 only when an `error` survives, so warnings never fail a build on their own.

Three ways to turn something down, from narrowest to widest:

| tool | effect |
|---|---|
| `ignoreSelectors: [".ad-slot"]` | elements matching the selector, and their descendants, are exempt from every DOM check |
| `warnOnly: ["missing-labels"]` | the check still runs and still reports, but never fails the run |
| `skip: ["contrast"]` | the check does not run at all |

All three exist as flags too: `--skip`, `--warn-only`. Console and network noise has its own filter, `ignoreConsole`, which is a list of case-insensitive regex sources matched against console messages and request URLs while the page loads.

Two checks do not consult `ignoreSelectors`, because they never touch the DOM: `console-errors` and `failed-requests`. Use `ignoreConsole` for those.

---

## blank-page

**Level:** error. **Source:** `src/checks/blank-page.mjs`

### What it catches

The page loaded and there is nothing on it. Two shapes:

- **Empty**: less than 2 characters of text and not a single visible `img`, `svg`, `canvas`, `video`, `input`, `button` or `[role="img"]` bigger than 8x8. Also fires when there is no `body` element at all.
- **Collapsed**: the body has text but its bounding box is 40px tall or less, so the DOM looks full and the screen reads as empty. This is what a failed layout usually looks like.

### Why it matters

This is the failure that matters most, because every other check passes on a blank page. No overflow, no contrast problem, no broken image. A run that reports "all good" about a white screen is worse than no run at all, so this check comes first in the report and everything after it reads as consequence.

### What it stays quiet about

- Any page with real text and at least one painted element. It has no opinion on whether the content is the right content.
- Empty *sections*. It judges the document, not a region of it.
- It does not consult `ignoreSelectors`: hiding an element cannot make a page blank.

### How to silence it

`skip: ["blank-page"]`, and think twice. If this one is firing, nothing else in the report means anything.

---

## console-errors

**Level:** error. **Source:** `src/checks/console-errors.mjs`

### What it catches

Uncaught exceptions and `console.error` calls during load, collected by a listener in `src/browser.mjs` and deduplicated. The first five distinct messages are reported individually, trimmed to the first line and 180 characters; the rest collapse into one warning that counts them.

### Why it matters

An exception during hydration or during a first render leaves the page half built, and nothing about that is visible in a build log. The message is usually the fastest route to the cause of everything else in the report.

### What it stays quiet about

- **Messages that only echo a failed request.** Chrome logs a console error for every dead request, worded so generically that it says nothing: `Failed to load resource...`, `net::ERR_...`, `the server responded with a status of 404`. `failed-requests` reports the same event with the URL, the status and the host, so keeping both would count every broken image twice and push the real exception out of view.
- Warnings and logs. Only `console.error` and real page errors are read.
- Anything matching `ignoreConsole`, filtered at capture time.
- Duplicates: the same message logged forty times is one finding.

### How to silence it

`ignoreConsole: ["ResizeObserver loop", "third-party-sdk"]` for known noise, `warnOnly` when a legacy page is never going to be clean, `skip` as a last resort.

---

## failed-requests

**Level:** error, with per-finding severity. **Source:** `src/checks/failed-requests.mjs`

### What it catches

Requests that came back 4xx or 5xx, and requests that never completed. Identical URLs are deduplicated with a retry count (a script hammering one dead endpoint thirty times is one problem, and thirty is the evidence). Then URLs that share a status and a host are folded into one line, so a CDN outage is one finding instead of thirty. Eight groups are reported, then a summary.

Severity follows what actually breaks the page, not the status code alone:

| situation | level |
|---|---|
| `favicon.ico`, `favicon.png`, `favicon-32x32.png` | warn |
| any 5xx | error |
| 404 on a painted asset (image, font, css, js, media), wherever it is hosted | error |
| 401, 402, 403, 429 | warn |
| anything else, first party | error |
| anything else, third party | warn |

A subdomain of the page's host counts as first party in both directions, since a CDN on your own domain is still your deployment.

### Why it matters

A dead stylesheet is an unstyled page. A dead script is a page that does nothing when clicked. Neither throws anything a test would catch.

### What it stays quiet about

- **Aborted requests.** A request cancelled mid-flight is almost always the page navigating away.
- **`data:`, `blob:` and extension URLs.** Not the page's traffic.
- **Requests killed by the machine running the check**: `BLOCKED_BY_CLIENT`, `BLOCKED_BY_ADMINISTRATOR`, `BLOCKED_BY_EXTENSION`. An ad blocker or a corporate policy is not a defect in the page, and the same page on a clean profile loads it fine.
- **Third-party 401/403** stays a warning on purpose. Nine times out of ten it is a missing dev key for analytics, a chat widget or a session replay script, and the product is fine. A first-party 401 does not get promoted either, because that is the normal answer to an unauthenticated probe against your own API on a logged-out page.
- Favicons, demoted before the asset rule, because Chrome requests `/favicon.ico` on its own whether the page asked for it or not.

### How to silence it

`ignoreConsole` also matches request URLs, so `ignoreConsole: ["googletagmanager", "hotjar"]` drops a whole third party. `ignoreSelectors` does nothing here: this check never touches the DOM.

---

## stuck-loading

**Level:** error. **Source:** `src/checks/stuck-loading.mjs`

### What it catches

A spinner that spins forever, a skeleton that never becomes content, an eternal "Loading...". The build is green, the request came back 200, and the user is looking at a page that never arrives.

The whole check hangs on one idea: a loading indicator is only a bug if it persists. So it reads twice. The first pass tags every candidate with a marker attribute, waits 1200ms, and the second pass asks who is still there and still looks like a loader. A skeleton that disappeared in between did its job and is never mentioned.

Candidates are recognised by `aria-busy="true"`, `role="progressbar"`, class, id and `data-*` words (`spinner`, `spin`, `loading`, `loader`, `preloader`, `skeleton`, `shimmer`, `busy`, `carregando`), compound names (`animate-pulse`, `placeholder-glow`, `placeholder-wave`, `lds-`, `sk-`), loading copy, and SVGs with an infinite rotation animation. It also reports a document whose `readyState` is still not `complete` after the wait, but only when it was incomplete on both readings.

### Why it matters

It is the one broken state that looks like a working state. Nothing failed, so nothing is logged, and a screenshot taken at the wrong moment looks like a page that is simply loading.

### What it stays quiet about

- **Anything that disappeared during the wait.** That is a skeleton doing its job.
- **Anything that stopped looking like a loader on the second read.** An app that flips `aria-busy` to false, or swaps a class from `skeleton` to `card`, reuses the same node to say it is done.
- **A progress bar that is progressing.** If `aria-valuenow` moved between the two readings, or already sits at `aria-valuemax`, it is not stuck. Determinate bars sitting still for one second are not accused either.
- **Below the fold.** Infinite scroll sentinels and lazy sections are supposed to sit there spinning until the reader reaches them, so only elements intersecting the viewport count.
- **Test hooks.** `data-testid`, `data-cy`, `data-qa`, `data-e2e`, `data-automation-id` and friends name the component, not its state, and they stay on the node after the content arrives. Airbnb ships a fully rendered navigation bar tagged `data-testid="shimmer-css-variable-index-0"`.
- **Tailwind arbitrary values.** `[--spinner-size:16px]` is a CSS declaration, not a state. Vercel puts it on every header button, and reading "spinner" out of it accuses three links that work perfectly.
- **Flags that are off.** `data-loading="false"`, and the same for `0`, `off`, `no`, `none`, `idle`, `done`, `complete`, `loaded`, `ready`, `success`, `error`, `failed`.
- **Analytics payloads.** Values longer than 32 characters, or starting with `[` or `{`, are not read as state.
- **Elements with more than 40 characters of text.** A real placeholder is an empty grey block. A node full of copy already has its content, whatever its class is called.
- **Hidden subtrees**, faded elements, and nested loaders: a loading container and the dot inside it are one problem, so only the outermost node is reported.
- **A page that navigates mid-check.** The execution context is destroyed and there is nothing to conclude, so the check stands down instead of failing the run.

### How to silence it

For a page that is legitimately a live dashboard with a permanent activity indicator, put `data-looksright-ignore` on `<html>` or `<body>` and the check opts out entirely. For one widget, `ignoreSelectors: [".live-feed"]`, or `data-looksright-ignore` on its container.

---

## horizontal-overflow

**Level:** error. **Source:** `src/checks/horizontal-overflow.mjs`

### What it catches

The page scrolls sideways. One wide table, one unbreakable URL, one `width: 100vw` next to a scrollbar, and the whole layout slides under your thumb.

Two findings come out of it: the document-level fact (`the document is 640px wide inside a 390px viewport`) and the element responsible, named. Two shapes of culprit are distinguished, because they need opposite tie-breakers: a **box** that sticks out past the edge (the outermost one is the cause, everything inside it is consequence), and **content that spills** out of a box that fits (the innermost one holds the string that does not fit).

On viewports narrower than 600px it also checks the viewport meta tag first: a missing `<meta name="viewport">` is an error and short-circuits everything else, and a meta without `width=device-width` is a warning. Without it, Chrome lays the page out against a virtual 980px window and every width measurement below would find nothing.

### Why it matters

Nobody notices this on a desktop browser and everybody notices it on a phone. It is the canonical "it broke on mobile", and it is invisible to every test that does not set a viewport.

### What it stays quiet about

- **A root or body with `overflow-x: hidden` or `clip`.** Chrome still reports an oversized `scrollWidth`, but the page cannot actually be scrolled: the content is being cut off instead, which is a different problem for a different check. Saying "the page scrolls sideways" there would be false.
- **Fixed elements and anything inside one.** Modals, toasts, sticky bars and off-canvas menus are laid out against the viewport and never extend the scrollable area, however far out they sit.
- **Anything inside an ancestor that scrolls or clips on the x axis.** That ancestor absorbs the overflow, and it is where a carousel rail lives.
- **A box parked entirely past the edge by a `transform` translation.** Closed drawer, off-stage slide, peek-in panel. Real overflow starts inside the viewport and runs out of it.
- **`html` and `body` themselves.** Blaming them tells nobody which element to fix.
- **Zero-sized boxes**, which covers `display: none` and `[hidden]`.
- **Sub-pixel math**, with a 1px tolerance.

One thing it deliberately does **not** exclude: `visibility: hidden`, `opacity: 0` and `aria-hidden` elements. They are hidden from the eye, not from the layout engine, so a 1400px invisible box really does scroll the page. That is the hardest kind of overflow to find by hand, and the message says so out loud.

### How to silence it

`ignoreSelectors` drops individual culprits, and when every culprit on the page is ignored the finding disappears with them, so the sideways scroll is treated as intentional for that config.

---

## clipped-text

**Level:** warn. **Source:** `src/checks/clipped-text.mjs`

### What it catches

Text that is in the DOM but cut off by the box it sits in. The sentence is there, the screen reader reads it, `toHaveText` passes, and the person looking at the page sees "Continue to chec".

Two shapes, worst first:

1. `white-space: nowrap` plus `overflow: hidden` with no `text-overflow`. The line stops mid-word with nothing to signal there is more.
2. Any clipped box where whole lines fall outside it and there is no scrollbar to reach them.

The clipping box is often not the element holding the text, so the scan starts from boxes that clip and overflow, then measures the real line rectangles inside them. The report quotes the exact character where the text starts being invisible, found by binary search over the range.

### Why it matters

Nothing throws, so this survives every suite that never looks at pixels. It is also the defect most likely to hit a translated string: the layout was measured in English and the German label is 40% longer.

### What it stays quiet about

- **`text-overflow: ellipsis` on the horizontal axis.** A single clamped line ending in "..." is a designed truncation, and a long name in a list is supposed to do that. Reporting it would fire on half the well-built pages alive.
- **`-webkit-line-clamp`**, `clip-path`, the legacy `clip` property and `zoom`: deliberate truncation or math this check cannot do honestly.
- **The visually-hidden pattern**: boxes under 8x8, which is the single biggest false positive here.
- **Boxes that are already scrolled** (`scrollLeft` or `scrollTop` not zero). Something drives that box, so the content is reachable whatever the computed overflow says.
- **Text with almost nothing inside the box** (less than 8px of intersection in either axis). That is an off-screen carousel slide or a closed panel, not a sentence somebody is trying to finish.
- **Less than 4px hidden**, which is rounding, a descender or a border rather than lost words. On the vertical axis it also demands at least one whole line more than half outside.
- **Native controls and replaced elements**: `input`, `textarea`, `select`, `option`, `progress`, `meter`, `iframe`, `canvas`. They clip by design, or need different math.
- **Inline and `display: contents` boxes**, where `overflow` does nothing.
- **Hidden or faded text**: `visibility: hidden`, opacity 0 on the element or any of twelve ancestors, `[aria-hidden="true"]`, `[hidden]`, `text-indent` at or below -300px.
- **Transformed boxes** where layout pixels and screen pixels no longer agree.
- **Text owned by a nearer box.** If anything between the text and the clipping box clips, scrolls, is scrolled, is clamped or is transformed, the text is that box's business, not this one's.
- **A known blind spot, on purpose**: text clipped by two nested boxes at once is measured against the nearest one only, so a card that is itself half outside a scroller is not reported. Under-reporting beats crying wolf.
- Repeats: one clipped component down a list of fifteen is one finding, with the worst instance speaking for the group.

### How to silence it

Adding `text-overflow: ellipsis` both fixes the harsh case and silences the check, which is usually the right answer. Otherwise `ignoreSelectors`. It is already a warning, so it never fails a build by itself.

---

## invisible-text

**Level:** error. **Source:** `src/checks/invisible-text.mjs`

### What it catches

Text painted in the same color as the thing behind it. Three reasons, each with its own message: a contrast ratio under **1.35:1**, `color: transparent` with nothing filling it in, or a text color faded under 15% alpha.

### Why it matters

This is the half-finished theme bug. Someone styled the light palette, the dark one inherited a hardcoded near-black, and a heading, a price or a button label simply stopped existing. It survives code review because the DOM is correct and the text really is there, and it survives a screenshot diff on the light theme because that theme is fine.

It is filed as an error rather than a contrast warning on purpose: at these ratios nobody squints and reads it anyway.

### What it stays quiet about

- **The screen-reader-only family**, by class name: `sr-only`, `sr-only-focusable`, `visually-hidden`, `visuallyhidden`, `visually-hidden-focusable`, `screen-reader-text`, `screen-reader-only`, `screenreader-only`, `a11y-hidden`, `accessibly-hidden`, `hidden-visually`, `hide-visually`, `element-invisible`. Reporting these is the fastest way to get a tool uninstalled: the developer did the accessible thing and the tool called it a bug.
- **The hand-rolled version of the same pattern**: absolutely positioned with `clip` set, or `clip-path: inset(50%)`.
- **Deliberate invisibility**: font size under 1px, `text-indent` at or below -100px (the pre-CSS way of replacing a heading with a logo), any `text-shadow`, and `-webkit-text-stroke`. A shadow or a stroke can carry text that matches its own background, and that is an outlined look, not a broken theme.
- **Anything it cannot measure honestly.** If any layer in the ancestry has a `background-image`, a `filter`, a `backdrop-filter` or a `mix-blend-mode`, the painted color is not derivable from CSS and the check says nothing. Same for `background-clip: text` gradient headlines, and for colors in a color space other than sRGB, where a wrong conversion would mean a wrong accusation.
- **Non-opaque chains that cross a positioned element.** A sibling nobody looked at may be painting in between, which is exactly how a hero with a video behind white text looks identical to white text on a white section.
- **Mid-animation states**: cumulative opacity under 0.98 gets a pass, because a settled state and an animation frame are indistinguishable from one reading.
- **Covered text.** If something from another subtree sits on the element's centre point (a modal, a cookie banner, a decorative layer), the computed background is not what ends up behind the glyphs.
- **Off-document text**: more than 600px past either horizontal edge, or 2000px above the top. That is where carousels park slides nobody is looking at.
- **Boxes under 4x4**, hidden elements, `[aria-hidden="true"]`, `[hidden]`, and text with no letters or digits (a lone icon glyph or a stray bullet, whose color usually comes from a pseudo element this check cannot read).

Instead of guessing the page background from the theme flag, it probes the browser's own `Canvas` system color, which resolves against the root's used `color-scheme`. A page that opts out of dark backgrounds is measured against the color it actually paints.

### How to silence it

`ignoreSelectors` for a component, `warnOnly: ["invisible-text"]` if a legacy area cannot be fixed today. If it fires on your custom visually-hidden helper, adding one of the standard class names above is a real fix, not a workaround.

---

## leaked-markup

**Level:** error. **Source:** `src/checks/leaked-markup.mjs`

### What it catches

Markup that reached the screen as text. Seven kinds, each named in its own message: Markdown bold (`**total**`), WhatsApp bold, italic and strikethrough (`*teste*`, `_texto_`, `~texto~`), a Markdown link that never became a link, a Markdown heading, a raw HTML tag or entity (`<br>`, `&amp;`), an unfilled template placeholder (`{{user.name}}`, `${price}`), and a stray `undefined`, `null`, `NaN` or `[object Object]`.

### Why it matters

These never throw. The DOM is valid, the types check, the request succeeded, and the page renders a string that was supposed to be interpreted by something and got printed instead. It is the class of bug people find in a screenshot days later, usually a customer's.

The common cause is two systems disagreeing about who renders what: a message stored with one flavour of markup and displayed by a component that knows another, a template engine that ran on the server but not on the client, an API field that arrived undefined and went straight into the sentence.

Findings are grouped by kind and counted: ten bubbles with the same unrendered bold are one bug in one component, and ten lines would bury everything else on the scene.

### What it stays quiet about

- **Anything inside `<code>`, `<pre>`, `<kbd>`, `<samp>`, a `<textarea>` or a `[contenteditable]`**, and inside the containers the usual syntax highlighters own (`.hljs`, `.cm-editor`, `.monaco-editor`, `.shiki`, `.highlight`). Documentation that shows `*mensagem*` as an example is doing its job.
- **Punctuation that is not wrapping anything.** `R$ 2 * 3 * 4` is multiplication, `relatorio_final_2026.pdf` is a filename, `10~15 dias` is a range. Every inline pattern requires the delimiter to sit at a word boundary and to close around real content, which is the same rule the WhatsApp and Markdown parsers use.
- **Hidden text**: `display: none`, `visibility: hidden`, or a box under 1px. Nobody is reading it.
- **Text under 3 characters**, and anything past the first match in a node: one accusation per text node is enough to send someone to the component.

### How to silence it

`ignoreSelectors` for a widget that legitimately prints markup (a template editor preview, a syntax cheat sheet you wrote by hand), or `warnOnly: ["leaked-markup"]` while a migration is in flight.

---

## contrast

**Level:** warn. **Source:** `src/checks/contrast.mjs`

### What it catches

Text below the WCAG AA minimum against the background actually painted behind it: 4.5:1 normally, 3:1 for large text (24px, or 18.66px at weight 700 or more). Results are grouped by color, background, size and weight, so one design token used in forty places is one finding with a count.

### Why it matters

It is the accessibility failure that ships most often, because a designer approved the color on a large monitor in a dark room and nobody measured it. It is also the one most tools get wrong, which is why this one is timid.

### What it stays quiet about

- **Any background it cannot derive from CSS.** A `background-image`, `mix-blend-mode`, `filter` or `backdrop-filter` anywhere up the ancestry means the measurement would be a guess, so the element is skipped. A tool that flags a legitimate hero section over a photo gets uninstalled the same day.
- **Dark mode with no opaque layer.** In light mode the canvas is white on every engine. In dark mode it depends on how the page declares `color-scheme`, so there is no honest value to return and the check declines.
- **Text with something painting under it from another branch.** Two passes catch this: a sibling subtree whose box overlaps the text and paints, and the browser's own hit test at the text's centre point. Foreign *text* at the same point counts as painting too, because two stacked copies of a headline (Stripe ships one in green under a half-transparent blue one) show the eye a composite that neither computed `color` describes.
- **Disabled controls**, `[disabled]`, `[aria-disabled="true"]`, `fieldset[disabled]` and `:disabled`. Dimmed on purpose, and reporting them would be noise on every form in the world.
- **Placeholders.** They live in an attribute, not a text node, so they never reach the walker at all.
- **SVG text**, painted with `fill` rather than `color`, and `[contenteditable="true"]`, which holds whatever the user typed.
- **Text effects**: `text-shadow`, `-webkit-text-stroke`, `background-clip: text`. The computed color is not what the eye sees.
- **Fewer than 3 non-space characters.** Single characters are icons, bullets or decorative initials, not prose.
- **Ratios at or below 1.05, and alpha at or below 0.02.** That is not a contrast problem, it is invisible text, and `invisible-text` says it far better than a ratio does.
- Hidden elements, zero-size boxes, `[aria-hidden="true"]`, `[hidden]`, and the first 4000 text nodes only: above that the page is a data dump and the first slice is representative.

### How to silence it

It is a warning by default, so it never fails a build on its own. `ignoreSelectors` for a region, `skip: ["contrast"]` if your design system already has its own audit.

---

## broken-images

**Level:** error, with warnings for the ambiguous cases. **Source:** `src/checks/broken-images.mjs`

### What it catches

- An `<img>` the browser finished loading with `naturalWidth` and `naturalHeight` at zero: the file is not there.
- An `<img>` with no `src` and no `srcset` at all, occupying a real box.
- A CSS `background-image` whose URL matches a request that failed, reported with the status.
- An `<img>` that had still not finished loading when the page settled (warning).
- A `@font-face` the browser itself marked as failed, which silently repaints the page in a fallback family.

### Why it matters

A broken image is the one defect a screenshot-free workflow always misses: the markup is right, the build passes, and the page shows an empty frame where the product photo should be.

### What it stays quiet about

- **Lazy images below the fold.** An `img` with `loading="lazy"` that is off-screen has not been asked to load yet, and reporting it would fire on every long page on the web.
- **Tracking pixels**: declared 1x1, or rendered at 2x2 or smaller.
- **`data:` URIs.** They cannot 404, and a decode failure there surfaces in the console, where `console-errors` already reports it.
- **Background images with no failed request behind them.** A background has no `naturalWidth` to inspect, so the only honest evidence that one is missing is the network saying the request died. Anything else would be a guess.
- **Backgrounds on boxes under 8x8**, which are decoration rather than a picture anyone misses.
- **Fonts that merely look different.** Only a `FontFace` whose status is `error` is reported, never one that might have fallen back.
- Hidden elements, `[aria-hidden="true"]`, `[hidden]`, and anything inside `template`, `script`, `style` or `noscript`.
- Volume: the first 600 images and 600 elements, 8 findings, then a count.

### How to silence it

`ignoreSelectors` for a widget that is expected to have holes. The pending-image warning usually means the page needs more time, not that it is broken: raise `settle`, or use `waitFor`.

---

## tiny-targets

**Level:** warn, promoted to error when a target is both undersized and crowded. **Source:** `src/checks/tiny-targets.mjs`

### What it catches

Buttons and links too small to hit with a thumb, measured on phone-sized viewports only. Two thresholds, because there are two standards and both are useful:

- **24x24 CSS px** is WCAG 2.2 AA (2.5.8 Target Size, Minimum). Below it, *and* with another target within 24px, is an error.
- **44x44** is the size that actually feels right under a thumb (Apple HIG). The gap between the two is a warning.

Before measuring, the hit area is expanded the way the browser expands it: an absolutely positioned `::before` or `::after` with negative offsets grows the box, and a `<label for>` sitting within 8px of its control merges with it, because tapping the label activates the control.

### Why it matters

You only find this by holding the phone. On a mouse-driven desktop a 16px icon button is fine; on a 390px screen it is a coin toss.

### What it stays quiet about

- **Every viewport 600px and wider.** A mouse hits a 16px icon fine, and the whole criterion is about fingers.
- **A small link inside something big and clickable.** If any ancestor is at least 44x44 and is interactive, the tap lands anyway. Interactive here includes `cursor: pointer`, because the most common big-target pattern on the web is a plain `<div>` row wired up with `addEventListener`, which the DOM gives no other way to see. The walk stops at `<body>`, so a page setting the cursor globally cannot silence the whole check.
- **Links inside running text.** WCAG exempts targets in a sentence, and rightly: a link in a paragraph cannot be 44px tall without wrecking the line height. The exemption demands `display: inline` exactly, because an `inline-block` can grow to 44px without disturbing the line, and exempting it would quietly swallow every icon button that happens to live inside a `<p>` or a heading.
- **Lonely small targets.** WCAG's spacing exception: a 20px button in open space passes, the same button wedged into a toolbar does not. The check measures the 24px circle around each target against its neighbours.
- **Boxes of 6x6 or less.** That is the screen-reader-only pattern, a 1x1 input parked under a custom control that does the real work. No advice fits it.
- **A `label[for]` pointing at a visible control**, which would report the same target twice. A label for a *hidden* control stays, because there the label is the target.
- **Disabled controls**, `[inert]`, `[aria-hidden="true"]`, `[hidden]`, and anything with `pointer-events: none`, where something painted on top handles the taps.
- **Anything unreachable**: more than half the box clipped away by an ancestor, parked outside the document, or covered by an overlay at its centre point. A label painted over its own control does not count as covering it.

### How to silence it

`warnOnly: ["tiny-targets"]` keeps the report without failing the build, `ignoreSelectors` exempts a component, `skip` removes it. If it fires on a custom row component, giving the row `cursor: pointer` is both the fix and the silencer, since that is what tells the browser it is clickable too.

---

## missing-labels

**Level:** warn. **Source:** `src/checks/missing-labels.mjs`

### What it catches

Controls nobody can name. The icon button is the whole story: a header with a hamburger, a magnifier and a close X, each one a `<button>` wrapping an `<svg>`, none carrying a single word. It looks finished on screen and to a screen reader the page is three buttons called "button".

Six kinds, reported in that order of priority:

| kind | what it means |
|---|---|
| broken `aria-labelledby` | it points at an id that does not exist, or at an empty element |
| button | no accessible name at all |
| link | no accessible name at all |
| field | no `<label>` resolves to it, and no `aria-label` |
| image | no `alt` attribute |
| iframe | no `title` attribute |

The dangling `aria-labelledby` gets its own message because it is worse than having none: it silently overrides the text and the `aria-label` that would otherwise have named the control.

Names are resolved the way the accessibility tree resolves them: `aria-labelledby`, then `aria-label`, then the element's own text with `aria-hidden` subtrees removed, then `title`, then the `alt` of an image inside it, an `<svg><title>`, a descendant carrying `aria-label`, and finally an `<input>`'s `value`.

### Why it matters

It is the accessibility defect that reviews miss most, because the page looks complete. And it costs one attribute to fix.

### What it stays quiet about

- **`alt=""`.** That is the correct way to say "decorative", so only a missing attribute counts.
- **`role="presentation"` and `role="none"`.** The author expressed an intent.
- **An `<img>` inside a link or a button.** Either the control is named some other way and nobody hears the difference, or the control is already reported above and this would be the same bug twice.
- **Input types that a `<label>` never names**: `hidden`, `submit`, `reset`, `button` and `image`. They take their name from `value` or their own `alt`, and Chrome supplies a default.
- **Disabled controls outside a `<form>`.** Almost always a placeholder in a half-built UI or a state in a component gallery. Inside a form it is a real field that will be enabled, so it still needs its label.
- **The search landmark pattern**: a bare input inside `<form role="search" aria-label="Search site">` is the shape the pattern documents, and the form's own name carries the field.
- **Anything inside an `<svg>`**, and anything inside `[aria-hidden="true"]`, `[hidden]` or `[inert]`.
- **Tiny elements**: controls under 4x4, iframes under 32x32 (a tracking pixel, not embedded content).
- Hidden elements, by `checkVisibility`, `display` and `visibility`.

One thing it does **not** forgive: a name made only of punctuation or a lone glyph. An "x" or an arrow character is what an icon button looks like when the icon is a character instead of an `<svg>`, and a screen reader reads it as the glyph's Unicode name. A `placeholder` is not forgiven either, and the message says why: it disappears the moment somebody types.

### How to silence it

It is a warning by default. `warnOnly` is already the behaviour; use `skip: ["missing-labels"]` if a dedicated accessibility suite already covers this, or `ignoreSelectors` for third-party markup you do not control.
