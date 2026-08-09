/**
 * The write engine. Run with:  node --test test/
 *
 * These are mostly negative on purpose, following the convention the reference PR
 * gate set: an engine whose whole job is "do not destroy the user's work" is only
 * trustworthy if something proves it refuses. A test that only shows two clean runs
 * agreeing proves nothing about the case that matters.
 */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { hashContent } from '../src/hash.js'
import { emptyManifest, readManifest } from '../src/manifest.js'
import { ADOPT, CONFLICT, CREATE, GENERATED, KEPT, UNCHANGED, UPDATE, applyPlan, planFiles } from '../src/plan.js'
import { tempDir } from './helpers.mjs'

const entry = (path, contents, ownership = GENERATED) => ({ path, contents, ownership })

const manifestWith = (files) => ({ ...emptyManifest(), files })

const planOne = (root, item, manifest = emptyManifest()) => planFiles(root, [item], manifest).then((r) => r[0])

// --- the three states, and the two that are easy to conflate ------------------

test('a file that is not there yet is created', async (t) => {
  const root = await tempDir(t)
  const plan = await planOne(root, entry('AGENTS.md', 'hello\n'))
  assert.equal(plan.action, CREATE)
})

test('ours, untouched, and identical → unchanged', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'hello\n')
  const plan = await planOne(root, entry('AGENTS.md', 'hello\n'), manifestWith({ 'AGENTS.md': hashContent('hello\n') }))
  assert.equal(plan.action, UNCHANGED)
})

test('ours, untouched, but the config changed → update, not conflict', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'base: develop\n')
  const plan = await planOne(
    root,
    entry('AGENTS.md', 'base: main\n'),
    manifestWith({ 'AGENTS.md': hashContent('base: develop\n') }),
  )
  // Without a manifest this is indistinguishable from a hand-edit, and a tool that
  // guessed here would either never update anything or overwrite everything.
  assert.equal(plan.action, UPDATE)
})

test('ours, then edited by hand → conflict, never update', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'hello\nmy own note\n')
  const plan = await planOne(root, entry('AGENTS.md', 'hello\n'), manifestWith({ 'AGENTS.md': hashContent('hello\n') }))
  assert.equal(plan.action, CONFLICT)
  assert.equal(plan.reason, 'edited')
})

test('someone else wrote it and we have no record → conflict', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'hand-written by a human\n')
  const plan = await planOne(root, entry('AGENTS.md', 'generated\n'))
  assert.equal(plan.action, CONFLICT)
  assert.equal(plan.reason, 'untracked')
})

// --- adoption: the two cases where asking would be pointless ------------------

test('an untracked file that already matches is adopted, not queried', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'generated\n')
  const plan = await planOne(root, entry('AGENTS.md', 'generated\n'))
  assert.equal(plan.action, ADOPT)
})

test('a file edited into exactly what we would write is adopted', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'v2\n')
  const plan = await planOne(root, entry('AGENTS.md', 'v2\n'), manifestWith({ 'AGENTS.md': hashContent('v1\n') }))
  assert.equal(plan.action, ADOPT)
})

test('a CRLF rewrite is not an edit', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'one\r\ntwo\r\n')
  const plan = await planOne(
    root,
    entry('AGENTS.md', 'one\ntwo\n'),
    manifestWith({ 'AGENTS.md': hashContent('one\ntwo\n') }),
  )
  assert.equal(plan.action, UNCHANGED)
})

// --- user-owned files ---------------------------------------------------------

test('a user-owned file that exists is kept, whatever it now contains', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'config.json'), '{"mine":true}\n')
  const plan = await planOne(root, { path: 'config.json', contents: '{}\n', ownership: 'user' })
  assert.equal(plan.action, KEPT)
})

test('applying a kept file writes nothing to disk', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'config.json'), '{"mine":true}\n')
  const items = await planFiles(root, [{ path: 'config.json', contents: '{}\n', ownership: 'user' }], emptyManifest())
  await applyPlan(items, { manifest: emptyManifest(), manifestPath: join(root, 'm.json') })
  assert.equal(await readFile(join(root, 'config.json'), 'utf8'), '{"mine":true}\n')
})

// --- apply: the refusals ------------------------------------------------------

test('an unresolved conflict is not written', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'mine\n')
  const manifest = manifestWith({ 'AGENTS.md': hashContent('ours\n') })
  const items = await planFiles(root, [entry('AGENTS.md', 'new\n')], manifest)

  await applyPlan(items, { manifest, manifestPath: join(root, 'm.json') })

  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'mine\n')
})

