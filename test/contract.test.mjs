/**
 * Gates on the non-negotiables, not on the code.
 *
 * The top rule of this project is that shipped instruction copy never names a
 * specific agent or product. A rule that nothing checks is a rule that survives
 * exactly until the first hurried edit, so it gets a test like anything else.
 */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

import { defaultConfig, viewModel } from '../src/config.js'
import { placeholdersIn, render } from '../src/template.js'

const TEMPLATES = new URL('../templates/', import.meta.url).pathname

/**
 * Product names, not capabilities. "If you can run shell commands" is the phrasing
 * this list exists to force.
 */
const PRODUCT_NAMES = [
  'claude',
  'copilot',
  'cursor',
  'windsurf',
  'codex',
  'gemini',
  'aider',
  'devin',
  'chatgpt',
  'openai',
  'anthropic',
  'jetbrains',
  'zed',
]

const BANNED = new RegExp(`\\b(${PRODUCT_NAMES.join('|')})\\b`, 'i')

async function templateFiles() {
  const names = await readdir(TEMPLATES, { recursive: true, withFileTypes: true })
  return names
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name))
}

const read = (path) => readFile(path, 'utf8')

test('there are templates to check', async () => {
  assert.ok((await templateFiles()).length >= 6)
})

// --- the top non-negotiable ---------------------------------------------------

test('no shipped template names a specific agent or product', async () => {
  for (const file of await templateFiles()) {
    const contents = await read(file)
    const hit = BANNED.exec(contents)
    assert.equal(
      hit,
      null,
      `${file.replace(TEMPLATES, '')} names "${hit?.[1]}". Say what the agent must be able to *do*, ` +
        'not what it is called.',
    )
  }
})

test('the filename of a shim may name a product; its contents may not', async () => {
  // The filename is dictated by whatever loads it — that is a shim, not branding.
  // This test exists so the distinction is written down somewhere enforceable.
  const claudeShim = await read(join(TEMPLATES, 'shims', 'CLAUDE.md.tmpl'))
  assert.equal(BANNED.test(claudeShim), false)
  assert.match(claudeShim, /^@AGENTS\.md$/m, 'the import has to be the first line for the loader to follow it')
})

// --- every template renders, under both branch models -------------------------

test('every placeholder used is one the view model defines', async () => {
  const known = new Set(Object.keys(viewModel(defaultConfig())))
  for (const file of await templateFiles()) {
    for (const key of placeholdersIn(await read(file))) {
      assert.ok(known.has(key), `${file.replace(TEMPLATES, '')} uses {{ ${key} }}, which the view model does not define`)
    }
  }
})

for (const gitflow of [true, false]) {
  test(`every template renders cleanly with gitflow: ${gitflow}`, async () => {
    const model = viewModel(defaultConfig({ gitflow }))
    for (const file of await templateFiles()) {
      const rendered = render(await read(file), model, { origin: file })
      assert.doesNotMatch(rendered, /\{\{/, `${file.replace(TEMPLATES, '')} still has an unfilled placeholder`)
    }
  })
}

test('trunk-based output never mentions develop', async () => {
  const model = viewModel(defaultConfig({ gitflow: false }))
  for (const file of await templateFiles()) {
    const rendered = render(await read(file), model, { origin: file })
    assert.doesNotMatch(
      rendered,
      /\bdevelop\b/,
      `${file.replace(TEMPLATES, '')} refers to a develop branch that a trunk-based repo does not have`,
    )
  }
})

// --- honesty rules ------------------------------------------------------------

test('the commit convention says it is not enforced', async () => {
  const agents = await read(join(TEMPLATES, 'AGENTS.md.tmpl'))
  assert.match(agents, /Nothing enforces this/i)
})

test('session memory is stated to be file-only, in every file that mentions it', async () => {
  for (const file of await templateFiles()) {
    const contents = await read(file)
    if (!contents.includes('{{ memoryFile }}')) continue
    assert.match(
      contents,
      /never to (a|an) (GitHub|issue|PR) comment|not into an issue comment|and nowhere else/i,
      `${file.replace(TEMPLATES, '')} names the memory file without ruling out GitHub comments`,
    )
  }
})

test('the instruction file forbids fabricating GitHub identifiers', async () => {
  const agents = await read(join(TEMPLATES, 'AGENTS.md.tmpl'))
  assert.match(agents, /Never fabricate/i)
  assert.match(agents, /Re-query/i)
})

test('every shim points at AGENTS.md rather than forking it', async () => {
  const shims = (await templateFiles()).filter((file) => file.includes(`${join('templates', 'shims')}`))
  assert.ok(shims.length >= 4)
  for (const file of shims) {
    assert.match(await read(file), /AGENTS\.md/, `${file.replace(TEMPLATES, '')} does not point at AGENTS.md`)
  }
})
