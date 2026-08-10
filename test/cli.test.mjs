/**
 * End to end, through the real binary in a real directory.
 *
 * The unit tests prove the engine's states. These prove the thing a person actually
 * runs — including that a second run is silent, and that a hand-edited file survives
 * a run with no terminal to ask on.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

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

const INSTALLED = [
  'nice-and-tidy.config.json',
  'AGENTS.md',
  'docs/WORKFLOW.md',
  'docs/BRANCHING.md',
  'docs/COMMIT_CONVENTIONS.md',
  'docs/SESSION_PROTOCOL.md',
  'CLAUDE.md',
  '.claude/skills/nice-and-tidy/SKILL.md',
  '.github/copilot-instructions.md',
  '.cursor/rules/nice-and-tidy.mdc',
  'docs/RESUME_HERE.md',
  '.nice-and-tidy/manifest.json',
]

const exists = async (path) => stat(path).then(() => true, () => false)

// --- the happy path, and the gate: running twice ------------------------------

test('a first init writes the whole set', async (t) => {
  const cwd = await tempDir(t)
  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  for (const file of INSTALLED) {
    assert.ok(await exists(join(cwd, file)), `${file} was not written`)
  }
  assert.match(stdout, /11 created/)
})

test('a second init is a silent no-op and touches nothing', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const before = await Promise.all(INSTALLED.map((f) => stat(join(cwd, f)).then((s) => s.mtimeMs)))
  const { code, stdout } = await cli(['init'], { cwd })
  const after = await Promise.all(INSTALLED.map((f) => stat(join(cwd, f)).then((s) => s.mtimeMs)))

  assert.equal(code, 0)
  assert.match(stdout, /Already up to date/)
  assert.deepEqual(after, before, 'a no-op run rewrote a file')
})

test('a config change regenerates the files it affects', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const config = JSON.parse(await readFile(join(cwd, 'nice-and-tidy.config.json'), 'utf8'))
  config.gitflow = false
  await writeFile(join(cwd, 'nice-and-tidy.config.json'), `${JSON.stringify(config, null, 2)}\n`)

  const { code, stdout } = await cli(['init'], { cwd })
  assert.equal(code, 0)
  assert.match(stdout, /update/)
  assert.match(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), /Cut everyday branches from \*\*`main`\*\*/)
})

test('the config is never rewritten once it exists', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const path = join(cwd, 'nice-and-tidy.config.json')
  await writeFile(path, `${JSON.stringify({ repo: 'me/mine', scopes: ['cli'] }, null, 2)}\n`)
  const mine = await readFile(path, 'utf8')

  await cli(['init'], { cwd })

  assert.equal(await readFile(path, 'utf8'), mine)
})

// --- the memory file: created once, owned like the config after that ----------

test('a first init scaffolds the memory file if nothing is there', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const memory = await readFile(join(cwd, 'docs/RESUME_HERE.md'), 'utf8')
  assert.match(memory, /Session memory/)
  assert.match(memory, /docs\/SESSION_PROTOCOL\.md/)
})

test('a real session write to the memory file survives every later init untouched', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const written = '# Session memory\n\nPhase 1 done. Phase 2 next.\n'
  await writeFile(join(cwd, 'docs/RESUME_HERE.md'), written)

  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /docs\/RESUME_HERE\.md.*conflict/, 'session notes must never read as a conflict')
  assert.equal(await readFile(join(cwd, 'docs/RESUME_HERE.md'), 'utf8'), written)
})

test('a custom protocol.memoryFile path is where the scaffold lands', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const config = JSON.parse(await readFile(join(cwd, 'nice-and-tidy.config.json'), 'utf8'))
  config.protocol.memoryFile = 'docs/PROGRESS.md'
  await writeFile(join(cwd, 'nice-and-tidy.config.json'), `${JSON.stringify(config, null, 2)}\n`)

  await cli(['init'], { cwd })

  assert.ok(await exists(join(cwd, 'docs/PROGRESS.md')))
  assert.equal(await exists(join(cwd, 'docs/RESUME_HERE.md')), true, 'the first scaffold is not deleted on a path change')
})

test('a global install never scaffolds a memory file — it has no single repo to belong to', async (t) => {
  const cwd = await tempDir(t)
  const home = await tempDir(t)
  await cli(['init', '--global'], { cwd, env: { HOME: home } })
  assert.equal(await exists(join(home, 'docs/RESUME_HERE.md')), false)
  assert.equal(await exists(join(home, '.config/nice-and-tidy/docs/RESUME_HERE.md')), false)
})

