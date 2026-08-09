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

// --- conditionals ---------------------------------------------------------------

test('an if block keeps its body when the flag is true', () => {
  assert.equal(render('{{#if gitflow}}develop{{/if}}', { gitflow: true }), 'develop')
})

test('an if block drops its body when the flag is false', () => {
  assert.equal(render('{{#if gitflow}}develop{{/if}}', { gitflow: false }), '')
})

test('an if/else block picks the matching branch', () => {
  const source = '{{#if gitflow}}develop{{else}}main{{/if}}'
  assert.equal(render(source, { gitflow: true }), 'develop')
  assert.equal(render(source, { gitflow: false }), 'main')
})

test('a placeholder inside a conditional branch is still substituted', () => {
  const source = '{{#if gitflow}}base: {{ baseBranch }}{{/if}}'
  assert.equal(render(source, { gitflow: true, baseBranch: 'develop' }), 'base: develop')
})

test('a dropped branch does not have to satisfy the placeholder rules', () => {
  // The else branch below mentions {{ nope }}, which is not in the model — it never
  // has to be, because gitflow: true never renders it.
  const source = '{{#if gitflow}}fine{{else}}{{ nope }}{{/if}}'
  assert.equal(render(source, { gitflow: true }), 'fine')
})

test('an unknown flag throws instead of shipping both branches unresolved', () => {
  assert.throws(() => render('{{#if nope}}a{{/if}}', {}), TemplateError)
})

test('a non-boolean flag is refused', () => {
  assert.throws(() => render('{{#if repo}}a{{/if}}', { repo: 'owner/name' }), TemplateError)
})

test('placeholdersIn does not mistake {{else}} for a scalar placeholder named "else"', () => {
  assert.deepEqual(placeholdersIn('{{#if gitflow}}a{{else}}b{{/if}}'), [])
})

test('if blocks do not nest', () => {
  // Documented, not supported: the lazy match closes on the *inner* {{/if}}, so the
  // outer block's body is read as "{{#if b}}x" and the true outer closing tag is left
  // dangling as literal text in the output.
  const source = '{{#if a}}{{#if b}}x{{/if}}{{/if}}'
  assert.equal(render(source, { a: true, b: true }), '{{#if b}}x{{/if}}')
})
