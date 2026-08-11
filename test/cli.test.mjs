/**
 * End to end, in a real directory — through the real binary wherever that is possible.
 *
 * The unit tests prove the engine's states. These prove the thing a person actually
 * runs — including that a second run is silent, and that a hand-edited file survives
 * a run with no terminal to ask on.
 *
 * The one exception is the interactive prompt: `interactive` comes from stdin being a
 * TTY, and a subprocess spawned by the test runner never has one. That test calls
 * `init` in process with a pair of streams instead, which is the same path — `init`
 * does not know who is holding the other end.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { init } from '../src/commands/init.js'
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

// --- append -------------------------------------------------------------------

const MINE = '# My own instructions\n\nNever deploy on a Friday.\n'

test('--append keeps the file and adds the generated block below it', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)

  const { code, stdout } = await cli(['init', '--append'], { cwd })
  const written = await readFile(join(cwd, 'CLAUDE.md'), 'utf8')

  assert.equal(code, 0)
  assert.ok(written.startsWith(MINE), "the user's own instructions were moved or lost")
  assert.match(written, /@AGENTS\.md/, 'the generated content never landed')
  assert.match(stdout, /1 appended to/)
})

test('an appended file is silent on every run after', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)
  await cli(['init', '--append'], { cwd })

  const after = await readFile(join(cwd, 'CLAUDE.md'), 'utf8')
  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0, 'an appended file must not conflict with itself forever')
  assert.match(stdout, /Already up to date/)
  assert.equal(await readFile(join(cwd, 'CLAUDE.md'), 'utf8'), after)
})

test('editing your own half of an appended file is not a conflict', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)
  await cli(['init', '--append'], { cwd })
  await writeFile(join(cwd, 'CLAUDE.md'), (await readFile(join(cwd, 'CLAUDE.md'), 'utf8')).replace(MINE, `${MINE}\n- And one more rule.\n`))

  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /Already up to date/)
})

test('editing inside the block asks again, and answering keeps your half', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)
  await cli(['init', '--append'], { cwd })
  await writeFile(
    join(cwd, 'CLAUDE.md'),
    (await readFile(join(cwd, 'CLAUDE.md'), 'utf8')).replace('@AGENTS.md', '@AGENTS.md\n\nedited by hand'),
  )

  const conflicted = await cli(['init'], { cwd })
  assert.equal(conflicted.code, 1, 'a hand-edited block has to stop and ask')

  const { code } = await cli(['init', '--force'], { cwd })
  assert.equal(code, 0)
  assert.ok((await readFile(join(cwd, 'CLAUDE.md'), 'utf8')).startsWith(MINE), 'answering took the whole file')
})

test('a file whose content only works at the top of a file is left alone, and said so', async (t) => {
  const cwd = await tempDir(t)
  const rule = join(cwd, '.cursor/rules/nice-and-tidy.mdc')
  await mkdir(join(cwd, '.cursor/rules'), { recursive: true })
  await writeFile(rule, '---\ndescription: mine\n---\n\nMy own rule.\n')

  const { code, stdout } = await cli(['init', '--append'], { cwd })

  assert.equal(code, 0)
  assert.equal(await readFile(rule, 'utf8'), '---\ndescription: mine\n---\n\nMy own rule.\n')
  assert.match(stdout, /cannot take an appended block/)
})

test('--append never leaves two copies of our own content in one file', async (t) => {
  // Our file, hand-edited afterwards. Appending here would stack a complete second
  // copy of the generated file underneath the user's edited one.
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await appendFile(join(cwd, 'AGENTS.md'), '\n## Mine\n\nNever deploy on a Friday.\n')
  const mine = await readFile(join(cwd, 'AGENTS.md'), 'utf8')

  const { code, stdout } = await cli(['init', '--append'], { cwd })

  assert.equal(code, 0)
  assert.equal(await readFile(join(cwd, 'AGENTS.md'), 'utf8'), mine)
  assert.match(stdout, /would leave two copies/)
  assert.match(stdout, /1 left alone/)
})

test('append is offered as a way out when there is no terminal to ask on', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)

  const { code, stderr } = await cli(['init'], { cwd })

  assert.equal(code, 1)
  assert.match(stderr, /--append/)
})

test('answering + at the prompt appends, and only the appendable file is offered it', async (t) => {
  // In process rather than through the binary: `interactive` comes from stdin being a
  // TTY, and a subprocess spawned by the test runner never has one. Same path a person
  // takes — `init` does not know who is holding the other end of the stream.
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)
  await mkdir(join(cwd, '.cursor/rules'), { recursive: true })
  await writeFile(join(cwd, '.cursor/rules/nice-and-tidy.mdc'), '---\ndescription: mine\n---\n')

  const input = new PassThrough()
  const output = new PassThrough()
  const seen = []
  output.on('data', (chunk) => {
    const text = chunk.toString()
    // A fresh install asks which agents first. Enter takes all of them, which is what
    // this test needs and what a run with no answer has always installed.
    if (/agents\?/.test(text)) return input.write('\n')
    if (!/overwrite it\?/.test(text)) return
    seen.push(text)
    // `+` for the shim, then Enter for the rule file, which was never offered append.
    input.write(seen.length === 1 ? '+\n' : '\n')
  })

  const code = await init({ cwd, interactive: true, input, output, out: () => {}, err: () => {} })
  const written = await readFile(join(cwd, 'CLAUDE.md'), 'utf8')

  assert.equal(code, 0)
  assert.equal(seen.length, 2)
  assert.match(seen[0], /\+ = append/, 'the option has to be visible to be usable')
  assert.doesNotMatch(seen[1], /append/, 'a file that cannot take a block must not be offered one')
  assert.ok(written.startsWith(MINE))
  assert.match(written, /@AGENTS\.md/)
  assert.equal(await readFile(join(cwd, '.cursor/rules/nice-and-tidy.mdc'), 'utf8'), '---\ndescription: mine\n---\n')
})

test('diff --append previews the append, not an overwrite', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'CLAUDE.md'), MINE)

  const { code, stdout } = await cli(['diff', '--append'], { cwd })

  assert.equal(code, 0)
  assert.doesNotMatch(stdout, /-Never deploy on a Friday/, 'a dry run must not show work being destroyed that would not be')
  assert.match(stdout, /\+<!-- nice-and-tidy:begin/)
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

test('--agents picks what a fresh install writes', async (t) => {
  const cwd = await tempDir(t)
  const { code } = await cli(['init', '--agents', 'claude'], { cwd })

  assert.equal(code, 0)
  assert.ok(await exists(join(cwd, 'CLAUDE.md')))
  assert.ok(await exists(join(cwd, 'AGENTS.md')), 'AGENTS.md is what the shims point at — never optional')
  assert.equal(await exists(join(cwd, '.github/copilot-instructions.md')), false)
  assert.equal(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), false)

  const { targets } = JSON.parse(await readFile(join(cwd, 'nice-and-tidy.config.json'), 'utf8'))
  assert.deepEqual(targets, ['agents-md', 'claude'], 'the choice is written down, not re-asked every run')
})

test('--agents none installs AGENTS.md and its docs, and nothing that points at them', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init', '--agents', 'none'], { cwd })

  assert.ok(await exists(join(cwd, 'docs/WORKFLOW.md')))
  for (const path of ['CLAUDE.md', '.github/copilot-instructions.md', '.cursor/rules/nice-and-tidy.mdc']) {
    assert.equal(await exists(join(cwd, path)), false, path)
  }
})

test('no --agents and no terminal still installs for everything', async (t) => {
  // The prompt is an offer. A pipe, a CI job or a script that never knew the flag
  // existed has to get what it always got.
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  for (const path of INSTALLED) assert.ok(await exists(join(cwd, path)), path)
})

test('an unusable --agents value is refused before anything is written', async (t) => {
  const cwd = await tempDir(t)
  const { code, stderr } = await cli(['init', '--agents', 'emacs'], { cwd })

  assert.equal(code, 2)
  assert.match(stderr, /emacs/)
  assert.equal(await exists(join(cwd, 'AGENTS.md')), false, 'a usage error must not half-install')
})

test('--agents is refused on the commands it would do nothing for', async (t) => {
  // bootstrap writes GitHub-side setup and clean touches files this tool never wrote.
  // Neither depends on which agent you use, and accepting the flag there would imply
  // otherwise.
  const cwd = await tempDir(t)
  for (const command of ['bootstrap', 'clean']) {
    const { code, stderr } = await cli([command, '--agents', 'claude'], { cwd })
    assert.equal(code, 2, command)
    assert.match(stderr, /--agents applies to/)
  }
})

// --- dropping an agent afterwards ---------------------------------------------

test('init will not rewrite a config that already exists, and says which command will', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stdout } = await cli(['init', '--agents', 'claude'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /the config wins/)
  assert.match(stdout, /upgrade --agents claude/)
  assert.ok(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), 'nothing was dropped on a note alone')
})

test('upgrade --agents rewrites targets and removes what the dropped agents had', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stdout } = await cli(['upgrade', '--agents', 'claude', '--force'], { cwd })

  assert.equal(code, 0)
  assert.deepEqual(JSON.parse(await readFile(join(cwd, 'nice-and-tidy.config.json'), 'utf8')).targets, [
    'agents-md',
    'claude',
  ])
  assert.equal(await exists(join(cwd, '.github/copilot-instructions.md')), false)
  assert.equal(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), false)
  assert.ok(await exists(join(cwd, 'CLAUDE.md')), 'the agent that was kept keeps its files')
  assert.match(stdout, /2 removed/)

  const manifest = JSON.parse(await readFile(join(cwd, '.nice-and-tidy/manifest.json'), 'utf8'))
  assert.equal(manifest.files['.cursor/rules/nice-and-tidy.mdc'], undefined, 'a removed file is forgotten too')
})

test('a second run after dropping an agent has nothing left to say', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await cli(['upgrade', '--agents', 'claude', '--force'], { cwd })

  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /Already up to date/)
  assert.doesNotMatch(stdout, /remove/)
})

test('diff shows a removal it is not going to perform', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await narrowTo(cwd, ['agents-md', 'claude'])

  const { code, stdout } = await cli(['diff'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /remove\s+\.cursor\/rules\/nice-and-tidy\.mdc/)
  assert.match(stdout, /Plan:/)
  assert.ok(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), 'diff writes nothing and deletes nothing')
})

test('a dry run of --agents reports the removals the real run performs', async (t) => {
  // The whole point of previewing `--agents` is to see what it takes away. Planning
  // against the config still on disk would report nothing and delete two files a
  // moment later — the exact drift diff exists to prevent.
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const preview = await cli(['upgrade', '--agents', 'claude', '--dry-run'], { cwd })
  assert.equal(preview.code, 0)
  assert.match(preview.stdout, /remove\s+\.github\/copilot-instructions\.md/)
  assert.match(preview.stdout, /remove\s+\.cursor\/rules\/nice-and-tidy\.mdc/)
  assert.match(preview.stdout, /Plan: 2 removed/)

  assert.ok(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), 'a dry run deleted a file')
  assert.deepEqual(
    JSON.parse(await readFile(join(cwd, 'nice-and-tidy.config.json'), 'utf8')).targets.length,
    4,
    'a dry run rewrote the config',
  )

  const real = await cli(['upgrade', '--agents', 'claude', '--force'], { cwd })
  assert.match(real.stdout, /2 removed/, 'the preview promised two removals; the run has to make them')
  assert.equal(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), false)
})

test('diff --agents previews without claiming the config wins', async (t) => {
  // "the config wins" is a refusal, and nothing is being refused here — a preview was
  // asked for and given. Printing both would be two answers to the same question.
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stdout } = await cli(['diff', '--agents', 'claude'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /remove/)
  assert.doesNotMatch(stdout, /the config wins/)
  assert.match(stdout, /Nothing here writes to nice-and-tidy\.config\.json/)
})

test('a stale manifest entry is dropped without claiming a version was recorded', async (t) => {
  // The file is gone because somebody deleted it themselves. The manifest still has
  // to forget it — but "recorded the version this ran with" would be an account of an
  // event that did not happen.
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await narrowTo(cwd, ['agents-md', 'claude'])
  await rm(join(cwd, '.cursor/rules/nice-and-tidy.mdc'))
  await rm(join(cwd, '.github/copilot-instructions.md'))

  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /forgot 2 entries for files that are already gone/)
  assert.doesNotMatch(stdout, /recorded the version/)

  const manifest = JSON.parse(await readFile(join(cwd, '.nice-and-tidy/manifest.json'), 'utf8'))
  assert.equal(manifest.files['.cursor/rules/nice-and-tidy.mdc'], undefined)
})

test('a file for a dropped agent that somebody edited is named, never deleted', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  const edited = join(cwd, '.cursor/rules/nice-and-tidy.mdc')
  await appendFile(edited, '\nmine\n')
  await narrowTo(cwd, ['agents-md', 'claude'])

  const { code, stdout } = await cli(['init'], { cwd })

  assert.equal(code, 0)
  assert.match(await readFile(edited, 'utf8'), /mine/, 'an edited file is not ours to delete, whatever the config says')
  assert.match(stdout, /orphaned/)
  assert.match(stdout, /delete it yourself/)
})

test('a file for a dropped agent this tool never wrote is left where it is', async (t) => {
  const cwd = await tempDir(t)
  await writeFile(join(cwd, 'nice-and-tidy.config.json'), `${JSON.stringify({ targets: ['agents-md'] }, null, 2)}\n`)
  await mkdir(join(cwd, '.cursor/rules'), { recursive: true })
  await writeFile(join(cwd, '.cursor/rules/nice-and-tidy.mdc'), 'not ours\n')

  const { stdout } = await cli(['init'], { cwd })

  assert.equal(await readFile(join(cwd, '.cursor/rules/nice-and-tidy.mdc'), 'utf8'), 'not ours\n')
  assert.match(stdout, /no record of writing it/)
})

test('a dropped agent whose file is an appended block loses the block, not the file', async (t) => {
  const cwd = await tempDir(t)
  await mkdir(join(cwd, '.github'), { recursive: true })
  await writeFile(join(cwd, '.github/copilot-instructions.md'), MINE)
  await cli(['init', '--append'], { cwd })

  await narrowTo(cwd, ['agents-md', 'claude'])
  const { stdout } = await cli(['init'], { cwd })

  const left = await readFile(join(cwd, '.github/copilot-instructions.md'), 'utf8')
  assert.equal(left, MINE, 'everything outside the markers was always theirs')
  assert.match(stdout, /its generated block only/)
})

test('--keep-existing removes nothing and says what it left', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  await narrowTo(cwd, ['agents-md', 'claude'])

  const { code, stdout } = await cli(['init', '--keep-existing'], { cwd })

  assert.equal(code, 0)
  assert.ok(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')))
  assert.match(stdout, /left in place \(--keep-existing\)/)
})

test('upgrade --agents with no terminal and no --force changes nothing', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const { code, stderr } = await cli(['upgrade', '--agents', 'claude'], { cwd })

  assert.equal(code, 1)
  assert.match(stderr, /--force/)
  assert.ok(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')))
  assert.deepEqual(JSON.parse(await readFile(join(cwd, 'nice-and-tidy.config.json'), 'utf8')).targets.length, 4)
})

test('upgrade --agents together with a leave-it-alone flag is refused, not ranked', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  for (const flag of ['--keep-existing', '--append']) {
    const { code, stderr } = await cli(['upgrade', '--agents', 'claude', flag], { cwd })
    assert.equal(code, 2, flag)
    assert.match(stderr, /not both/)
  }
})

test('upgrade --agents that changes nothing says so instead of showing an empty diff', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })
  const { code, stdout } = await cli(['upgrade', '--agents', 'all'], { cwd })

  assert.equal(code, 0)
  assert.match(stdout, /already installs for all/)
})

test('the prompt on a fresh install takes an answer, and Enter takes everything', async (t) => {
  // In process, for the same reason the append prompt test is: `interactive` comes
  // from stdin being a TTY, and a spawned subprocess never has one.
  for (const [answer, expected] of [
    ['claude\n', false],
    ['\n', true],
  ]) {
    const cwd = await tempDir(t)
    const input = new PassThrough()
    const output = new PassThrough()
    output.on('data', (chunk) => {
      if (/agents\?/.test(chunk.toString())) input.write(answer)
    })

    const code = await init({ cwd, interactive: true, input, output, out: () => {}, err: () => {} })

    assert.equal(code, 0)
    assert.ok(await exists(join(cwd, 'CLAUDE.md')), answer)
    assert.equal(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), expected, answer)
  }
})

test('an unparseable answer is re-asked rather than guessed at', async (t) => {
  const cwd = await tempDir(t)
  const input = new PassThrough()
  const output = new PassThrough()
  const seen = []
  output.on('data', (chunk) => {
    const text = chunk.toString()
    if (!/agents\?/.test(text)) return
    seen.push(text)
    input.write(seen.length === 1 ? 'emacs\n' : 'claude\n')
  })

  const code = await init({ cwd, interactive: true, input, output, out: () => {}, err: () => {} })

  assert.equal(code, 0)
  assert.equal(seen.length, 2, 'a wrong answer deserves a second go')
  assert.equal(await exists(join(cwd, '.cursor/rules/nice-and-tidy.mdc')), false, 'the second answer is the one used')
})

test('a config that already exists answers the question, so it is never asked', async (t) => {
  const cwd = await tempDir(t)
  await cli(['init'], { cwd })

  const input = new PassThrough()
  const output = new PassThrough()
  const asked = []
  output.on('data', (chunk) => {
    if (/agents\?/.test(chunk.toString())) asked.push(1)
  })

  const code = await init({ cwd, interactive: true, input, output, out: () => {}, err: () => {} })

  assert.equal(code, 0)
  assert.deepEqual(asked, [])
})

/** Drops targets from a config the way a person editing the file by hand would. */
async function narrowTo(cwd, targets) {
  const path = join(cwd, 'nice-and-tidy.config.json')
  const config = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, `${JSON.stringify({ ...config, targets }, null, 2)}\n`)
}

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
    ['init', '--force', '--append'],
    ['init', '--keep-existing', '--append'],
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

