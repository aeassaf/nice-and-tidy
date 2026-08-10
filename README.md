# nice-and-tidy

Install an issue-first Git workflow and an AI session protocol into any repo, for any
coding agent.

```bash
npx nice-and-tidy init
```

## TLDR

- **What it does**: one command writes a set of instruction files (`AGENTS.md` +
  companions) that teach any coding agent (Claude, Copilot, Cursor, whatever's next)
  to work issue-first: open the issue, cut a conventionally-named branch, write
  conventional commits, fill every PR field, and keep the board honest.
- **What you get**: a workflow (branch naming, commit convention, PR/board hygiene)
  and a response protocol (terse replies, session handoff through a committed file
  instead of scattered GitHub comments).
- **Zero runtime dependencies.** `npx` is a genuine cold start; nothing to download
  beyond the package itself.
- Both were hand-derived on a real repo over several days. This exists so they don't
  have to be re-derived per project.
- **Safe to re-run.** Files you've hand-edited are never silently overwritten; see
  [Re-running is safe](#re-running-is-safe).
- **Two honest limits**: nothing lints commit messages (it's a convention, not a
  gate), and `bootstrap` can't create a Project board because GitHub exposes no API
  for cloning the board template; it prints the three manual steps instead.

## Conventions

This repo is installed on itself, so the docs below are the same ones `init` writes
into any repo that runs it; they describe this repo, not a hypothetical one. Each is
a dedicated, human-readable doc, not a paragraph buried in this README:

| Convention | Where |
|---|---|
| Issues, PRs, and keeping the board honest | [`docs/WORKFLOW.md`](https://github.com/aeassaf/nice-and-tidy/blob/main/docs/WORKFLOW.md) |
| Branch naming | [`docs/BRANCHING.md`](https://github.com/aeassaf/nice-and-tidy/blob/main/docs/BRANCHING.md) |
| Commit messages | [`docs/COMMIT_CONVENTIONS.md`](https://github.com/aeassaf/nice-and-tidy/blob/main/docs/COMMIT_CONVENTIONS.md) |
| How an agent replies, and hands a session off | [`docs/SESSION_PROTOCOL.md`](https://github.com/aeassaf/nice-and-tidy/blob/main/docs/SESSION_PROTOCOL.md) |

[`AGENTS.md`](https://github.com/aeassaf/nice-and-tidy/blob/main/AGENTS.md) is the
short form all four compress down to; the file an agent actually reads day to day.
The docs above are where the *why* lives, for when the short form isn't enough.

These links are absolute GitHub URLs on purpose: this README also ships as the
npmjs.com package page, and `docs/` and the root `AGENTS.md` aren't in the published
tarball; only `templates/AGENTS.md.tmpl` is. A relative link would 404 there.

## Example

```
$ npx nice-and-tidy init
nice-and-tidy · local install
  /path/to/yourrepo

  create     nice-and-tidy.config.json
  create     AGENTS.md
  create     docs/WORKFLOW.md
  create     docs/BRANCHING.md
  create     docs/COMMIT_CONVENTIONS.md
  create     docs/SESSION_PROTOCOL.md
  create     CLAUDE.md
  create     .claude/skills/nice-and-tidy/SKILL.md
  create     .github/copilot-instructions.md
  create     .cursor/rules/nice-and-tidy.mdc
  create     docs/RESUME_HERE.md

  11 created.
```

`.nice-and-tidy/manifest.json` is written alongside these but isn't itself a planned
file, so it doesn't get its own line; 12 files on disk, 11 reported. Nothing on
GitHub was touched; that's `bootstrap`'s job. Run it again and every line above
becomes `unchanged`, because nothing changed.

Open a fresh chat with any of those agents afterward and ask it to pick up an issue; it now knows to cut `feature/42-your-slug`, commit as `feat(cli): …`, and fill the PR
template before asking you to review.

## How it fits together

```mermaid
flowchart TD
    A["npx nice-and-tidy init"] --> B["AGENTS.md + companion docs written"]
    B --> C["CLAUDE.md, copilot-instructions.md,<br/>.cursor rules; one-line pointers"]
    C --> D["Agent reads its shim,<br/>follows AGENTS.md"]
```

Once an agent is following `AGENTS.md`, every session runs the same cycle:

```mermaid
flowchart TD
    E["Issue opened first"] --> F["Branch: type/N-slug"]
    F --> G["Conventional commits"]
    G --> H["PR: fields filled,<br/>closes the issue"]
    H --> I["Board Status kept honest"]
    E -.-> J["Session ends"]
    J -.-> K["Handoff written to<br/>docs/RESUME_HERE.md"]
```

Everything an agent needs to behave this way lives in the repo it's working in; no
service to authenticate against, no daemon to keep running.

## Status

`init`, `diff`, `upgrade`, `bootstrap` and `clean` all work. 197 tests, mostly negative; an
engine whose job is "do not destroy the user's work" is only trustworthy if something
proves it refuses to.

## What `init` writes

| Path | What it is |
|---|---|
| `AGENTS.md` | The canonical instructions. Everything else points here. |
| `docs/WORKFLOW.md` | The issue → PR → board process, in full; the companion `AGENTS.md` §1–5 summarize. |
| `docs/BRANCHING.md` | The branch table and naming rule, structurally different under `gitflow: true`/`false`. |
| `docs/COMMIT_CONVENTIONS.md` | The commit type table and format. |
| `docs/SESSION_PROTOCOL.md` | Why replies are concise and sessions hand off through a file; the rationale `AGENTS.md` §6–7 and the Skill's operational rules point back to. |
| `CLAUDE.md` | A one-line import of `AGENTS.md`, plus notes for sessions that can act on the repo directly. |
| `.github/copilot-instructions.md` | Pointer. |
| `.cursor/rules/nice-and-tidy.mdc` | Pointer. |
| `.claude/skills/nice-and-tidy/SKILL.md` | The workflow as an invocable skill, with the shell commands spelled out. |
| `nice-and-tidy.config.json` | Yours, after the first write. Never rewritten. |
| `docs/RESUME_HERE.md` (or wherever `protocol.memoryFile` points) | A starter scaffold, created once if nothing is there. Yours after that, same as the config; a real session's notes are never diffed or flagged as a conflict, whatever they say. |
| `.nice-and-tidy/manifest.json` | Provenance. Commit it; see below. |

There's no Windsurf shim: Windsurf reads a root `AGENTS.md` natively, and its own
docs describe `.windsurfrules` as the deprecated file that support replaced; shipping
one would be dead weight, not defense in depth. Every entry in `targets` is a claim
about what a third-party tool reads *today*, so each is worth re-checking against that
tool's own docs; native `AGENTS.md` support is exactly the kind of thing that lands in
a point release and turns a useful shim into dead weight.

The instruction files never name a specific agent or product. Depth is gated by
capability instead: *"if you can run shell commands…"*, *"if your session can compact
its own context…"*. An agent with every capability listed gets the full experience
without the copy ever singling it out. A test enforces this.

`init` makes no network calls and touches nothing on GitHub. Creating labels,
milestones, the PR template and the board is `bootstrap`'s job.

## Re-running is safe

This is the part most scaffolding tools get wrong in one of two directions: clobbering your edits, or never being able to update anything again.

Every file written is recorded in `.nice-and-tidy/manifest.json` as `path → sha256`.
On a re-run, each file falls into one of these buckets:

```mermaid
flowchart TD
    S["Re-run init"] --> Q1{"File exists?"}
    Q1 -- No --> W["create"]
    Q1 -- Yes --> Q2{"Hash matches<br/>what we'd write now?"}
    Q2 -- Yes --> N["unchanged:<br/>not even touched"]
    Q2 -- No --> Q3{"Manifest has a record,<br/>and it matches<br/>the file on disk?"}
    Q3 -- "Yes, we wrote it,<br/>config just changed" --> U["update"]
    Q3 -- "No, untracked,<br/>or hand-edited" --> D["conflict:<br/>diff shown, file left alone"]
```

`nice-and-tidy.config.json` and the memory file skip this decision tree entirely; they're yours from the first write (`kept`), never diffed, whatever they say.

Comparing the file to what we'd write cannot distinguish "you edited this" from "your
config changed"; both differ from what's on disk. Only a record of what was last
written tells those apart, which is why the manifest exists and why it should be
committed: a fresh clone without it treats every generated file as foreign and stops
to ask about all of them.

When a conflict comes up:

- In a terminal, you're asked per file. Enter keeps your version.
- Without a terminal, nothing is written and the exit code is `1`.
- `--keep-existing` applies everything else and leaves conflicts alone. Exit `0`.
- `--force` overwrites them.
- `--append` (or `+` at the prompt) keeps your file *and* installs the content, one
  below the other. See below.

A skipped conflict stays a conflict. Nothing silently adopts a file you edited.

### Appending, when you already have a `CLAUDE.md`

Overwrite and keep-mine are both all-or-nothing. If your repo already has its own
`CLAUDE.md`, `AGENTS.md` or `.github/copilot-instructions.md`, the third answer keeps
both: your content stays where it is, and the generated content goes underneath it,
fenced by two markers.

```markdown
# Working on acme-web                        ← yours. Never touched again.

Run `pnpm dev` for the local server.

<!-- nice-and-tidy:begin; generated. … -->  ← ours. Rewritten on every run.

@AGENTS.md
…
<!-- nice-and-tidy:end -->
```

The markers are what a later run reads, so from then on the two halves are treated
differently:

| You change | Next run |
|---|---|
| Anything **outside** the markers | Nothing. That content is yours; the tool has no opinion on it. |
| Anything **inside** them | `conflict`; diffed and left alone, same as any hand-edited file. |
| Your config, changing what we'd generate | `update`, rewriting **only** what's between the markers. |
| Delete or duplicate the markers | `conflict`. An ambiguous fence is never guessed at. |

For an appended file the manifest records the hash of the block, not of the whole
file; recording the whole file is what would let a later run mistake your content for
ours and replace it without asking.

Two things are left alone instead of appended to, and `--append` says which and why:

- `.cursor/rules/nice-and-tidy.mdc` and the Skill. Their generated content opens with
  YAML frontmatter, which only means anything at the top of a file.
- A file **this tool wrote** that was then hand-edited. Its content is already a copy
  of ours, so appending would leave two of them in one file. That conflict is about a
  version, not about ownership; `--force` and keep-mine are its answers.

## Commands

```bash
nice-and-tidy init          # write the instruction files and the config
nice-and-tidy diff          # show what init would change, write nothing
nice-and-tidy upgrade       # pull in a newer release of this tool, same repo
nice-and-tidy bootstrap     # GitHub-side setup: PR template, gate, CI, labels, milestones
nice-and-tidy clean         # find deprecated per-tool convention files that predate AGENTS.md
```

| Flag | |
|---|---|
| `-g, --global` | Install for the current user instead of the current repo. |
| `--dry-run` | Same as `diff`; for `clean`, report without writing anything. |
| `--keep-existing` | Apply everything except conflicts. |
| `--force` | Overwrite conflicts without asking; for `clean`, replace every flagged file with a pointer to `AGENTS.md`. |
| `--append` | Keep conflicting files and add the generated content to the end of each, fenced by markers. Files whose content only works at the top of a file are left alone instead. |
| `--gitflow` / `--no-gitflow` | Branch model. Only applies when creating the config. |

Exit codes: `0` fine, `1` unresolved conflicts, `2` bad usage or bad config, `3`
`bootstrap` only; `gh` is missing or not logged in, and nothing was contacted.

### `upgrade`

```bash
npx nice-and-tidy@latest upgrade
```

Re-running `init` after a newer release is already safe on its own; see above. `upgrade`
adds the two things a plain re-run can't do:

- prints which version last touched this repo and which version is about to, from
  `generatorVersion` in the manifest, and refuses to run an older release over a newer
  install unless you pass `--force`
- notices when a newer release's config has keys yours predates and offers to add
  them, diffed like any other conflict; `nice-and-tidy.config.json` is yours once it
  exists, so `init` alone will never touch it, even to add a key you don't have yet

Everything else; the file plan, `--keep-existing`, `--force`, `--append`, the exit
codes; is `init`'s, unchanged. `--append` has nothing to add to a JSON config, so on
the backfill question it means "leave it alone"; `--force` is how you take the new keys.

### `bootstrap`

Everything `init` deliberately doesn't touch, because it needs the network:

| What | Notes |
|---|---|
| `.github/pull_request_template.md` | Through the same plan/manifest pipeline as `init`'s files; your edits are diffed and asked about, not clobbered. |
| `scripts/check-pr-description.mjs` + `.github/workflows/pr-description.yml` | A dependency-free gate that fails a PR whose template sections are still the guidance comments. |
| `.github/workflows/ci.yml` | A minimal npm starting point. Adjust it. |
| Labels and milestones | Created from config, skipping any that already exist. Re-runnable. |

It needs `gh` installed and authenticated, and exits `3` without touching anything if
that isn't true. The default-branch flip under `gitflow: true` is **printed, never
run**; that's a repo-wide change a human should make deliberately.

No Project board is created. `gh project create` only produces a blank project, and
the GraphQL mutation that could clone a template needs a source ID GitHub doesn't
expose to a token. `docs/WORKFLOW.md` documents the three manual steps instead.

### `clean`

A repo can carry older, per-tool convention files from before it ran
`nice-and-tidy init` (`.cursorrules` from pre-2024 Cursor use is the common case) that now duplicate or contradict what `AGENTS.md` says. `clean` checks a small, fixed
registry of formats verified as **deprecated by the tool that reads them**, not a
glob of anything that looks agent-related:

| Path | Deprecated in favor of |
|---|---|
| `.cursorrules` | `.cursor/rules/*.mdc`; Cursor's Agent mode, the default since 2026, silently ignores a root `.cursorrules` file entirely. |
| `.windsurfrules` | Windsurf's native root `AGENTS.md` support. |

A hit is skipped, silently, if its content already mentions `AGENTS.md`; nothing to
do. Otherwise `clean` shows the file like a conflict (same diff `init` shows for a
hand-edited file) and asks before writing anything; `--dry-run` only reports, and
with no terminal to ask on and no `--force`, it reports and writes nothing, same as
`init`. **It never deletes.** The only mutation is replacing a file's contents with a
generic pointer to `AGENTS.md`; recoverable through git *if the file was already
tracked*, and the file still exists in case something checks for its presence. It
shows the diff and asks first precisely because an untracked file's old contents
are not recoverable at all.

The registry is intentionally short. `.clinerules` isn't in it: Cline does not read
`AGENTS.md` natively as of this writing, so `.clinerules` is a *live* convention
file, not a deprecated one; flagging it would offer to gut a config real Cline
setups still depend on. Every entry is a claim about what a tool reads *today*,
worth re-checking against that tool's own docs before it's trusted, the same as
`targets` in [Config](#config) below.

`init` prints a one-line note pointing at `clean` when it finds something to flag; it
never runs `clean` for you.

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
  repo and be markdown; both are validated.

## Session memory never touches GitHub

Issue and PR *fields* (status, labels, milestone, assignee, links) are real project
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

Zero runtime dependencies, deliberately; `npx` should be a cold start with nothing to
download. Node 20.19+.

```bash
npm test
```

137 tests, mostly negative. An engine whose job is "do not destroy the user's work" is
only trustworthy if something proves it refuses.

## Licence

MIT.
