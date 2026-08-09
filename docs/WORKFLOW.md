# WORKFLOW

How work gets tracked, from an idea to Done, in aeassaf/nice-and-tidy. This file is the source
of truth for the *process*. Two companions cover what this file doesn't:
[`BRANCHING.md`](BRANCHING.md) (what branch to cut and from where) and
[`COMMIT_CONVENTIONS.md`](COMMIT_CONVENTIONS.md) (what a commit message looks like).

## The rules

1. A GitHub issue exists before code does. All handling of that work happens on the
   issue from then on — priority, labels, milestone, status.
2. Every created issue is added to the Project board.
3. Every issue has every applicable field filled: milestone, labels, assignee
   (default aeassaf), and the Project fields (Status, Priority, Size).
4. Every PR has the same fields filled, plus the linked issue.
5. Closing a PR closes the issue it references and moves that issue to **Done** on
   the board. GitHub does the first half automatically on `Closes #N` in the PR body
   — the board field still needs a manual move; closing a PR does not touch it.
6. An issue with an open PR sits in **In review**.
7. An issue with a branch but no open PR sits in **In progress**.

## The board

`bootstrap` creates the Project board from GitHub's own default team-planning
template — no custom field creation to write or maintain:

- **Status**: `Backlog · Ready · In progress · In review · Done`.
- **Priority**: `P0 · P1 · P2`.
- **Size**: `XS · S · M · L · XL`.

Field and option IDs are specific to the board `bootstrap` creates in *this* repo —
they get appended below the first time `bootstrap` runs, and are re-queried, never
reused from memory or from this document, on every write after that:

<!-- populated by `bootstrap` -->

## What "all fields filled" means concretely

- **Milestone** — the phase or batch of work the issue belongs to.
- **Labels** — from `bug`, `enhancement`, `documentation`, `tech-debt`, `gate`, `needs-antoine`, `question`, as many as genuinely apply. Don't force one that
  doesn't fit just to fill the field.
- **Assignee** — aeassaf, always, unless said otherwise in chat.
- **Priority, Size, Status** — Project (v2) fields, not settable until the board
  exists. Don't fake these with labels in the meantime.

## Linking a PR to its issue so rule 5 fires

Reference the issue in the PR's **Issues** section. GitHub auto-closes an issue on
merge when a PR merged into the repository's **default branch** contains `Closes #N`,
`Fixes #N`, or `Resolves #N` in its body — a bare `#N` does **not** auto-close
it.
