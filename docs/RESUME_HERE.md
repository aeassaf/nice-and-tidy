# Session memory

State of the build in `aeassaf/nice-and-tidy`, written for a session starting cold —
no chat history, no GitHub. Read this first. See `docs/SESSION_PROTOCOL.md` for why
this file exists and the rules for keeping it current.

**Last updated:** 2026-08-09, end of the `clean` command session (issue #23, PR #24).

## Where things stand

| Command | State |
|---|---|
| `init` | Writes the instruction files, shims, config and memory scaffold. Idempotent. |
| `diff` | Shows what `init` would change, writes nothing. |
| `bootstrap` | PR template, description gate, CI, labels, milestones. Needs `gh`. |
| `clean` | New this session. Finds deprecated, single-file, per-tool convention formats (`.cursorrules`, `.windsurfrules`) that predate `AGENTS.md`, and offers to replace their contents with a pointer to it. Never deletes. |

138 tests pass (`npm test`). PR [#24](https://github.com/aeassaf/nice-and-tidy/pull/24)
is open against `main`, CI green, `Closes #23` in the body. Not yet merged — a human
review is the next gate. No Project board is linked to this repo, so there is no
board field to move; `git log`/the PR itself is the source of truth on state.

## This session — `clean`

- `src/foreignConventions.js` — `FOREIGN_CONVENTIONS` registry + `scanForeignConventions(root)`.
  Two entries, both **verified against the tool's own current docs this session, not
  assumed**: `.cursorrules` (deprecated since Cursor 0.43; silently ignored under
  Cursor's Agent mode, default since 2026) and `.windsurfrules` (superseded by
  Windsurf's native root `AGENTS.md` support — the claim `config.js`'s `TARGETS`
  comment already made, independently corroborated this session by a search result
  listing Windsurf among tools that read `AGENTS.md` natively).
- **Deliberately excluded, checked and rejected — don't re-add without re-verifying:**
  - `.clinerules` — Cline does **not** read `AGENTS.md` natively as of this session
    (open, unresolved GitHub feature request). It's Cline's live config file, not a
    deprecated one. Adding it would offer to gut a config real Cline setups depend on.
  - `.aiderrules` — not a real Aider filename. Aider's convention file defaults to
    `CONVENTIONS.md` or `--conventions-file`, both too generic to safely flag as
    agent-specific.
- `src/commands/clean.js` — report → diff (`ui.js#printDiff`) → prompt
  (`ui.js#createPrompter`) → write. Deliberately does not touch `plan.js` or
  `.nice-and-tidy/manifest.json` — there's nothing to regenerate and no provenance to
  record; idempotency comes from the already-mentions-`AGENTS.md` check.
- `init` prints a one-line note pointing at `clean` when it finds something to flag,
  at local scope only, on both `init` and `diff` (informational, not a write either
  way). Never auto-invokes `clean`.
- `templates/shims/pointer.md.tmpl` — the generic replacement stub. No product names
  (the `contract.test.mjs` banned-name scan covers it automatically, same as every
  other file under `templates/`), no config placeholders.
- Fixed after the first advisor pass, before calling this done:
  - `scanForeignConventions` now swallows `EISDIR` alongside `ENOENT` — a directory at
    a registry path (e.g. someone's `.cursorrules/`) used to throw an unhandled
    rejection out of `init`, not just `clean`.
  - README's "recoverable through git" claim on replacement now says *if the file was
    already tracked* — for an untracked file the old content is genuinely gone, which
    is why `clean` always shows the diff and asks first rather than treating the
    replacement as free to undo.

## Decisions carried from earlier sessions

- **npm visibility: public.** Settled, issue #14.
- **The repo keeps running its own output.** `AGENTS.md`, `CLAUDE.md`, `.claude/`,
  `.cursor/` and `.github/copilot-instructions.md` at the root are generated files,
  kept deliberately.
- **Git history is not rewritten.**
- **No Project board, on purpose.** `docs/WORKFLOW.md` carries the three manual setup
  steps instead of `bootstrap` attempting to script them.

## Open questions

1. **`gitflow: false` on this repo — keep it?** Low stakes; edit the key, re-run
   `init`.
2. **Config schema versioning.** Still no `"version"` key in
   `nice-and-tidy.config.json`.
3. **`config.board.projectNumber`** — nothing reads it today, even when set.
4. **Should `FOREIGN_CONVENTIONS` grow?** Candidates worth checking *before* adding,
   not assuming: whether Cline ships native `AGENTS.md` support yet (would flip
   `.clinerules` from excluded to includable), any legacy Copilot per-language
   instruction file locations, JetBrains AI Assistant's `.junie/guidelines.md`. None
   investigated this session — the registry stayed at 2 verified entries rather than
   padded with unverified ones.

## Known gaps

- **`plan.js` cannot remove a file** when the config value that produced it goes
  away.
- **The interactive conflict prompt is unit-tested, not end-to-end tested** — same is
  now true of `clean`'s prompt path (`decide()`'s interactive branch): covered by
  `ui.js#createPrompter`'s own unit tests, not by an end-to-end `clean` test, since
  `cli.test.mjs` runs through `execFile` with no TTY.
- **`.github/workflows/ci.yml` is a generic npm starting point.**
- **Milestones exist but issues #1–#11 closed with `milestone=NONE`.** Cosmetic.
- **Two memory-only commits went straight to `main`** earlier in this project's
  history; unresolved tension with `AGENTS.md` §2. This session, like the last one
  that touched code, went through a branch and PR.

## Next

- Get PR #24 reviewed and merged. Once merged, `Closes #23` closes the issue
  automatically (merges into `main`, the default branch).
- Consider whether any of the "Should `FOREIGN_CONVENTIONS` grow?" candidates above
  are worth a follow-up issue, once actually verified against current tool docs.
- `npm publish` is still a human action, not run yet (carried from #14 — unrelated to
  this session's work).

## Running it

```bash
npm test                              # 138
node bin/cli.js diff                  # everything unchanged/kept
node bin/cli.js clean --dry-run       # reports any deprecated convention files, writes nothing
node bin/cli.js bootstrap --dry-run   # GitHub-side plan, contacts nothing
```
