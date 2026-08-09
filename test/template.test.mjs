import assert from 'node:assert/strict'
import { test } from 'node:test'

import { TemplateError, placeholdersIn, render } from '../src/template.js'

test('a placeholder is substituted, with or without inner spaces', () => {
  assert.equal(render('base {{baseBranch}} and {{ baseBranch }}', { baseBranch: 'develop' }), 'base develop and develop')
})

test('a template with no placeholders passes through untouched', () => {
  const source = '# Title\n\nNothing to fill in here.\n'
  assert.equal(render(source, {}), source)
})

// --- negative: the whole point is that it fails loudly ------------------------

test('an unknown placeholder throws instead of shipping braces into a real file', () => {
  assert.throws(() => render('see {{ nope }}', { baseBranch: 'develop' }), TemplateError)
})

test('the error names every missing key at once, not just the first', () => {
  try {
    render('{{ alpha }} {{ beta }}', {})
    assert.fail('expected a TemplateError')
  } catch (error) {
    assert.match(error.message, /alpha/)
    assert.match(error.message, /beta/)
  }
})

test('the error names the template it came from', () => {
  assert.throws(
    () => render('{{ nope }}', {}, { origin: 'templates/AGENTS.md.tmpl' }),
    /templates\/AGENTS\.md\.tmpl/,
  )
})

test('a non-string value is refused rather than stringified', () => {
  for (const value of [['a', 'b'], { a: 1 }, 3, true, null]) {
    assert.throws(() => render('{{ scopes }}', { scopes: value }), TemplateError, `expected ${JSON.stringify(value)} to be refused`)
  }
})

test('a value that is itself a placeholder is not re-expanded', () => {
  // Otherwise config content could inject template syntax into a generated file.
  assert.equal(render('{{ repo }}', { repo: '{{ baseBranch }}', baseBranch: 'develop' }), '{{ baseBranch }}')
})

test('placeholdersIn lists each key once, sorted', () => {
  assert.deepEqual(placeholdersIn('{{ b }} {{ a }} {{ b }}'), ['a', 'b'])
})
