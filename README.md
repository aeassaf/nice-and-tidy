# nice-and-tidy

Install an issue-first Git workflow and an AI session protocol into any repo, for any
coding agent.

Two things get installed from one command:

1. **A workflow** — issue before branch, branch naming, a commit convention, PR
   field-filling, and a project board whose Status tracks reality instead of drifting
   from it.
2. **A response protocol** — how an agent talks: terse, structured, and every session
   ends by leaving a trail the next session can pick up cold, in a committed markdown
   file rather than in GitHub comments.

Both were hand-derived on a real repo over several days. This exists so they don't
have to be re-derived per project.

## Status

Early. `init` and `diff` work. `bootstrap` does not exist yet and says so when you run
it rather than pretending. Not published to npm — the package is marked private until
that's a deliberate decision.

```bash
node bin/cli.js init
```

## What `init` writes

| Path | What it is |
|---|---|
| `AGENTS.md` | The canonical instructions. Everything else points here. |
| `docs/WORKFLOW.md` | The issue → PR → board process, in full — the companion `AGENTS.md` §1–5 summarize. |
| `docs/BRANCHING.md` | The branch table and naming rule, structurally different under `gitflow: true`/`false`. |
| `docs/COMMIT_CONVENTIONS.md` | The commit type table and format. |
| `docs/SESSION_PROTOCOL.md` | Why replies are concise and sessions hand off through a file — the rationale `AGENTS.md` §6–7 and the Skill's operational rules point back to. |
| `CLAUDE.md` | A one-line import of `AGENTS.md`, plus notes for sessions that can act on the repo directly. |
| `.github/copilot-instructions.md` | Pointer. |
| `.cursor/rules/nice-and-tidy.mdc` | Pointer. |
| `.claude/skills/nice-and-tidy/SKILL.md` | The workflow as an invocable skill, with the shell commands spelled out. |
| `nice-and-tidy.config.json` | Yours, after the first write. Never rewritten. |
| `docs/RESUME_HERE.md` (or wherever `protocol.memoryFile` points) | A starter scaffold, created once if nothing is there. Yours after that, same as the config — a real session's notes are never diffed or flagged as a conflict, whatever they say. |
| `.nice-and-tidy/manifest.json` | Provenance. Commit it — see below. |

There's no Windsurf shim: Windsurf reads a root `AGENTS.md` natively, and its own
docs describe `.windsurfrules` as the deprecated file that support replaced — shipping
one would be dead weight, not defense in depth. Re-checked whenever a target's native
support might have changed; see `docs/RESUME_HERE.md` for when this was last verified
and against what sources.

The instruction files never name a specific agent or product. Depth is gated by
capability instead: *"if you can run shell commands…"*, *"if your session can compact
its own context…"*. An agent with every capability listed gets the full experience
without the copy ever singling it out. A test enforces this.

`init` makes no network calls and touches nothing on GitHub. Creating labels,
milestones, the PR template and the board is `bootstrap`'s job.

## Re-running is safe

This is the part worth understanding, because it is the part most scaffolding tools
get wrong in one of two directions — clobbering your edits, or never being able to
update anything again.

Every file written is recorded in `.nice-and-tidy/manifest.json` as `path → sha256`.
On a re-run each file falls into one of these:

| State | What happens |
|---|---|
| Not there | Written. |
| There, hash matches what we wrote, content identical | Nothing. Silent no-op — the file is not even touched. |
| There, hash matches what we wrote, config changed | Updated. It's ours and nobody edited it. |
| There, hash differs, or we have no record of it | **Diff shown, file left alone.** |

Comparing the file to what we'd write cannot distinguish the last two — both differ.
Only a record of what was last written tells "you edited this" apart from "your config
changed." That record is why the manifest exists, and why it should be committed: a
fresh clone without it treats every generated file as foreign and stops to ask about
all of them.

When a conflict comes up:

- In a terminal, you're asked per file. Enter keeps your version.
- Without a terminal, nothing is written and the exit code is `1`.
- `--keep-existing` applies everything else and leaves conflicts alone. Exit `0`.
- `--force` overwrites them.

A skipped conflict stays a conflict. Nothing silently adopts a file you edited.

## Commands

```bash
nice-and-tidy init          # write the instruction files and the config
nice-and-tidy diff          # show what init would change, write nothing
nice-and-tidy bootstrap     # GitHub-side setup — not implemented yet
```

| Flag | |
|---|---|
| `-g, --global` | Install for the current user instead of the current repo. |
| `--dry-run` | Same as `diff`. |
| `--keep-existing` | Apply everything except conflicts. |
| `--force` | Overwrite conflicts without asking. |
| `--gitflow` / `--no-gitflow` | Branch model. Only applies when creating the config. |

Exit codes: `0` fine, `1` unresolved conflicts, `2` bad usage or bad config, `3` not
implemented.

### `--global`

Writes `~/.claude/skills/nice-and-tidy/SKILL.md` and a reference copy of `AGENTS.md`
under `~/.config/nice-and-tidy/`. Nothing loads a machine-wide `AGENTS.md` on its own,
and the command says so rather than implying it wired something up. Per-repo installs
are what agents actually read.

## Config

`nice-and-tidy.config.json`, at the repo root. Written once by `init`, yours after
that.

```json
{
  "repo": "owner/name",
  "defaultAssignee": "githubusername",
  "gitflow": true,
  "milestones": ["Phase 1"],
  "labels": ["bug", "enhancement"],
  "scopes": ["cli", "docs"],
  "board": { "projectNumber": null, "template": "team-planning" },
  "targets": ["agents-md", "claude", "copilot", "cursor"],
  "protocol": {
    "concise": true,
    "memoryFile": "docs/RESUME_HERE.md",
    "statusBlockEveryResponse": true
  }
}
```

- `repo` and `defaultAssignee` are filled in from your `origin` remote on first run.
- `gitflow: false` degrades the branch model to trunk-based: no `develop`, short-lived
  branches straight into `main`.
- `targets` defaults to all of them. A shim is a few lines pointing at `AGENTS.md`;
  the only reason to drop one is a tool that already reads `AGENTS.md` natively, where
  the shim would be dead weight.
- `protocol.memoryFile` is where session handoff is written. It must stay inside the
  repo and be markdown — both are validated.

## Session memory never touches GitHub

Issue and PR *fields* — status, labels, milestone, assignee, links — are real project
data and keep being updated on GitHub as the workflow describes.

An agent's running account of its own sessions is not project data. It goes in
`protocol.memoryFile` and nowhere else: no issue comments, no PR comments, no board
notes. GitHub stays exactly as readable to a human as it would be if no agent had ever
been involved.

There is no option to change this.

## What is not enforced

The commit convention is a convention. Nothing lints commit messages, and the
generated docs say so rather than implying a gate that isn't there. If drift becomes a
real problem, a commit-message hook is the natural fix.

## Development

Zero runtime dependencies, deliberately — `npx` should be a cold start with nothing to
download. Node 20.19+.

```bash
npm test
```

101 tests, mostly negative. An engine whose job is "do not destroy the user's work" is
only trustworthy if something proves it refuses.

## Licence

MIT.
