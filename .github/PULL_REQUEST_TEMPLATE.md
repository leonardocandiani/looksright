## What changes

<!-- 1-3 bullets on what this PR delivers -->

-
-

## Why

<!-- Motivation. Related issue (if any): closes #N -->

## Type

- [ ] feat — new check, flag, or integration
- [ ] fix — bug fix
- [ ] refactor — behavior-preserving change
- [ ] docs — documentation only
- [ ] chore — maintenance, config, deps

## Evidence it works

<!--
Paste the real output. The whole product is "do not claim, look", so a PR that
claims without looking does not merge.
-->

```bash
node --test test/
```

```
<!-- paste the output -->
```

## Checklist

- [ ] Ran against `test/fixtures/broken.html`: the findings this PR touches still fire
- [ ] Ran against `test/fixtures/clean.html`: still zero findings, still exit 0
- [ ] Changed a check? Documented its exclusions in the check file and in the README table
- [ ] New check? Registered in `src/checks/index.mjs` and covered by a fixture
- [ ] Changed a flag? Updated the `HELP` text in `bin/looksright.mjs` and the README
- [ ] Changed a workflow or `action.yml`? Checked the YAML with `actionlint`
- [ ] No secrets in the diff
- [ ] Commit follows Conventional Commits

## False positive risk

<!--
For any change to a check: what normal, correct page could this now fire on?
"None that I could find, tested against N real sites" is a valid answer if you
actually did it. Say which sites.
-->

## Notes

<!-- Design decisions, alternatives considered, anything the reviewer should know -->
