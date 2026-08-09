import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Provenance for every file this tool writes: path → sha256 of the content we wrote.
 *
 * This is what makes "re-runnable without clobbering" possible at all. Comparing the
 * file on disk against the content we are *about to* write only answers "are these
 * the same," which cannot distinguish the two cases that matter:
 *
 *   - a generated file nobody has touched, which a new config should update
 *   - a generated file somebody edited, which nothing should touch without asking
 *
 * Both differ from the desired content. Only a record of what we last wrote tells
 * them apart.
 *
 * Kept out of the config file deliberately. The config is the user's after its first
 * write; mixing machine-maintained hashes into a file humans edit means every re-run
 * dirties it, and hashing a file that contains its own hash does not terminate.
 */

export const MANIFEST_VERSION = 1

export function emptyManifest() {
  return { manifestVersion: MANIFEST_VERSION, files: {} }
}

export async function readManifest(manifestPath) {
  let raw
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return emptyManifest()
    throw error
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A corrupt manifest must not be load-bearing. Treating it as empty degrades to
    // "every generated file looks foreign," which stops and asks — the safe failure.
    return emptyManifest()
  }

  if (parsed?.manifestVersion !== MANIFEST_VERSION || typeof parsed.files !== 'object' || parsed.files === null) {
    return emptyManifest()
  }

  const files = {}
  for (const [path, hash] of Object.entries(parsed.files)) {
    if (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) files[path] = hash
  }
  return { manifestVersion: MANIFEST_VERSION, files }
}

/** Keys are sorted so a re-run never produces a reordered, noisy git diff. */
export function serialiseManifest(manifest) {
  const files = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  return `${JSON.stringify({ manifestVersion: MANIFEST_VERSION, files }, null, 2)}\n`
}

export async function writeManifest(manifestPath, manifest) {
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, serialiseManifest(manifest), 'utf8')
}
