# RESUME HERE

State of the build, written for a session starting cold — no chat history, no context.
Read this first, then `PROJECT_BRIEF.md` for the full plan.

**Last updated:** 2026-08-09, end of a session that ran Phases 2 through 6 back to
back, one issue/branch/PR per phase, each merged before the next started.

## Where things stand

Phases 1–4 and 6 are done and merged. Phase 5's code is done and merged too, but its
*gate* — a scripted team-planning board — turned out to be unreachable; see below,
that's not a loose end, it's a documented finding. Phases 7 and 8 have not been
started at all — out of this session's reach, see the bottom of this file.

| Phase | Issue | PR | Status |
|---|---|---|---|
| 1 — CLI skeleton + config schema | [#1](https://github.com/aeassaf/nice-and-tidy/issues/1) | [#2](https://github.com/aeassaf/nice-and-tidy/pull/2) | Merged |
| 2 — `AGENTS.md` + shims, templated | [#3](https://github.com/aeassaf/nice-and-tidy/issues/3) | [#4](https://github.com/aeassaf/nice-and-tidy/pull/4) | Merged |
| 3 — response protocol | [#5](https://github.com/aeassaf/nice-and-tidy/issues/5) | [#6](https://github.com/aeassaf/nice-and-tidy/pull/6) | Merged |
| 4 — bootstrap | [#7](https://github.com/aeassaf/nice-and-tidy/issues/7) | [#8](https://github.com/aeassaf/nice-and-tidy/pull/8) | Merged |
| 5 — board bootstrap | [#9](https://github.com/aeassaf/nice-and-tidy/issues/9) | [#10](https://github.com/aeassaf/nice-and-tidy/pull/10) | Merged, gate unreachable — documented, not scripted |
| 6 — memory handoff | [#11](https://github.com/aeassaf/nice-and-tidy/issues/11) | [#12](https://github.com/aeassaf/nice-and-tidy/pull/12) | Merged |
| 7 — dogfood on portfolio-v2 + a second repo | — | — | Not started |
| 8 — publish | — | — | Not started |

Tests: 124, all passing (`npm test`). `node bin/cli.js diff` on this repo reports
everything unchanged or `kept` — verified at the end of every phase in this session,
not just at the end.

GitHub state as of this session: labels `bug enhancement documentation tech-debt gate
needs-antoine question` and milestones `Phase 1`…`Phase 8` exist on
`aeassaf/nice-and-tidy` (created live by `bootstrap` in Phase 4, verified idempotent
on a second run). No Project board exists for this repo — see Phase 5 below, that's
deliberate. `main` got real CI for the first time this session: `.github/workflows/
ci.yml` and `pr-description.yml` both run and both passed on every PR from #8 onward.

## What Phase 1 delivered (unchanged since, still the foundation)

A zero-dependency npm CLI with `init` and `diff`. The part that took the care is the
write engine (`src/plan.js`) — "re-runnable without clobbering" needs three states per
file, and comparing on-disk content against desired content can only produce two. The
third comes from `.nice-and-tidy/manifest.json`, which records `path → sha256` of what
was last written:

| On disk | Recorded hash | Result |
|---|---|---|
| absent | — | create |
| matches desired | matches disk | unchanged, no write at all |
| differs from desired | matches disk | **update** — ours, untouched, config moved |
| differs from desired | differs, or absent | **conflict** — diff and ask |
| matches desired | differs, or absent | adopt the hash, no write, no prompt |

Every later phase built on this instead of inventing a second write path — Phase 4's
PR template and Phase 6's memory scaffold both go through the exact same
`planFiles`/`applyPlan` pipeline as `AGENTS.md` does.

## What Phase 2 delivered — templated docs, conditionals, one dropped shim

- **`{{#if flag}}...{{else}}...{{/if}}` block conditionals** in `src/template.js`,
  additive to Phase 1's scalar substitution. Deliberately non-nesting — see the
  engine's own doc comment for what happens if a template tries anyway (it mis-parses
  silently, which is why there's a test pinning that exact behavior rather than
  leaving it to be discovered).
- **`docs/WORKFLOW.md`, `BRANCHING.md`, `COMMIT_CONVENTIONS.md`**, templated from
  `reference/docs/*`'s *shape*, not their portfolio-v2-specific content (live field
  IDs, issue links, a bespoke "why we chose Gitflow" narrative — none of that
  generalizes).
- **The windsurf shim was dropped, not left unused.** Researched at build time:
  Windsurf reads a root `AGENTS.md` natively now, and its own docs call
  `.windsurfrules` the deprecated predecessor to that support. `windsurf` is no
  longer a valid `targets` entry at all — a breaking config-schema change, made
  deliberately now, before this schema has more than one installed repo depending on
  it. Copilot and Cursor kept their shims: Copilot's `AGENTS.md` support is
  documented as coexisting with `copilot-instructions.md`, not replacing it, and
  Cursor's Chat/Composer modes still read `.cursor/rules/*.mdc` and do not read
  `AGENTS.md` (only Agent mode does).
- **Known gap, not exercised by any gate:** `plan.js` has no concept of *removing* a
  previously-generated file when a target drops out of config. Dropping `windsurf`
  from this repo's own `targets` required deleting `.windsurfrules` and its manifest
  entry by hand. Fine for a one-time, deliberate removal; would be a real gap if
  targets get dropped and re-added routinely.

## What Phase 3 delivered — SESSION_PROTOCOL.md, and closing a Phase 2 gap

- **`docs/SESSION_PROTOCOL.md`**, extracted from prose that Phase 1 had already baked
  into both `AGENTS.md.tmpl` §6–8 and the Skill's "Ending a session" — duplicated,
  not shared. Both now link to it instead of restating the reasoning.
- **While cross-linking, found that `AGENTS.md` never linked to `docs/WORKFLOW.md`,
  `BRANCHING.md`, or `COMMIT_CONVENTIONS.md` at all**, despite Phase 2 generating all
  three. Small enough to fix in the same PR rather than opening a fourth issue.
- **The phase's actual gate — "a session ends its replies with the status block,
  unprompted" — is not mechanically verifiable from inside the session building it.**
  Said so in the PR rather than claiming it passed. The closest thing to evidence:
  this session's own replies followed that format from partway through onward, once
  the gap was noticed.

## What Phase 4 delivered — bootstrap is real now

- Copies the PR template, its description check (`check-pr-description.mjs`,
  near-verbatim from `reference/` — only genericized the header comments, which
  claimed a pnpm workspace and an `engines` pin that don't hold for an arbitrary
  installed repo) and two workflows into `.github/`/`scripts/`, through the same
  plan/manifest pipeline `init` uses.
- **`ci.yml` was authored fresh, not sourced from `reference/`.**
  `reference/.github/workflows/ci.yml` was never staged in this repo (flagged as a
  gap back in the Phase 1 session) — the real portfolio-v2 file wasn't available to
  copy. `templates/workflow/ci.yml.tmpl` (npm test on push/PR to the configured
  branches) is a reasonable default, not a verbatim port. **Worth diffing against the
  actual file if it's ever shared**, in case the real one does something this one
  doesn't.
- **Labels and milestones actually created against `aeassaf/nice-and-tidy`** — see
  the table above. `src/gh.js` wraps `gh` behind an injectable `exec`, so this is
  unit-tested (`test/bootstrap.test.mjs`) without needing a real `gh` binary in CI.
- **The default-branch flip is printed, never run.** This repo is `gitflow: false`,
  so nothing was printed for it — the logic is only exercised by a `gitflow: true`
  test fixture, not by this repo's own bootstrap run.
- **Extracted `src/resolveConflicts.js` before writing `bootstrap.js`**, so the
  "print conflicts, ask, apply" walk never existed as two copies to drift apart.
  `init.js` was refactored onto it too; its existing test suite is what proved the
  refactor didn't change behavior.
- This PR is the first one checked by the gate it introduces — `pr-description.yml`
  ran against PR #8's own description and passed.

## What Phase 5 delivered — and why there's no board

**The brief's original gate for this phase — a scripted team-planning board, field
and option IDs recorded automatically, zero hand-written GraphQL — is unreachable
through `gh` or the public API today.** Researched, not assumed:

- `gh project create` has no `--template` flag. It only ever produces a blank
  project: a 3-option Status field (`Todo`/`In Progress`/`Done`), no Priority, no
  Size.
- The GraphQL `copyProjectV2` mutation could clone a template project, but it needs
  `projectId` for the *source* — and GitHub's built-in templates aren't exposed at
  any ID a token can read. There is nothing to copy from via API.
- There is no `gh project field-edit`. Widening the default Status field's 3 options
  to the 5-option `Backlog`/`Ready`/`In progress`/`In review`/`Done` shape
  `docs/WORKFLOW.md` already documents would need a raw `updateProjectV2Field`
  GraphQL mutation — the hand-written GraphQL the brief explicitly wanted to avoid
  maintaining.

`docs/WORKFLOW.md`'s board section says this plainly now, with the three steps that
are still real (create via template in the web UI → `gh project link` → `gh project
field-list`, re-queried every time). **No board was created against the real
account.** A Project is account-scoped, not repo-scoped — landing one next to the
existing `Portfolio V2` board would be a different, larger blast radius than the
repo-scoped labels/milestones this session was authorized to create, and a board
built the only scriptable way (blank + hand-rolled fields) would have a Status field
that contradicts what's already shipped in `docs/WORKFLOW.md`. `config.board.
projectNumber` stays `null`; the field/option-ID placeholder in the old
`WORKFLOW.md.tmpl` was removed rather than filled in from outside the plan/manifest
pipeline — see the PR body for why that would have broken `node bin/cli.js diff`.

**If a board gets created by hand later:** run `gh project link`, then update
`nice-and-tidy.config.json`'s `board.projectNumber` (config is `USER`-owned, editing
it directly is exactly how it's meant to change) and re-run `init` — nothing else in
this pipeline currently reacts to that field being set, which is itself worth
revisiting once a real board exists to test against.

## What Phase 6 delivered — the memory file gets scaffolded

- `init` now writes a starter scaffold at `protocol.memoryFile` **once, if nothing
  is there.** `ownership: USER`, same as `nice-and-tidy.config.json` — `plan.js`
  already returns `KEPT` unconditionally for any `USER`-owned file that exists,
  whatever it contains, so a real session's notes (like this file, right now) are
  never diffed against the scaffold or flagged as a conflict.
- Verified against this repo's own `docs/RESUME_HERE.md`, which by that point had
  three phases of real history in it: `node bin/cli.js diff` reported it `kept`, not
  a conflict.
- **What this phase's code cannot do, and doesn't claim to:** write the actual
  session content. That's agent behavior, already covered by `AGENTS.md` §7 and
  `docs/SESSION_PROTOCOL.md` since Phases 1 and 3. The brief's original gate for
  Phase 6 was really asking for something no `src/` change produces — decided to
  build the narrower, real thing (the scaffold) rather than a nominal pass at the
  wider claim.

## Open questions for Antoine

1. **`gitflow: false` on this repo — keep it?** Unchanged from the Phase 1 session's
   question; still low-stakes, still easy to flip (edit the key, re-run `init`).
2. **Config schema versioning.** Still no `"version"` key. `targets` already had one
   breaking change this session (`windsurf` dropped) with nothing to detect a config
   written against the old shape — worth adding before this has more than one
   installed repo.
3. **`ci.yml.tmpl`'s authored-fresh content** — compare against whatever
   portfolio-v2's real `ci.yml` does, once it's shareable, and reconcile.
4. **`config.board.projectNumber`** — set it by hand once a board exists (see Phase
   5 above), and check whether anything should react to it being non-null. Nothing
   does today.
5. Still open from the brief: npm visibility (package is `private: true` until
   decided) — this is Phase 8, not started.

## Known gaps, recorded rather than skipped

- **`plan.js` cannot remove a file** when a target or config value that used to
  produce it goes away. Handled by hand for the `windsurf` shim removal in Phase 2;
  would need real code if this becomes routine.
- **The interactive conflict prompt is unit-tested, not end-to-end tested** — carried
  over from the Phase 1 session, still true, still low-risk (the e2e suite covers the
  no-TTY refusal path; `test/ui.test.mjs` covers answer parsing against fake streams).
- **No Project board exists for this repo** — see Phase 5. Not a bug, a documented
  API limitation.

## Next: Phases 7 and 8 — not started, out of this session's reach

- **Phase 7 (dogfood on portfolio-v2 + a second trunk-based repo)** needs a second
  repository (`aeassaf/portfolio-v2`) this session had no access to, plus an as-yet
  unidentified second trunk-based repo. Concretely: install `nice-and-tidy` into
  portfolio-v2, replace its hand-written `docs/WORKFLOW.md`/`BRANCHING.md`/
  `COMMIT_CONVENTIONS.md` with generated ones, diff for drift against what several
  days of hand-derivation originally produced — that diff is the real proof this
  project does what it set out to do. Needs a session with that repo in reach.
- **Phase 8 (publish)** is an npm visibility decision the brief already marks as
  Antoine-only ("confirm before Phase 8, don't assume"). Also needs Phase 7's
  dogfooding done first — publishing before proving this works on a second, real
  repo would be publishing the untested case.

## Running it

```bash
npm test                              # 124
node bin/cli.js diff                  # should report everything unchanged/kept
node bin/cli.js bootstrap --dry-run   # labels/milestones plan against the real repo
node --test scripts/*.test.mjs        # the installed PR-description gate's own tests
```
