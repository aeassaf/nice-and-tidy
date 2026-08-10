import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { hashContent } from './hash.js'
import { serialiseManifest, writeManifest } from './manifest.js'
import { packageVersion } from './version.js'

/**
 * Every file this tool writes lands in exactly one of these states. The whole point
 * of the manifest is that `conflict` and `update` are distinguishable — both differ
 * from what we want on disk, and only one of them is safe to overwrite.
 */
export const CREATE = 'create'
export const UPDATE = 'update'
export const UNCHANGED = 'unchanged'
export const ADOPT = 'adopt'
export const KEPT = 'kept'
export const CONFLICT = 'conflict'

/** Ownership decides whether a second run is allowed to touch an existing file. */
export const GENERATED = 'generated'
export const USER = 'user'

export async function planFiles(root, entries, manifest) {
  return Promise.all(entries.map((entry) => planFile(root, entry, manifest)))
}

async function planFile(root, entry, manifest) {
  const absolute = join(root, entry.path)
  const desired = entry.contents

  let actual = null
  try {
    actual = await readFile(absolute, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const item = { ...entry, absolute, desired, actual }

  if (actual === null) return { ...item, action: CREATE, hash: hashContent(desired) }

  // The config belongs to whoever edited it last, which after the first run is never
  // us. A later `init` reads it; it does not get to rewrite it.
  if (entry.ownership === USER) return { ...item, action: KEPT }

  const actualHash = hashContent(actual)
  const desiredHash = hashContent(desired)
  const recorded = manifest.files[entry.path]

  // Already exactly what we would write. Recording the hash costs nothing and stops
  // a hand-written file — or a file from a run that predates the manifest — from
  // prompting forever about a difference that does not exist.
  if (actualHash === desiredHash) return { ...item, action: recorded === actualHash ? UNCHANGED : ADOPT, hash: actualHash }

  if (recorded === undefined) return { ...item, action: CONFLICT, reason: 'untracked', hash: actualHash }
  if (recorded !== actualHash) return { ...item, action: CONFLICT, reason: 'edited', hash: actualHash }

  return { ...item, action: UPDATE, hash: desiredHash }
}

export const isConflict = (item) => item.action === CONFLICT
export const willWrite = (item) => item.action === CREATE || item.action === UPDATE

/**
 * Applies a plan that has already had its conflicts resolved.
 *
 * `resolutions` maps a path to `overwrite` or `skip`. A conflict with no resolution
 * is skipped — the default has to be the one that cannot destroy work.
 */
export async function applyPlan(items, { manifest, manifestPath, resolutions = new Map(), dryRun = false, generatorVersion }) {
  const next = { ...manifest, files: { ...manifest.files }, generatorVersion: generatorVersion ?? (await packageVersion()) }
  const written = []
  const skipped = []

  for (const item of items) {
    const resolution = item.action === CONFLICT ? (resolutions.get(item.path) ?? 'skip') : null

    if (item.action === CONFLICT && resolution !== 'overwrite') {
      // The manifest entry is left exactly as it was, on purpose. Adopting the edited
      // file's hash here would mark it as ours and quietly overwrite it next run.
      skipped.push(item)
      continue
    }

    if (item.action === KEPT) {
      skipped.push(item)
      continue
    }

    if (item.action === CREATE || item.action === UPDATE || resolution === 'overwrite') {
      if (!dryRun) {
        await mkdir(dirname(item.absolute), { recursive: true })
        await writeFile(item.absolute, item.desired, 'utf8')
      }
      next.files[item.path] = hashContent(item.desired)
      written.push(item)
      continue
    }

    // UNCHANGED and ADOPT: nothing to write, but the manifest learns the hash.
    next.files[item.path] = item.hash
  }

  const manifestChanged = serialiseManifest(next) !== serialiseManifest(manifest)
  if (manifestChanged && !dryRun) await writeManifest(manifestPath, next)

  return { manifest: next, written, skipped, manifestChanged }
}
