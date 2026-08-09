/**
 * The smallest template engine that does the job, and no smaller.
 *
 * Phase 1 substituted flat scalars — `{{ baseBranch }}` — and nothing else. Phase 2
 * adds one block form, `{{#if flag}}...{{else}}...{{/if}}`, for content that varies
 * in *structure* with config (the branch table that only makes sense under Gitflow).
 * Blocks do not nest — a template that needs nested conditionals is a template that
 * should be split, not an engine that should grow a parser.
 *
 * Lists are rendered into strings by the view model before they get here, so this
 * file never has to decide how a list should look.
 */

// `else` is reserved for `{{else}}` inside a conditional block — never a valid
// placeholder key, so the negative lookahead keeps it out of both the substitution
// pass and `placeholdersIn`'s static scan.
const PLACEHOLDER = /\{\{\s*(?!else\b)([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g
const CONDITIONAL = /\{\{#if\s+([A-Za-z][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/if\}\}/g
const ELSE = /\{\{else\}\}/

export class TemplateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TemplateError'
  }
}

/**
 * Resolves `{{#if flag}}` blocks before scalar substitution runs, so a placeholder
 * inside either branch is still filled by the normal pass below. `flag` must be a
 * boolean in the model — the same "fail loudly" rule as an unknown or non-string
 * scalar placeholder, for the same reason: a flag that silently evaluates falsy
 * ships the wrong branch instead of failing the build.
 */
function resolveConditionals(source, model, origin) {
  const unknown = new Set()
  const nonBoolean = new Set()

  const output = source.replace(CONDITIONAL, (match, key, body) => {
    if (!Object.hasOwn(model, key)) {
      unknown.add(key)
      return match
    }
    const value = model[key]
    if (typeof value !== 'boolean') {
      nonBoolean.add(`${key} (${typeof value})`)
      return match
    }
    const splitAt = body.search(ELSE)
    const ifBranch = splitAt === -1 ? body : body.slice(0, splitAt)
    const elseBranch = splitAt === -1 ? '' : body.slice(splitAt).replace(ELSE, '')
    return value ? ifBranch : elseBranch
  })

  if (unknown.size > 0) {
    throw new TemplateError(
      `${origin} has {{#if}} on ${plural(unknown.size, 'flag')} the view model does not define: ` +
        `${[...unknown].sort().join(', ')}.`,
    )
  }
  if (nonBoolean.size > 0) {
    throw new TemplateError(
      `${origin} has {{#if}} on ${plural(nonBoolean.size, 'value')} that is not a boolean: ` +
        `${[...nonBoolean].sort().join(', ')}.`,
    )
  }

  return output
}

/**
 * Unknown or non-scalar placeholders throw rather than passing through.
 *
 * A `{{ repo }}` that silently survives into a user's AGENTS.md is worse than a
 * failed install: the install looks like it worked, and the breakage surfaces later
 * as an agent reading a literal pair of braces as if it were a repository name.
 */
export function render(source, model, { origin = 'template' } = {}) {
  const afterConditionals = resolveConditionals(source, model, origin)

  const unknown = new Set()
  const nonScalar = new Set()

  const output = afterConditionals.replace(PLACEHOLDER, (match, key) => {
    if (!Object.hasOwn(model, key)) {
      unknown.add(key)
      return match
    }
    const value = model[key]
    if (typeof value !== 'string') {
      nonScalar.add(`${key} (${Array.isArray(value) ? 'array' : typeof value})`)
      return match
    }
    return value
  })

  if (unknown.size > 0) {
    throw new TemplateError(
      `${origin} uses ${plural(unknown.size, 'placeholder')} the view model does not define: ` +
        `${[...unknown].sort().join(', ')}.`,
    )
  }
  if (nonScalar.size > 0) {
    throw new TemplateError(
      `${origin} substitutes ${plural(nonScalar.size, 'value')} that is not a string: ` +
        `${[...nonScalar].sort().join(', ')}. ` +
        'Pre-render lists and objects into strings in the view model.',
    )
  }

  return output
}

/** Every placeholder a template mentions, for tests that assert the boundary. */
export function placeholdersIn(source) {
  return [...new Set([...source.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort()
}

function plural(n, word) {
  return n === 1 ? `a ${word}` : `${n} ${word}s`
}
