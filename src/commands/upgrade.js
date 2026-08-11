import { readFile, writeFile } from 'node:fs/promises'

import { CONFIG_FILENAME, ConfigError, agentsLabel, readConfig, sameTargets, serialiseConfig } from '../config.js'
import { findRepoRoot } from '../git.js'
import { readManifest } from '../manifest.js'
import { EXIT_UNRESOLVED, EXIT_USAGE, init } from './init.js'
import { createPrompter, printDiff, bold, dim, yellow } from '../ui.js'
import { globalScope, localScope } from '../scope.js'
import { compareVersions, packageVersion } from '../version.js'

/**
 * `init` is already re-runnable — see its own docstring — so pulling in a newer
 * release is, mechanically, just running it again. `upgrade` wraps that with the two
 * things a plain re-run cannot do on its own:
 *
 *   - say which version wrote what's here and which version is about to replace it
 *   - notice that a newer release added config keys an existing config predates, and
 *     offer to add them — `nice-and-tidy.config.json` is user-owned and `init` never
 *     touches it once it exists, so nothing else will ever do this
 *
 * Everything else — the file plan, the conflict prompts, `--force`/`--keep-existing`
 * — is `init`'s, unchanged. This function delegates to it rather than re-implement
 * any of it.
 */
export async function upgrade(options) {
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
  } = options ?? {}

  // `--agents` asks for the config to change; these two say don't touch anything. One
  // of them has to lose, and picking a winner silently is worse than saying so — a run
  // that quietly ignored `--agents` would go on installing for agents somebody just
  // asked it to stop installing for.
  if (agents !== undefined && (keepExisting || append)) {
    const flag = keepExisting ? '--keep-existing' : '--append'
    err(
      `Pass --agents or ${flag}, not both — --agents changes "targets" in ${CONFIG_FILENAME}, ` +
        `and ${flag} says leave files as they are.\n`,
    )
    return EXIT_USAGE
  }

  const scope = isGlobal ? globalScope() : localScope((await findRepoRoot(cwd)) ?? cwd)

  const manifest = await readManifest(scope.manifestPath)
  const hasManifest = Object.keys(manifest.files).length > 0

  let rawConfigText = null
  try {
    rawConfigText = await readFile(scope.configPath, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  if (!hasManifest && rawConfigText === null) {
    err(`Nothing installed at ${scope.label} — run \`nice-and-tidy init\` first.\n`)
    return EXIT_USAGE
  }

  const currentVersion = await packageVersion()
  const previousVersion = manifest.generatorVersion

  out(`${bold('nice-and-tidy')} ${dim('·')} upgrade ${dim('·')} ${scope.kind}\n`)
  out(`${dim(`  ${scope.label}`)}\n`)
  out(`  ${previousVersion ?? dim('unknown')} → ${currentVersion}\n\n`)

  if (previousVersion) {
    const cmp = compareVersions(currentVersion, previousVersion)
    if (cmp !== null && cmp < 0 && !force) {
      err(
        `This checkout runs nice-and-tidy ${currentVersion}, older than the ${previousVersion} already\n` +
          `installed at ${scope.label}. Running an older release over a newer install is not supported.\n` +
          `  --force   proceed anyway\n`,
      )
      return EXIT_USAGE
    }
  }

  // One prompter for the whole run, created here and passed down to both the config
  // backfill question below and to `init`'s own conflict prompts. Two readline
  // interfaces opened on the same stdin is the exact failure createPrompter's own
  // docstring warns about: the second one gets EOF instead of an answer.
  const prompter = interactive ? createPrompter({ input, output }) : null
  try {
    const backfill = await rewriteConfig({
      configPath: scope.configPath,
      rawConfigText,
      agents,
      force,
      keepExisting,
      append,
      dryRun,
      interactive,
      prompter,
      out,
      err,
    })
    if (backfill === BLOCKED) return EXIT_UNRESOLVED

    return await init({
      cwd,
      global: isGlobal,
      force,
      keepExisting,
      append,
      dryRun,
      gitflow,
      // Only forwarded when there was no config for it to have been written into.
      // Otherwise the file on disk is now the answer — either it was just rewritten
      // above, or the question was asked and declined, and `init`'s "the config wins"
      // note would be a second, contradictory answer to something already settled.
      agents: rawConfigText === null ? agents : undefined,
      interactive,
      out,
      err,
      input,
      output,
      prompter,
    })
  } finally {
    prompter?.close()
  }
}

const SKIPPED = 'skipped'
const APPLIED = 'applied'
const BLOCKED = 'blocked'

/**
 * The one place anything rewrites a config the user owns, for the two reasons there
 * are to.
 *
 * The first is automatic: a newer release's `defaultConfig()` carries keys the file on
 * disk predates. `readConfig` already computes exactly that shape — raw file merged
 * over current defaults, nested objects included — so the diff against the raw text is
 * entirely "what's new," and nothing here needs to know which keys those are. Keys
 * already present are never removed or changed.
 *
 * The second is asked for: `--agents` sets `targets`. That one *does* change a key the
 * user set, which is why it lives behind the same prompt rather than in `init` — and
 * why the diff is shown before the question either way.
 */
async function rewriteConfig({
  configPath,
  rawConfigText,
  agents,
  force,
  keepExisting,
  append,
  dryRun,
  interactive,
  prompter,
  out,
  err,
}) {
  if (rawConfigText === null) return SKIPPED

  let existing
  try {
    existing = await readConfig(configPath)
  } catch (error) {
    // A config that fails to parse or validate is `init`'s error to report, in the
    // one place that already does so consistently — not this function's to duplicate.
    if (error instanceof ConfigError) return SKIPPED
    throw error
  }
  if (!existing) return SKIPPED

  const merged = serialiseConfig(existing.config)
  const retargeted = agents !== undefined && !sameTargets(agents, existing.config.targets)
  const desiredText = retargeted ? serialiseConfig({ ...existing.config, targets: agents }) : merged

  if (agents !== undefined && !retargeted) {
    out(`  ${dim(`config   ${CONFIG_FILENAME} already installs for ${agentsLabel(agents)} — nothing to change there.`)}\n`)
  }
  if (desiredText === rawConfigText) return SKIPPED

  const change = describe({ retargeted, agents, backfilled: merged !== rawConfigText })
  out(`  ${yellow('config')}   ${CONFIG_FILENAME} ${change.why}:\n`)
  printDiff({ path: CONFIG_FILENAME, actual: rawConfigText, desired: desiredText }, out)

  if (dryRun) return SKIPPED

  if (keepExisting) {
    out(`\n  left ${CONFIG_FILENAME} alone (--keep-existing).\n`)
    return SKIPPED
  }

  // `--append` is an answer about instruction files, and it has no meaning here: a
  // config is JSON, with nowhere to put a block. Treating it as "leave it alone" is
  // what keeps `upgrade --append` usable without a terminal — the alternative is
  // blocking the whole run on a question this flag was never about. `--force` is
  // still the way to take the new keys.
  if (append) {
    out(`\n  left ${CONFIG_FILENAME} alone — --append has nothing to add to a config file.\n`)
    return SKIPPED
  }

  if (force) {
    await writeFile(configPath, desiredText, 'utf8')
    out(`\n  ${change.done} ${CONFIG_FILENAME}.\n`)
    return APPLIED
  }

  if (interactive) {
    out(`\n  ${bold(CONFIG_FILENAME)}\n`)
    const answer = await prompter.ask()
    if (answer === 'abort') {
      out(`\n  aborted — nothing was written.\n`)
      return BLOCKED
    }
    if (answer === 'overwrite') {
      await writeFile(configPath, desiredText, 'utf8')
      out(`\n  ${change.done} ${CONFIG_FILENAME}.\n`)
      return APPLIED
    }
    out(`\n  left ${CONFIG_FILENAME} alone.\n`)
    return SKIPPED
  }

  err(
    `\n${CONFIG_FILENAME} ${change.blocked}, and there is no terminal here to ask on.\n` +
      (agents === undefined ? `  --keep-existing   leave it alone\n` : '') +
      `  --force           ${change.force}\n`,
  )
  return BLOCKED
}

/**
 * The same config write has two reasons behind it and they are not interchangeable —
 * "added the missing keys" printed over a run that just dropped two agents would be a
 * false account of what happened to somebody's repo. One place decides the wording so
 * the heading, the confirmation and the no-terminal message can never disagree.
 */
function describe({ retargeted, agents, backfilled }) {
  if (retargeted && backfilled) {
    return {
      why: `would install for ${agentsLabel(agents)} instead, and predates keys this release adds`,
      done: `set "targets" and added the missing keys to`,
      blocked: `would change "targets" and gain keys this release adds`,
      force: 'apply both',
    }
  }
  if (retargeted) {
    return {
      why: `would install for ${agentsLabel(agents)} instead`,
      done: `set "targets" in`,
      blocked: `would change "targets"`,
      force: 'change it',
    }
  }
  return {
    why: 'predates keys this release adds',
    done: 'added the missing keys to',
    blocked: 'has keys available that are missing above',
    force: 'add the missing keys',
  }
}
