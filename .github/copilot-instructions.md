# Repository instructions

**Read `AGENTS.md` at the root of this repository and follow it.** It is the single
source of truth for how work is tracked, branched, committed, reviewed, and handed
off here. This file is a pointer to it, not a second copy.

The short version, so nothing is lost if only this file is loaded:

- Work starts from a GitHub issue. Never invent an issue number.
- Branches are `<type>/<issue-number>-<kebab-case-slug>`, cut from `main`
  and merged back into `main`. Never push to `main`.
- Commits are `<type>(<scope>): <subject>`, imperative and lowercase. Nothing enforces
  this — it is convention, and saying so is part of the convention.
- Pull requests fill every template section and every applicable field. `Closes #N`
  only auto-closes when the PR merges into the repository's default branch.
- Replies are concise and end with a status block. Session handoff is written to
  `docs/RESUME_HERE.md`, never to a GitHub comment.

Everything above is stated in full, with the reasoning, in `AGENTS.md`.
