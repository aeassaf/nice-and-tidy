import { buildBootstrapPayload } from '../bootstrapPayload.js'
import { CONFIG_FILENAME, ConfigError, readConfig } from '../config.js'
import { findRepoRoot } from '../git.js'
import { authStatus, createLabel, createMilestone, existingLabels, existingMilestones, gh as ghExec } from '../gh.js'
import { readManifest } from '../manifest.js'
import { CONFLICT, KEPT, UNCHANGED, applyPlan, planFiles } from '../plan.js'
import { ABORTED, NO_TERMINAL, resolveConflicts } from '../resolveConflicts.js'
import { localScope } from '../scope.js'
import { ACTION_LABEL, bold, dim, green, yellow } from '../ui.js'

export const EXIT_OK = 0
export const EXIT_UNRESOLVED = 1
export const EXIT_USAGE = 2
export const EXIT_NOT_READY = 3

/**
 * The one-time GitHub-side setup: the PR template, its description gate and the
 * workflow that runs it, land through the same plan/manifest pipeline `init` uses —
 * one provenance record for everything this tool writes, a hand-edited template
 * diffed and asked about exactly like a hand-edited `AGENTS.md`. Labels and
 * milestones are separate GitHub API calls with no local file to diff, so they get
 * their own "skip what already exists" logic instead.
 *
 * What this does not do: the Project board (a separate, larger piece of setup — see
 * `docs/RESUME_HERE.md`) and flipping the default branch, which it only ever prints.
 */
export async function bootstrap(options) {
  const {
    cwd = process.cwd(),
    force = false,
    keepExisting = false,
    dryRun = false,
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    input = process.stdin,
    output = process.stdout,
    exec = ghExec,
  } = options ?? {}

  const scope = localScope((await findRepoRoot(cwd)) ?? cwd)

  let existing
  try {
    existing = await readConfig(scope.configPath)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    err(`${error.message}\n`)
    return EXIT_USAGE
  }
  if (!existing) {
    err(`No ${CONFIG_FILENAME} here yet. Run \`nice-and-tidy init\` first — bootstrap reads its config.\n`)
    return EXIT_USAGE
  }
  const { config } = existing

  if (!config.repo) {
    err(
      `"repo" is not set in ${CONFIG_FILENAME}. bootstrap needs an "owner/name" to create labels, ` +
        `milestones and the PR template against — set it and run init again first.\n`,
    )
    return EXIT_USAGE
  }

  const ready = await authStatus(exec)
  if (!ready.ok) {
    err(
      `${yellow('gh is not ready.')} ${ready.reason}\n\n` +
        `bootstrap needs \`gh\` installed and logged in (\`gh auth login\`) — nothing was created,\n` +
        `changed or contacted.\n`,
    )
    return EXIT_NOT_READY
  }

  out(`${bold('nice-and-tidy bootstrap')} ${dim('·')} ${config.repo}\n\n`)

  // --- files: the PR template, the description gate, the workflows ------------

  const entries = await buildBootstrapPayload(config)
  const manifest = await readManifest(scope.manifestPath)
  const items = await planFiles(scope.root, entries, manifest)

  for (const item of items) {
    const suffix = item.action === KEPT ? dim('  (yours — never rewritten)') : ''
    out(`  ${ACTION_LABEL[item.action]}  ${item.path}${suffix}\n`)
  }

  const idle = items.every((item) => item.action === UNCHANGED || item.action === KEPT)

  const { outcome, resolutions } = await resolveConflicts(items, {
    force,
    keepExisting,
    dryRun,
    interactive,
    input,
    output,
    out,
    err,
  })
  if (outcome === ABORTED || outcome === NO_TERMINAL) return EXIT_UNRESOLVED

  const result = await applyPlan(items, {
    manifest,
    manifestPath: scope.manifestPath,
    resolutions,
    dryRun,
  })

  out(`\n${summariseFiles(items, result, { dryRun, idle })}\n`)

  // --- labels -------------------------------------------------------------------

  out(`\n${bold('Labels')}\n`)
  await syncNamed({
    wanted: config.labels,
    fetchExisting: () => existingLabels(config.repo, exec),
    create: (name) => createLabel(config.repo, name, exec),
    noun: 'label',
    dryRun,
    out,
  })

  // --- milestones -----------------------------------------------------------

  out(`\n${bold('Milestones')}\n`)
  await syncNamed({
    wanted: config.milestones,
    fetchExisting: () => existingMilestones(config.repo, exec),
    create: (title) => createMilestone(config.repo, title, exec),
    noun: 'milestone',
    dryRun,
    out,
  })

  // --- the default-branch flip: printed, never run ---------------------------

  if (config.gitflow) {
    out(
      `\n${bold('Not run — a repo setting, a human decision:')}\n` +
        `  ${dim(`gh repo edit ${config.repo} --default-branch develop`)}\n` +
        `  Needed for \`Closes #N\` to auto-close once everyday PRs land on develop instead of main.\n` +
        `  See docs/BRANCHING.md.\n`,
    )
  }

  const undecided = items.filter((item) => item.action === CONFLICT && !resolutions.has(item.path))
  return undecided.length > 0 && !dryRun ? EXIT_UNRESOLVED : EXIT_OK
}

/**
 * Shared shape for labels and milestones: fetch what already exists, create only
 * what's missing from config, report both. Neither GitHub API errors on a duplicate
 * cleanly enough to rely on — "ask first" is what makes this idempotent, the same
 * principle the manifest applies to files.
 */
async function syncNamed({ wanted, fetchExisting, create, noun, dryRun, out }) {
  if (wanted.length === 0) {
    out(`  ${dim(`none configured — nothing to do.`)}\n`)
    return
  }

  const existing = await fetchExisting()
  const missing = wanted.filter((name) => !existing.has(name))

  for (const name of wanted) {
    if (!existing.has(name)) continue
    out(`  ${dim('exists   ')}  ${name}\n`)
  }

  if (dryRun) {
    for (const name of missing) out(`  ${green('would create')}  ${name}\n`)
    return
  }

  for (const name of missing) {
    await create(name)
    out(`  ${green('created  ')}  ${name}\n`)
  }

  if (missing.length === 0 && wanted.length > 0) out(`  ${dim(`all ${wanted.length} ${noun}s already exist.`)}\n`)
}

function summariseFiles(items, result, { dryRun, idle }) {
  if (idle) return dim('  Already up to date. Nothing to write.')

  const counted = (action) => items.filter((item) => item.action === action).length
  const parts = []
  if (counted('create') > 0) parts.push(`${counted('create')} created`)
  if (counted('update') > 0) parts.push(`${counted('update')} updated`)
  if (counted('adopt') > 0) parts.push(`${counted('adopt')} adopted`)

  const overwritten = result.written.filter((item) => item.action === CONFLICT).length
  if (overwritten > 0) parts.push(`${overwritten} overwritten`)

  const left = result.skipped.filter((item) => item.action === CONFLICT).length
  if (left > 0) parts.push(`${left} left alone`)

  const body = parts.length > 0 ? parts.join(', ') : 'nothing to write'
  return dryRun ? dim(`  Plan: ${body}.`) : `  ${body}.`
}
