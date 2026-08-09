/**
 * Tests for the PR description gate. Run with:  node --test scripts/
 *
 * A gate is only trustworthy if something proves it FAILS on a deliberate violation.
 * Most of these are negative tests for exactly that reason.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { validate, parseSections, REQUIRED_SECTIONS } from './check-pr-description.mjs'

const TEMPLATE = fileURLToPath(new URL('../.github/pull_request_template.md', import.meta.url))

/** The one line every "reject this content" test swaps out. */
const TRICKY = 'The refraction reads scroll position on the compositor, not the main thread.'

/** A description that satisfies every section. */
const filled = `
## Issues
Rebuild the nav so it survives the chapter transition.

## What's tricky
${TRICKY}

## How to test
- \`pnpm dev\`
- Scroll past CH.02 and watch the nav

## Dependencies
None

## Screenshots
None — no user-visible change.
`

const sectionsIn = (body) => [...parseSections(body).keys()]

// --- positive ---------------------------------------------------------------

test('a fully filled description passes', () => {
  assert.deepEqual(validate(filled), [])
})

test('"None" counts as an answer for Dependencies and Screenshots', () => {
  const problems = validate(filled)
  assert.equal(problems.filter((p) => p.section === 'Dependencies').length, 0)
  assert.equal(problems.filter((p) => p.section === 'Screenshots').length, 0)
})

test('section order is not enforced', () => {
  const reordered = `
## Screenshots
None
## Dependencies
None
## How to test
- run it
## What's tricky
Nothing
## Issues
Bump a dep.
`
  assert.deepEqual(validate(reordered), [])
})

test('heading matching tolerates curly apostrophes, colons and closing hashes', () => {
  const noisy = filled
    .replace("## What's tricky", '## What’s tricky: ##')
    .replace('## Dependencies', '##   Dependencies   ')
  assert.deepEqual(validate(noisy), [])
})

test('level-3 headings are content, not section boundaries', () => {
  const nested = filled.replace(
    '## How to test\n- `pnpm dev`',
    '## How to test\n### On desktop\n- `pnpm dev`',
  )
  assert.deepEqual(validate(nested), [])
})

test('a fenced code block alone is enough content', () => {
  const codeOnly = filled.replace(
    '- `pnpm dev`\n- Scroll past CH.02 and watch the nav',
    '```bash\npnpm dev\n```',
  )
  assert.deepEqual(validate(codeOnly), [])
})

// --- negative: each one proves the gate actually fails ----------------------

test('the untouched template fails every section', () => {
  const problems = validate(readFileSync(TEMPLATE, 'utf8'))
  assert.equal(problems.length, REQUIRED_SECTIONS.length)
  for (const name of REQUIRED_SECTIONS) {
    assert.ok(
      problems.some((p) => p.section === name && /is empty/.test(p.problem)),
      `expected "${name}" to be reported empty`,
    )
  }
})

test('an empty description fails', () => {
  assert.equal(validate('').length, 1)
  assert.equal(validate('   \n\n  ').length, 1)
})

test('a free-form description with no headings fails all five', () => {
  const problems = validate('Fixed the thing. Should be fine.')
  assert.equal(problems.length, 5)
  assert.ok(problems.every((p) => /Missing/.test(p.problem)))
})

for (const missing of REQUIRED_SECTIONS) {
  test(`deleting "${missing}" fails the gate`, () => {
    const body = filled
      .split('\n## ')
      .filter((chunk, i) => i === 0 || !chunk.startsWith(missing))
      .join('\n## ')
    const problems = validate(body)
    assert.equal(problems.length, 1)
    assert.equal(problems[0].section, missing)
    assert.match(problems[0].problem, /Missing/)
  })
}

test('a section left as a guidance comment is empty, not filled', () => {
  const commented = filled.replace(
    'Rebuild the nav so it survives the chapter transition.',
    '<!-- a ticket link, or a description of the task -->',
  )
  const problems = validate(commented)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].section, 'Issues')
})

test('a multi-line comment does not swallow the headings that follow it', () => {
  const commented = filled.replace(TRICKY, '<!--\n## How to test\n## Dependencies\n-->')
  // The commented-out headings must not register as real sections...
  const problems = validate(commented)
  assert.equal(problems.length, 1)
  assert.equal(problems[0].section, "What's tricky")
  // ...and the real ones further down must still be found.
  assert.ok(sectionsIn(commented).includes('how to test'))
})

test('placeholder punctuation is not content', () => {
  for (const junk of ['...', '-', '*', '> ', '| |']) {
    const problems = validate(filled.replace(TRICKY, junk))
    assert.equal(problems.length, 1, `expected "${junk}" to be rejected`)
    assert.equal(problems[0].section, "What's tricky")
  }
})

test('a heading with no body before the next heading is empty', () => {
  const problems = validate(filled.replace('## Dependencies\nNone', '## Dependencies'))
  assert.equal(problems.length, 1)
  assert.equal(problems[0].section, 'Dependencies')
})

test('CRLF line endings parse identically — GitHub sends them', () => {
  assert.deepEqual(validate(filled.replace(/\n/g, '\r\n')), [])
})

test('the template declares exactly the sections the gate requires', () => {
  const declared = sectionsIn(readFileSync(TEMPLATE, 'utf8'))
  assert.deepEqual(
    declared,
    REQUIRED_SECTIONS.map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()),
  )
})
