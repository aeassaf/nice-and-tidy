# nice-and-tidy — project brief

Hand this to a fresh AI coding session in a **new, empty repository** to start the
project. Package/repo name: **nice-and-tidy**.

**Terminology note (applies to this brief only, not the shipped product):** this
document names specific tools — Claude Code, GitHub Copilot, Cursor — because it's an
engineering spec and precision helps whoever builds it. The product itself must never
name a specific agent in its own shipped copy. See *Agent-agnostic, tuned by
capability* below — that's the one rule everything else here defers to.

---

## What this is

Two things any repo can install, from one npm CLI:

1. **A workflow** — issue-first, Gitflow-shaped branches, a commit convention, a PR
   template with a check that actually fails on an unedited template, a GitHub
   Project board whose Status field tracks reality instead of drifting from it.
2. **A response protocol** — how the agent talks: terse, structured, and every
   session ends by leaving a trail the next session (any agent, any day) can pick up
   cold.

Both were hand-derived on `aeassaf/portfolio-v2` over several conversations. The
point of this project is to stop re-deriving them per repo.

## Agent-agnostic, tuned by capability

Works with any AI coding agent. Nothing shipped — no instruction file, no generated
doc, no CLI output — names a specific agent or claims to work best with one. Depth is
earned by capability, not granted by brand:

- An agent that can shell out to `git`/`gh` gets the full workflow automation.
- An agent with a context-compaction or session-summarization feature gets that
  suggested at the right moment — phrased as *"if your session is getting long, start
  a new one / compact it,"* never as a named command.
- Every agent gets memory that survives a session boundary — written to a plain
  markdown file in the repo, never to GitHub. See *The response protocol* for why
  that split is deliberate, not an omission.

Write every instruction file this way: **by capability, not by product name.** An
agent that happens to have every capability listed gets the full experience without
the copy ever singling it out. That is what "works best for [redacted]" means here,
and it's the only place in this brief that sentence appears.

## Why now, why this shape

Three working documents already exist and have been dogfooded on a live repo for
several days: `docs/WORKFLOW.md`, `docs/BRANCHING.md`, `docs/COMMIT_CONVENTIONS.md`
in `aeassaf/portfolio-v2`, plus a PR template with a dependency-free enforcing check
and a GitHub Project board wired to a Status/Priority/Size shape that turned out to
be GitHub's own default team-planning template. None of it was exotic. What took
several sessions was **re-explaining the rules and re-doing the `gh` setup calls by
hand, once per project** — plus, this round, re-explaining *how the agent should
even talk*. Both are the parts to eliminate.

## Source material — read before designing anything

Reference implementation for **one** project, GitHub-only, no cross-agent layer yet.
Extract the shape; portfolio-v2-specific values (its milestone names, its labels, its
repo slug) become config, not defaults.

| File (in `aeassaf/portfolio-v2`) | What to take from it |
|---|---|
| `docs/WORKFLOW.md` | Issue/PR field-filling rules, Status/Priority/Size mapping, the `Closes #N` default-branch caveat, `gh project item-edit` scripting pattern |
| `docs/BRANCHING.md` | Gitflow branch table, naming `<type>/<issue>-<slug>`, the bootstrap-order problem, the default-branch-flip tradeoff |
| `docs/COMMIT_CONVENTIONS.md` | Type table (`feat/fix/docs/style/refactor/perf/test/build/ci/chore/dependencies/revert`), the "not enforced, and say so" honesty pattern |
| `.github/pull_request_template.md` | HTML-comment guidance so an untouched template visibly fails |
| `scripts/check-pr-description.mjs` + `.test.mjs` | Dependency-free, majority-negative-test validator pattern |
| `.github/workflows/pr-description.yml` | Separate workflow for the `edited` trigger; body passed via `env:`, never interpolated |
| `.github/workflows/ci.yml` | `push: branches: [main, develop]`, added pre-emptively |

Already staged in this repo at `reference/` — see *Reference material* below.

## Installation paths — researched, ranked

Checked current adoption before designing this rather than guessing. Findings:

1. **`AGENTS.md` at repo root is the actual cross-tool standard**, not a fallback.
   Formalized as an open spec in 2025 with OpenAI/Google/Cursor/Factory involvement,
   donated to the Linux Foundation's Agentic AI Foundation in December 2025. As of
   mid-2026: 60,000+ repos, 28+ tools reading it natively, including Cursor, Codex,
   Copilot, Windsurf, Gemini CLI, Zed, Aider, Devin. **This is the primary artifact
   and single source of truth for instruction content** — everything else is either
   a thin pointer to it or an agent-specific extension.
2. **Claude Code reads `CLAUDE.md`, not `AGENTS.md`, directly** — the documented
   bridge is a one-line import at the top of `CLAUDE.md`: `@AGENTS.md`. Generate
   exactly that, plus Claude-specific extras below the import line. This is the
   concrete mechanism behind *Agent-agnostic, tuned by capability* above — no
   branding, just the file Claude Code's own docs say to write.
