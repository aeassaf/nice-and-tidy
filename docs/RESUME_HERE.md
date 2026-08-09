# Session memory

State of the build in `aeassaf/nice-and-tidy`, written for a session starting cold —
no chat history, no GitHub. Read this first. See `docs/SESSION_PROTOCOL.md` for why
this file exists and the rules for keeping it current.

**Last updated:** 2026-08-09, end of the public-release-prep session (issue #14).

## Where things stand

The CLI is feature-complete for a first release and self-hosting: this repo's own
`AGENTS.md`, `docs/*`, shims, PR template, gate and CI were all written by the tool,
and `node bin/cli.js diff` reports everything `unchanged` or `kept`.

| Command | State |
|---|---|
| `init` | Writes the instruction files, shims, config and memory scaffold. Idempotent. |
| `diff` | Shows what `init` would change, writes nothing. |
| `bootstrap` | PR template, description gate, CI, labels, milestones. Needs `gh`. |

124 tests pass. The package is publishable — `private: true` is gone,
`publishConfig.access` is `public` — but **`npm publish` has not been run.** The name
was free on the registry as of this session.

## Decisions made

- **npm visibility: public.** This was the last question the build reserved for a
  human. Settled.
- **The repo keeps running its own output.** `AGENTS.md`, `CLAUDE.md`, `.claude/`,
  `.cursor/` and `.github/copilot-instructions.md` at the root are generated files,
  kept deliberately — the tool demonstrating itself is worth more than a tidier root.
- **Git history is not rewritten.** Past commits keep their co-authorship trailers.
  Rewriting public `main` is a human's call and nobody asked for it.
- **No Project board, on purpose.** `gh project create` only makes a blank project,
  and the GraphQL mutation that could clone a template needs a source ID GitHub does
  not expose to a token. `docs/WORKFLOW.md` carries the manual steps instead.

## Open questions

1. **`gitflow: false` on this repo — keep it?** Low stakes; edit the key, re-run
   `init`.
2. **Config schema versioning.** There is still no `"version"` key in
   `nice-and-tidy.config.json`. `targets` has already taken one breaking change, and
   nothing detects a config written against the older shape. Worth adding before more
   than one repo depends on this.
3. **`config.board.projectNumber`** — nothing reads it today, even when set. Decide
   whether anything should, once a real board exists to test against.
4. **Proving it on a second repo.** The tool has only ever been run on itself. An
   install into an unrelated trunk-based repo is the missing evidence. Not a blocker
   for publishing, but the first thing worth doing after.

## Known gaps

- **`plan.js` cannot remove a file** when the config value that produced it goes
  away. A `targets` entry dropped, or `protocol.memoryFile` repointed, leaves the old
  file behind untracked. Handled by hand so far; would need real code if it becomes
  routine.
- **The interactive conflict prompt is unit-tested, not end-to-end tested.** The e2e
  suite covers the no-TTY refusal path; `test/ui.test.mjs` covers answer parsing
  against fake streams.
- **`.github/workflows/ci.yml` is a generic npm starting point**, not a template
  derived from a proven pipeline. It installs and runs `npm test`. Any repo needing
  more should edit it.
- **Milestones exist but were never assigned.** Issues #1–#11 all closed with
  `milestone=NONE` despite `AGENTS.md` §1 requiring the field. Cosmetic, and
  backfillable with one `gh issue edit --milestone` per issue.
- **Two memory-only commits went straight to `main`** earlier in this project's
  history, reasoned as commentary rather than project data. `AGENTS.md` §2 says
  "never push directly to `main`" with no such exception written down. Either §2
  should state the exemption or memory commits should go through a PR like anything
  else. Unresolved; this session used a branch and PR to stay on the safe side.

## Next

- Run `npm publish` (a human action) if the release is wanted now.
- Install into an unrelated repo and see what breaks. That is the real test.

## Running it

```bash
npm test                              # 124
node bin/cli.js diff                  # everything unchanged/kept
node bin/cli.js bootstrap --dry-run   # GitHub-side plan, contacts nothing
npm pack --dry-run                    # 34 files: bin, src, templates, README, LICENCE
```
