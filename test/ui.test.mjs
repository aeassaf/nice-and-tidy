import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { createPrompter, printDiff } from '../src/ui.js'

function prompter() {
  const input = new PassThrough()
  const output = new PassThrough()
  return { input, output, prompter: createPrompter({ input, output }) }
}

async function answerWith(text) {
  const { input, prompter: p } = prompter()
  const pending = p.ask()
  input.write(text)
  const result = await pending
  p.close()
  return result
}

test('y overwrites', async () => {
  assert.equal(await answerWith('y\n'), 'overwrite')
  assert.equal(await answerWith('YES\n'), 'overwrite')
})

test('a is abort', async () => {
  assert.equal(await answerWith('a\n'), 'abort')
})

test('a bare Enter keeps the existing file', async () => {
  assert.equal(await answerWith('\n'), 'skip')
})

test('anything unrecognised keeps the existing file', async () => {
  // The default has to be the answer that cannot destroy work, including for a
  // fat-fingered response.
  for (const text of ['n\n', 'yeah ok\n', 'Y E S\n', '  \n']) {
    assert.equal(await answerWith(text), 'skip', `expected ${JSON.stringify(text)} to be a skip`)
  }
})

test('a second question on the same prompter still gets an answer', async () => {
  // One interface for the run, not one per file: closing an interface built on stdin
  // pauses it, and the next question would silently read EOF.
  const { input, prompter: p } = prompter()

  const first = p.ask()
  input.write('y\n')
  assert.equal(await first, 'overwrite')

  const second = p.ask()
  input.write('a\n')
  assert.equal(await second, 'abort')

  p.close()
})

test('printDiff writes something for every conflicted file', () => {
  const lines = []
  printDiff({ path: 'AGENTS.md', actual: 'a\nb\n', desired: 'a\nc\n' }, (line) => lines.push(line))
  assert.ok(lines.some((line) => line.includes('-b')))
  assert.ok(lines.some((line) => line.includes('+c')))
})

test('printDiff still shows a hunk when only the trailing newline differs', () => {
  // A conflict that renders nothing is the one failure mode that would make the
  // "diff and ask" promise useless.
  const lines = []
  printDiff({ path: 'AGENTS.md', actual: 'a\nb', desired: 'a\nb\n' }, (line) => lines.push(line))
  assert.ok(lines.length > 0)
  assert.ok(lines.some((line) => line.includes('No newline at end of file')))
})
