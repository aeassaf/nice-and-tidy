import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

export class GhError extends Error {
  constructor(message, { stderr } = {}) {
    super(message)
    this.name = 'GhError'
    this.stderr = stderr
  }
}

/**
 * The one place this tool shells out to the `gh` CLI. Everything above this function
 * takes an injectable `exec` — the same DI shape `init.js` already uses for I/O — so
 * bootstrap's own logic (what to create, what to skip) is testable without a real
 * `gh` binary or a real network call.
 */
export async function gh(args) {
  try {
    const { stdout } = await run('gh', args, { encoding: 'utf8' })
    return stdout.trim()
  } catch (error) {
    const stderr = error.stderr?.trim()
    throw new GhError(`gh ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`, { stderr })
  }
}

/**
 * Whether `gh` itself is reachable and logged in. Everything bootstrap does past the
 * file-copy step needs this — refusing loudly here, before any label or milestone
 * call, is what stops a half-finished run with no clear cause.
 */
export async function authStatus(exec = gh) {
  try {
    await exec(['auth', 'status'])
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: error instanceof GhError ? error.message : String(error) }
  }
}

export async function existingLabels(repo, exec = gh) {
  const json = await exec(['label', 'list', '--repo', repo, '--json', 'name', '--limit', '1000'])
  return new Set(JSON.parse(json).map((label) => label.name))
}

export async function createLabel(repo, name, exec = gh) {
  await exec(['label', 'create', name, '--repo', repo])
}

export async function existingMilestones(repo, exec = gh) {
  // state=all: an existing closed milestone with the same title still collides on
  // create. The default open-only listing would miss that and try anyway.
  const json = await exec(['api', `repos/${repo}/milestones?state=all`, '--jq', '[.[].title]'])
  return new Set(JSON.parse(json))
}

export async function createMilestone(repo, title, exec = gh) {
  await exec(['api', `repos/${repo}/milestones`, '-f', `title=${title}`])
}
