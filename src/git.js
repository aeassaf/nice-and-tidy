import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Local `git` only. Phase 1 makes no network calls of any kind; reading a remote URL
 * out of `.git/config` is how `init` can fill in `repo` and `defaultAssignee` without
 * asking, and without touching GitHub.
 */
async function git(args, cwd) {
  try {
    const { stdout } = await run('git', args, { cwd, encoding: 'utf8' })
    return stdout.trim()
  } catch {
    return null
  }
}

export async function findRepoRoot(cwd) {
  return git(['rev-parse', '--show-toplevel'], cwd)
}

export async function currentBranch(cwd) {
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
}

/** Handles the ssh, scp-style and https remote forms. Returns `owner/name` or null. */
export function parseRemote(url) {
  if (typeof url !== 'string' || url.trim() === '') return null
  const match = /[:/]([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!match) return null
  const [, owner, name] = match
  if (owner === '' || name === '') return null
  return `${owner}/${name}`
}

export async function detectRepoSlug(cwd, remote = 'origin') {
  return parseRemote(await git(['remote', 'get-url', remote], cwd))
}
