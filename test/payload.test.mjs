/**
 * Which files belong to which target, and (the half with teeth) which files a run is
 * allowed to *consider* removing.
 *
 * That set is derived from the payload table on purpose, never from "everything in the
 * manifest that isn't in today's payload." The manifest is shared with `bootstrap`,
 * whose PR template, description gate and CI workflow never appear in an `init`
 * payload; under the broader rule `init` would propose deleting all three on every
 * run. The test below is what stops that rule from being reintroduced as a
 * simplification.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildBootstrapPayload } from '../src/bootstrapPayload.js'
import { TARGETS, defaultConfig } from '../src/config.js'
import { filesByTarget, filesFor, orphanedFiles } from '../src/payload.js'

const pathsOf = (kind, targets) => orphanedFiles(kind, targets).map((file) => file.path)

test('nothing is orphaned when every target is selected', () => {
  assert.deepEqual(orphanedFiles('local', TARGETS), [])
  assert.deepEqual(orphanedFiles('global', TARGETS), [])
})

test('dropping a target orphans exactly the files that target wrote', () => {
  const orphans = pathsOf('local', ['agents-md', 'claude'])
  assert.deepEqual(orphans.sort(), ['.cursor/rules/nice-and-tidy.mdc', '.github/copilot-instructions.md'])
})

test('AGENTS.md and its docs are never orphanable', () => {
  // Not because dropping `agents-md` is handled here, but because `validateConfig`
  // refuses a config without it. If that ever changes, this fails loudly rather than
  // quietly proposing to delete the file every shim points at.
  for (const file of filesFor('local')) {
    if (file.target !== 'agents-md') continue
    assert.equal(pathsOf('local', ['agents-md']).includes(file.path), false, file.path)
  }
})

test('a removal candidate carries whether it can hold an appended block', () => {
  // Get this wrong and a file somebody appended our block to gets deleted whole
  // instead of having the block taken out of it.
  const copilot = orphanedFiles('local', ['agents-md']).find((f) => f.target === 'copilot')
  const cursor = orphanedFiles('local', ['agents-md']).find((f) => f.target === 'cursor')
  assert.equal(copilot.appendable, true)
  assert.equal(cursor.appendable, false)
})

test('bootstrap files are never removal candidates, whatever the targets are', async () => {
  // The manifest is shared. Deriving the orphan set from it instead of from the
  // payload table would have every `init` offer to delete GitHub-side setup.
  const bootstrapPaths = new Set((await buildBootstrapPayload(defaultConfig({ repo: 'me/mine' }))).map((e) => e.path))
  assert.ok(bootstrapPaths.size > 0)

  for (const targets of [['agents-md'], ['agents-md', 'claude'], TARGETS]) {
    for (const path of pathsOf('local', targets)) {
      assert.equal(bootstrapPaths.has(path), false, `${path} is bootstrap's, not a target's`)
    }
  }
})

test('what a target is offered as writing is what it actually writes', () => {
  // The prompt reads this map. A hand-written description would drift from the table
  // the first time a file moves.
  const grouped = filesByTarget('local')
  for (const file of filesFor('local')) {
    assert.ok(grouped.get(file.target).includes(file.path), file.path)
  }
  assert.deepEqual(grouped.get('cursor'), ['.cursor/rules/nice-and-tidy.mdc'])
})
