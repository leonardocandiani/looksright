---
name: Bug report
about: A check fired on a correct page, missed a broken one, or looksright itself crashed
title: "[bug] "
labels: bug
assignees: leonardocandiani
---

## What happened

<!-- 1-3 sentences. Which check, and was it a false positive, a miss, or a crash? -->

## The page that reproduces it

<!--
Give us something we can open. In order of usefulness:
1. A public URL.
2. A minimal HTML file that reproduces it, pasted below. Strip everything that
   is not needed to make the finding appear.
3. If neither is possible, the exact markup and CSS of the element in the finding.

A screenshot alone is not enough: the checks read the live DOM and the computed
styles, so we need something a browser can load.
-->

```html
<!-- paste the minimal HTML here -->
```

## Command and output

Run it with `--json` and paste the whole thing. The scene (route, viewport, theme)
and the selector are what make the report reproducible.

```bash
npx looksright check <url> --json
```

```json
<!-- paste the JSON here -->
```

## What you expected

<!-- "contrast should not fire, the text is on a solid #111 background" -->

## What you got

<!-- The finding as printed, or the crash with its stack -->

## Config

<!-- Paste looksright.config.json if you use one, or say "no config" -->

```json
```

## Environment

- looksright version: <!-- npx looksright --help prints nothing useful here, use: npm ls -g looksright -->
- Node: <!-- node --version -->
- Browser it launched: <!-- Chrome, Edge, or the Playwright Chromium -->
- Browser version: <!-- google-chrome --version -->
- OS: <!-- macOS 15, Ubuntu 22, Windows 11 -->
- Where it ran: <!-- local, GitHub Actions, other CI -->

## Additional context

<!-- Screenshots from --shots, anything else that helps -->
