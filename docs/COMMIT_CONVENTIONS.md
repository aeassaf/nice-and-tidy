# COMMIT_CONVENTIONS

Companion to [`BRANCHING.md`](BRANCHING.md) (what a branch looks like) and
[`WORKFLOW.md`](WORKFLOW.md) (what an issue or PR looks like).

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

- **type** — one of the table below. Required.
- **scope** — optional, parenthetical, names the affected area: `cli`, `config`, `templates`, `skill`, `docs`, `ci`.
  Omit it when the change is repo-wide.
- **subject** — present tense, imperative mood, lowercase, no trailing period. "add
  the gate," not "added the gate" or "adds the gate." Long enough to carry the *why*
  when brevity would hide it, but don't pad a subject that a one-line body could carry
  instead.
- **body** — optional. Wrap near 72 columns. States why, not what — the diff already
  says what.
- **footer** — optional. `Refs #N` references an issue without closing it. `Closes
  #N` / `Fixes #N` closes one **only when the PR merges into the repository's default
  branch**. `BREAKING CHANGE: …` for a breaking change.

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
| `build` | The build system or its config. |
| `ci` | CI/CD pipeline changes. |
| `chore` | Repo housekeeping that doesn't fit any type above. |
| `dependencies` | A dependency added, removed, or bumped — kept separate from `chore` so `git log --grep '^dependencies'` finds every one on its own. |
| `revert` | Reverts a previous commit. Subject: `revert: <original subject>`; body names the reverted commit hash. |

No `wip`, no `misc`. If a commit is hard to type, it's probably two commits.

## Not enforced by a gate

Nothing in CI validates a commit message against this table. It's convention, not a
gate — the same honesty rule as [`WORKFLOW.md`](WORKFLOW.md) applies: don't claim
enforcement that doesn't exist. If drift becomes a real problem, a commit-message hook
is the natural fix; that's a decision for aeassaf to make, not a default this tool
picks.