const BANNED = /\b(claude|copilot|cursor|windsurf|codex|gemini|aider|devin|chatgpt|openai|anthropic)\b/i

test('help and bootstrap name no agent or product', async (t) => {
  const cwd = await tempDir(t)
  // Two exemptions, both for the same reason — a name somebody else chose, quoted
  // back. `init`'s file listing prints the paths it just wrote, and a loader dictates
  // those. `--agents` documents the values that flag takes, and those values *are* the
  // products; a flag for choosing between agents that will not name one is unusable.
  //
  // Everything the CLI says in its own voice is still not exempt, and neither is a
  // single word of any generated file — see contract.test.mjs, which is the rule this
  // one only guards the surface of.
  for (const args of [['--help'], ['bootstrap']]) {
    const { stdout, stderr } = await cli(args, { cwd })
    assert.equal(BANNED.test(withoutAgentsFlag(stdout + stderr)), false, `${args.join(' ')} named a product`)
  }
})

test('--help names the agents --agents accepts, or the flag cannot be used', async (t) => {
  const cwd = await tempDir(t)
  const { stdout } = await cli(['--help'], { cwd })
  for (const agent of ['claude', 'copilot', 'cursor']) {
    assert.match(stdout, new RegExp(`\\b${agent}\\b`), `--help must say that --agents takes "${agent}"`)
  }
})

/** The `--agents` paragraph, cut out at its own indent so the rest stays under test. */
const withoutAgentsFlag = (text) => text.replace(/^ {6}--agents {8}[\s\S]*?\n(?= {2}-h,)/m, '')