test('skipping a conflict leaves the manifest stale, so the next run asks again', async (t) => {
  const root = await tempDir(t)
  const manifestPath = join(root, 'm.json')
  await writeFile(join(root, 'AGENTS.md'), 'mine\n')
  const manifest = manifestWith({ 'AGENTS.md': hashContent('ours\n') })

  const first = await planFiles(root, [entry('AGENTS.md', 'new\n')], manifest)
  const applied = await applyPlan(first, { manifest, manifestPath, resolutions: new Map([['AGENTS.md', 'skip']]) })

  // Adopting the edited file's hash here would silently mark it as ours and
  // overwrite it without asking on the very next run.
  assert.equal(applied.manifest.files['AGENTS.md'], hashContent('ours\n'))

  const second = await planFiles(root, [entry('AGENTS.md', 'new\n')], applied.manifest)
  assert.equal(second[0].action, CONFLICT)
})

test('a conflict is written only when explicitly resolved to overwrite', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'mine\n')
  const manifest = manifestWith({ 'AGENTS.md': hashContent('ours\n') })
  const items = await planFiles(root, [entry('AGENTS.md', 'new\n')], manifest)

  const applied = await applyPlan(items, {
    manifest,
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['AGENTS.md', 'overwrite']]),
  })

  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'new\n')
  assert.equal(applied.manifest.files['AGENTS.md'], hashContent('new\n'))
})

test('dry run writes neither the file nor the manifest', async (t) => {
  const root = await tempDir(t)
  const manifestPath = join(root, '.nice-and-tidy', 'manifest.json')
  const items = await planFiles(root, [entry('AGENTS.md', 'hello\n')], emptyManifest())

  await applyPlan(items, { manifest: emptyManifest(), manifestPath, dryRun: true })

  await assert.rejects(() => readFile(join(root, 'AGENTS.md'), 'utf8'), { code: 'ENOENT' })
  assert.deepEqual((await readManifest(manifestPath)).files, {})
})

test('a run with nothing to do does not rewrite the manifest', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'hello\n')
  const manifest = manifestWith({ 'AGENTS.md': hashContent('hello\n') })
  const items = await planFiles(root, [entry('AGENTS.md', 'hello\n')], manifest)

  const applied = await applyPlan(items, { manifest, manifestPath: join(root, 'm.json') })

  assert.equal(applied.manifestChanged, false)
  await assert.rejects(() => readFile(join(root, 'm.json'), 'utf8'), { code: 'ENOENT' })
})

test('nested directories are created on the way', async (t) => {
  const root = await tempDir(t)
  const items = await planFiles(root, [entry('.claude/skills/x/SKILL.md', 'hi\n')], emptyManifest())
  await applyPlan(items, { manifest: emptyManifest(), manifestPath: join(root, 'm.json') })
  assert.equal(await readFile(join(root, '.claude/skills/x/SKILL.md'), 'utf8'), 'hi\n')
})

// --- manifest durability ------------------------------------------------------

test('a corrupt manifest degrades to conflict, not to overwrite', async (t) => {
  const root = await tempDir(t)
  const manifestPath = join(root, 'm.json')
  await writeFile(manifestPath, '{ not json')
  await writeFile(join(root, 'AGENTS.md'), 'mine\n')

  const manifest = await readManifest(manifestPath)
  const plan = await planOne(root, entry('AGENTS.md', 'new\n'), manifest)

  assert.deepEqual(manifest.files, {})
  assert.equal(plan.action, CONFLICT)
})

test('a manifest from a future version is ignored rather than half-trusted', async (t) => {
  const root = await tempDir(t)
  const manifestPath = join(root, 'm.json')
  await writeFile(manifestPath, JSON.stringify({ manifestVersion: 99, files: { 'AGENTS.md': hashContent('x') } }))
  assert.deepEqual((await readManifest(manifestPath)).files, {})
})

test('a manifest entry that is not a sha256 is dropped', async (t) => {
  const root = await tempDir(t)
  const manifestPath = join(root, 'm.json')
  await writeFile(manifestPath, JSON.stringify({ manifestVersion: 1, files: { a: 'nope', b: hashContent('x') } }))
  const manifest = await readManifest(manifestPath)
  assert.deepEqual(Object.keys(manifest.files), ['b'])
})
