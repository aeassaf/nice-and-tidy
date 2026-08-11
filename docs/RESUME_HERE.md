# Session memory

State of the build in `aeassaf/nice-and-tidy`, written for a session starting cold —
no chat history, no GitHub. Read this first. See `docs/SESSION_PROTOCOL.md` for why
this file exists and the rules for keeping it current.

**Last updated:** 2026-08-11, end of the choose-your-agents session (issue #33).

## Where things stand

| Command | State |
|---|---|
| `init` | Writes the instruction files, shims, config and memory scaffold. Idempotent. `--agents` picks which shims, and asks on a fresh interactive run. |
| `diff` | Shows what `init` would change, writes nothing. |
| `upgrade` | Re-runs `init` with a version line, offers to backfill config keys an older file predates, and is the only command that will rewrite `targets` (`--agents`, after showing the diff and asking). |
| `bootstrap` | PR template, description gate, CI, labels, milestones. Needs `gh`. |
| `clean` | Finds deprecated per-tool convention files (`.cursorrules`, `.windsurfrules`) and offers to replace them with a pointer to `AGENTS.md`. Never deletes. |

253 tests pass (`npm test`). No Project board is linked to this repo, so there is no
board field to move; `git log`/the PR itself is the source of truth on state.

## This session — choosing your agents, and removing what a dropped one left (#33)

`config.targets` already filtered the payload; there was no way to set it but by hand,
and no way to clean up after changing it. Both halves shipped together — the first
alone only works on a repo that has never been installed into.

- **`--agents` on `init` / `diff` / `upgrade`.** Comma-separated list, or `all`, or
  `none`. `config.js#parseAgents` owns the parsing; `agentsLabel` is its inverse and a
  test pins the round trip, because the CLI prints a label back at you in the
  "run this instead" note and it has to be a value you can actually paste.
- **`agents-md` is never offered as a choice.** `validateConfig` already refuses a
  config without it. It is always added to whatever gets parsed, `none` means
  "AGENTS.md and its docs alone," and `--help` says so.
- **`init` still never rewrites a config that exists** — same precedent `--gitflow`
  set. It prints a note naming `upgrade --agents <label>` instead of sending somebody
  to a text editor. `upgrade`'s `backfillConfig` became `rewriteConfig` and now covers
  both reasons a config changes; `describe()` is one place deciding the wording, so
  the heading, the confirmation line and the no-terminal message cannot disagree.
  "added the missing keys" printed over a run that just dropped two agents would be a
  false account of what happened to somebody's repo.
- **`upgrade --agents` with `--keep-existing` or `--append` is a usage error.** One
  asks for the config to change, the other says don't. Ranking them silently would
  keep installing for agents somebody just asked it to stop installing for.
- **The prune rule — the part where getting it wrong loses a file.** Three states,
  and only the first touches the disk:
  - manifest records the path **and** the on-disk hash matches → `remove`, and the
    manifest entry is dropped with it;
  - recorded but the hash differs, or never recorded → `orphaned`. Named, never
    touched, manifest entry left exactly as it was (same reasoning as a skipped
    conflict);
  - recorded with nothing on disk → `forget`, a silent manifest cleanup.
- **Region files lose the block, not the file.** `region.js#stripRegion` is new. For an
  appended file the manifest holds `hash(region interior)` — comparing that against the
  whole file would read *every* appended file as hand-edited and orphan it. Stripping to
  nothing means the file was only ever our block, and that one is deleted rather than
  left empty (`strip: undefined` is the signal to `applyPlan`).
- **Removal candidates come from `payload.js#orphanedFiles`, never from "the manifest
  minus today's payload."** The manifest is shared with `bootstrap`, whose PR template,
  description gate and CI workflow never appear in an `init` payload — the broader rule
  would have `init` delete all three on every run. `test/payload.test.mjs` (new) pins
  this so it can't come back as a simplification.
- **Empty parent directories are left behind on purpose.** `.cursor/rules/` may hold
  rules this tool never wrote.
- **A fresh interactive `init` now asks which agents.** Enter takes all — the prompt is
  an offer, and a pipe or CI job that never knew the flag existed gets what it always
  got. `prompter.line()` is new alongside `ask()`, on the *same* prompter instance:
  `init` now creates one for the whole run and passes it to `resolveConflicts`, because
  a second readline interface on the same stdin gets EOF instead of an answer. A wrong
  answer is re-asked, up to three times, then falls back to all.
- **Caught by the advisor pass, not by the tests: `--agents --dry-run` lied.**
  `rewriteConfig` correctly writes nothing in a dry run, then `init` read the config
  still on disk and planned against the *old* targets — so the preview of a command
  that deletes two files reported "nothing to write." The existing removal test passed
  because it narrowed the config on disk first and never exercised the flag path. A
  dry run with `--agents` now plans against the requested targets (`previewing` in
  `init.js`), the "config wins" note is suppressed there because nothing is being
  refused, and `upgrade` forwards `agents` on `dryRun` and on `APPLIED`, withholding
  it only when the change was offered and declined. Pinned by a test that asserts the
  preview and the real run agree on the count.
- **Two smaller false accounts, same commit.** "recorded the version this ran with"
  printed over a run whose only manifest change was a `FORGET`; and `--keep-existing`
  printed "already up to date" directly above "3 files left in place" because `idle`
  was computed from the applied removals rather than the planned ones.
- **The naming contract needed a stated exemption.** `test/cli.test.mjs`'s "help and
  bootstrap name no agent or product" failed on the new `--help` text. A flag for
  choosing between agents that will not name one is unusable, so the test now cuts the
  `--agents` paragraph out and checks the rest — plus a second test asserting the names
  *are* there. `contract.test.mjs` is untouched: not one word of any generated file
  names a product, and that rule did not move.

## An earlier session — the append option (#29)

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
- **Append is not offered for `edited` conflicts, only `untracked` ones.** Caught late,
  after the first advisor pass. `--append` on a file this tool wrote and somebody then
  edited was stacking a complete second copy of the generated content below their
  version — verified turning a 212-line `AGENTS.md` into 425. Append answers "this file
  is somebody else's"; that conflict is about a *version*, and overwrite/keep-mine are
  its answers. `plan.js` now omits `appendWrite` on the `edited` branch, and
  `resolveConflicts#refusals` gives the two left-alone reasons separately rather than
  telling somebody their appendable file "cannot take a block."
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

- **Removal is scoped to target-gated files.** Change `protocol.memoryFile` and the
  old scaffold stays where it was; rename a payload file in a future release and the
  old one is left behind. Both are deliberate — see the note on `orphanedFiles`.
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

- Get the PR for #33 reviewed and merged. `Closes #33` closes the issue automatically
  (merges into `main`, the default branch).
- `npm publish` is still a human action, not run yet (carried from #14).

## Running it

```bash
npm test                              # 253
node bin/cli.js diff                  # everything unchanged/kept
node bin/cli.js init --agents claude  # fresh install, one agent only
node bin/cli.js upgrade --agents all  # change an existing install's targets; asks first
node bin/cli.js init --append         # keeps existing files, adds the block below them
node bin/cli.js clean --dry-run       # reports any deprecated convention files, writes nothing
node bin/cli.js bootstrap --dry-run   # GitHub-side plan, contacts nothing
```
