import { BY_ID } from './checks/index.mjs';
import { countBy, passed } from './run.mjs';

const COLOR = {
  reset: '[0m',
  dim: '[2m',
  bold: '[1m',
  red: '[31m',
  yellow: '[33m',
  green: '[32m',
  cyan: '[36m',
};

/** Colors are opt-out via NO_COLOR, which CI systems and pipes set for us. */
function paint(enabled) {
  if (!enabled) return Object.fromEntries(Object.keys(COLOR).map((k) => [k, '']));
  return COLOR;
}

export function useColor(stream = process.stdout) {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR;
}

function sceneName(scene) {
  const route = scene.route.name ?? scene.route.path;
  return `${route} · ${scene.viewport.name} · ${scene.theme}`;
}

/**
 * The terminal report.
 *
 * Grouped by scene, because a finding without its viewport and theme is not
 * actionable: "contrast too low" means nothing until you know it happens on
 * the phone in dark mode.
 */
export function toTerminal(result, { color = true } = {}) {
  const c = paint(color);
  const lines = [];
  const problems = result.scenes.filter((s) => s.findings.length);

  for (const scene of problems) {
    const errors = scene.findings.filter((f) => f.level === 'error').length;
    const mark = errors ? `${c.red}✗${c.reset}` : `${c.yellow}!${c.reset}`;
    lines.push(`\n${mark} ${c.bold}${sceneName(scene)}${c.reset}  ${c.dim}${scene.url}${c.reset}`);

    for (const finding of scene.findings) {
      const tone = finding.level === 'error' ? c.red : c.yellow;
      const tag = BY_ID[finding.check]?.title ?? finding.check;
      lines.push(`  ${tone}${finding.level === 'error' ? 'error' : 'warn '}${c.reset} ${c.dim}${tag}${c.reset}  ${finding.message}`);
      if (finding.selector) lines.push(`        ${c.cyan}${finding.selector}${c.reset}`);
    }

    if (scene.screenshot) lines.push(`  ${c.dim}screenshot: ${scene.screenshot}${c.reset}`);
  }

  const clean = result.scenes.length - problems.length;
  const errors = countBy(result.scenes, 'error');
  const warnings = countBy(result.scenes, 'warn');

  lines.push('');
  if (passed(result.scenes)) {
    lines.push(`${c.green}Looks right.${c.reset} ${plural(result.scenes.length, 'scene')} checked, ${plural(warnings, 'warning')}.`);
  } else {
    lines.push(
      `${c.red}${c.bold}Does not look right.${c.reset} ${plural(errors, 'error')} and ${plural(warnings, 'warning')} across ${problems.length} of ${result.scenes.length} scenes${clean ? `, ${clean} clean` : ''}.`,
    );
  }

  return lines.join('\n');
}

/** Machine readable, for CI and for agents that need to act on the result. */
export function toJson(result) {
  return JSON.stringify(
    {
      ok: passed(result.scenes),
      errors: countBy(result.scenes, 'error'),
      warnings: countBy(result.scenes, 'warn'),
      checks: result.checks,
      scenes: result.scenes.map((s) => ({
        route: s.route.name ?? s.route.path,
        url: s.url,
        viewport: s.viewport.name,
        theme: s.theme,
        ms: s.ms,
        ...(s.screenshot ? { screenshot: s.screenshot } : {}),
        findings: s.findings,
      })),
    },
    null,
    2,
  );
}

/** For a PR comment or a report file someone actually reads. */
export function toMarkdown(result) {
  const errors = countBy(result.scenes, 'error');
  const warnings = countBy(result.scenes, 'warn');
  const out = ['# LooksRight', ''];

  out.push(
    passed(result.scenes)
      ? `**Looks right.** ${result.scenes.length} scenes checked, ${warnings} warnings.`
      : `**Does not look right.** ${errors} errors, ${warnings} warnings, ${result.scenes.length} scenes checked.`,
    '',
  );

  for (const scene of result.scenes.filter((s) => s.findings.length)) {
    out.push(`## ${sceneName(scene)}`, '', `\`${scene.url}\``, '');
    out.push('| | Check | What is wrong |', '|---|---|---|');
    for (const f of scene.findings) {
      const icon = f.level === 'error' ? '🔴' : '🟡';
      const tag = BY_ID[f.check]?.title ?? f.check;
      out.push(`| ${icon} | ${tag} | ${escapePipes(f.message)}${f.selector ? `<br><code>${escapePipes(f.selector)}</code>` : ''} |`);
    }
    out.push('');
    if (scene.screenshot) out.push(`![${sceneName(scene)}](${scene.screenshot})`, '');
  }

  return out.join('\n');
}

/** "1 error" and "2 errors": the sentence is read by a person, not parsed. */
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function escapePipes(text) {
  return String(text).replace(/\|/g, '\\|');
}
