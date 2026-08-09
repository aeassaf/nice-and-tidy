# BRANCHING

A Gitflow-shaped branch model, adapted for a repo that's pre-launch, has no release
train yet, and is mostly built one GitHub issue per session. Ratified 2026-08-08.
Companion to [`COMMIT_CONVENTIONS.md`](COMMIT_CONVENTIONS.md) (what a commit looks
like) and [`WORKFLOW.md`](WORKFLOW.md) (what an issue/PR looks like).

## The branches

| Branch | Purpose | Receives merges from | Never |
|---|---|---|---|
| `main` | Production. Once deployed (Phase 9 / [#32](https://github.com/aeassaf/portfolio-v2/issues/32)), this is what's live. | `release/*`, `hotfix/*` | A direct push, or a PR straight from a `feature/*`/`fix/*`/`docs/*`/`chore/*` branch. |
| `develop` | Integration. Always green — every gate passes at tip. The default base for new work. | `feature/*`, `fix/*`, `docs/*`, `chore/*`, plus back-merges from `release/*`/`hotfix/*` | A direct push. |
| `feature/<issue>-<slug>` | A new capability. Mostly `feat` commits. | — | — |
| `fix/<issue>-<slug>` | A bug fix that isn't urgent-production. Mostly `fix` commits. | — | — |
| `docs/<issue>-<slug>` | Documentation-only work. `docs` commits. | — | — |
| `chore/<issue>-<slug>` | Tooling, maintenance, dependency bumps, gate work. `chore`/`ci`/`build`/`dependencies`/`refactor`/`test` commits. | — | — |
| `release/<version>` | Stabilizes a batch of `develop` before it ships. Fixes only, no new features. | `develop` | — |
| `hotfix/<version>-<slug>` | An urgent fix against what's already live. Cut straight from `main`. | `main` | — |

Everyday branches (`feature`/`fix`/`docs`/`chore`) fork from `develop` and PR back
into `develop`. `release` and `hotfix` are the only branch types that touch `main`.

## Naming

```
<type>/<issue-number>-<kebab-case-slug>
```

Examples: `feature/9-core-group`, `fix/4-engine-gate-gap`, `docs/18-missing-projects`,
`chore/5-js-budget-diagnosis`. The issue number makes `git branch --list '*4*'`
findable and lets the branch name answer "what's this for" without opening GitHub.
Pick the type from what the branch's commits will mostly be, not from the issue's
GitHub label — an issue labelled `bug` that turns out to need `docs`-only work ships
as a `docs/` branch.

`release/<version>` and `hotfix/<version>-<slug>` use semver once a first version
exists — see [Versioning](#versioning).

## Bootstrap: `develop` does not exist yet

`main` is still the empty initial commit; [#1](https://github.com/aeassaf/portfolio-v2/pull/1)
(Phases 0–2) is still open against it. **The moment #1 merges, cut `develop` from
`main`** — that's the first real thing on `develop`, and every issue from #3 onward
branches from it, not from `main`. Creating `develop` earlier would just be a branch
pointing at an empty commit that nothing can build on yet, since #3 onward all depend
on the code #1 delivers.

```bash
git checkout main && git pull
git checkout -b develop
git push -u origin develop
```

Until that happens, work continues against `main` exactly as it does today — this
doc describes the target state, not a retroactive rewrite of #1.

## `Closes #N` needs `develop` to be the GitHub default branch

GitHub only honors a `Closes #N` / `Fixes #N` keyword — auto-closing the linked issue
on merge — for a PR merged into the repository's **default branch**. Today that's
`main`. Once `develop` exists and becomes where every everyday PR lands, those
`Closes #N` keywords will silently stop auto-closing anything unless `develop` also
becomes the default branch.

**Recommended, not yet done — it's a repo setting, needs Antoine's go-ahead:**

```bash
gh repo edit aeassaf/portfolio-v2 --default-branch develop
```

Until that's run, [`WORKFLOW.md`](WORKFLOW.md)'s rule 5 (closing a PR closes the
issue) only fires for PRs merged straight into `main` — `release/*` and `hotfix/*`
merges, not the everyday `feature/*`/`fix/*` ones. Track closure by hand (`Refs #N`
in the commit, close the issue after merge) until the default branch flips.

## Phase gates are the develop → main promotion point

`CLAUDE.md`'s non-negotiable — "stop at each phase gate and report" — doubles as the
answer to "when does `develop` go to `main`." A phase gate closing *is* a release:
once Antoine has looked and said go, open one PR, `develop` → `main` — through a
`release/<version>` branch if the batch needs a stabilization window, straight
`develop` → `main` if it doesn't. Nothing reaches `main`, and nothing reaches
production once deployed, without that checkpoint having actually happened.

## Versioning

No version exists yet. The first tag — cut when `develop` → `main` first ships to
production (Phase 9 / [#32](https://github.com/aeassaf/portfolio-v2/issues/32)) — is
`v0.1.0`. From there, semver follows the commit types shipped since the last tag: any
`feat` bumps minor, a fix-only batch bumps patch, a `BREAKING CHANGE:` footer bumps
major. Nothing computes this automatically — it's a convention to follow by hand
until, if ever, it's worth scripting.

## Why not straight trunk-based

The one-issue-per-session model already gives short-lived branches and frequent small
PRs — most of what trunk-based development is for. What it doesn't give is a place to
batch "everything since the last phase gate" for Antoine's sign-off before it reaches
what will become the live site. `develop` is that place. Once the site is live and
deploys continuously off `main`, it's worth revisiting whether `develop` still earns
its keep — Gitflow's own well-known criticism is that a permanent integration branch
outlives its usefulness once release cadence gets fast enough that every merge to
`main` is effectively a release. That's a Phase-9-or-later question, not a now one.
