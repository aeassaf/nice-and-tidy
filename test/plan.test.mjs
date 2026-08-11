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
import {
  ADOPT,
  CONFLICT,
  CREATE,
  FORGET,
  GENERATED,
  KEPT,
  ORPHANED,
  REMOVE,
  UNCHANGED,
  UPDATE,
  applyPlan,
  planFiles,
  planRemovals,
} from '../src/plan.js'
import { appendRegion, findRegion, wrapRegion } from '../src/region.js'
import { packageVersion } from '../src/version.js'
import { tempDir } from './helpers.mjs'

const entry = (path, contents, ownership = GENERATED) => ({ path, contents, ownership })

const appendable = (path, contents) => ({ ...entry(path, contents), appendable: true })

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
  const manifest = { ...manifestWith({ 'AGENTS.md': hashContent('hello\n') }), generatorVersion: await packageVersion() }
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

// --- append: the third answer -------------------------------------------------

const MINE = '# My own instructions\n\nNever deploy on a Friday.\n'

test('appending keeps what was there and adds our content below it', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), MINE)
  const items = await planFiles(root, [appendable('AGENTS.md', 'generated\n')], emptyManifest())

  assert.equal(items[0].action, CONFLICT)
  await applyPlan(items, {
    manifest: emptyManifest(),
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['AGENTS.md', 'append']]),
  })

  const written = await readFile(join(root, 'AGENTS.md'), 'utf8')
  assert.ok(written.startsWith(MINE), "the user's content was moved or lost")
  assert.equal(findRegion(written).body, 'generated\n')
})

test('an appended file records the block, never the whole file', async (t) => {
  // The one that matters. Recording the whole file would make the next run read
  // `update` — the file on disk matching what we last wrote — and replace somebody's
  // own instructions with a bare copy of ours, without asking.
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), MINE)
  const items = await planFiles(root, [appendable('AGENTS.md', 'generated\n')], emptyManifest())

  const applied = await applyPlan(items, {
    manifest: emptyManifest(),
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['AGENTS.md', 'append']]),
  })

  assert.equal(applied.manifest.files['AGENTS.md'], hashContent('generated\n'))
  assert.notEqual(applied.manifest.files['AGENTS.md'], hashContent(await readFile(join(root, 'AGENTS.md'), 'utf8')))
})

test('a re-run over an appended file asks nothing and writes nothing', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), appendRegion(MINE, 'generated\n'))
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })

  const plan = await planOne(root, appendable('AGENTS.md', 'generated\n'), manifest)

  assert.equal(plan.action, UNCHANGED)
})

test('editing outside the block is not an edit of ours', async (t) => {
  // The whole point of a region. Their half of the file is theirs, and a tool that
  // asked about every change to it would be unusable in the repo it was installed in.
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), appendRegion(`${MINE}\n- And one more rule.\n`, 'generated\n'))
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })

  assert.equal((await planOne(root, appendable('AGENTS.md', 'generated\n'), manifest)).action, UNCHANGED)
})

test('editing inside the block is a conflict, and the diff is scoped to the block', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), appendRegion(MINE, 'generated, then edited\n'))
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })

  const plan = await planOne(root, appendable('AGENTS.md', 'generated\n'), manifest)

  assert.equal(plan.action, CONFLICT)
  assert.equal(plan.reason, 'region-edited')
  assert.ok(plan.write.startsWith(MINE), 'answering this conflict must not take the whole file')
})

test('a config change updates the block and leaves the rest of the file alone', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), appendRegion(MINE, 'base: develop\n'))
  const manifest = manifestWith({ 'AGENTS.md': hashContent('base: develop\n') })
  const items = await planFiles(root, [appendable('AGENTS.md', 'base: main\n')], manifest)

  assert.equal(items[0].action, UPDATE)
  await applyPlan(items, { manifest, manifestPath: join(root, 'm.json') })

  const written = await readFile(join(root, 'AGENTS.md'), 'utf8')
  assert.ok(written.startsWith(MINE))
  assert.equal(findRegion(written).body, 'base: main\n')
})

test('an update over an appended file does not grow it a line at a time', async (t) => {
  const root = await tempDir(t)
  const path = join(root, 'AGENTS.md')
  await writeFile(path, appendRegion(MINE, 'v1\n'))
  let manifest = manifestWith({ 'AGENTS.md': hashContent('v1\n') })

  for (const version of ['v2\n', 'v3\n']) {
    const items = await planFiles(root, [appendable('AGENTS.md', version)], manifest)
    manifest = (await applyPlan(items, { manifest, manifestPath: join(root, 'm.json') })).manifest
  }

  assert.equal(await readFile(path, 'utf8'), appendRegion(MINE, 'v3\n'))
})

// --- append: the refusals -----------------------------------------------------

test('a file that did not opt in is never appended to', async (t) => {
  // Its generated content opens with frontmatter, which means nothing halfway down a
  // file — and the markers are an HTML comment, which is a syntax error in a workflow.
  const root = await tempDir(t)
  await writeFile(join(root, 'rules.mdc'), MINE)
  const items = await planFiles(root, [entry('rules.mdc', 'generated\n')], emptyManifest())

  assert.equal(items[0].appendWrite, undefined)
  await applyPlan(items, {
    manifest: emptyManifest(),
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['rules.mdc', 'append']]),
  })

  assert.equal(await readFile(join(root, 'rules.mdc'), 'utf8'), MINE, 'append fell through to a write it cannot do')
})

