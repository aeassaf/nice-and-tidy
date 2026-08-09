# RESUME HERE

State of the build, written for a session starting cold — no chat history, no context.
Read this first, then `PROJECT_BRIEF.md` for the full plan.

**Last updated:** 2026-08-09, end of the Phase 1 session.

## Where things stand

Phase 1 is complete and on a branch, not yet merged.

- Issue: [#1 — Phase 1 — CLI skeleton + config schema](https://github.com/aeassaf/nice-and-tidy/issues/1)
- Branch: `feature/1-cli-skeleton-config-schema`
- PR: opened against `main`
- Tests: 101, all passing (`npm test`)

## What Phase 1 delivered

A zero-dependency npm CLI with `init`, `diff` and a `bootstrap` that refuses loudly.

The part that took the care is the write engine (`src/plan.js`). "Re-runnable without
clobbering" needs three states per file, and comparing on-disk content against desired
content can only produce two. The third comes from `.nice-and-tidy/manifest.json`,
which records `path → sha256` of what was last written:

| On disk | Recorded hash | Result |
|---|---|---|
| absent | — | create |
| matches desired | matches disk | unchanged, no write at all |
| differs from desired | matches disk | **update** — ours, untouched, config moved |
| differs from desired | differs, or absent | **conflict** — diff and ask |
| matches desired | differs, or absent | adopt the hash, no write, no prompt |

Without the manifest, rows 3 and 4 are indistinguishable, and a tool has to pick
between never updating anything and overwriting everything.

`init` makes no network calls. It does shell out to local `git` to read the `origin`
remote, which is how `repo` and `defaultAssignee` get filled in.

## Decisions made this session

- **Config lives at `nice-and-tidy.config.json`, repo root.** The brief drafted
  `.claude/workflow.config.json` and flagged it bikeshed-later. A config path the
  product owns is shipped surface, and the top non-negotiable forbids naming a
  specific agent there. `.claude/skills/` is the opposite case — that path is dictated
  by a loader, which makes it a shim rather than branding. Antoine picked this.
- **`gitflow` defaults to `true`.** Antoine picked this.
- **Issue opened with partial fields**, documenting the gap, rather than deferring.
  This repo has no milestones, no custom labels and no board, so `WORKFLOW.md` rule 3
  cannot be satisfied yet — the same bootstrap-order problem `BRANCHING.md` documents
  for `develop`. Antoine picked this.
- **Zero runtime dependencies**, chosen rather than inherited. `npx` should be a cold
  start. Separate from the PR-description gate's own dependency-free constraint, which
  is forced (it runs in CI with no install step).
- **This repo self-installed with `gitflow: false`.** `develop` does not exist here
  yet, and a small CLI does not obviously need it. This also gets the brief's
  "dogfood a trunk-based repo" requirement started early. See open questions.
- **`--global` writes only where something loads from.** `~/.claude/skills/…/SKILL.md`
  plus a reference copy at `~/.config/nice-and-tidy/AGENTS.md`. Nothing reads a
  machine-wide `AGENTS.md` on its own, and the CLI says so instead of implying it
  wired something up. It deliberately does not edit an existing machine-wide
  instruction file — that is a change to the user's environment, so it stays a printed
  suggestion.

## Open questions for Antoine

1. **`gitflow: false` on this repo — keep it?** Self-installed trunk-based for the
   reasons above. Switching to Gitflow means cutting `develop` and deciding on the
   default-branch flip. Low stakes either way; easy to change (edit the key, re-run
   `init`).
2. **Config schema versioning.** There is no `"version"` key in the config. Deliberate
   — the brief's schema is explicit and unrequested keys add surface — but it means a
   future breaking change to the shape has nothing to detect it. Worth adding before
   anyone else installs this.
3. Still open from the brief: npm visibility (package is `private: true` until
   decided), `bootstrap`'s label opinionation, and whether `memoryFile` should be one
   file per repo or one per issue.

## Known gaps, recorded rather than skipped

- **`reference/.github/workflows/ci.yml` is missing.** The brief's source table lists
  seven reference files plus `ci.yml`; only the seven are staged. Phase 4 needs it —
  ask for it then.
- **`check-pr-description.mjs` is not copy-verbatim-ready**, despite the brief saying
  so. Its header comments reference pnpm workspace globs and an `engines` pin, and its
  test hardcodes `../.github/pull_request_template.md`, which pins the script to
  `scripts/`. That is an instance of the brief's own rule — a hardcoded value means the
  templating boundary was drawn wrong. Phase 4 problem.
- **The interactive conflict prompt is unit-tested, not end-to-end tested.** The e2e
  suite runs without a TTY, so it covers the refusal path. `test/ui.test.mjs` covers
  the answer parsing against fake streams.
- **Phase 1 templates are literal, by design.** Structural variation — the Gitflow-only
  branch table, per-target gating of doc content — is not expressible yet:
  `src/template.js` does flat scalar substitution and nothing else, and throws on an
  unknown or non-scalar placeholder. That inexpressibility is what stopped Phase 1 from
  half-doing Phase 2.

## Next: Phase 2 — `AGENTS.md` + shims, templated

Gate, from the brief: *`gitflow: false` produces a coherent trunk-based doc set, no
dangling `develop` references.*

Concretely:

1. Add conditionals to `src/template.js`. Phase 1 intentionally has none.
2. Generate `docs/WORKFLOW.md`, `docs/BRANCHING.md`, `docs/COMMIT_CONVENTIONS.md` from
   `reference/docs/*` — those are the most portfolio-v2-specific files (its milestones,
   its labels, its repo slug, its project field IDs), so every one of those values has
   to become config.
3. **Research at build time, do not answer from memory:** confirm whether Copilot,
   Cursor and Windsurf now read `AGENTS.md` natively. If any do, drop that shim rather
   than ship dead weight. The brief flags this and it changes what gets generated.
4. Also evaluate `agent-skill-creator`'s adapter matrix before hand-building more
   format adapters — the brief says this problem may already be solved once.

`test/contract.test.mjs` already asserts "trunk-based output never mentions develop"
across every template, so Phase 2's gate has a test waiting for it.

## Running it

```bash
npm test
node bin/cli.js init --dry-run
```

The repo has `nice-and-tidy` installed on itself. `node bin/cli.js diff` should report
everything unchanged — if it doesn't, either a template moved or someone edited a
generated file, and the diff will say which.
