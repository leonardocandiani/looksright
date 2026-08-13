---
name: Feature request
about: Suggest a new check, a flag, or an integration
title: "[feat] "
labels: enhancement
assignees: leonardocandiani
---

## The bug it would have caught

<!--
Describe a real rendering failure that shipped, or would have shipped, because
nothing caught it. Concrete beats abstract: "the footer overlapped the CTA at
320px and nobody noticed for a week".
-->

## Proposed check or option

<!-- What it would look at, and what it would report -->

## How it decides

<!--
For a new check, this is the part that matters. What does it read from the page,
and what is the threshold? Example: "compares getBoundingClientRect().width of
the element against its parent's clientWidth, fires above a 2px difference".
-->

## False positives it must avoid

<!--
The bar is zero false positives above coverage. A check that fires on normal
pages gets uninstalled on the first run. List the legitimate patterns that would
trip a naive version, and how the check should exclude them.
-->

## Category

- [ ] New check in `src/checks/`
- [ ] New CLI flag
- [ ] New config option
- [ ] Change to an existing check's thresholds or exclusions
- [ ] Reporter output (terminal, JSON, markdown)
- [ ] GitHub Action / CI integration
- [ ] Claude Code plugin (command, skill, agent)
- [ ] Documentation
- [ ] Other: <!-- describe -->

## Willingness to contribute

- [ ] I can open the PR
- [ ] I can help test
- [ ] Just suggesting, no availability to implement
