import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests run against plain directories, not git repos. `init` falls back to the cwd
 * when `git rev-parse` finds nothing, which keeps the suite hermetic — no git binary,
 * no network, no shared state. Remote parsing is tested as the pure function it is.
 */
export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nice-and-tidy-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

export const CLI = new URL('../bin/cli.js', import.meta.url).pathname
