import { canAppend, isConflict } from './plan.js'
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
 * there to ask, `--force`/`--keep-existing`/`--append` are the way out).
 */
export async function resolveConflicts(
  items,
  { force, keepExisting, append, dryRun, interactive, input, output, out, err, prompter: shared },
) {
  const conflicts = items.filter(isConflict)
  const appendable = conflicts.filter(canAppend)

  if (conflicts.length > 0) {
    out(`\n${yellow(heading(conflicts, { dryRun, append }))}\n`)
    for (const item of conflicts) {
      out(`\n  ${bold(item.path)} ${dim(`— ${CONFLICT_EXPLANATION[item.reason]}`)}\n`)
      // The diff shown is of the answer about to be given, not of overwriting
      // regardless: under `--append` these are different files, and a report that
      // showed one while the run did the other would be the drift this module exists
      // to prevent.
      printDiff({ ...item, desired: append && canAppend(item) ? item.appendWrite : item.write }, out)
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

  if (append) {
    for (const item of conflicts) resolutions.set(item.path, canAppend(item) ? 'append' : 'skip')
    for (const note of refusals(conflicts)) out(`\n  ${dim(note)}\n`)
    return { outcome: RESOLVED, resolutions }
  }

  if (interactive) {
    // A caller that already opened a prompter for its own question (`upgrade`'s
    // config backfill) passes it in so this reuses it instead of opening a second
    // readline interface on the same stdin — see createPrompter's own note on why a
    // second one silently loses every answer after the first.
    const prompter = shared ?? createPrompter({ input, output })
    try {
      for (const item of conflicts) {
        out(`\n  ${bold(item.path)}\n`)
        const answer = await prompter.ask({ allowAppend: canAppend(item) })
        if (answer === 'abort') {
          out(`\n  aborted — nothing was written.\n`)
          return { outcome: ABORTED, resolutions }
        }
        resolutions.set(item.path, answer === 'overwrite' || answer === 'append' ? answer : 'skip')
      }
    } finally {
      if (!shared) prompter.close()
    }
    return { outcome: RESOLVED, resolutions }
  }

  err(
    `\nNothing was written. ${conflicts.length} file${conflicts.length === 1 ? '' : 's'} above ` +
      `${conflicts.length === 1 ? 'differs' : 'differ'} from what this would install, and there is no ` +
      `terminal here to ask on.\n` +
      `  --keep-existing   apply everything else and leave those files alone\n` +
      `  --force           overwrite them\n` +
      (appendable.length > 0
        ? `  --append          add the generated block to the end of ${
            appendable.length === conflicts.length ? 'them' : `the ${appendable.length} that can take one`
          }, leaving what's there alone\n`
        : ''),
  )
  return { outcome: NO_TERMINAL, resolutions }
}

/**
 * Why a conflict was left alone under `--append`, for the two reasons that are not the
 * same reason. Saying "cannot take a block" about a file that plainly could would be
 * the kind of almost-true message that costs somebody an afternoon.
 */
function refusals(conflicts) {
  const refused = conflicts.filter((item) => !canAppend(item))
  const shape = refused.filter((item) => !item.appendable).map((item) => item.path)
  const ours = refused.filter((item) => item.appendable).map((item) => item.path)

  return [
    shape.length > 0 &&
      `${shape.join(', ')} cannot take an appended block — ${shape.length === 1 ? 'its' : 'their'} generated ` +
        `content only means anything at the top of a file. Left alone.`,
    ours.length > 0 &&
      `${ours.join(', ')} ${ours.length === 1 ? 'was' : 'were'} written by this tool and then edited, so ` +
        `appending would leave two copies of the same content. Left alone — --force takes this release's ` +
        `version, or answer per file in a terminal.`,
  ].filter(Boolean)
}

function heading(conflicts, { dryRun, append }) {
  const noun = `${conflicts.length} file${conflicts.length === 1 ? '' : 's'}`
  if (dryRun) {
    return `${noun} ${conflicts.length === 1 ? 'differs' : 'differ'} from what an install would write:`
  }
  if (append) return `${noun} already ${conflicts.length === 1 ? 'exists' : 'exist'} and would gain a generated block:`
  return `${noun} would be overwritten:`
}
