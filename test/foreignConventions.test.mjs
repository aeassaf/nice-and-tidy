import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { filesFor } from '../src/payload.js'
import { FOREIGN_CONVENTIONS, scanForeignConventions } from '../src/foreignConventions.js'
import { tempDir } from './helpers.mjs'

test('a registry path that is not on disk is reported as not existing', async (t) => {
  const dir = await tempDir(t)
  const hits = await scanForeignConventions(dir)
  assert.equal(hits.length, FOREIGN_CONVENTIONS.length)
  assert.ok(hits.every((hit) => hit.exists === false && hit.aligned === false && hit.content === null))
})

test('a file that exists and does not mention AGENTS.md is exists, not aligned', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, '.cursorrules'), 'always use tabs\n')

  const hits = await scanForeignConventions(dir)
  const hit = hits.find((h) => h.path === '.cursorrules')
  assert.equal(hit.exists, true)
  assert.equal(hit.aligned, false)
  assert.equal(hit.content, 'always use tabs\n')
})

test('a file that already mentions AGENTS.md is aligned', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, '.windsurfrules'), 'See AGENTS.md at the repo root.\n')

  const hits = await scanForeignConventions(dir)
  const hit = hits.find((h) => h.path === '.windsurfrules')
  assert.equal(hit.exists, true)
  assert.equal(hit.aligned, true)
})

test('the mention check is case-insensitive', async (t) => {
  const dir = await tempDir(t)
  await writeFile(join(dir, '.cursorrules'), 'follow agents.md\n')

  const hits = await scanForeignConventions(dir)
  assert.equal(hits.find((h) => h.path === '.cursorrules').aligned, true)
})

test('a directory at a registry path is not a hit, and does not throw', async (t) => {
  const dir = await tempDir(t)
  await mkdir(join(dir, '.cursorrules'))

  const hits = await scanForeignConventions(dir)
  const hit = hits.find((h) => h.path === '.cursorrules')
  assert.equal(hit.exists, false)
  assert.equal(hit.aligned, false)
})

// --- the invariant `clean` and `init` both depend on ---------------------------

test('the registry never claims a path init already owns', () => {
  const owned = new Set([...filesFor('local'), ...filesFor('global')].map((f) => f.path))
  for (const entry of FOREIGN_CONVENTIONS) {
    assert.ok(!owned.has(entry.path), `${entry.path} is in both FOREIGN_CONVENTIONS and a payload's filesFor()`)
  }
})