test('an append asked for on a file that cannot take one leaves the manifest stale', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'rules.mdc'), MINE)
  const items = await planFiles(root, [entry('rules.mdc', 'generated\n')], emptyManifest())

  const applied = await applyPlan(items, {
    manifest: emptyManifest(),
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['rules.mdc', 'append']]),
  })

  // Same rule as a skip: recording anything here marks the file as ours and the next
  // run overwrites it without asking.
  assert.equal(applied.manifest.files['rules.mdc'], undefined)
})

test('a file this tool wrote and somebody then edited is not offered an append', async (t) => {
  // Append answers "this file is somebody else's and both lots of content should
  // survive." Here the content already is a copy of ours, and appending would leave
  // two of them in one file. That conflict is about a version, and overwrite or
  // keep-mine are its answers.
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'generated\nmy own note\n')
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })

  const plan = await planOne(root, appendable('AGENTS.md', 'generated\n'), manifest)

  assert.equal(plan.reason, 'edited')
  assert.equal(plan.appendWrite, undefined)
})

test('an append asked for on our own edited file writes nothing at all', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), 'generated\nmy own note\n')
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })
  const items = await planFiles(root, [appendable('AGENTS.md', 'generated\n')], manifest)

  const applied = await applyPlan(items, {
    manifest,
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['AGENTS.md', 'append']]),
  })

  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'generated\nmy own note\n')
  assert.equal(applied.manifest.files['AGENTS.md'], hashContent('generated\n'), 'the stale record has to survive')
})

test('deleting the markers degrades to a conflict, not to a silent overwrite', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), `${MINE}\ngenerated\n`)
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })

  const plan = await planOne(root, appendable('AGENTS.md', 'generated\n'), manifest)

  assert.equal(plan.action, CONFLICT)
})

test('pasting a second pair of markers degrades to a conflict too', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), `${appendRegion(MINE, 'generated\n')}${wrapRegion('generated\n')}`)
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })

  const plan = await planOne(root, appendable('AGENTS.md', 'generated\n'), manifest)

  assert.equal(plan.action, CONFLICT, 'two regions is a guess, and a guess here rewrites bytes we did not write')
})

test('appending a second time rewrites the block instead of stacking another one', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), appendRegion(MINE, 'edited by hand\n'))
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })
  const items = await planFiles(root, [appendable('AGENTS.md', 'generated\n')], manifest)

  await applyPlan(items, {
    manifest,
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['AGENTS.md', 'append']]),
  })

  const written = await readFile(join(root, 'AGENTS.md'), 'utf8')
  assert.equal(written, appendRegion(MINE, 'generated\n'))
  assert.equal(written.match(/nice-and-tidy:begin/g).length, 1)
})

test('overwrite on a file that is only partly ours still only takes the block', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'AGENTS.md'), appendRegion(MINE, 'edited by hand\n'))
  const manifest = manifestWith({ 'AGENTS.md': hashContent('generated\n') })
  const items = await planFiles(root, [appendable('AGENTS.md', 'generated\n')], manifest)

  await applyPlan(items, {
    manifest,
    manifestPath: join(root, 'm.json'),
    resolutions: new Map([['AGENTS.md', 'overwrite']]),
  })

  assert.ok((await readFile(join(root, 'AGENTS.md'), 'utf8')).startsWith(MINE))
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

// --- the other direction: a target that went away -----------------------------
//
// Every test below is about the same question asked in reverse — "is this file mine
// to take away." The manifest answers it, and the answer has to be no by default:
// getting an update wrong shows somebody a diff, getting a removal wrong loses a
// file that may never have been committed.

const candidate = (path, extra = {}) => ({ path, target: 'copilot', appendable: false, ...extra })

const planOneRemoval = (root, item, manifest = emptyManifest()) =>
  planRemovals(root, [item], manifest).then((r) => r[0])

test('ours, untouched → removed', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), 'ours\n')
  const plan = await planOneRemoval(root, candidate('shim.md'), manifestWith({ 'shim.md': hashContent('ours\n') }))
  assert.equal(plan.action, REMOVE)
})

test('ours, then edited → orphaned, never removed', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), 'ours, plus my note\n')
  const plan = await planOneRemoval(root, candidate('shim.md'), manifestWith({ 'shim.md': hashContent('ours\n') }))
  assert.equal(plan.action, ORPHANED)
  assert.equal(plan.reason, 'edited')
})

test('never ours → orphaned, never removed', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), 'somebody else wrote this\n')
  const plan = await planOneRemoval(root, candidate('shim.md'))
  assert.equal(plan.action, ORPHANED)
  assert.equal(plan.reason, 'untracked')
})

