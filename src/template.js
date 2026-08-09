/**
 * The smallest template engine that does the job, and no smaller.
 *
 * Phase 1 substitutes flat scalars — `{{ baseBranch }}` — and nothing else. No
 * conditionals, no loops, no partials. Anything that needs to *vary in structure*
 * with config (the branch table that only makes sense under Gitflow, per-target
 * shims) is deliberately not expressible yet; that is Phase 2's job, and leaving it
 * inexpressible is what stops Phase 1 from half-doing it.
 *
 * Lists are rendered into strings by the view model before they get here, so this
 * file never has to decide how a list should look.
 */

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g

export class TemplateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TemplateError'
  }
}

/**
 * Unknown or non-scalar placeholders throw rather than passing through.
 *
 * A `{{ repo }}` that silently survives into a user's AGENTS.md is worse than a
 * failed install: the install looks like it worked, and the breakage surfaces later
 * as an agent reading a literal pair of braces as if it were a repository name.
 */
export function render(source, model, { origin = 'template' } = {}) {
  const unknown = new Set()
  const nonScalar = new Set()

  const output = source.replace(PLACEHOLDER, (match, key) => {
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