// --- the refusals -------------------------------------------------------------

test('a hand-edited file stops the run when there is no terminal to ask on', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await appendFile(join(cwd, 'AGENTS.md'), '\n## Mine\n\nNever deploy on a Friday.\n')
  const mine = await readFile(join(cwd, 'AGENTS.md'), 'utf8')

  const { code, stdout, stderr } = await cli(['init'], { cwd })

  assert.equal(code, 1)
  assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), mine, 'the edit was destroyed')
  assert.match(stdout, /Never deploy on a Friday/, 'the diff has to show what would be lost')
  assert.match(stderr, /--keep-existing/)
  assert.match(stderr, /--force/)
})

test('a pre-existing file this tool never wrote is a conflict, not a clobber', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'AGENTS.md'), '# My own instructions\n')

  const { code } = await cli(['init'], { cwd })

  assert.equal(code, 1)
  assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), '# My own instructions\n')
})

test('--keep-existing applies everything else and succeeds', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'AGENTS.md'), '# My own instructions\n')

  const { code } = await cli(['init', '--keep-existing'], { cwd })

  assert.equal(code, 0)
  assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), '# My own instructions\n')
  assert.ok(await exists(join(cwd, 'CLAUDE.md')), 'the non-conflicting files should still land')
})

test('a skipped conflict is still a conflict on the next run', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'AGENTS.md'), '# My own instructions\n')
  await cli(['init', '--keep-existing'], { cwd })

  const { code } = await cli(['init'], { cwd })

  assert.equal(code, 1, 'skipping once must not silently adopt the file')
})

test('--force overwrites, and only then', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'AGENTS.md'), '# My own instructions\n')

  const { code } = await cli(['init', '--force'], { cwd })

  assert.equal(code, 0)
  assert.doesNotMatch(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), /My own instructions/)
})

test('diff writes nothing at all, not even on a clean directory', async (t) => {
  const cwd = await tempDir(t)
  const { code, stdout } = await cli(['diff'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /create/)
  for (const file of INSTALLED) {
    assert.equal(await exists(join(cwd, file)), false, `${file} was written by a dry run`)
  }
})

test('diff reports a conflict without failing — it is a report', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await appendFile(join(cwd, 'AGENTS.md'), '\nmine\n')

  const { code, stdout } = await cli(['diff'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /differs from what an install would write/)
})

// --- targets ------------------------------------------------------------------

test('targets decides what gets installed', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(
    join(cwd, 'nice-and-tidy.config.json'),
    `${JSON.stringify({ targets: ['agents-md'] }, null, 2)}\n`,
  )

  const { code } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  assert.ok(await exists(join(cwd, 'AGENTS.md')))
  assert.ok(await exists(join(cwd, 'docs/WORKFLOW.md')), 'workflow docs are agents-md-gated, not shim-gated')
  assert.equal(await exists(join(cwd, 'CLAUDE.md')), false)
  assert.equal(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), false)
})

// --- global -------------------------------------------------------------------

test('a global install writes under the home directory and says what it did not do', async (t) => {
  const cwd = await tempDir(t)
  const home = await tempDir(t)

  const { code, stdout } = await cli(['init', '--global'], { cwd, env: { HOME: home } })

  assert.equal(code, 0)
  assert.ok(await exists(join(home, '.config/nice-and-tidy/AGENTS.md')))
  assert.ok(await exists(join(home, '.claude/skills/nice-and-tidy/SKILL.md')))
  assert.ok(await exists(join(home, '.config/nice-and-tidy/nice-and-tidy.config.json')))
  assert.match(stdout, /Nothing loads a machine-wide AGENTS\.md on its own/)

  assert.equal(await exists(join(cwd, 'AGENTS.md')), false, 'a global install must not write into the cwd')
  assert.equal(await exists(join(home, 'nice-and-tidy.config.json')), false, 'no config dropped at the top of home')
})

test('a global install names the targets it has nothing for, rather than pretending', async (t) => {
  const home = await tempDir(t)
  const { stdout } = await cli(['init', '--global'], { cwd: await tempDir(t), env: { HOME: home } })
  assert.match(stdout, /copilot, cursor/)
})

// --- usage errors -------------------------------------------------------------

test('contradictory flags are refused rather than silently ranked', async (t) => {
  const cwd = await tempDir(t)
  for (const args of [
    ['init', '--force', '--keep-existing'],
    ['init', '--global', '--local'],
    ['init', '--gitflow', '--no-gitflow'],
  ]) {
    const { code } = await cli(args, { cwd })
    assert.equal(code, 2, `expected ${args.join(' ')} to be refused`)
  }
})

