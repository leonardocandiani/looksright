---
description: Open the running page in a real browser and report what is actually broken
argument-hint: '[url|route]'
allowed-tools: Read, Glob, Grep, Edit, Bash(npx:*), Bash(node:*), Bash(cat:*), Bash(lsof:*), Bash(curl:*)
---

# looksright check

Look at the page. Do not reason about it, do not trust the build: open it and read
what came back.

`$ARGUMENTS` may hold a URL (`http://localhost:5173`) or a route (`/pricing`). It
is often empty, and that is the normal case.

## 1. Find the URL

In this order, stop at the first hit:

1. **The argument.** A full URL is used as is. A bare route (`/pricing`) needs a
   base URL, so keep going and combine them.
2. **`looksright.config.json`** in the repo root (or `looksright.config.mjs`,
   `.looksrightrc.json`). Its `baseUrl` wins over anything you infer.
3. **The dev server that is already up.** Read `package.json` scripts,
   `vite.config.*`, `next.config.*`, `astro.config.*` for an explicit port, then
   confirm something is answering: `curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>`.
4. **Ask.** If nothing answers, ask the user for the URL, or whether to start the
   dev server. Never guess a port and never report on a URL you did not confirm
   is serving. A `check` against a dead port produces a blank-page finding that
   is about the port, not about the code.

## 2. Run it

```bash
npx looksright check <url> --json 2>/dev/null || true
```

Progress goes to stderr, the JSON goes to stdout, and the exit code is 1 when any
error level finding survives. The `|| true` keeps that exit code from ending your
turn; the JSON is what you read.

Narrow the run when the user's complaint is narrow: `--viewport phone`,
`--theme dark`, `--route /pricing,/app`. Add `--shots .looksright` when you want
screenshots to hand to the `ui-judge` subagent afterwards.

If the run fails with "No browser found", tell the user to install Chrome or run
`npx playwright install chromium`. Do not fall back to reading the source and
guessing.

## 3. Report, with the code file attached

Group by severity, errors first, then warnings. For each finding print the check
id, the scene (route, viewport, theme), the message, and the selector.

Then do the part a JSON file cannot do: **find the code**. A finding carries a
selector like `.hero-title` or `button.icon-only`. Grep for it:

```bash
grep -rn "hero-title" src/ app/ components/ 2>/dev/null
```

Report `src/components/Hero.tsx:24` next to the finding when the grep is
unambiguous. When it matches five files, say so and name the likeliest one rather
than picking silently. When the selector is generic (`div > span`), say the
source is not inferable and move on. A wrong file path costs more than no file path.

## 4. Diagnose, do not repair on your own

Present the diagnosis and ask what to fix. Findings differ in cost: an
`invisible-text` in dark mode is a token that was never defined, a
`horizontal-overflow` is usually one fixed width or one unbroken string, and a
`contrast` warning may be a deliberate brand decision the user will not want
touched.

If the user asked you to fix, or already told you to go ahead: fix, then **run the
exact same command again** and paste the new counts. A fix without a second run is
a claim, not a result.

## 5. The rule

Never call a screen done because the build passed, the types checked, or the code
reads correctly. The evidence is the looksright output from this turn. If you did
not run it, say the screen is unverified.
