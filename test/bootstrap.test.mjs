/**
 * bootstrap's own logic (what to create, what to skip, when to refuse) tested with a
 * fake `gh` — no real binary, no network, same DI shape `init.js`'s tests use for I/O.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { EXIT_NOT_READY, EXIT_OK, EXIT_UNRESOLVED, EXIT_USAGE, bootstrap } from '../src/commands/bootstrap.js'
import { GhError } from '../src/gh.js'
import { tempDir } from './helpers.mjs'

const CONFIG = {
  repo: 'acme/widgets',
  defaultAssignee: 'acme',
  gitflow: false,
  milestones: ['Phase 1', 'Phase 2'],
  labels: ['bug', 'enhancement'],
  scopes: [],
  board: { projectNumber: null, template: 'team-planning' },
  targets: ['agents-md'],
  protocol: { concise: true, memoryFile: 'docs/RESUME_HERE.md', statusBlockEveryResponse: true },
}

async function writeConfig(cwd, overrides = {}) {
  await writeFile(join(cwd, 'nice-and-tidy.config.json'), JSON.stringify({ ...CONFIG, ...overrides }, null, 2))
}

/** A fake `gh` with just enough state to answer auth/label/milestone calls. */
function fakeGh({ authenticated = true, labels = [], milestones = [] } = {}) {
  const state = { labels: new Set(labels), milestones: new Set(milestones) }
  const calls = []

  const exec = async (args) => {
    calls.push(args)
    const [cmd] = args

    if (cmd === 'auth') {
      if (!authenticated) throw new GhError('gh auth status failed: not logged in')
      return ''
    }
    if (cmd === 'label') {
      if (args[1] === 'list') return JSON.stringify([...state.labels].map((name) => ({ name })))
      if (args[1] === 'create') {
        const name = args[2]
        if (state.labels.has(name)) throw new GhError(`label "${name}" already exists`)
        state.labels.add(name)
        return ''
      }
    }
    if (cmd === 'api') {
      if (args[2] === '--jq') return JSON.stringify([...state.milestones])
      if (args[1].endsWith('/milestones')) {
        const title = args[3].replace('title=', '')
        if (state.milestones.has(title)) throw new GhError(`milestone "${title}" already exists`)
        state.milestones.add(title)
        return ''
      }
    }
    throw new Error(`fakeGh: unhandled call ${JSON.stringify(args)}`)
  }

  return { exec, calls, state }
}

function sink() {
  const lines = []
  return { fn: (text) => lines.push(text), text: () => lines.join('') }
}

async function run(cwd, { exec, ...options } = {}) {
  const outSink = sink()
  const errSink = sink()
  const code = await bootstrap({
    cwd,
    exec,
    interactive: false,
    out: outSink.fn,
    err: errSink.fn,
    ...options,
  })
  return { code, stdout: outSink.text(), stderr: errSink.text() }
}

// --- refusals -------------------------------------------------------------------

test('no config yet refuses and says to run init first', async (t) => {
  const cwd = await tempDir(t)
  const { code, stderr } = await run(cwd, { exec: fakeGh().exec })
  assert.equal(code, EXIT_USAGE)
  assert.match(stderr, /run.*init.*first/i)
})

test('a config with no repo set refuses', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd, { repo: null })
  const { code, stderr } = await run(cwd, { exec: fakeGh().exec })
  assert.equal(code, EXIT_USAGE)
  assert.match(stderr, /"repo" is not set/)
})

test('gh not authenticated refuses loudly, before touching labels or milestones', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd)
  const { exec, calls } = fakeGh({ authenticated: false })
  const { code, stderr } = await run(cwd, { exec })
  assert.equal(code, EXIT_NOT_READY)
  assert.match(stderr, /gh is not ready/)
  assert.deepEqual(calls, [['auth', 'status']], 'nothing past the auth check should have run')
})

// --- the happy path ---------------------------------------------------------------

test('a first run writes the files and creates every configured label and milestone', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd)
  const { exec, state } = fakeGh()

  const { code, stdout } = await run(cwd, { exec })

  assert.equal(code, EXIT_OK)
  assert.match(stdout, /create.*\.github\/pull_request_template\.md/)
  assert.match(stdout, /create.*scripts\/check-pr-description\.mjs/)
  assert.deepEqual(state.labels, new Set(['bug', 'enhancement']))
  assert.deepEqual(state.milestones, new Set(['Phase 1', 'Phase 2']))
  assert.match(stdout, /created.*bug/)
  assert.match(stdout, /created.*Phase 1/)
})

test('a second run is idempotent: files unchanged, nothing re-created', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd)
  const { exec: exec1 } = fakeGh()
  await run(cwd, { exec: exec1 })

  const { exec: exec2, calls } = fakeGh({ labels: CONFIG.labels, milestones: CONFIG.milestones })
  const { code, stdout } = await run(cwd, { exec: exec2 })

  assert.equal(code, EXIT_OK)
  assert.match(stdout, /unchanged.*\.github\/pull_request_template\.md/)
  assert.match(stdout, /exists.*bug/)
  assert.match(stdout, /exists.*Phase 1/)
  assert.ok(
    calls.every((call) => !(call[0] === 'label' && call[1] === 'create') && !(call.length === 4 && call[2] === '-f')),
    'nothing should have tried to create an already-existing label or milestone',
  )
})

test('--dry-run reports what would be created without creating it', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd)
  const { exec, state } = fakeGh()

  const { code, stdout } = await run(cwd, { exec, dryRun: true })

  assert.equal(code, EXIT_OK)
  assert.match(stdout, /would create.*bug/)
  assert.equal(state.labels.size, 0, 'dry run must not actually create anything')
  assert.equal(state.milestones.size, 0)
})

test('an empty labels or milestones list says so instead of doing nothing silently', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd, { labels: [], milestones: [] })
  const { exec } = fakeGh()

  const { stdout } = await run(cwd, { exec })
  assert.match(stdout, /none configured/)
})

// --- the default-branch flip: printed, never run ---------------------------------

test('gitflow: true prints the default-branch command but never runs it', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd, { gitflow: true })
  const { exec, calls } = fakeGh()

  const { stdout } = await run(cwd, { exec })

  assert.match(stdout, /gh repo edit acme\/widgets --default-branch develop/)
  assert.ok(
    calls.every((call) => !(call[0] === 'repo' && call[1] === 'edit')),
    'the default-branch flip must only ever be printed',
  )
})

test('gitflow: false prints nothing about the default branch', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd, { gitflow: false })
  const { exec } = fakeGh()

  const { stdout } = await run(cwd, { exec })
  assert.doesNotMatch(stdout, /default-branch/)
})

// --- conflicts reuse the same machinery init uses ---------------------------------

test('a hand-edited PR template conflicts and, with no terminal, nothing is written', async (t) => {
  const cwd = await tempDir(t)
  await writeConfig(cwd)
  await mkdir(join(cwd, '.github'), { recursive: true })
  await writeFile(join(cwd, '.github', 'pull_request_template.md'), '# My own template\n')

  const { exec } = fakeGh()
  const { code } = await run(cwd, { exec })

  assert.equal(code, EXIT_UNRESOLVED)
  assert.equal(
    await readFile(join(cwd, '.github', 'pull_request_template.md'), 'utf8'),
    '# My own template\n',
    'the hand-edited file must survive untouched',
  )
})
