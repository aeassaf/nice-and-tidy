import { isConflict } from './plan.js'
import { CONFLICT_EXPLANATION, bold, createPrompter, dim, printDiff, yellow } from './ui.js'

export const ABORTED = 'aborted'
export const NO_TERMINAL = 'no-terminal'
export const RESOLVED = 'resolved'

/**
 * The conflict-reporting-and-resolution walk `init` and `bootstrap` both need,
 * pulled out once rather than kept as two copies that drift. `init`'s own docstring
 * already states the principle this follows: two commands doing "the same walk" stay
 * one function, or the report drifts from what a run actually does.
 *
 * Returns `{ outcome, resolutions }`. `outcome` is `RESOLVED` (proceed to apply,
 * `resolutions` may still be empty if nothing conflicted), `ABORTED` (a person typed
 * "a" — nothing should be written), or `NO_TERMINAL` (conflicts exist, nothing was
 * there to ask, `--force`/`--keep-existing` are the way out).
 */
export async function resolveConflicts(items, { force, keepExisting, dryRun, interactive, input, output, out, err }) {
  const conflicts = items.filter(isConflict)

  if (conflicts.length > 0) {
    const noun = `${conflicts.length} file${conflicts.length === 1 ? '' : 's'}`
    out(
      `\n${yellow(
        dryRun
          ? `${noun} ${conflicts.length === 1 ? 'differs' : 'differ'} from what an install would write:`
          : `${noun} would be overwritten:`,
      )}\n`,
    )
    for (const item of conflicts) {
      out(`\n  ${bold(item.path)} ${dim(`— ${CONFLICT_EXPLANATION[item.reason]}`)}\n`)
      printDiff(item, out)
    }
  }

  const resolutions = new Map()
  if (conflicts.length === 0 || dryRun) return { outcome: RESOLVED, resolutions }

  if (force) {
    for (const item of conflicts) resolutions.set(item.path, 'overwrite')
    return { outcome: RESOLVED, resolutions }
  }

  if (keepExisting) {
    for (const item of conflicts) resolutions.set(item.path, 'skip')
    return { outcome: RESOLVED, resolutions }
  }

  if (interactive) {
    const prompter = createPrompter({ input, output })
    try {
      for (const item of conflicts) {
        out(`\n  ${bold(item.path)}\n`)
        const answer = await prompter.ask()
        if (answer === 'abort') {
          out(`\n  aborted — nothing was written.\n`)
          return { outcome: ABORTED, resolutions }
        }
        resolutions.set(item.path, answer === 'overwrite' ? 'overwrite' : 'skip')
      }
    } finally {
      prompter.close()
    }
    return { outcome: RESOLVED, resolutions }
  }

  err(
    `\nNothing was written. ${conflicts.length} file${conflicts.length === 1 ? '' : 's'} above ` +
      `${conflicts.length === 1 ? 'differs' : 'differ'} from what this would install, and there is no ` +
      `terminal here to ask on.\n` +
      `  --keep-existing   apply everything else and leave those files alone\n` +
      `  --force           overwrite them\n`,
  )
  return { outcome: NO_TERMINAL, resolutions }
}
