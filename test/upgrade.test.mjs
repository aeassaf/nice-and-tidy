/**
 * `upgrade`, through the real binary; `init` is already tested end to end in
 * cli.test.mjs, so these only cover what `upgrade` adds on top of it: the version
 * banner, the downgrade guard, and backfilling config keys a file predates.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { upgrade } from '../src/commands/upgrade.js'
import { CLI, tempDir } from './helpers.mjs'

const exec = promisify(execFile)

async function cli(args, { cwd, env = {} } = {}) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, NO_COLOR: '1', ...env },
    })
    return { code: 0, stdout, stderr }
  } catch (error) {
    return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
  }
}

const CONFIG = 'nice-and-tidy.config.json'
const MANIFEST = '.nice-and-tidy/manifest.json'

test('upgrade with nothing installed points at init instead of guessing', async (t) => {
  const cwd = await tempDir(t)
  const { code, stderr } = await cli(['upgrade'], { cwd })

  assert.equal(code, 2)
  assert.match(stderr, /run `nice-and-tidy init` first/)
})

test('upgrade after init is the same no-op init already is, plus a version line', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stdout } = await cli(['upgrade'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /Already up to date/)
  assert.match(stdout, /→/)
})

test('upgrade records the running version in the manifest', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const manifest = JSON.parse(await readFile(join(cwd, MANIFEST), 'utf8'))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.generatorVersion, pkg.version)
})

test('upgrade refuses to run an older release over a newer install', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const manifestPath = join(cwd, MANIFEST)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.generatorVersion = '99.0.0'
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const { code, stderr } = await cli(['upgrade'], { cwd })

  assert.equal(code, 2)
  assert.match(stderr, /older than the 99\.0\.0 already/)
})

test('--force runs an upgrade anyway, over a manifest that claims a newer version', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const manifestPath = join(cwd, MANIFEST)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.generatorVersion = '99.0.0'
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const { code } = await cli(['upgrade', '--force'], { cwd })

  assert.equal(code, 0)
})

// --- config backfill ------------------------------------------------------------

test('a config missing a key the current release defaults is offered a backfill', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const configPath = join(cwd, CONFIG)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  delete config.scopes
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const { code, stdout, stderr } = await cli(['upgrade'], { cwd })

  assert.equal(code, 1, 'no terminal to ask on, and no flag decided it')
  assert.match(stdout, /predates keys this release adds/)
  assert.match(stderr, /--force/)
  assert.match(stderr, /--keep-existing/)
  assert.ok(!('scopes' in JSON.parse(await readFile(configPath, 'utf8'))), 'nothing was written without a decision')
})

test('--force backfills the missing config key', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const configPath = join(cwd, CONFIG)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  delete config.scopes
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const { code } = await cli(['upgrade', '--force'], { cwd })

  assert.equal(code, 0)
  const after = JSON.parse(await readFile(configPath, 'utf8'))
  assert.deepEqual(after.scopes, [])
})

test('--keep-existing leaves the config alone and still applies the rest', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const configPath = join(cwd, CONFIG)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  delete config.scopes
  const mine = `${JSON.stringify(config, null, 2)}\n`
  await writeFile(configPath, mine)

  const { code } = await cli(['upgrade', '--keep-existing'], { cwd })

  assert.equal(code, 0)
  assert.equal(await readFile(configPath, 'utf8'), mine)
})

test('--append leaves the config alone rather than blocking on a question it is not about', async (t) => {
  // A config is JSON, with nowhere to put a block. Refusing the whole run over that
  // would make `upgrade --append` unusable without a terminal, which is the one place
  // the flag exists for.
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const configPath = join(cwd, CONFIG)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  delete config.scopes
  const mine = `${JSON.stringify(config, null, 2)}\n`
  await writeFile(configPath, mine)

  const { code, stdout } = await cli(['upgrade', '--append'], { cwd })

  assert.equal(code, 0)
  assert.equal(await readFile(configPath, 'utf8'), mine)
  assert.match(stdout, /nothing to add to a config file/)
})

test('--dry-run shows the config backfill diff and writes nothing', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const configPath = join(cwd, CONFIG)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  delete config.scopes
  const mine = `${JSON.stringify(config, null, 2)}\n`
  await writeFile(configPath, mine)

  const { code, stdout } = await cli(['upgrade', '--dry-run'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /predates keys this release adds/)
  assert.equal(await readFile(configPath, 'utf8'), mine)
})

// --- one prompter, two questions -------------------------------------------------

test('an interactive run answers both the backfill question and a later file conflict', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const configPath = join(cwd, CONFIG)
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  delete config.scopes
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const agentsPath = join(cwd, 'AGENTS.md')
  await writeFile(agentsPath, `${await readFile(agentsPath, 'utf8')}\nmine\n`)

  const input = new PassThrough()
  const output = new PassThrough()

  // Wait for readline's own prompt text to actually appear on `output` before
  // answering, rather than a fixed delay; the two questions are separated by real
  // file I/O (readConfig, planFiles), so a tick count would be timing-dependent.
  let promptCount = 0
  let onPrompt = null
  output.on('data', (chunk) => {
    if (!/overwrite it\?/.test(chunk.toString())) return
    promptCount++
    onPrompt?.()
  })
  const nthPrompt = (n) =>
    promptCount >= n ? Promise.resolve() : new Promise((resolve) => (onPrompt = resolve))

  const chunks = []
  const out = (text) => chunks.push(text)
  const err = (text) => chunks.push(text)

  const pending = upgrade({ cwd, interactive: true, input, output, out, err })

  // Two separate prompts are expected: the config backfill, then the AGENTS.md
  // conflict. `upgrade` shares one prompter across both rather than opening a second
  // readline interface on the same input stream mid-run; see resolveConflicts.js's
  // note on why a second one can lose the answer to whatever asked first.
  await nthPrompt(1)
  input.write('y\n')
  await nthPrompt(2)
  input.write('y\n')

  const code = await pending

  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(await readFile(configPath, 'utf8')).scopes, [], 'the backfill answer was not applied')
  assert.doesNotMatch(
    await readFile(agentsPath, 'utf8'),
    /mine/,
    'the conflict answer was not applied; a second prompter silently swallowed it',
  )
})

test('a config with every current key is not offered a pointless backfill', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stdout } = await cli(['upgrade'], { cwd })

  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /predates keys/)
})
