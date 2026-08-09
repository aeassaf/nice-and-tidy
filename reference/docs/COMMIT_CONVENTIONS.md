# COMMIT_CONVENTIONS

Ratified 2026-08-08. Companion to [`BRANCHING.md`](BRANCHING.md) (what a branch looks
like) and [`WORKFLOW.md`](WORKFLOW.md) (what an issue/PR looks like).

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type** — one of the table below. Required.
- **scope** — optional, parenthetical, names the affected area: a package (`theme`,
  `ui`, `web`, `assafos`, `content`, `seo`, `analytics`), a workflow (`ci`), or a doc
  area (`docs`, `gates`). Omit it when the change is repo-wide.
- **subject** — present tense, imperative mood, lowercase, no trailing period. "add
  the gate," not "added the gate" or "adds the gate." Long enough to carry the *why*
  when brevity would hide it — this repo's own log already does that (`fix(ci): the
  PR description job installs nothing, so stop caching pnpm`) — but don't pad a
  subject that a one-line body could carry instead.
- **body** — optional. Wrap near 72 columns. States why, not what — the diff already
  says what.
- **footer** — optional. `Refs #N` references an issue without closing it. `Closes
  #N` / `Fixes #N` closes one **only when the PR merges into the repository's default
  branch** — see [`BRANCHING.md`](BRANCHING.md#closes-n-needs-develop-to-be-the-github-default-branch)
  for why that's not automatic once `develop` exists. `BREAKING CHANGE: …` for a
  breaking change. `Co-Authored-By: …` per the global git instructions.

## Types

| Type | Use for |
|---|---|
| `feat` | A new user-facing capability. |
| `fix` | A bug fix. |
| `docs` | Documentation only — no code touched. |
| `style` | Formatting, whitespace, punctuation — no logic change. |
| `refactor` | A code change that is neither a fix nor a feature. |
| `perf` | A change made specifically to improve performance. |
| `test` | Adding or correcting tests, with no production code change. |
| `build` | The build system or its config — Turborepo, `tsconfig`, bundler, lockfile structure. |
| `ci` | CI/CD pipeline changes — `.github/workflows/`. |
| `chore` | Repo housekeeping that doesn't fit any type above. |
| `dependencies` | A dependency added, removed, or bumped — kept separate from `chore` so `git log --grep '^dependencies'` finds every one on its own. |
| `revert` | Reverts a previous commit. Subject: `revert: <original subject>`; body names the reverted commit hash. |

No `wip`, no `misc`. If a commit is hard to type, it's probably two commits.

## Examples, in this repo's own voice

```
feat(theme): port the 88-name token contract byte-exact
fix(ci): the PR description job installs nothing, so stop caching pnpm
docs: add CLAUDE.md so a session needs only an issue number
dependencies: pin typescript to 6.0.3 against typescript-eslint's <6.1.0 range
chore(gates): widen findUnregisteredBackdropClasses to catch background overrides
```

## Not enforced by a gate

Unlike the PR-description check, nothing in CI validates a commit message against
this table. It's convention, not a gate — the same honesty rule as
[`WORKFLOW.md`](WORKFLOW.md) applies: don't claim enforcement that doesn't exist. If
drift becomes a real problem, a commitlint hook is the natural fix; nobody's asked
for one yet.
