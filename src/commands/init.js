import {
  AGENT_TARGETS,
  CONFIG_FILENAME,
  ConfigError,
  agentsLabel,
  defaultConfig,
  parseAgents,
  readConfig,
  sameTargets,
} from '../config.js'
import { scanForeignConventions } from '../foreignConventions.js'
import { detectRepoSlug, findRepoRoot } from '../git.js'
import { readManifest } from '../manifest.js'
import { buildPayload, filesByTarget, filesFor, inertTargets, orphanedFiles } from '../payload.js'
import {
  CONFLICT,
  FORGET,
  KEPT,
  ORPHANED,
  UNCHANGED,
  applyPlan,
  isConflict,
  planFiles,
  planRemovals,
  stripsRegion,
} from '../plan.js'
import { ABORTED, NO_TERMINAL, resolveConflicts } from '../resolveConflicts.js'
import { globalScope, localScope } from '../scope.js'
import { ACTION_LABEL, ORPHAN_EXPLANATION, bold, createPrompter, dim, yellow } from '../ui.js'

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
    append = false,
    dryRun = false,
    gitflow,
    agents,
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    input = process.stdin,
    output = process.stdout,
    prompter: shared,
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

  // One prompter for the whole run. The agent question below and the conflict
  // questions later are two questions on the same stdin, and a second readline
  // interface on a stream the first one already paused gets EOF instead of an answer —
  // see createPrompter. A caller that opened its own (`upgrade`) passes it in.
  const prompter = shared ?? (interactive ? createPrompter({ input, output }) : null)

  try {
    out(`${bold('nice-and-tidy')} ${dim('·')} ${scope.kind} install\n`)
    out(`${dim(`  ${scope.label}`)}\n\n`)

    for (const warning of existing?.warnings ?? []) out(`  ${yellow('warning')}  ${warning}\n`)

    const chosen = existing
      ? null
      : (agents ?? (interactive && !dryRun ? await askForAgents({ kind: scope.kind, prompter, out }) : null))

    // A dry run with `--agents` was asked what those agents would mean, so it answers
    // that — planning against the config on disk instead would report on a command
    // nobody typed, and report "nothing to remove" for a run that removes two files.
    // A real run is refused below instead: `init` does not rewrite a config that exists.
    const previewing = existing !== null && agents !== undefined && dryRun

    const config = existing
      ? previewing
        ? { ...existing.config, targets: agents }
        : existing.config
      : await freshConfig(scope, cwd, gitflow, chosen)

    if (previewing) {
      out(
        `  ${dim(`note     showing --agents ${agentsLabel(agents)}. Nothing here writes to ${CONFIG_FILENAME} —`)}\n` +
          `  ${dim(`         \`nice-and-tidy upgrade --agents ${agentsLabel(agents)}\` is what changes it for real.`)}\n`,
      )
    }

    if (existing && gitflow !== undefined && gitflow !== config.gitflow) {
      out(
        `  ${yellow('note')}     ${CONFIG_FILENAME} already sets "gitflow": ${config.gitflow}, and the config wins.\n` +
          `           Edit that key in the file to change it — a flag does not rewrite your config.\n`,
      )
    }

    // Same precedent, one command further on. `init` does not rewrite a config that
    // already exists, but unlike `gitflow` there is a command that will — `upgrade`
    // already owns the one path that asks before touching the user's config, so this
    // points at it rather than sending somebody to a text editor.
    if (existing && agents !== undefined && !previewing && !sameTargets(agents, config.targets)) {
      out(
        `  ${yellow('note')}     ${CONFIG_FILENAME} already sets "targets", and the config wins.\n` +
          `           \`nice-and-tidy upgrade --agents ${agentsLabel(agents)}\` changes it — it asks first,\n` +
          `           then removes the files the dropped agents left behind.\n`,
      )
    }

    const entries = await buildPayload(scope, config)
    const manifest = await readManifest(scope.manifestPath)
    const items = await planFiles(scope.root, entries, manifest)

    // Computed even for `diff` and even under `--keep-existing`: a report that leaves
    // out what a run would take away is the drift this command is built not to have.
    const removals = await planRemovals(scope.root, orphanedFiles(scope.kind, config.targets), manifest)
    const applicable = keepExisting ? [] : removals

    for (const item of items) {
      const suffix = item.action === KEPT ? dim('  (yours — never rewritten)') : ''
      out(`  ${ACTION_LABEL[item.action]}  ${item.path}${suffix}\n`)
    }
    for (const item of listable(applicable)) {
      const suffix = stripsRegion(item) ? dim('  (its generated block only — the rest is yours)') : ''
      out(`  ${ACTION_LABEL[item.action]}  ${item.path}${suffix}\n`)
    }

    // Judged on `removals`, not `applicable`: a run holding files back under
    // `--keep-existing` has something to say about them, and "already up to date"
    // directly above "3 files left in place" is two answers to the same question.
    const idle =
      items.every((item) => item.action === UNCHANGED || item.action === KEPT) && listable(removals).length === 0

    const { outcome, resolutions } = await resolveConflicts(items, {
      force,
      keepExisting,
      append,
      dryRun,
      interactive,
      input,
      output,
      out,
      err,
      prompter,
    })
    if (outcome === ABORTED || outcome === NO_TERMINAL) return EXIT_UNRESOLVED

    const result = await applyPlan(items, {
      manifest,
      manifestPath: scope.manifestPath,
      resolutions,
      removals: applicable,
      dryRun,
    })

    out(
      `\n${summarise(items, result, {
        dryRun,
        idle,
        forgotten: applicable.filter((item) => item.action === FORGET).length,
        versionRecorded: !dryRun && result.manifest.generatorVersion !== manifest.generatorVersion,
      })}\n`,
    )

    for (const note of removalNotes(removals, { keepExisting })) out(`${dim(`  ${note}`)}\n`)

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

    if (scope.kind === 'local') {
      const foreign = await scanForeignConventions(scope.root)
      const flagged = foreign.filter((hit) => hit.exists && !hit.aligned)
      if (flagged.length > 0) {
        out(
          `\n  ${dim(
            `${flagged.length} older ${flagged.length === 1 ? 'file' : 'files'} here (${flagged
              .map((hit) => hit.path)
              .join(', ')}) may still conflict with AGENTS.md — run \`nice-and-tidy clean\` to review ${
              flagged.length === 1 ? 'it' : 'them'
            }.`,
          )}\n`,
        )
      }
    }

    const undecided = items.filter((item) => item.action === CONFLICT && !resolutions.has(item.path))
    return undecided.length > 0 && !dryRun ? EXIT_UNRESOLVED : EXIT_OK
  } finally {
    if (!shared) prompter?.close()
  }
}

/**
 * The one question `init` asks before it knows what to build, and only when there is
 * nothing on disk to answer it: a config that already exists is the answer.
 *
 * Enter takes every agent, which is what this did before the question existed. The
 * prompt is an offer — a run that cannot ask, or one nobody answers, installs
 * everything exactly as it always has.
 */
async function askForAgents({ kind, prompter, out }) {
  const grouped = filesByTarget(kind)
  const offered = AGENT_TARGETS.filter((target) => grouped.has(target))
  if (offered.length === 0) return null

  const width = Math.max(...offered.map((target) => target.length))

  out(`  ${bold('Which agents is this for?')}\n\n`)
  for (const target of offered) {
    out(`    ${target.padEnd(width)}  ${dim(grouped.get(target).join(', '))}\n`)
  }
  out(
    `\n  ${dim(
      `${grouped.get('agents-md')?.[0] ?? 'AGENTS.md'} is written either way — every one of these is a pointer to it.`,
    )}\n\n`,
  )

  // Three tries, then take the default. A wrong answer deserves a second go; an
  // unparseable stream answering three times running is not somebody typing.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const answer = await prompter.line(`  ${bold('agents')}? [names, "all", or "none" — Enter for all] `)
    if (answer === null) break
    if (answer === '') break

    const parsed = parseAgents(answer)
    if (parsed.targets) {
      out(`\n`)
      return parsed.targets
    }
    out(`  ${yellow(parsed.error)}\n`)
  }

  out(`\n  ${dim('installing for all of them.')}\n\n`)
  return null
}

async function freshConfig(scope, cwd, gitflow, targets) {
  const overrides = {}
  if (gitflow !== undefined) overrides.gitflow = gitflow
  if (targets) overrides.targets = targets

  if (scope.kind === 'local') {
    const repo = await detectRepoSlug(cwd)
    if (repo) {
      overrides.repo = repo
      overrides.defaultAssignee = repo.split('/')[0]
    }
  }

  return defaultConfig(overrides)
}

/** Removals worth printing a line for. `forget` has no file behind it to report. */
const listable = (removals) => removals.filter((item) => item.action !== FORGET)

/**
 * What a removal walk left behind and why — the files this refuses to delete, and the
 * ones a flag told it not to. Both are cases where saying nothing would read as "there
 * was nothing there."
 */
function removalNotes(removals, { keepExisting }) {
  const notes = []

  if (keepExisting) {
    const held = listable(removals)
    if (held.length > 0) {
      notes.push(
        `${held.length} ${held.length === 1 ? 'file belongs' : 'files belong'} to agents your config no longer ` +
          `lists — left in place (--keep-existing): ${held.map((item) => item.path).join(', ')}.`,
      )
    }
    return notes
  }

  for (const item of removals.filter((item) => item.action === ORPHANED)) {
    notes.push(`${item.path} — ${ORPHAN_EXPLANATION[item.reason]}.`)
  }
  return notes
}

function summarise(items, result, { dryRun, idle, forgotten, versionRecorded }) {
  if (idle) {
    // Every file is untouched, but the manifest can still change — and a repo that
    // commits it would otherwise see a dirty file after a run that just claimed there
    // was nothing to write. Two different reasons, said apart: a version bump is not
    // the same event as dropping the record of a file somebody deleted themselves, and
    // one message covering both would be right about half the runs that print it.
    const why = []
    if (versionRecorded) why.push('recorded the version this ran with')
    if (forgotten > 0) {
      why.push(`forgot ${forgotten} ${forgotten === 1 ? 'entry' : 'entries'} for files that are already gone`)
    }
    return dim(`  Already up to date. Nothing to write.${why.length > 0 ? ` (${why.join(', ')}.)` : ''}`)
  }

  const counted = (action) => items.filter((item) => item.action === action).length
  const parts = []
  if (counted('create') > 0) parts.push(`${counted('create')} created`)
  if (counted('update') > 0) parts.push(`${counted('update')} updated`)
  if (counted('adopt') > 0) parts.push(`${counted('adopt')} adopted`)

  const resolved = (how) => result.written.filter((item) => item.action === CONFLICT && item.resolution === how).length
  if (resolved('overwrite') > 0) parts.push(`${resolved('overwrite')} overwritten`)
  if (resolved('append') > 0) parts.push(`${resolved('append')} appended to`)

  // Two different removals, counted apart. "3 removed" over a file that is still
  // sitting there minus one block would be a lie about somebody's disk.
  const deleted = result.removed.filter((item) => !stripsRegion(item)).length
  const stripped = result.removed.filter(stripsRegion).length
  if (deleted > 0) parts.push(`${deleted} removed`)
  if (stripped > 0) parts.push(`${stripped} ${stripped === 1 ? 'block' : 'blocks'} taken out`)

  const left = result.skipped.filter(isConflict).length
  if (left > 0) parts.push(`${left} left alone`)

  const orphans = result.skipped.filter((item) => item.action === ORPHANED).length
  if (orphans > 0) parts.push(`${orphans} orphaned`)

  const body = parts.length > 0 ? parts.join(', ') : 'nothing to write'
  return dryRun ? dim(`  Plan: ${body}.`) : `  ${body}.`
}