3. **Per-agent shims only where a target doesn't yet read `AGENTS.md` natively** —
   check at build time, tool support is moving fast (Cursor and Copilot may already
   read it directly, which would make their shims dead weight). Candidates:
   `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`, `.windsurfrules`. Each
   one is a pointer to `AGENTS.md`'s content, not a fork of it.
4. **npm CLI (`npx <pkg> init`) is the validated install mechanism** — not a novel
   choice. Comparable existing tools already ship this way: `agent-skill-creator`
   installs on 17 platforms from one source file via `npx`, with format adapters for
   Cursor/Windsurf/Junie generated automatically; `agentrulegen.com` does the same
   multi-format export. **Evaluate reusing or forking `agent-skill-creator`'s
   adapter matrix before hand-building a 17-platform transpiler** — this exact
   problem is already solved once.
5. **Claude Code Skill + optional Plugin/marketplace listing is a second, additional
   install path**, not a replacement for the npm CLI. `.claude/skills/<name>/SKILL.md`
   (project- or user-scoped) carries the response protocol and the deeper workflow
   automation, because Claude Code's actual tool surface (shell, `gh`, persistent
   session boundaries, a compaction command) is what executes it. A Plugin manifest
   (`.claude-plugin/plugin.json`) makes it additionally installable via `/plugin`
   for people who'd rather not touch npm at all.

Net recommendation: **`AGENTS.md` first, npm CLI as the installer for it and every
shim, Claude Code Skill/Plugin as an additional richer path layered on top — never
the only path.**

## Goals

- `npx <pkg> init` (project-local, commits `AGENTS.md` + shims + `.claude/skills/`)
  and `npx <pkg> init --global` (`~/.claude/skills/` + a global `AGENTS.md` default,
  applies machine-wide where a repo has no local override).
- `bootstrap` — the one-time GitHub-side setup (PR template, check, workflow,
  labels, milestones, Project board) scripted from what was done by hand this week.
- Generated content that an agent actually acts on mid-session: issue-first, branch
  naming, commit format, PR field-filling, Project board Status transitions, and the
  response protocol below — all driven by one config file, nothing hardcoded.
- Every portfolio-v2-specific value becomes config: repo slug, default assignee,
  labels, milestones, commit scopes, Gitflow on/off.

## Non-goals

- Not a commit-message *linter* by default — convention, not a gate, and the
  generated docs say so (same honesty rule as `COMMIT_CONVENTIONS.md`).
- Not a `gh` replacement — shells out to it.
- Not GitLab/Bitbucket on day one.
- Not silently overwriting a hand-edited file on re-run — diff and ask, like
  `npx husky init` or `npx shadcn add`.
- Not hand-building a 17-format adapter matrix if `agent-skill-creator` already
  covers it — check before writing that code.

## Architecture

```
<pkg>/
  package.json              bin: cli.js
  bin/cli.js                 init / bootstrap / diff
  templates/
    AGENTS.md.tmpl            canonical instructions — capability-gated, no agent names
    shims/
      CLAUDE.md.tmpl           "@AGENTS.md" + Claude-specific extras below the import
      copilot-instructions.md.tmpl
      cursor-rules.mdc.tmpl
      windsurfrules.tmpl
    workflow/
      COMMIT_CONVENTIONS.md.tmpl
      BRANCHING.md.tmpl
      WORKFLOW.md.tmpl
      pull_request_template.md.tmpl
      pr-description.yml.tmpl
      check-pr-description.mjs      (generic already — copy verbatim, no templating)
      check-pr-description.test.mjs
    protocol/
      SESSION_PROTOCOL.md.tmpl      the response/session structure below, as shipped copy
  skill/
    SKILL.md.tmpl               Claude Code Skill: imports workflow + protocol, adds
                                 Claude-specific execution notes (gh calls, /compact-class
                                 suggestion, the local-file memory writer)
  plugin/                      optional: .claude-plugin/plugin.json for marketplace install
  test/
  README.md
```

## Config file

`.claude/workflow.config.json` (or repo-root `.agentworkflow.json` — bikeshed later),
written by `init`, read by every generated file at template-fill time:

```json
{
  "repo": "owner/name",
  "defaultAssignee": "githubusername",
  "gitflow": true,
  "milestones": ["Phase 0", "Phase 1"],
  "labels": ["bug", "enhancement"],
  "scopes": ["web", "ui", "ci", "docs"],
  "board": { "projectNumber": null, "template": "team-planning" },
  "targets": ["agents-md", "claude", "copilot", "cursor", "windsurf"],
  "protocol": {
    "concise": true,
    "memoryFile": "docs/RESUME_HERE.md",
    "statusBlockEveryResponse": true
  }
}
```

