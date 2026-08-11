import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { scanForeignConventions } from '../foreignConventions.js'
import { findRepoRoot } from '../git.js'
import { localScope } from '../scope.js'
import { render } from '../template.js'
import { bold, createPrompter, dim, printDiff, yellow } from '../ui.js'

export const EXIT_OK = 0
export const EXIT_UNRESOLVED = 1

const POINTER_TEMPLATE = new URL('../../templates/shims/pointer.md.tmpl', import.meta.url)

/**
 * `clean` is not `init`'s conflict walk with a different noun. `init` diffs a payload
 * file against content it knows how to regenerate, with a manifest to tell "someone
 * edited it" apart from "config changed." A foreign convention file has none of
 * that; there is nothing to regenerate, no provenance to record, only "does this
 * already point at AGENTS.md or not." So this reuses `ui.js`'s display and prompting
 * primitives directly and skips `plan.js`/the manifest entirely.
 */
export async function clean(options) {
  const {
    cwd = process.cwd(),
    force = false,
    dryRun = false,
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    input = process.stdin,
    output = process.stdout,
  } = options ?? {}

  const scope = localScope((await findRepoRoot(cwd)) ?? cwd)

  out(`${bold('nice-and-tidy clean')} ${dim('·')} deprecated agent convention files\n`)
  out(`${dim(`  ${scope.root}`)}\n\n`)

  const flagged = await findFlagged(scope.root)

  if (flagged.length === 0) {
    out(`  Nothing found. No deprecated agent convention file conflicts with AGENTS.md here.\n`)
    return EXIT_OK
  }

  const noun = `${flagged.length} file${flagged.length === 1 ? '' : 's'}`
  const pointer = await pointerStub()

  out(`${yellow(`${noun} may conflict with what AGENTS.md now says:`)}\n`)
  for (const hit of flagged) {
    out(`\n  ${bold(hit.path)} ${dim(`; ${hit.why}`)}\n`)
    printDiff({ path: hit.path, actual: hit.content, desired: pointer }, out)
  }

  if (dryRun) {
    out(`\n${dim(`  Plan: replace ${noun} with a pointer to AGENTS.md.`)}\n`)
    return EXIT_OK
  }

  const decision = await decide(flagged, { force, interactive, input, output, out })

  if (decision === ABORTED) {
    out(`\n  aborted; nothing was written.\n`)
    return EXIT_UNRESOLVED
  }
  if (decision === NO_TERMINAL) {
    err(
      `\nNothing was written. ${noun} above may conflict, and there is no terminal here to ask on.\n` +
        `  --force   replace all of them with a pointer to AGENTS.md\n`,
    )
    return EXIT_UNRESOLVED
  }

  for (const hit of decision) {
    await writeFile(join(scope.root, hit.path), pointer, 'utf8')
  }

  out(`\n  ${decision.length} replaced, ${flagged.length - decision.length} left alone.\n`)
  return EXIT_OK
}

async function findFlagged(root) {
  const hits = await scanForeignConventions(root)
  return hits.filter((hit) => hit.exists && !hit.aligned)
}

async function pointerStub() {
  const source = await readFile(POINTER_TEMPLATE, 'utf8')
  return render(source, {}, { origin: 'templates/shims/pointer.md.tmpl' })
}

const ABORTED = 'aborted'
const NO_TERMINAL = 'no-terminal'

/** Returns the subset of `flagged` to replace, or the `ABORTED`/`NO_TERMINAL` sentinel. */
async function decide(flagged, { force, interactive, input, output, out }) {
  if (force) return flagged
  if (!interactive) return NO_TERMINAL

  const prompter = createPrompter({ input, output })
  const toReplace = []
  try {
    for (const hit of flagged) {
      out(`\n  ${bold(hit.path)}\n`)
      const answer = await prompter.ask()
      if (answer === 'abort') return ABORTED
      if (answer === 'overwrite') toReplace.push(hit)
    }
  } finally {
    prompter.close()
  }
  return toReplace
}