test('a hash that only differs by a trailing edit is still not ours to delete', async (t) => {
  // The near miss is the dangerous one: a file that is 99% what we wrote is a file
  // somebody added one line to, and that line is the part with their work in it.
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), 'ours\n\nand one line of mine\n')
  const plan = await planOneRemoval(root, candidate('shim.md'), manifestWith({ 'shim.md': hashContent('ours\n') }))
  assert.equal(plan.action, ORPHANED)
})

test('nothing on disk is nothing to report — only a stale manifest entry to drop', async (t) => {
  const root = await tempDir(t)
  const gone = await planOneRemoval(root, candidate('shim.md'), manifestWith({ 'shim.md': hashContent('ours\n') }))
  assert.equal(gone.action, FORGET)

  const never = await planOneRemoval(root, candidate('shim.md'))
  assert.equal(never, undefined, 'no file, no record — there is nothing to say about it')
})

test('an appended file loses its block, not the file', async (t) => {
  const root = await tempDir(t)
  const mine = '# mine\n'
  await writeFile(join(root, 'shim.md'), appendRegion(mine, 'ours\n'))

  const plan = await planOneRemoval(
    root,
    candidate('shim.md', { appendable: true }),
    // What the manifest holds for an appended file is the region's interior, never
    // the whole file — the invariant the append feature rests on.
    manifestWith({ 'shim.md': hashContent('ours\n') }),
  )

  assert.equal(plan.action, REMOVE)
  assert.equal(plan.strip, mine, 'the bytes that stay are theirs, exactly as they were')
})

test('an appended file whose block was edited is orphaned, not stripped', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), appendRegion('# mine\n', 'ours, edited\n'))
  const plan = await planOneRemoval(
    root,
    candidate('shim.md', { appendable: true }),
    manifestWith({ 'shim.md': hashContent('ours\n') }),
  )
  assert.equal(plan.action, ORPHANED)
  assert.equal(plan.reason, 'region-edited')
})

test('a file that is only a region is deleted rather than left empty', async (t) => {
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), wrapRegion('ours\n'))
  const plan = await planOneRemoval(
    root,
    candidate('shim.md', { appendable: true }),
    manifestWith({ 'shim.md': hashContent('ours\n') }),
  )
  assert.equal(plan.action, REMOVE)
  assert.equal(plan.strip, undefined, 'undefined strip is what tells applyPlan to unlink')
})

// --- applying a removal --------------------------------------------------------

test('applying a removal deletes the file and forgets it', async (t) => {
  const root = await tempDir(t)
  const path = join(root, 'shim.md')
  await writeFile(path, 'ours\n')
  const manifest = manifestWith({ 'shim.md': hashContent('ours\n'), 'AGENTS.md': hashContent('a\n') })

  const removals = await planRemovals(root, [candidate('shim.md')], manifest)
  const result = await applyPlan([], { manifest, manifestPath: join(root, 'm.json'), removals })

  assert.equal(await readFile(path, 'utf8').then(() => true, () => false), false)
  assert.deepEqual(Object.keys(result.manifest.files), ['AGENTS.md'], 'a stale entry would re-claim the path')
  assert.equal(result.removed.length, 1)
})

test('a dry run removes nothing and rewrites no manifest', async (t) => {
  const root = await tempDir(t)
  const path = join(root, 'shim.md')
  await writeFile(path, 'ours\n')
  const manifest = manifestWith({ 'shim.md': hashContent('ours\n') })

  const removals = await planRemovals(root, [candidate('shim.md')], manifest)
  await applyPlan([], { manifest, manifestPath: join(root, 'm.json'), removals, dryRun: true })

  assert.equal(await readFile(path, 'utf8'), 'ours\n')
})

test('an orphan keeps its manifest entry, so re-selecting the target still asks', async (t) => {
  // Dropping the entry here would make the file untracked. A later run that turned
  // the target back on would read untracked as "not ours" — which is a conflict, so
  // it would still ask. But the entry is also the record of what we last wrote, and
  // throwing it away for a file we deliberately did not touch is a lie about history.
  const root = await tempDir(t)
  await writeFile(join(root, 'shim.md'), 'ours, edited\n')
  const manifest = manifestWith({ 'shim.md': hashContent('ours\n') })

  const removals = await planRemovals(root, [candidate('shim.md')], manifest)
  const result = await applyPlan([], { manifest, manifestPath: join(root, 'm.json'), removals })

  assert.equal(await readFile(join(root, 'shim.md'), 'utf8'), 'ours, edited\n')
  assert.equal(result.manifest.files['shim.md'], hashContent('ours\n'))
  assert.equal(result.removed.length, 0)
})

test('applying a strip keeps their content and forgets the path', async (t) => {
  const root = await tempDir(t)
  const path = join(root, 'shim.md')
  await writeFile(path, appendRegion('# mine\n', 'ours\n'))
  const manifest = manifestWith({ 'shim.md': hashContent('ours\n') })

  const removals = await planRemovals(root, [candidate('shim.md', { appendable: true })], manifest)
  const result = await applyPlan([], { manifest, manifestPath: join(root, 'm.json'), removals })

  assert.equal(await readFile(path, 'utf8'), '# mine\n')
  assert.equal(result.manifest.files['shim.md'], undefined)
})
