# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-12

First release.

### Added

- `looksright check <url|path>`: opens the page in a real Chrome once per route x viewport x theme and reports what is wrong with the rendered result. Exits 1 when an error-level finding survives, so it gates CI with no extra configuration.
- Eleven checks: `blank-page`, `console-errors`, `failed-requests`, `stuck-loading`, `horizontal-overflow`, `clipped-text`, `invisible-text`, `contrast`, `broken-images`, `tiny-targets`, `missing-labels`. Each one names the element and the number behind the finding, and documents what it deliberately does not report.
- Default scenes: `/` at phone (390x844), tablet (820x1180) and desktop (1440x900), in light and dark. Viewports narrower than 600px run with mobile emulation and touch enabled, so a site that sniffs the user agent still serves its phone layout.
- Browser discovery without a download: tries the installed `chrome`, `msedge` and `chromium` channels, falls back to a Playwright Chromium if one is present, and fails with the list of what it tried when there is none.
- Config file (`looksright.config.json`, `.mjs`, `.js` or `.looksrightrc`) with `baseUrl`, `routes`, `viewports`, `themes`, `skip`, `warnOnly`, `ignoreSelectors`, `ignoreConsole`, `timeout`, `settle` and `screenshots`.
- CLI flags that override the config: `--config`, `--viewport`, `--theme`, `--route`, `--skip`, `--warn-only`, `--shots`, `--json`, `--md`, `--wait`, `--settle`, `--timeout`, `--headed`, `--channel`, `--quiet`.
- `looksright init` writes an example config, `looksright checks` lists the checks and their default level.
- Three report formats: a terminal report grouped by scene, `--json` for CI and agents, `--md` for a PR comment or an artifact. `--shots <dir>` saves one screenshot per scene.
- Library API: `check(url, options)` returns `ok`, `errors`, `warnings`, `summary`, `scenes` and a flattened `findings` array. `run`, `passed`, `countBy`, `CHECKS`, `BY_ID`, `loadConfig`, `toTerminal`, `toMarkdown` and `toJson` are exported too.

[0.1.0]: https://github.com/leonardocandiani/looksright/releases/tag/v0.1.0
