#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';

import { loadConfig, normalize, DEFAULT_VIEWPORTS } from '../src/config.mjs';
import { CHECKS } from '../src/checks/index.mjs';
import { run, passed, countBy } from '../src/run.mjs';
import { toJson, toMarkdown, toTerminal, useColor } from '../src/report.mjs';

const HELP = `
looksright - open a page and check whether it actually looks right

Usage
  looksright check <url|path> [options]
  looksright init
  looksright checks

Options
  --config <file>      Config file to use instead of looking for one
  --viewport <names>   phone,tablet,desktop or WIDTHxHEIGHT (default: all three)
  --theme <names>      light,dark (default: both)
  --route <paths>      Extra paths to visit, comma separated
  --skip <ids>         Checks to skip, comma separated
  --warn-only <ids>    Checks that never fail the run
  --shots <dir>        Save a screenshot of every scene into <dir>
  --json [file]        Machine readable output
  --md <file>          Write a markdown report
  --wait <selector>    Wait for this selector before checking
  --settle <ms>        Extra wait after load (default: 600)
  --timeout <ms>       Navigation timeout (default: 20000)
  --headed             Show the browser window
  --channel <name>     Force a browser: chrome, msedge, chromium
  --quiet              Only print the summary line
  -h, --help           This text

Exit codes
  0  no error level finding survived
  1  at least one error level finding
  2  looksright could not run: no browser, bad config, bad flag

Examples
  looksright check http://localhost:3000
  looksright check / --viewport phone --theme dark
  looksright check https://example.com --shots .looksright --md report.md
`;

// Flags that never take a value. Without this list, `looksright check --quiet
// http://localhost:3000` reads the URL as the value of --quiet and the run has
// no target left, which looks like the tool ignoring the argument.
const BOOLEAN_FLAGS = new Set(['headed', 'quiet', 'help', 'h']);

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--') && !token.startsWith('-')) {
      args._.push(token);
      continue;
    }
    const key = token.replace(/^--?/, '');
    if (BOOLEAN_FLAGS.has(key)) {
      args.flags[key] = true;
      continue;
    }
    const next = argv[i + 1];
    // A value flag followed by another flag, or by nothing, is still a boolean:
    // `--json` on its own writes to the default path.
    if (next === undefined || next.startsWith('-')) {
      args.flags[key] = true;
    } else {
      args.flags[key] = next;
      i++;
    }
  }
  return args;
}

function list(value) {
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function viewportsFrom(value) {
  return list(value).map((name) => {
    const size = /^(\d+)x(\d+)$/.exec(name);
    if (size) {
      return { name, width: Number(size[1]), height: Number(size[2]), scale: 2 };
    }
    const known = DEFAULT_VIEWPORTS.find((v) => v.name === name);
    if (!known) throw new Error(`Unknown viewport "${name}". Use phone, tablet, desktop, or 412x915.`);
    return known;
  });
}

const CONFIG_EXAMPLE = `{
  "baseUrl": "http://localhost:3000",
  "routes": ["/", "/pricing", { "path": "/app", "waitFor": "[data-loaded]" }],
  "viewports": ["phone", "desktop"],
  "themes": ["light", "dark"],
  "warnOnly": ["missing-labels"],
  "ignoreSelectors": [".ad-slot"],
  "ignoreConsole": ["ResizeObserver loop"],
  "screenshots": ".looksright"
}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [command, target] = args._;

  if (args.flags.help || args.flags.h || !command) {
    process.stdout.write(`${HELP}\n`);
    process.exit(command ? 0 : 1);
  }

  if (command === 'checks') return listChecks();
  if (command === 'init') return writeExampleConfig();
  if (command !== 'check') {
    process.stderr.write(`Unknown command "${command}".\n${HELP}\n`);
    process.exit(1);
  }
  return check(args, target);
}

function listChecks() {
  for (const item of CHECKS) {
    process.stdout.write(`${item.id.padEnd(22)} ${item.level.padEnd(5)} ${item.title}\n`);
  }
}

async function writeExampleConfig() {
  await writeFile('looksright.config.json', CONFIG_EXAMPLE);
  process.stdout.write('Wrote looksright.config.json. Edit the routes and run: looksright check\n');
}

async function check(args, target) {
  const config = await loadConfig(process.cwd(), args.flags.config === true ? null : args.flags.config);
  applyFlags(config, args.flags, target);

  if (!config.routes.length) {
    process.stderr.write('Nothing to check. Pass a URL or add routes to the config.\n');
    process.exit(1);
  }

  const quiet = Boolean(args.flags.quiet);
  const color = useColor();
  const result = await run(config, {
    headed: Boolean(args.flags.headed),
    channel: typeof args.flags.channel === 'string' ? args.flags.channel : null,
    onScene: quiet
      ? undefined
      : (scene) => {
          const bad = scene.findings.filter((f) => f.level === 'error').length;
          const mark = bad ? '✗' : scene.findings.length ? '!' : '✓';
          process.stderr.write(`${mark} ${scene.route.name ?? scene.route.path} ${scene.viewport.name} ${scene.theme} (${scene.ms}ms)\n`);
        },
  });

  await emit(result, args.flags, { quiet, color });
  process.exit(passed(result.scenes) ? 0 : 1);
}

async function emit(result, flags, { quiet, color }) {
  if (typeof flags.md === 'string') await writeFile(flags.md, toMarkdown(result));

  if (flags.json) {
    const json = toJson(result);
    if (typeof flags.json === 'string') await writeFile(flags.json, json);
    else process.stdout.write(`${json}\n`);
    return;
  }

  if (quiet) {
    const errors = countBy(result.scenes, 'error');
    const warnings = countBy(result.scenes, 'warn');
    process.stdout.write(
      passed(result.scenes) ? 'Looks right.\n' : `Does not look right: ${errors} errors, ${warnings} warnings.\n`,
    );
    return;
  }

  process.stdout.write(`${toTerminal(result, { color })}\n`);
}

function applyFlags(config, flags, target) {
  if (target) {
    const absolute = /^https?:\/\//.test(target);
    if (absolute) {
      const url = new URL(target);
      config.baseUrl = url.origin;
      config.routes = [{ path: url.pathname + url.search }];
    } else {
      config.routes = [{ path: target }];
    }
  }

  for (const path of list(flags.route)) config.routes.push({ path });

  if (typeof flags.viewport === 'string') config.viewports = viewportsFrom(flags.viewport);
  if (typeof flags.theme === 'string') config.themes = list(flags.theme);
  if (typeof flags.skip === 'string') config.skip = list(flags.skip);
  if (typeof flags['warn-only'] === 'string') config.warnOnly = list(flags['warn-only']);
  if (typeof flags.shots === 'string') config.screenshots = flags.shots;
  if (typeof flags.settle === 'string') config.settle = Number(flags.settle);
  if (typeof flags.timeout === 'string') config.timeout = Number(flags.timeout);
  if (typeof flags.wait === 'string') {
    config.routes = config.routes.map((r) => ({ ...r, waitFor: flags.wait }));
  }

  const normalized = normalize(config);
  Object.assign(config, normalized);
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exit(2);
});
