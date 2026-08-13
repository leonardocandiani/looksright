---
name: looksright
description: Verifies that a web page actually renders correctly by opening it in a real Chrome across viewports and themes and running 12 deterministic checks. Use before telling anyone a screen is done, after any change that touches rendering (component, CSS, theme tokens, layout, copy length, data fetching), when the user reports that something "looks broken", "is blank", "is weird on mobile", or "is unreadable in dark mode", and when a page must be gated in CI. Do not use for backend-only changes or code that does not reach the DOM.
---

# looksright

Type checks prove the props line up. Unit tests prove the function returns the
right value. Neither one opens the page. The failures that reach users, a blank
screen, a spinner that never stops, text the same color as its background, a
layout that scrolls sideways on a phone, live entirely in the rendered document
and are invisible to every check that does not load it.

LooksRight loads it. Real Chrome, every route times every viewport times every
theme, 12 checks, exit code 1 when something is wrong.

## The rule this skill exists to enforce

**A finding from looksright is runtime evidence. "The code looks correct" is not.**

Never report a screen as done, working, or fixed based on a passing build, a
passing type check, or your own reading of the JSX. The proof is the looksright
output from the current turn. If you have not run it, the honest word is
*unverified*, and you say so.

## When to run it

Run it when the change reaches the DOM:

- A component, a page, a layout, a stylesheet, a Tailwind class, a theme token.
- A copy change: longer strings are the most common cause of clipped text and
  horizontal overflow.
- A data fetch or a loading state: the skeleton that never resolves is the single
  most common "it works on my machine" bug.
- Anything you are about to describe to the user as finished.

Also run it when the user says the page is broken, before you form a hypothesis.
Their report is the primary evidence; your job is to reproduce it, and the fastest
reproduction is the same phone-and-dark-mode scene they were looking at.

## When not to run it

- Backend, database, migrations, cron, CLI, tests, config, docs.
- A refactor with no render change, where a diff review is the appropriate check.
- Before the dev server is running. A dead port produces a blank-page finding
  that is about the port, not the code, and reporting it wastes the user's time.

## Running it

```bash
npx looksright check http://localhost:3000 --json 2>/dev/null || true
```

Progress lines go to stderr, JSON goes to stdout, exit code 1 means an error level
finding survived. Keep the `|| true` so the exit code does not end the turn.

Scope it down when the complaint is scoped: `--viewport phone`, `--theme dark`,
`--route /pricing`. Add `--shots .looksright` when you want screenshots, and hand
those to the `ui-judge` subagent for the part no check can decide.

## Reading the findings

| Check | What it means | Usual fix |
|---|---|---|
| `blank-page` | Nothing rendered, or `body` has no height | An exception before mount, a failed root fetch, a router with no matching route. Read `console-errors` in the same scene first, it usually names the cause. |
| `console-errors` | An exception was thrown during load | Fix the exception. It already reports only real throws, not the echo of a failed request. |
| `failed-requests` | 4xx, 5xx, or a network failure | A wrong asset path, a missing env var in the API base URL, a CORS rejection. Grouped by host so one dead service does not print forty lines. |
| `stuck-loading` | A spinner or skeleton was still there 1200ms later, read twice | Either the fetch never resolves, or the check needs `waitFor` on that route because the data genuinely takes longer. Decide which one is true before you touch code. |
| `horizontal-overflow` | The page scrolls sideways on a phone, or `<meta viewport>` is missing | The finding names the element. A fixed `width` in px, a `min-width`, an unbroken string, a table without a scroll container, an image without `max-width: 100%`. |
| `clipped-text` | Text is cut by its container with no ellipsis | Let the box grow, wrap the text, or add `text-overflow: ellipsis` on purpose. Warn level: sometimes the crop is intentional. |
| `invisible-text` | Text is nearly the color of its own background, ratio below 1.35 | Almost always a half-finished theme: a color defined for light mode and inherited into dark. Find the token, not the component. |
| `contrast` | Below WCAG AA on text that actually rendered | Darken the foreground or lighten the background. Warn level, because brand decisions live here, so raise it, do not silently change it. |
| `broken-images` | An `<img>` or a font did not load | Wrong path, missing file in the build output, a hotlink that now 403s. |
| `tiny-targets` | A touch target under 24px is an error, under 44px a warning, phone viewports only | Pad the target rather than scale the icon. |
| `missing-labels` | An icon button with no accessible name, an input with no label, an img with no alt, an iframe with no title | Add `aria-label`, a `<label for>`, `alt`, `title`. Cheap to fix, and it is what a screen reader has to work with. |

## Two habits that keep the tool trusted

**Grep the selector before you name the file.** A finding carries `.hero-title`;
the file it lives in is one grep away. Report `src/components/Hero.tsx:24` next to
the finding when the grep is unambiguous, and say "not inferable" when the
selector is generic. A confidently wrong path costs more than no path.

**Fix, then run again.** The second run with the counts down is the deliverable.
The fix itself is a hypothesis until the tool disagrees with itself.

## When a finding is wrong

It happens, and the fix is not to ignore the tool. Suppress precisely:
`ignoreSelectors` for a third-party widget you do not control, `ignoreConsole` for
a message you have read and understood, `warnOnly` for a category the project is
not ready to enforce yet. Blanket-skipping a check turns the run green while the
bug stays on the screen, which is the exact failure this tool exists to prevent.
