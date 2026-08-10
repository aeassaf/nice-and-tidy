import { readFile } from 'node:fs/promises'

/**
 * Repo root, neutral name.
 *
 * The brief drafted `.claude/workflow.config.json` and flagged it as bikeshed-later.
 * A config path this product owns is shipped surface, and shipped surface does not
 * name a specific agent. `.claude/skills/` is the opposite case; that path is
 * dictated by a loader we are writing *to*, which makes it a shim rather than
 * branding.
 */
export const CONFIG_FILENAME = 'nice-and-tidy.config.json'

/**
 * Install targets. `agents-md` is the source of truth; the rest point at it.
 *
 * `windsurf` isn't here. Windsurf reads a root `AGENTS.md` natively; the same file
 * this tool already writes; and its own docs describe `.windsurfrules` as the
 * deprecated predecessor to that support, not a currently-recommended format. A shim
 * that points a deprecated file at a *replacement* mechanism is dead weight, not
 * defense in depth.
 *
 * Every entry here is a claim about what a third-party tool reads today, so each one
 * is worth re-checking against that tool's own docs before it is trusted; native
 * `AGENTS.md` support is exactly the kind of thing that lands in a point release and
 * turns a useful shim into dead weight.
 */
export const TARGETS = ['agents-md', 'claude', 'copilot', 'cursor']

const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const REPO_SLUG = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

export function defaultConfig(overrides = {}) {
  const base = {
    repo: null,
    defaultAssignee: null,
    gitflow: true,
    milestones: [],
    labels: [],
    scopes: [],
    board: { projectNumber: null, template: 'team-planning' },
    targets: [...TARGETS],
    protocol: {
      concise: true,
      memoryFile: 'docs/RESUME_HERE.md',
      statusBlockEveryResponse: true,
    },
  }
  return {
    ...base,
    ...overrides,
    board: { ...base.board, ...(overrides.board ?? {}) },
    protocol: { ...base.protocol, ...(overrides.protocol ?? {}) },
  }
}

/**
 * Unknown keys are warnings, not errors. A typo like `gitFlow` silently doing nothing
 * is the failure worth catching; refusing to run because a newer config carries a key
 * this version has not learned yet is not.
 */
export function validateConfig(config) {
  const errors = []
  const warnings = []

  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { errors: ['Config must be a JSON object.'], warnings }
  }

  const known = defaultConfig()
  for (const key of Object.keys(config)) {
    if (!Object.hasOwn(known, key)) {
      warnings.push(`Unknown key "${key}"; ignored. Check for a typo.`)
    }
  }

  if (config.repo !== null && config.repo !== undefined) {
    if (typeof config.repo !== 'string' || !REPO_SLUG.test(config.repo)) {
      errors.push('"repo" must be "owner/name", or null.')
    }
  }

  if (config.defaultAssignee !== null && config.defaultAssignee !== undefined) {
    if (typeof config.defaultAssignee !== 'string' || !USERNAME.test(config.defaultAssignee)) {
      errors.push('"defaultAssignee" must be a GitHub username, or null.')
    }
  }

  if (config.gitflow !== undefined && typeof config.gitflow !== 'boolean') {
    errors.push('"gitflow" must be true or false.')
  }

  for (const key of ['milestones', 'labels', 'scopes']) {
    const value = config[key]
    if (value === undefined) continue
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
      errors.push(`"${key}" must be an array of non-empty strings.`)
    }
  }

  if (config.board !== undefined) {
    const board = config.board
    if (board === null || typeof board !== 'object' || Array.isArray(board)) {
      errors.push('"board" must be an object.')
    } else {
      const n = board.projectNumber
      if (n !== null && n !== undefined && !(Number.isInteger(n) && n > 0)) {
        errors.push('"board.projectNumber" must be a positive integer, or null.')
      }
      if (board.template !== undefined && (typeof board.template !== 'string' || !board.template.trim())) {
        errors.push('"board.template" must be a non-empty string.')
      }
    }
  }

  if (config.targets !== undefined) {
    const targets = config.targets
    if (!Array.isArray(targets) || targets.length === 0) {
      errors.push(`"targets" must be a non-empty array. Known targets: ${TARGETS.join(', ')}.`)
    } else {
      const unknown = targets.filter((t) => !TARGETS.includes(t))
      if (unknown.length > 0) {
        errors.push(`"targets" has unknown ${unknown.length === 1 ? 'entry' : 'entries'}: ${unknown.join(', ')}. Known targets: ${TARGETS.join(', ')}.`)
      }
      if (new Set(targets).size !== targets.length) {
        errors.push('"targets" has duplicate entries.')
      }
      if (!targets.includes('agents-md')) {
        errors.push(
          '"targets" must include "agents-md". Every other target is a pointer to it, ' +
            'so dropping it leaves the shims pointing at a file that was never written.',
        )
      }
    }
  }

  if (config.protocol !== undefined) {
    const protocol = config.protocol
    if (protocol === null || typeof protocol !== 'object' || Array.isArray(protocol)) {
      errors.push('"protocol" must be an object.')
    } else {
      for (const key of ['concise', 'statusBlockEveryResponse']) {
        if (protocol[key] !== undefined && typeof protocol[key] !== 'boolean') {
          errors.push(`"protocol.${key}" must be true or false.`)
        }
      }
      if (protocol.memoryFile !== undefined) {
        errors.push(...validateMemoryFile(protocol.memoryFile))
      }
    }
  }

  return { errors, warnings }
}

