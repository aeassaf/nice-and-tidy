import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  AGENT_TARGETS,
  ConfigError,
  TARGETS,
  agentsLabel,
  defaultConfig,
  parseAgents,
  readConfig,
  sameTargets,
  validateConfig,
  viewModel,
} from '../src/config.js'
import { parseRemote } from '../src/git.js'
import { tempDir } from './helpers.mjs'

const ok = (overrides) => validateConfig(defaultConfig(overrides))
const errorsFor = (overrides) => ok(overrides).errors

// --- positive -----------------------------------------------------------------

test('the default config is valid', () => {
  assert.deepEqual(validateConfig(defaultConfig()).errors, [])
})

test('gitflow defaults on', () => {
  assert.equal(defaultConfig().gitflow, true)
})

test('nested overrides merge instead of replacing the whole object', () => {
  const config = defaultConfig({ protocol: { memoryFile: 'docs/HANDOFF.md' } })
  assert.equal(config.protocol.memoryFile, 'docs/HANDOFF.md')
  assert.equal(config.protocol.concise, true, 'the untouched sibling key survived')
})

// --- negative: each proves validation actually rejects ------------------------

test('a repo slug that is not owner/name is rejected', () => {
  for (const repo of ['justaname', 'owner/name/extra', 'owner /name', '', 'https://github.com/o/n']) {
    assert.equal(errorsFor({ repo }).length, 1, `expected "${repo}" to be rejected`)
  }
})

test('a non-boolean gitflow is rejected', () => {
  for (const gitflow of ['true', 1, null]) {
    assert.equal(errorsFor({ gitflow }).length, 1, `expected ${JSON.stringify(gitflow)} to be rejected`)
  }
})

test('label and scope lists must be non-empty strings', () => {
  assert.equal(errorsFor({ labels: ['bug', ''] }).length, 1)
  assert.equal(errorsFor({ scopes: [42] }).length, 1)
  assert.equal(errorsFor({ milestones: 'Phase 1' }).length, 1)
})

test('an unknown target is rejected and the known ones are named', () => {
  const [message] = errorsFor({ targets: ['agents-md', 'emacs'] })
  assert.match(message, /emacs/)
  assert.match(message, /agents-md/)
})

test('dropping agents-md is rejected; every other target points at it', () => {
  const errors = errorsFor({ targets: ['claude', 'cursor'] })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /must include "agents-md"/)
})

test('duplicate targets are rejected', () => {
  assert.ok(errorsFor({ targets: ['agents-md', 'agents-md'] }).some((e) => /duplicate/.test(e)))
})

test('an empty target list is rejected', () => {
  assert.equal(errorsFor({ targets: [] }).length, 1)
})

test('a memory file outside the repo is rejected', () => {
  for (const memoryFile of ['/etc/passwd.md', '../escape.md', 'docs/../../out.md', 'C:/x.md']) {
    const errors = errorsFor({ protocol: { memoryFile } })
    assert.equal(errors.length, 1, `expected "${memoryFile}" to be rejected`)
  }
})

test('a memory file that is not markdown is rejected', () => {
  assert.match(errorsFor({ protocol: { memoryFile: 'docs/state.txt' } })[0], /markdown/)
})

test('a board project number must be a positive integer', () => {
  for (const projectNumber of [0, -1, 1.5, '4']) {
    assert.equal(errorsFor({ board: { projectNumber } }).length, 1, `expected ${projectNumber} to be rejected`)
  }
  assert.deepEqual(errorsFor({ board: { projectNumber: null } }), [])
})

test('a misspelled key warns instead of failing the run', () => {
  const { errors, warnings } = validateConfig({ ...defaultConfig(), gitFlow: false })
  assert.deepEqual(errors, [])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /gitFlow/)
})

test('a non-object config is rejected outright', () => {
  for (const value of [null, [], 'x', 3]) {
    assert.equal(validateConfig(value).errors.length, 1)
  }
})

// --- reading ------------------------------------------------------------------

test('a missing config reads as null, not an error', async (t) => {
  assert.equal(await readConfig(join(await tempDir(t), 'nope.json')), null)
})

test('malformed JSON names the file rather than throwing a parser error', async (t) => {
  const path = join(await tempDir(t), 'nice-and-tidy.config.json')
  await writeFile(path, '{ "gitflow": tru }')
  await assert.rejects(() => readConfig(path), (error) => error instanceof ConfigError && /not valid JSON/.test(error.message))
})

test('an invalid config refuses to load', async (t) => {
  const path = join(await tempDir(t), 'nice-and-tidy.config.json')
  await writeFile(path, JSON.stringify({ targets: ['nonsense'] }))
  await assert.rejects(() => readConfig(path), ConfigError)
})

test('a partial config is filled in from the defaults', async (t) => {
  const path = join(await tempDir(t), 'nice-and-tidy.config.json')
  await writeFile(path, JSON.stringify({ repo: 'a/b' }))
  const { config } = await readConfig(path)
  assert.equal(config.gitflow, true)
  assert.equal(config.protocol.memoryFile, 'docs/RESUME_HERE.md')
})

