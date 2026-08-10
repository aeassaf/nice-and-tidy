import { readFile, writeFile } from 'node:fs/promises'

import { CONFIG_FILENAME, ConfigError, readConfig, serialiseConfig } from '../config.js'
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
    dryRun = false,
    gitflow,
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
    input = process.stdin,
    output = process.stdout,
  } = options ?? {}

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
    const backfill = await backfillConfig({
      configPath: scope.configPath,
      rawConfigText,
      force,
      keepExisting,
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
      dryRun,
      gitflow,
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
 * Adds config keys a newer release's `defaultConfig()` carries that the file on disk
 * predates — never removes or changes a key already present. `readConfig` already
 * computes exactly this shape (raw file merged over current defaults, including
 * nested `board`/`protocol` defaults); the diff against the raw file is entirely
 * "what's new," so nothing here needs to know which keys are actually new.
 */
async function backfillConfig({ configPath, rawConfigText, force, keepExisting, dryRun, interactive, prompter, out, err }) {
  if (rawConfigText === null) return SKIPPED

  let existing
  try {
    existing = await readConfig(configPath)
  } catch (error) {
    // A config that fails to parse or validate is `init`'s error to report, in the
    // one place that already does so consistently — not backfill's to duplicate.
    if (error instanceof ConfigError) return SKIPPED
    throw error
  }
  if (!existing) return SKIPPED

  const desiredText = serialiseConfig(existing.config)
  if (desiredText === rawConfigText) return SKIPPED

  out(`  ${yellow('config')}   ${CONFIG_FILENAME} predates keys this release adds:\n`)
  printDiff({ path: CONFIG_FILENAME, actual: rawConfigText, desired: desiredText }, out)

  if (dryRun) return SKIPPED

  if (keepExisting) {
    out(`\n  left ${CONFIG_FILENAME} alone (--keep-existing).\n`)
    return SKIPPED
  }

  if (force) {
    await writeFile(configPath, desiredText, 'utf8')
    out(`\n  added the missing keys to ${CONFIG_FILENAME}.\n`)
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
      out(`\n  added the missing keys to ${CONFIG_FILENAME}.\n`)
      return APPLIED
    }
    out(`\n  left ${CONFIG_FILENAME} alone.\n`)
    return SKIPPED
  }

  err(
    `\n${CONFIG_FILENAME} has keys available that are missing above, and there is no terminal here to ask on.\n` +
      `  --keep-existing   leave it alone\n` +
      `  --force           add the missing keys\n`,
  )
  return BLOCKED
}