test('an unknown command and an unknown flag both exit 2', async (t) => {
  const cwd = await tempDir(t)
  assert.equal((await cli(['frobnicate'], { cwd })).code, 2)
  assert.equal((await cli(['init', '--yolo'], { cwd })).code, 2)
})

test('an invalid config refuses to run and says why', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'nice-and-tidy.config.json'), JSON.stringify({ targets: ['emacs'] }))

  const { code, stderr } = await cli(['init'], { cwd })

  assert.equal(code, 2)
  assert.match(stderr, /emacs/)
  assert.equal(await exists(join(cwd, 'AGENTS.md')), false)
})

test('bootstrap refuses loudly rather than guessing when init has not run yet', async (t) => {
  const { code, stderr } = await cli(['bootstrap'], { cwd: await tempDir(t) })
  assert.equal(code, 2)
  assert.match(stderr, /run.*init.*first/i)
})

// --- clean: deprecated per-tool convention files -------------------------------

test('clean finds nothing in a plain repo', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stdout } = await cli(['clean'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /Nothing found/)
})

test('clean --dry-run reports a deprecated file and writes nothing', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await writeFile(join(cwd, '.cursorrules'), 'always use tabs\n')

  const { code, stdout } = await cli(['clean', '--dry-run'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /\.cursorrules/)
  assert.equal(await readFile(join(cwd, '.cursorrules'), 'utf8'), 'always use tabs\n')
})

test('clean skips a file that already points at AGENTS.md', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await writeFile(join(cwd, '.windsurfrules'), 'See AGENTS.md at the repo root.\n')

  const { code, stdout } = await cli(['clean'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /Nothing found/)
  assert.equal(await readFile(join(cwd, '.windsurfrules'), 'utf8'), 'See AGENTS.md at the repo root.\n')
})

test('clean with no terminal and no --force reports and writes nothing', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await writeFile(join(cwd, '.cursorrules'), 'always use tabs\n')

  const { code, stdout, stderr } = await cli(['clean'], { cwd })

  assert.equal(code, 1)
  assert.match(stdout, /\.cursorrules/)
  assert.match(stderr, /--force/)
  assert.equal(await readFile(join(cwd, '.cursorrules'), 'utf8'), 'always use tabs\n')
})

test('clean --force replaces every flagged file with a pointer to AGENTS.md', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await writeFile(join(cwd, '.cursorrules'), 'always use tabs\n')
  await writeFile(join(cwd, '.windsurfrules'), 'some old note\n')

  const { code, stdout } = await cli(['clean', '--force'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /2 replaced, 0 left alone/)
  assert.match(await readFile(join(cwd, '.cursorrules'), 'utf8'), /AGENTS\.md/)
  assert.match(await readFile(join(cwd, '.windsurfrules'), 'utf8'), /AGENTS\.md/)
})

test('clean --force is a no-op the second time — the pointer already mentions AGENTS.md', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await writeFile(join(cwd, '.cursorrules'), 'always use tabs\n')
  await cli(['clean', '--force'], { cwd })
  const pointer = await readFile(join(cwd, '.cursorrules'), 'utf8')

  const { code, stdout } = await cli(['clean'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /Nothing found/)
  assert.equal(await readFile(join(cwd, '.cursorrules'), 'utf8'), pointer)
})

test('init points at clean when a deprecated convention file is found', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, '.cursorrules'), 'always use tabs\n')

  const { stdout } = await cli(['init'], { cwd })

  assert.match(stdout, /nice-and-tidy clean/)
  assert.match(stdout, /\.cursorrules/)
})

test('init says nothing about clean when there is nothing to flag', async (t) => {
  const cwd = await tempDir(t)
  const { stdout } = await cli(['init'], { cwd })
  assert.doesNotMatch(stdout, /nice-and-tidy clean/)
})

// --- the non-negotiable, at the surface a person sees -------------------------

test('help and bootstrap name no agent or product', async (t) => {
  const cwd = await tempDir(t)
  // `init`'s file listing is exempt: it prints the paths it just wrote, and a loader
  // dictates those. Everything the CLI says in its own voice is not exempt.
  const banned = /\b(claude|copilot|cursor|windsurf|codex|gemini|aider|devin|chatgpt|openai|anthropic)\b/i
  for (const args of [['--help'], ['bootstrap']]) {
    const { stdout, stderr } = await cli(args, { cwd })
    assert.equal(banned.test(stdout + stderr), false, `${args.join(' ')} named a product`)
  }
})