// --- view model ---------------------------------------------------------------

// Phase 1's invariant was "strings all the way down"; nothing else was renderable.
// Phase 2 adds `{{#if flag}}`, which needs booleans, so the invariant narrows to:
// every key is a string (for `{{ }}`) or a named conditional flag (for `{{#if }}`),
// never anything else a template author could reach for by accident.
const CONDITIONAL_FLAGS = ['gitflow']

test('the view model is strings, except for the named conditional flags', () => {
  for (const [key, value] of Object.entries(viewModel(defaultConfig()))) {
    if (CONDITIONAL_FLAGS.includes(key)) {
      assert.equal(typeof value, 'boolean', `${key} is a conditional flag and must be a boolean`)
    } else {
      assert.equal(typeof value, 'string', `${key} must be a string; templates cannot render anything else`)
    }
  }
})

test('gitflow decides the base branch', () => {
  assert.equal(viewModel(defaultConfig({ gitflow: true })).baseBranch, 'develop')
  assert.equal(viewModel(defaultConfig({ gitflow: false })).baseBranch, 'main')
})

test('an empty scope list renders as an instruction, not an empty gap', () => {
  assert.match(viewModel(defaultConfig()).commitScopes, /omit the parenthetical/)
})

// --- remote parsing (pure, so the suite needs no git) -------------------------

test('every remote form resolves to owner/name', () => {
  const cases = {
    'git@github.com:aeassaf/nice-and-tidy.git': 'aeassaf/nice-and-tidy',
    'https://github.com/aeassaf/nice-and-tidy.git': 'aeassaf/nice-and-tidy',
    'https://github.com/aeassaf/nice-and-tidy': 'aeassaf/nice-and-tidy',
    'ssh://git@github.com/aeassaf/nice-and-tidy.git': 'aeassaf/nice-and-tidy',
    'https://github.com/aeassaf/nice-and-tidy/': 'aeassaf/nice-and-tidy',
  }
  for (const [url, expected] of Object.entries(cases)) assert.equal(parseRemote(url), expected)
})

test('a remote that is not parseable yields null rather than a guess', () => {
  for (const url of ['', '   ', null, undefined, 'not-a-url']) assert.equal(parseRemote(url), null)
})

// --- --agents, the flag that has to survive being typed by a person -----------

test('a list of agents becomes targets, with agents-md always in it', () => {
  assert.deepEqual(parseAgents('claude').targets, ['agents-md', 'claude'])
  assert.deepEqual(parseAgents('claude,cursor').targets, ['agents-md', 'claude', 'cursor'])
})

test('all and none are the two ends', () => {
  assert.deepEqual(parseAgents('all').targets, TARGETS)
  assert.deepEqual(parseAgents('none').targets, ['agents-md'])
})

test('the same choice written two ways parses to the same config', () => {
  // Order and spacing and case are how somebody types, not what they mean. Letting
  // any of them through would put a reordered targets array in a diff for no reason.
  const canonical = parseAgents('claude,cursor').targets
  for (const written of ['cursor,claude', ' Claude , CURSOR ', 'claude,,cursor']) {
    assert.deepEqual(parseAgents(written).targets, canonical, written)
  }
})

test('agents-md in the list is accepted and changes nothing', () => {
  assert.deepEqual(parseAgents('agents-md,claude').targets, ['agents-md', 'claude'])
})

test('an unknown agent is refused, and the message names what is known', () => {
  const { error, targets } = parseAgents('emacs')
  assert.equal(targets, undefined)
  assert.match(error, /emacs/)
  for (const agent of AGENT_TARGETS) assert.match(error, new RegExp(agent))
})

test('all or none mixed with anything else is refused rather than guessed at', () => {
  // "all,cursor" reads two ways: everything, or a typo for just cursor. Picking one
  // silently installs for agents somebody may have meant to leave out.
  for (const input of ['all,cursor', 'none,claude', 'all,none']) {
    assert.match(parseAgents(input).error, /cannot be combined/, input)
  }
})

test('an empty --agents is refused, not read as none', () => {
  for (const input of ['', '   ', ',,']) assert.match(parseAgents(input).error, /needs a value/, JSON.stringify(input))
})

test('every parse round-trips through the label the CLI prints back', () => {
  for (const written of ['all', 'none', 'claude', 'claude,cursor']) {
    const label = agentsLabel(parseAgents(written).targets)
    assert.deepEqual(parseAgents(label).targets, parseAgents(written).targets, written)
  }
  assert.equal(agentsLabel(TARGETS), 'all')
  assert.equal(agentsLabel(['agents-md']), 'none')
})

test('sameTargets ignores the order two lists were written in', () => {
  assert.equal(sameTargets(['agents-md', 'claude'], ['claude', 'agents-md']), true)
  assert.equal(sameTargets(['agents-md', 'claude'], ['agents-md']), false)
  assert.equal(sameTargets(['agents-md', 'claude'], ['agents-md', 'cursor']), false)
})
