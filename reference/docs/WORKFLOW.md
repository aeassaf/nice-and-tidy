# WORKFLOW

How work gets tracked, from "Antoine describes a thing" to "it's Done." Ratified
2026-08-08. This file is the source of truth for the *process*; `docs/RESUME_HERE.md`
stays the source of truth for *where the build stands*. Two companions cover the
parts of the process this file doesn't: [`BRANCHING.md`](BRANCHING.md) (what branch
to cut and from where) and [`COMMIT_CONVENTIONS.md`](COMMIT_CONVENTIONS.md) (what a
commit message looks like).

## The rules, as given

1. When Antoine describes a new feature, issue, or bug, a GitHub issue gets created for
   it first. All handling of that work happens on the issue from then on — priority,
   labels, milestone.
2. Every created issue is added to the Project board.
3. Every issue has all applicable fields filled: milestone, labels, assignee (default
   Antoine), and the Project fields (Status, Size, Priority).
4. Every PR has all applicable fields filled too: linked issue, labels, assignee
   (default Antoine), and the same Project fields.
5. Closing a PR closes the issue it references and moves that issue to **Done** on the
   board.
6. An issue with an open PR sits in **Code review**.
7. An issue with a branch but no open PR sits in **In progress**.

## The board

**Live as of 2026-08-08.** [Portfolio V2](https://github.com/users/aeassaf/projects/4)
(project #4, `PVT_kwHOAx-NdM4Bfxog`), GitHub's default team-planning template. All 31
issues and PR #1 are items on it.

- **Status**: `Backlog · Ready · In progress · In review · Done`. The rules said "Code
  review" — the board's closest option is **In review**; that's what rule 6 maps to.
- **Priority**: `P0 · P1 · P2`.
- **Size**: `XS · S · M · L · XL`.

| Rule | Status today |
|---|---|
| 1. Issue created before work starts | **Live.** Every session already starts from an issue. |
| 2. Added to Project | **Live**, but manual per item — GitHub's auto-add-to-project workflow is UI-only, not scriptable via `gh`/the API, so nothing add itself automatically. Whoever creates an issue or PR runs `gh project item-add 4 --owner aeassaf --url <issue-or-pr-url>` right after. |
| 3. Issue fields filled — milestone, labels, assignee, Priority, Size | **Live.** Milestone/labels set at creation; assignee defaults to Antoine; Priority/Size set on the board. Backfilled on all 33 existing items 2026-08-08 — Priority/Size were my first-pass judgment calls from each issue's stated scope, not Antoine's; treat them as a starting point, re-sort freely. |
| 4. PR fields filled — linked issue, labels, assignee, Priority, Size | **Live.** Same mechanism as issues, added to the board via `gh project item-add`. |
| 5. Closing a PR closes the issue → Done | **Half-live.** `Closes #N` in the PR body makes GitHub auto-close the issue on merge — works with no board involvement. The linked issue's Status still needs a manual move to **Done** (`gh project item-edit`) — GitHub does not do this automatically just because the issue closed. |
| 6. Issue with an open PR → In review | **Live**, set manually when the PR opens. #2 is set this way now, reflecting PR #1 being open against it. |
| 7. Branch, no open PR → In progress | **Live**, set manually when a branch is pushed for an issue with no PR yet. |

Field IDs, for scripting future updates without re-querying:

```
project:  PVT_kwHOAx-NdM4Bfxog
Status:   PVTSSF_lAHOAx-NdM4BfxogzhaCHCE   Backlog f75ad846 · Ready 61e4505c · In progress 47fc9ee4 · In review df73e18b · Done 98236657
Priority: PVTSSF_lAHOAx-NdM4BfxogzhaCIP4   P0 79628723 · P1 0a877460 · P2 da944a9c
Size:     PVTSSF_lAHOAx-NdM4BfxogzhaCIP8   XS 6c6483d2 · S f784b110 · M 7515a9f1 · L 817d0097 · XL db339eb2
```

```bash
gh project item-edit --project-id PVT_kwHOAx-NdM4Bfxog --id <item-id> \
  --field-id <field-id> --single-select-option-id <option-id>
```

`<item-id>` (not the issue/PR number) comes from `gh project item-list 4 --owner aeassaf --format json`.

## What "all possible values filled" means concretely, today

- **Milestone** — the phase the work belongs to (`Phase 0` … `Phase 9`). Set at issue
  creation from `docs/PROGRESS.md`'s roadmap.
- **Labels** — as many of `documentation`, `design-system`, `infra`, `enhancement`,
  `bug`, `tech-debt`, `gate`, `perf`, `a11y`, `content`, `needs-antoine`, `question` as
  genuinely apply. Don't force a label that doesn't fit just to fill the field.
- **Assignee** — Antoine, always, unless he says otherwise. `gh issue create
  --assignee aeassaf` / `gh issue edit <n> --add-assignee aeassaf`.
- **Size, Priority, Status** — Project (v2) fields. Not settable until the board
  exists; do not fake these with labels in the meantime (a `size:M` label would just be
  something to unwind later).

## Linking a PR to its issue so rule 5 fires

Reference the issue by number in the PR's **Issues** section
(`.github/pull_request_template.md`). GitHub auto-closes an issue on merge when a PR
merged into the repository's **default branch** contains `Closes #N`, `Fixes #N`, or
`Resolves #N` in its body — plain `#N` does **not** auto-close, so a PR that only
*references* an issue without closing it (like
[#1](https://github.com/aeassaf/portfolio-v2/pull/1) →
[#2](https://github.com/aeassaf/portfolio-v2/issues/2)) should say so explicitly
rather than relying on the auto-close keyword by accident.

⚠️ "The default branch" is `main` today, but [`BRANCHING.md`](BRANCHING.md) has
everyday PRs landing on `develop` once it's cut. `Closes #N` only auto-closes if the
branch it merges into is the one GitHub considers default — see
[`BRANCHING.md`](BRANCHING.md#closes-n-needs-develop-to-be-the-github-default-branch)
for the flip this needs and why it hasn't happened yet.

## Not covered here

Issue #33 ("Decisions only Antoine can make") is never closed by a PR — it's a running
checklist, not a unit of work. Rule 5 doesn't apply to it.
