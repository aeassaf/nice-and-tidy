import { bold, dim, yellow } from '../ui.js'

export const EXIT_NOT_IMPLEMENTED = 3

/**
 * Refuses, loudly and specifically.
 *
 * A stub that printed "done" or silently exited 0 would be worse than no command at
 * all: the next thing to run is a workflow that assumes labels, milestones and a
 * board exist, and it would fail somewhere much further from the cause.
 */
export async function bootstrap({ err = (text) => process.stderr.write(text) } = {}) {
  err(
    `${yellow('bootstrap is not implemented yet.')}\n\n` +
      `It will do the one-time GitHub-side setup:\n` +
      `  - copy the pull request template, its description check and the workflow into .github/\n` +
      `  - create the labels and milestones named in ${bold('nice-and-tidy.config.json')}\n` +
      `  - create the project board from GitHub's own team-planning template\n` +
      `  - print, never run, the default-branch change when the branch model needs one\n\n` +
      `${dim('Nothing was created, changed or contacted. `init` works today and is independent of this.')}\n`,
  )
  return EXIT_NOT_IMPLEMENTED
}