/**
 * The memory file is written by an agent at the end of every session, so a bad value
 * here is a path traversal with a scheduler behind it.
 */
function validateMemoryFile(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return ['"protocol.memoryFile" must be a non-empty string.']
  }
  const path = value.replace(/\\/g, '/')
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
    return ['"protocol.memoryFile" must be relative to the repo root, not absolute.']
  }
  if (path.split('/').includes('..')) {
    return ['"protocol.memoryFile" must stay inside the repo; no ".." segments.']
  }
  if (!path.endsWith('.md')) {
    return ['"protocol.memoryFile" must be a markdown file (.md).']
  }
  return []
}

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

export async function readConfig(configPath) {
  let raw
  try {
    raw = await readFile(configPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON: ${error.message}`)
  }

  const { errors, warnings } = validateConfig(parsed)
  if (errors.length > 0) {
    throw new ConfigError(`${CONFIG_FILENAME} is invalid:\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  }

  return { config: defaultConfig(parsed), warnings }
}

export function serialiseConfig(config) {
  return `${JSON.stringify(config, null, 2)}\n`
}

/**
 * Flattens config into what templates are allowed to render: strings for
 * `{{ placeholder }}`, plus the small set of named booleans for `{{#if flag }}`; * see `template.js`. Nothing else survives this function; a template that needs a
 * new conditional gets a new named boolean here, not an object or array passed
 * through directly.
 */
export function viewModel(config) {
  const gitflow = config.gitflow !== false
  const scopes = config.scopes ?? []
  const labels = config.labels ?? []

  return {
    repo: config.repo ?? 'this repository',
    owner: config.repo ? config.repo.split('/')[0] : 'the repository owner',
    assignee: config.defaultAssignee ?? 'the repository owner',
    branchModel: gitflow ? 'Gitflow-shaped' : 'trunk-based',
    baseBranch: gitflow ? 'develop' : 'main',
    productionBranch: 'main',
    memoryFile: config.protocol?.memoryFile ?? 'docs/RESUME_HERE.md',
    commitScopes:
      scopes.length > 0
        ? scopes.map((s) => `\`${s}\``).join(', ')
        : 'no scopes are configured yet, so omit the parenthetical',
    labels:
      labels.length > 0
        ? labels.map((l) => `\`${l}\``).join(', ')
        : 'no labels are configured yet; use whatever the repo already has',
    // Boolean, for `{{#if gitflow}}`; every other key above is a string, for
    // `{{ placeholder }}`. The two forms are deliberately not interchangeable; see
    // template.js.
    gitflow,
  }
}
