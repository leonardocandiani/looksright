# Contributing

Thanks for looking. The most valuable contributions here are not new features, they are better exclusions: a case where a check accused code that was perfectly fine. A report with the exact markup that triggered it is worth more than a patch.

## Running it

```bash
npm install
npm test
```

`npm install` pulls one dependency, `playwright-core`. It does not download a browser. The tests and the tool both drive the Chrome or Edge already on your machine, so install Google Chrome if you have neither, or run `npx playwright install chromium` once.

To try a change against something real:

```bash
node bin/looksright.mjs check https://example.com --headed
```

`--headed` opens the window so you can see what the check saw. `--viewport phone --theme dark` narrows a run down to the scene you are debugging.

The fixtures in `test/fixtures/` are two pages: `broken.html` has one planted instance of most defects, `clean.html` has none and must stay at zero findings. `test/server.mjs` serves them on an ephemeral port. If your change makes `clean.html` report anything, that is a false positive, and it is a blocker.

## Writing a new check

A check is one file in `src/checks/` exporting a default object with four properties, registered in `src/checks/index.mjs`.

```js
export default {
  id: 'my-check',        // kebab-case, used by --skip, --warn-only and the JSON
  title: 'My check',     // shown in the terminal report
  level: 'error',        // default level for findings this check returns
  async run({ page, viewport, theme, signals, config, route }) {
    return [];           // an array of findings, empty when the page is fine
  },
};
```

What `run` receives:

| argument | what it is |
|---|---|
| `page` | the Playwright page, already loaded and settled |
| `viewport` | `{ name, width, height, scale }` for this scene |
| `theme` | `'light'` or `'dark'` |
| `signals` | `{ consoleErrors, pageErrors, failedRequests }`, recorded during load |
| `config` | the resolved config, including `ignoreSelectors` |
| `route` | the route object being visited |

`signals` exists because console messages and responses only happen while the page loads. By the time a check runs they are gone, so `src/browser.mjs` listens for them up front. If your check needs something that is only observable during navigation, add a listener there rather than trying to read it after the fact.

A finding looks like this. Only `message` is required.

```js
{
  message: 'One sentence a person can act on, naming the element and the number.',
  selector: 'div.card > span.price',   // short and readable, not a coordinate path
  text: 'the offending content, trimmed',
  detail: { ratio: 1.02, color: '#111827', background: '#111827' },
  level: 'warn',                        // optional, overrides the check's default
}
```

The runner adds `check` and resolves the final `level`, so a check never has to know about `skip` or `warnOnly`.

### The golden rule: a documented exclusion beats coverage

A check that fires on legitimate code gets muted, and a muted check finds nothing. So every case a check refuses to judge is a comment in the source explaining why, ideally naming the real site or pattern that forced it. Read any existing check and most of the file is exactly that: `invisible-text` skips the `sr-only` family, `tiny-targets` skips a small link inside a card that is itself clickable, `contrast` refuses to guess a background it cannot derive from CSS.

When you are unsure whether something is a bug or a pattern, stay quiet and say so in a comment. Under-reporting is recoverable. Crying wolf is not.

Practical checklist before opening the PR:

- `clean.html` still reports zero findings.
- The new check runs against 5 to 10 real sites without accusing anything correct. Throwaway harnesses go in `_temp/`, which is not committed.
- Every early `return` and `continue` that skips an element has a comment saying why.
- The message names the element and carries the number behind the claim. "Contrast too low" is not a finding, "2:1 on #b9b9b9 over #ffffff, below the 4.5:1 minimum for 16px text" is.
- Work is bounded. Pages with 10k nodes exist, so cap the walk and say what the cap is.
- `config.ignoreSelectors` is honoured, or the check documents why it has no DOM to match against (`failed-requests` is the example).

## Proposing a change

Open an issue before a large PR, especially for a new check or a change in severity. Severity is a contract: moving something to `error` fails other people's builds on code that passed yesterday.

Small fixes, better messages and new exclusions can go straight to a PR.

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `perf:`. One logical change per commit.

Keep the style of the codebase: plain ES modules, no build step, no transpiler, no new runtime dependency without a very good reason. The whole point is that `npx looksright` works on a machine that has installed nothing.
