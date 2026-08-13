---
description: Detect the framework, find the routes, and write a looksright.config.json for this repo
argument-hint: '[--ci]'
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(npx:*), Bash(node:*), Bash(cat:*), AskUserQuestion
---

# looksright setup

Write a `looksright.config.json` that fits THIS repo, so `npx looksright check`
runs with no arguments and visits the pages that matter.

`$ARGUMENTS` may contain `--ci`, which means also add the GitHub Actions job.

## 1. Detect the framework

Read `package.json` (dependencies and scripts) plus the config files, and pick one:

| Signal | Framework | Where the routes live |
|---|---|---|
| `next` in deps | Next.js | `app/**/page.{tsx,jsx,js}` or `pages/**/*.{tsx,jsx}` |
| `vite` + `react-router` | Vite SPA | route definitions in `src/**`, grep `path:` or `<Route` |
| `astro` in deps | Astro | `src/pages/**/*.{astro,md,mdx}` |
| `@remix-run/*` | Remix | `app/routes/**` |
| `nuxt` in deps | Nuxt | `pages/**/*.vue` |
| `Gemfile` with `rails` | Rails | `config/routes.rb` |
| `manage.py` | Django | `urls.py`, following `include()` |
| plain `index.html`, no framework | static | the HTML files themselves |

If nothing matches, ask the user which framework it is and where the routes are.

## 2. Collect the routes

Glob the route directory and convert file paths to URL paths. Drop what cannot be
checked without help:

- Dynamic segments (`[id]`, `:slug`, `<int:pk>`) need a real value. Pick one from
  a seed, a fixture, or a test, and if there is none, ask; do not emit `/post/[id]`.
- Routes behind auth will render the login page instead. Leave them out and tell
  the user they are out, or ask for a route that is reachable while logged out.
- API routes, `route.ts` handlers, `sitemap.xml`, `robots.txt`: skip, they render
  no UI.

Aim for the handful of pages people actually see: home, one content page, one form,
one dense app screen. Twenty routes across three viewports and two themes is 120
scenes and several minutes; that is a config nobody runs twice.

## 3. Find the base URL

Read the dev script in `package.json` for an explicit `--port`, then fall back to
the framework default: Next 3000, Vite 5173, Astro 4321, Remix 3000, Nuxt 3000,
Rails 3000, Django 8000. State the port you chose in the summary so a wrong guess
is visible.

## 4. Propose the config, then write it

Show the file first and ask for confirmation. Never overwrite an existing
`looksright.config.json` without saying so and showing the diff.

```json
{
  "baseUrl": "http://localhost:3000",
  "routes": ["/", "/pricing", { "path": "/app", "waitFor": "[data-loaded]" }],
  "viewports": ["phone", "desktop"],
  "themes": ["light", "dark"],
  "warnOnly": ["missing-labels"],
  "ignoreSelectors": [],
  "ignoreConsole": [],
  "screenshots": ".looksright"
}
```

Decisions worth making on the user's behalf, with the reason stated:

- **Viewports**: `phone` and `desktop`. Tablet rarely finds a bug the other two
  missed and costs a third of the runtime.
- **Themes**: both, if the repo has any dark mode signal (`dark:` classes,
  `prefers-color-scheme`, a `data-theme` attribute). If it has none, `["light"]`.
- **`waitFor`**: only on routes that load data client side, pointed at a selector
  that exists only after the data arrived. Without it, `stuck-loading` will report
  the skeleton, correctly.
- **`warnOnly`**: `missing-labels` on an existing codebase that never had an
  accessibility pass, so the first run is not a wall of red. Say that it is
  temporary.
- **`ignoreConsole`**: only for noise you have seen in this repo's output, never
  preemptively.

After writing, run it once and show the result. A config that was never executed
is not a setup.

## 5. CI job, if asked

Offer to add `.github/workflows/looksright.yml`. It needs the app to be serving,
so the job builds, starts the server in the background, waits for the port, then
checks. Ask before writing the file.

```yaml
name: LooksRight

on:
  pull_request:
  workflow_dispatch:

jobs:
  looks-right:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Start the app
        run: npm start &
      - name: Wait for the port
        run: npx --yes wait-on http://localhost:3000 --timeout 60000
      - uses: leonardocandiani/looksright@v0.1.0
        with:
          url: http://localhost:3000
          shots: .looksright
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: looksright-screenshots
          path: .looksright
```

Adjust `npm start`, the port, and the wait target to what this repo actually does.
If the app needs env vars or a database to boot, say so instead of shipping a job
that will fail on the first run.