`gitflow: false` degrades the branch model to trunk-based (`main` + short-lived
`<type>/<issue>-<slug>` straight into `main`, no `develop`) — portfolio-v2 chose
Gitflow deliberately (`docs/BRANCHING.md`'s own "why not trunk-based" section); that
reasoning doesn't universally apply. **`targets` defaults to every target listed —
install all of them at once, not either/or.** A shim costs a few lines and mostly
just points at `AGENTS.md`; the only reason to drop one is a target that already
reads `AGENTS.md` natively, where a shim would be dead weight, not a cost tradeoff
the user needs to pick between. `protocol.memoryFile` is where session handoff gets
written — see below.

## The response protocol (second pillar — as important as the git rules)

Design motivation, stated plainly: default AI verbosity wastes the reader's time and
attention. This isn't a nice-to-have setting — it's the default, ships on, and the
generated docs should say *why* in one line, not apologize for it.

**Style, always:** concise, complete, straight to the point. State results and
decisions directly. No restating the request, no narrating steps, no padding.

**End of every substantive response, a compact status block** (omit a line entirely
if there's nothing to report — never print "None" as filler):

- **Questions pending** — brief bullets, awaiting the user.
- **Progress** — % complete on the current milestone/task.
- **Git/PR status** — branch, clean/uncommitted, PR number + state.
- **Expected next input** — what the user should say next; explicitly recommend a
  new session or a context-compaction step when the conversation has grown long
  (capability-gated phrasing, not a named command).

**End of session (a real stopping point, not every message), add:**

- **Done this session** — brief, complete bullets.
- **Planned for next session** — brief, complete bullets.
- **Memory handoff** — leave state the next session can read cold, **written to
  `protocol.memoryFile` and nowhere else.** GitHub — issues, PRs, labels, the
  Project board — stays exactly as readable to a human as it would be with no AI
  involved at all. Issue/PR *state* (status, fields, links) is real project data and
  keeps being updated on GitHub per the workflow half of this skill; the AI's own
  running commentary about its own sessions is not project data and does not belong
  there. This generalizes a pattern already proven on portfolio-v2 —
  `docs/RESUME_HERE.md` and `docs/PROGRESS.md` already do exactly this: plain
  markdown, committed, read first by the next session, and it has never once been a
  GitHub comment. Push everything, update tickets/PRs, leave git state clean before
  signing off — this is a hand-off, not a pause.

This entire section ships as `templates/protocol/SESSION_PROTOCOL.md.tmpl`. No
target agent, however capable, ever gets a GitHub-comment memory option — this one
isn't capability-gated, it's off, full stop.

## `bootstrap`

- Copy the templated PR template + check script + workflow into `.github/`.
- Create labels from config (`gh label create`, skip existing).
- Create milestones from config, if any.
- Create the Project board by reusing **GitHub's own default team-planning
  template** — no custom GraphQL field-creation to write or maintain.
- Print, never run, the default-branch-flip command (`gh repo edit
  --default-branch develop`) when `gitflow: true`. Repo-setting change, needs a
  human's go-ahead in chat, same as portfolio-v2.
- Detect and refuse loudly (not silently skip) a missing `project` OAuth scope or a
  `gh` version predating `gh project` — print the exact fix, don't fail opaquely.
- Detect existing agent-config files before writing shims (`AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/`, etc. may already exist by hand) and diff/ask, never clobber.

## Non-negotiables

- **Shipped instruction copy never names a specific agent or product.**
  Capability-gated phrasing only — see *Agent-agnostic, tuned by capability*. This is
  the one rule every other non-negotiable is subordinate to.
- **Never fabricate a GitHub field/option ID.** Re-query, don't trust a cached one.
- **Never flip a repo's default branch, delete a label, or close a tracking issue
  without it being asked for in chat.** `bootstrap` prepares and prints; a human
  clicks go on anything account/repo-settings-shaped.
- **Say what isn't enforced.** Convention-only rules say so in the generated docs.
- **Config is the only place project-specifics live.** A hardcoded value in
  `templates/` on a second real install means the templating boundary was drawn
  wrong — fix the template.
- **Never silently overwrite a hand-edited instruction file.** Diff and ask.
- **AI session memory never touches GitHub.** No issue comments, no PR comments, no
  project-board notes written by the skill about its own sessions. GitHub stays
  exactly as readable as it would be without AI involved — memory is markdown, full
  stop. Issue/PR *fields* (status, labels, links) are real project data and are the
  one thing this rule doesn't apply to; those keep updating as designed.
- **Dogfood on a second, structurally different repo** (smaller, trunk-based) before
  calling v1 done — proves `gitflow: false` isn't a config option nobody's tested.

## Phased build plan, with gates

1. **CLI skeleton + config schema.** `init --local`/`--global` write a real config
   and copy still-mostly-literal files. No GitHub calls. *Done when:* running twice
   is idempotent; the second run diffs instead of clobbering.
2. **`AGENTS.md` + shims, templated.** Config placeholders drive `AGENTS.md`, the
   `CLAUDE.md` import shim, and per-target shims gated by `targets`. *Done when:*
   `gitflow: false` produces a coherent trunk-based doc set, no dangling `develop`
   references.
3. **The response protocol.** `SESSION_PROTOCOL.md` generated and wired into the
   Claude Skill's own behavior (and into `AGENTS.md` in capability-gated form for
   every other target). *Done when:* a session run against the installed skill
   actually ends its replies with the status block, unprompted.
4. **`bootstrap`.** PR template, check, workflow, labels, milestones. *Done when:*
   run against a fresh throwaway repo, a bad PR trips the check exactly like
   portfolio-v2's own proof run.
5. **Project board bootstrap.** Default team-planning template, field/option IDs
   recorded into the generated `WORKFLOW.md`. *Done when:* a fresh repo gets the
   same Status/Priority/Size shape with zero hand-written GraphQL.
6. **Memory handoff.** `protocol.memoryFile` writer, generalized from
   `docs/RESUME_HERE.md`'s working pattern. *Done when:* a second session, reading
   only that file (no chat history, no GitHub), can correctly state what the first
   session finished and what's next — and GitHub shows zero trace of either session.
7. **Dogfood.** Install into portfolio-v2 (replace its hand-written docs with
   generated ones, diff for drift) **and** into one smaller trunk-based repo.
8. **Publish.** npm visibility decision, README. This project runs its own output
   on itself from commit one.

## Resolved

- **Name: `nice-and-tidy`.**
- **Install paths: all of them, always, not either/or.** `init` writes `AGENTS.md`
  plus every applicable shim in one pass, minus shims for targets that already read
  `AGENTS.md` natively (that's a dead-weight-avoidance trim, not a user choice).
- **Memory: local file only, generalized from `docs/RESUME_HERE.md`.** No GitHub
  comment path exists, capability-gated or otherwise.

## Open questions only Antoine can answer

- **npm visibility** — repo is already public with an MIT `LICENSE` committed, which
  points at public npm unless told otherwise. Confirm before Phase 8, don't assume.
- **Gitflow default** — on by default at `init`, or opt-in?
- **`bootstrap`'s label opinionation** — always seed portfolio-v2's label set, or
  ship GitHub's small standard set and let config add the rest?
- **Per-shim necessity** — confirm at build time whether Copilot/Cursor/Windsurf
  already read `AGENTS.md` natively; if so, drop that shim rather than ship dead
  weight.
- **One `memoryFile` per repo, or one per issue/branch** — `docs/RESUME_HERE.md`-style
  (single file, always current) scales differently than a file per unit of work.
  Single file is the safer default (matches the proven pattern exactly); worth
  revisiting once a repo has enough parallel work in flight to make one file feel
  cramped.

## Reference material — already staged

The seven files are sitting in this repo already, paths preserved from
portfolio-v2:

```
reference/docs/WORKFLOW.md
reference/docs/BRANCHING.md
reference/docs/COMMIT_CONVENTIONS.md
reference/.github/pull_request_template.md
reference/scripts/check-pr-description.mjs
reference/scripts/check-pr-description.test.mjs
reference/.github/workflows/pr-description.yml
```

Read them before writing any template — they're the working prototype, not a
description of one. `reference/` isn't part of the shipped package; delete it (or
leave it, harmless either way) once the templates it informed actually exist.

## Repo state at the start

`aeassaf/nice-and-tidy`, public, `main`, MIT `LICENSE` already committed, nothing
else yet — no `package.json`, no `.gitignore` (an `.idea/` directory is present and
untracked; gitignore it in Phase 1 rather than committing IDE state).

## Where to start

First issue: **"Phase 1 — CLI skeleton + config schema."** Same one-issue-per-session
discipline this brief describes building — first real use of the thing under
construction is building the thing.

---

Sources checked for the installation-paths research: [AGENTS.md](https://agents.md/) ·
[AGENTS.md Complete Guide 2026](https://codersera.com/blog/agents-md-complete-guide-2026/) ·
[AGENTS.md vs CLAUDE.md — official import mechanism](https://gist.github.com/yurukusa/d36197848911f025add142abefcde685) ·
[Make CLAUDE.md follow AGENTS.md](https://travis.media/blog/claude-md-import-agents-md/) ·
[agent-skill-creator — 17-platform installer](https://github.com/FrancyJGLisboa/agent-skill-creator) ·
[Agent Rules Builder](https://www.agentrulegen.com/) ·
[Claude Code plugin marketplace](https://code.claude.com/docs/en/discover-plugins)
