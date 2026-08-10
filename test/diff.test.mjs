import assert from 'node:assert/strict'
import { test } from 'node:test'

import { changeSummary, toLines, unifiedDiff } from '../src/diff.js'

const lines = (...items) => `${items.join('\n')}\n`

test('identical content produces no diff at all', () => {
  assert.equal(unifiedDiff(lines('a', 'b'), lines('a', 'b')), '')
})

test('a line-ending-only change is not a diff; it matches what the hash ignores', () => {
  assert.equal(unifiedDiff('a\r\nb\r\n', 'a\nb\n'), '')
})

/** Body lines only; the `---`/`+++` headers are not changes. */
const changedLines = (diff) => diff.split('\n').filter((line) => /^[-+][^-+]/.test(line))

test('a pure insertion shows one addition and no removals', () => {
  assert.deepEqual(changedLines(unifiedDiff(lines('a', 'b'), lines('a', 'c', 'b'))), ['+c'])
})

test('a pure deletion shows one removal and no additions', () => {
  assert.deepEqual(changedLines(unifiedDiff(lines('a', 'c', 'b'), lines('a', 'b'))), ['-c'])
})

test('a replaced line reads as the removal then the addition', () => {
  const diff = unifiedDiff(lines('base: develop'), lines('base: main'))
  const body = diff.split('\n').filter((l) => /^[-+][^-+]/.test(l))
  assert.deepEqual(body, ['-base: develop', '+base: main'])
})

test('hunk headers carry the line numbers', () => {
  const before = lines(...Array.from({ length: 40 }, (_, i) => `line ${i}`))
  const after = before.replace('line 20', 'line twenty')
  assert.match(unifiedDiff(before, after), /^@@ -\d+,\d+ \+\d+,\d+ @@$/m)
})

test('distant changes become separate hunks, not one giant one', () => {
  const before = lines(...Array.from({ length: 60 }, (_, i) => `line ${i}`))
  const after = before.replace('line 2\n', 'CHANGED\n').replace('line 55\n', 'ALSO\n')
  const hunks = unifiedDiff(before, after).match(/^@@/gm)
  assert.equal(hunks.length, 2)
})

test('adjacent changes stay in one hunk', () => {
  const before = lines(...Array.from({ length: 30 }, (_, i) => `line ${i}`))
  const after = before.replace('line 10\n', 'A\n').replace('line 11\n', 'B\n')
  assert.equal(unifiedDiff(before, after).match(/^@@/gm).length, 1)
})

test('creating content from nothing is all additions', () => {
  const diff = unifiedDiff('', lines('a', 'b'))
  assert.match(diff, /^\+a$/m)
  assert.match(diff, /^\+b$/m)
})

test('a missing trailing newline is called out rather than shown as a mystery', () => {
  assert.match(unifiedDiff(lines('a', 'b'), 'a\nb'), /No newline at end of file/)
})

test('a file past the size guard reports instead of allocating', () => {
  const huge = lines(...Array.from({ length: 2100 }, (_, i) => `a${i}`))
  const other = lines(...Array.from({ length: 2100 }, (_, i) => `b${i}`))
  const diff = unifiedDiff(huge, other)
  assert.match(diff, /too large to diff inline/)
  assert.match(diff, /2100 lines on disk/)
})

test('toLines does not invent a trailing empty line', () => {
  assert.deepEqual(toLines('a\nb\n'), ['a', 'b'])
  assert.deepEqual(toLines('a\nb'), ['a', 'b'])
  assert.deepEqual(toLines(''), [])
})

test('changeSummary counts both directions', () => {
  assert.equal(changeSummary(lines('a', 'b'), lines('a', 'c')), '+1 -1')
  assert.equal(changeSummary(lines('a'), lines('a', 'b')), '+1 -0')
})
