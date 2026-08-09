import { CONFIG_FILENAME, ConfigError, defaultConfig, readConfig } from '../config.js'
import { detectRepoSlug, findRepoRoot } from '../git.js'
import { readManifest } from '../manifest.js'
import { buildPayload, filesFor, inertTargets } from '../payload.js'
import { CONFLICT, KEPT, UNCHANGED, applyPlan, isConflict, planFiles } from '../plan.js'
import { globalScope, localScope } from '../scope.js'
import { ACTION_LABEL, CONFLICT_EXPLANATION, bold, createPrompter, dim, printDiff, yellow } from '../ui.js'

export const EXIT_OK = 0
export const EXIT_UNRESOLVED = 1
export const EXIT_USAGE = 2

/**
 * `init` and `diff` are the same walk over the same plan; `diff` just never writes and
 * never asks. Keeping them one function is what stops the report from drifting away
 * from what an install would actually do.
 */
export async function init(options) {
  const {
    cwd = process.cwd(),
    global: isGlobal = false,
    force = false,
    keepExisting = false,
    dryRun = false,
    gitflow,
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    input = process.stdin,
    output = process.stdout,
  } = options ?? {}

  const scope = isGlobal ? globalScope() : localScope((await findRepoRoot(cwd)) ?? cwd)

  let existing = null
  try {
    existing = await readConfig(scope.configPath)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    err(`${error.message}\n`)
    return EXIT_USAGE
  }

  const config = existing ? existing.config : await freshConfig(scope, cwd, gitflow)

  out(`${bold('nice-and-tidy')} ${dim('·')} ${scope.kind} install\n`)
  out(`${dim(`  ${scope.label}`)}\n\n`)

  for (const warning of existing?.warnings ?? []) out(`  ${yellow('warning')}  ${warning}\n`)
  if (existing && gitflow !== undefined && gitflow !== config.gitflow) {
    out(
      `  ${yellow('note')}     ${CONFIG_FILENAME} already sets "gitflow": ${config.gitflow}, and the config wins.\n` +
        `           Edit that key in the file to change it — a flag does not rewrite your config.\n`,
    )
  }

  const entries = await buildPayload(scope, config)
  const manifest = await readManifest(scope.manifestPath)
  const items = await planFiles(scope.root, entries, manifest)

  for (const item of items) {
    const suffix = item.action === KEPT ? dim('  (yours — never rewritten)') : ''
    out(`  ${ACTION_LABEL[item.action]}  ${item.path}${suffix}\n`)
  }

  const idle = items.every((item) => item.action === UNCHANGED || item.action === KEPT)
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

  if (conflicts.length > 0 && !dryRun) {
    if (force) {
      for (const item of conflicts) resolutions.set(item.path, 'overwrite')
    } else if (keepExisting) {
      // Recorded rather than left blank. Skipping because the user asked to and
      // skipping because nobody was around to ask look identical to `applyPlan`, but
      // only one of them is an answer — and only the other should fail the run.
      for (const item of conflicts) resolutions.set(item.path, 'skip')
    } else if (interactive) {
      const prompter = createPrompter({ input, output })
      try {
        for (const item of conflicts) {
          out(`\n  ${bold(item.path)}\n`)
          const answer = await prompter.ask()
          if (answer === 'abort') {
            out(`\n  aborted — nothing was written.\n`)
            return EXIT_UNRESOLVED
          }
          resolutions.set(item.path, answer === 'overwrite' ? 'overwrite' : 'skip')
        }
      } finally {
        prompter.close()
      }
    } else {
      err(
        `\nNothing was written. ${conflicts.length} file${conflicts.length === 1 ? '' : 's'} above ` +
          `${conflicts.length === 1 ? 'differs' : 'differ'} from what this would install, and there is no ` +
          `terminal here to ask on.\n` +
          `  --keep-existing   apply everything else and leave those files alone\n` +
          `  --force           overwrite them\n`,
      )
      return EXIT_UNRESOLVED
    }
  }

  const result = await applyPlan(items, {
    manifest,
    manifestPath: scope.manifestPath,
    resolutions,
    dryRun,
  })

  out(`\n${summarise(items, result, { dryRun, idle })}\n`)

  const inert = inertTargets(scope.kind, config.targets)
  if (inert.length > 0) {
    out(
      `${dim(`  ${inert.join(', ')} ${inert.length === 1 ? 'has' : 'have'} nothing to install at ${scope.kind} scope — skipped.`)}\n`,
    )
  }

  if (scope.kind === 'global') {
    const canonical = filesFor('global').find((file) => file.target === 'agents-md')?.path
    out(
      `\n  ${bold('One thing this did not do.')} Nothing loads a machine-wide AGENTS.md on its own.\n` +
        `  ${dim(`~/${canonical}`)} is a reference copy, not a hook. Per-repo installs are what\n` +
        `  agents actually read — run this inside a repository for that.\n`,
    )
  }

  const undecided = items.filter((item) => item.action === CONFLICT && !resolutions.has(item.path))
  return undecided.length > 0 && !dryRun ? EXIT_UNRESOLVED : EXIT_OK
}

async function freshConfig(scope, cwd, gitflow) {
  const overrides = {}
  if (gitflow !== undefined) overrides.gitflow = gitflow

  if (scope.kind === 'local') {
    const repo = await detectRepoSlug(cwd)
    if (repo) {
      overrides.repo = repo
      overrides.defaultAssignee = repo.split('/')[0]
    }
  }

  return defaultConfig(overrides)
}

function summarise(items, result, { dryRun, idle }) {
  if (idle) return dim('  Already up to date. Nothing to write.')

  const counted = (action) => items.filter((item) => item.action === action).length
  const parts = []
  if (counted('create') > 0) parts.push(`${counted('create')} created`)
  if (counted('update') > 0) parts.push(`${counted('update')} updated`)
  if (counted('adopt') > 0) parts.push(`${counted('adopt')} adopted`)

  const overwritten = result.written.filter((item) => item.action === CONFLICT).length
  if (overwritten > 0) parts.push(`${overwritten} overwritten`)

  const left = result.skipped.filter(isConflict).length
  if (left > 0) parts.push(`${left} left alone`)

  const body = parts.length > 0 ? parts.join(', ') : 'nothing to write'
  return dryRun ? dim(`  Plan: ${body}.`) : `  ${body}.`
}
