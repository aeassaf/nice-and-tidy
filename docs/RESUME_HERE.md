# Session memory

State of the build in `aeassaf/nice-and-tidy`, written for a session starting cold —
no chat history, no GitHub. Read this first. See `docs/SESSION_PROTOCOL.md` for why
this file exists and the rules for keeping it current.

**Last updated:** 2026-08-10, end of the append-option session (issue #29, PR #30).

## Where things stand

| Command | State |
|---|---|
| `init` | Writes the instruction files, shims, config and memory scaffold. Idempotent. |
| `diff` | Shows what `init` would change, writes nothing. |
| `upgrade` | Re-runs `init` with a version line, and offers to backfill config keys an older file predates. |
| `bootstrap` | PR template, description gate, CI, labels, milestones. Needs `gh`. |
| `clean` | Finds deprecated per-tool convention files (`.cursorrules`, `.windsurfrules`) and offers to replace them with a pointer to `AGENTS.md`. Never deletes. |

193 tests pass (`npm test`). No Project board is linked to this repo, so there is no
board field to move; `git log`/the PR itself is the source of truth on state.

## This session — the append option (#29)

The third answer to "this file already exists," alongside overwrite and keep-mine.
Your content stays, the generated content goes below it, fenced by two markers.

- `src/region.js` — new. `findRegion` / `appendRegion` / `replaceRegion` / `wrapRegion`.
  The markers are `<!-- nice-and-tidy:begin … -->` / `<!-- nice-and-tidy:end -->`,
  matched at **column zero** by their `nice-and-tidy:begin` prefix (not the full line),
  so a later release can reword the framing sentence without orphaning regions an
  older one wrote.
- **The invariant everything rests on:** for an appended file the manifest records
  `hash(region interior)`, not the whole file. Recording the whole file makes the next
  run read `update` — disk matches what we last wrote — and replace the user's own
  content with a bare copy of ours, silently. `plan.js#applyPlan` records
  `hashContent(item.desired)`, and for a region-managed item `desired` *is* the
  interior. Don't "simplify" that to hashing the bytes written.
- `plan.js` gained `item.write` (exact bytes for a normal write / overwrite) separate
  from `item.desired` (what we generated) and `item.hash`. Once a file is
  region-managed, **every** write is `replaceRegion` — including `overwrite`. And
  `item.appendWrite` is the bytes for the `append` resolution, `undefined` when the
  file can't take one.
- Every ambiguity degrades to `conflict`, never to `update`: markers deleted,
  duplicated, half-written, or end-before-begin all read as "no region" and fall back
  to the whole-file rules, which stop and ask. Tested in both directions.
- **`appendable` is opt-in per payload entry, and that is deliberate.** The markers are
  an HTML comment — a syntax error in `bootstrap`'s workflow YAML and `.mjs` payload.
  Opting out by default is what keeps those safe by construction. The two `init` files
  that opt out (`.cursor/rules/nice-and-tidy.mdc`, the Skill) do so for a second
  reason: their content opens with YAML frontmatter, which only means anything at the
  top of a file.
- **Bug caught by a test, not by review:** `replaceRegion` grew the file by one newline
  per run, because the end marker's own line terminator was landing in `after`.
  `findRegion` now consumes it. `test/region.test.mjs` pins idempotency.
- Prompt key is `+`, with the full word `append` also accepted. `a` stays **abort** —
  "append" starts with an a, and abort is the half of that collision that writes
  nothing. Two assertions pin it.
- `prompter.ask({ allowAppend })` is opt-in per question. `clean` and `upgrade`'s
  config backfill both share this prompter and neither offers append — an option that
  silently does nothing is worse than one that isn't offered.
- `upgrade --append` treats the config backfill as "leave it alone" rather than
  blocking the run on a question the flag was never about. `--force` still takes the
  new keys.
- `diff --append` previews the *append*, not an overwrite — `init.js`'s own rule that
  the report must not drift from what a run does.
- Template prose fixed where appending made it false: `CLAUDE.md.tmpl` no longer claims
  the import "has to stay first" (it has to stay on its own line, anywhere in the
  file), and `copilot-instructions.md.tmpl` says "what follows is a pointer," not "this
  file is."

## Decisions carried from earlier sessions

- **npm visibility: public.** Settled, issue #14.
- **The repo keeps running its own output.** `AGENTS.md`, `CLAUDE.md`, `.claude/`,
  `.cursor/` and `.github/copilot-instructions.md` at the root are generated files,
  kept deliberately. Changing a shim template means re-running `node bin/cli.js init`
  in this repo and committing the result.
- **Git history is not rewritten.**
- **No Project board, on purpose.** `docs/WORKFLOW.md` carries the three manual setup
  steps instead of `bootstrap` attempting to script them.
- **`FOREIGN_CONVENTIONS` stays at 2 verified entries.** Candidates were checked and
  rejected last session — `.clinerules` is Cline's live config, not a deprecated file,
  and `.aiderrules` is not a real filename. Re-verify against current docs before
  adding anything.

## Open questions

1. **`gitflow: false` on this repo — keep it?** Low stakes; edit the key, re-run `init`.
2. **Config schema versioning.** Still no `"version"` key in `nice-and-tidy.config.json`.
3. **`config.board.projectNumber`** — nothing reads it today, even when set.
4. **Should append be offered for `bootstrap`'s files at all?** Today no payload entry
   there opts in. The PR template is the only plausible candidate, and appending a
   second template below somebody's own is probably not what they'd want.

## Known gaps

- **`plan.js` cannot remove a file** when the config value that produced it goes away.
- **A marker pair written at column zero inside somebody's own fenced code block would
  be read as a real region.** It degrades to a conflict rather than a silent write, so
  it asks — but it does ask about a file it has no business managing. Indented copies
  are already ignored.
- **`.github/workflows/ci.yml` is a generic npm starting point.**
- **Milestones exist but issues #1–#11 closed with `milestone=NONE`.** Cosmetic.
- **Two memory-only commits went straight to `main`** earlier in this project's
  history; unresolved tension with `AGENTS.md` §2. Every session that touched code
  since has gone through a branch and PR.

## Next

- Get PR #30 reviewed and merged. `Closes #29` closes the issue automatically (merges
  into `main`, the default branch).
- `npm publish` is still a human action, not run yet (carried from #14).

## Running it

```bash
npm test                              # 193
node bin/cli.js diff                  # everything unchanged/kept
node bin/cli.js init --append         # keeps existing files, adds the block below them
node bin/cli.js clean --dry-run       # reports any deprecated convention files, writes nothing
node bin/cli.js bootstrap --dry-run   # GitHub-side plan, contacts nothing
```
