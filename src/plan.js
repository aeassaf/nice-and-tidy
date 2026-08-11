import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { hashContent } from './hash.js'
import { serialiseManifest, writeManifest } from './manifest.js'
import { appendRegion, findRegion, replaceRegion, stripRegion } from './region.js'
import { packageVersion } from './version.js'

/**
 * Every file this tool writes lands in exactly one of these states. The whole point
 * of the manifest is that `conflict` and `update` are distinguishable; both differ
 * from what we want on disk, and only one of them is safe to overwrite.
 */
export const CREATE = 'create'
export const UPDATE = 'update'
export const UNCHANGED = 'unchanged'
export const ADOPT = 'adopt'
export const KEPT = 'kept'
export const CONFLICT = 'conflict'

/**
 * And three more for the other direction, for a file whose target is no longer selected.
 *
 * `remove` is the only one that touches the disk, and the manifest is what earns it
 * that: we wrote this file, and what is there is byte for byte what we wrote.
 * `orphaned` is everything else, reported and never touched. `forget` is a manifest
 * entry with nothing behind it any more.
 */
export const REMOVE = 'remove'
export const ORPHANED = 'orphaned'
export const FORGET = 'forget'

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

  const item = { ...entry, absolute, desired, actual, write: desired }

  if (actual === null) return { ...item, action: CREATE, hash: hashContent(desired) }

  // The config belongs to whoever edited it last, which after the first run is never
  // us. A later `init` reads it; it does not get to rewrite it.
  if (entry.ownership === USER) return { ...item, action: KEPT }

  const desiredHash = hashContent(desired)
  const recorded = manifest.files[entry.path]

  // A file this tool appended to is only partly ours, and the rules below run against
  // the part that is. Appending is opt-in per payload entry and off by default: the
  // markers are an HTML comment, which is a syntax error in a workflow YAML or a
  // script, and a file that never opts in is never region-managed even if somebody
  // pastes the markers into it by hand.
  const region = entry.appendable ? findRegion(actual) : null
  if (region !== null) return planRegion(item, { region, desiredHash, recorded })

  const actualHash = hashContent(actual)

  // Already exactly what we would write. Recording the hash costs nothing and stops
  // a hand-written file; or a file from a run that predates the manifest; from
  // prompting forever about a difference that does not exist.
  if (actualHash === desiredHash) return { ...item, action: recorded === actualHash ? UNCHANGED : ADOPT, hash: actualHash }

  // Append answers exactly one question: "this file is somebody else's, and both lots
  // of content should survive." A file this tool wrote and somebody then edited is not
  // that question; its content is already a copy of ours, and appending would leave
  // two of them in the same file. That one is a conflict about a *version*, and
  // overwrite or keep-mine are the answers to it. The bytes are worked out here so the
  // diff shown and the bytes written can never be two different answers.
  const appendWrite = entry.appendable ? appendRegion(actual, desired) : undefined

  if (recorded === undefined) return { ...item, action: CONFLICT, reason: 'untracked', hash: actualHash, appendWrite }
  if (recorded !== actualHash) return { ...item, action: CONFLICT, reason: 'edited', hash: actualHash }

  return { ...item, action: UPDATE, hash: desiredHash }
}

/**
 * The same four outcomes as a whole file, judged on the region's interior instead.
 *
 * Two consequences, both deliberate. Editing the file *outside* the markers is not a
 * conflict; that content is the user's and this tool has no opinion on it. And every
 * write here is `replaceRegion`, never `desired`: once a file is region-managed, even
 * "overwrite" means "restore our block," not "replace their file."
 */
function planRegion(item, { region, desiredHash, recorded }) {
  const bodyHash = hashContent(region.body)
  const write = replaceRegion(item.actual, item.desired)

  // Appending to a file that already has a region would leave two of them, and
  // `findRegion` refuses to guess between duplicates. Rewriting the one that is there
  // is what append means the second time round.
  const base = { ...item, region: true, write, appendWrite: write }

  if (bodyHash === desiredHash) return { ...base, action: recorded === bodyHash ? UNCHANGED : ADOPT, hash: bodyHash }
  if (recorded === undefined) return { ...base, action: CONFLICT, reason: 'region-untracked', hash: bodyHash }
  if (recorded !== bodyHash) return { ...base, action: CONFLICT, reason: 'region-edited', hash: bodyHash }

  return { ...base, action: UPDATE, hash: desiredHash }
}

/**
 * The other half of the plan: what to do about a file whose target has been dropped.
 *
 * The rule is the manifest's, applied in the one direction it was always going to be
 * needed in. A generated file that is byte for byte what we last wrote is ours to take
 * away again. Anything else, whether never recorded or recorded and then edited, is
 * somebody's work, and this reports it for a human to delete rather than guessing.
 * Getting that backwards deletes something unrecoverable, which is why the safe branch
 * is the fallthrough and every unsafe one returns early.
 *
 * Candidates come from `payload.js#orphanedFiles`, never from "the manifest minus
 * today's payload"; see the note there.
 */
export async function planRemovals(root, candidates, manifest) {
  const items = await Promise.all(candidates.map((candidate) => planRemoval(root, candidate, manifest)))
  return items.filter((item) => item !== null)
}

async function planRemoval(root, candidate, manifest) {
  const absolute = join(root, candidate.path)
  const recorded = manifest.files[candidate.path]

  let actual = null
  try {
    actual = await readFile(absolute, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const base = { ...candidate, absolute, actual }

  // Nothing on disk. Nothing to report either, but a manifest entry left pointing at
  // a path we no longer write would mark whatever somebody puts there next as ours.
  if (actual === null) return recorded === undefined ? null : { ...base, action: FORGET }

  if (recorded === undefined) return { ...base, action: ORPHANED, reason: 'untracked' }

  // Only partly ours: our block inside a file somebody else wrote. Deleting the file
  // would take their content with it, so the region is what goes. The manifest holds
  // the hash of the region's interior for these, never of the whole file. Comparing
  // against the whole file here would read every appended file as hand-edited.
  const region = candidate.appendable ? findRegion(actual) : null
  if (region !== null) {
    if (hashContent(region.body) !== recorded) return { ...base, action: ORPHANED, reason: 'region-edited' }
    const stripped = stripRegion(actual)
    return { ...base, action: REMOVE, strip: stripped === '' ? undefined : stripped }
  }

  if (hashContent(actual) !== recorded) return { ...base, action: ORPHANED, reason: 'edited' }

  return { ...base, action: REMOVE }
}

export const isConflict = (item) => item.action === CONFLICT
export const isOrphaned = (item) => item.action === ORPHANED
/** A removal that keeps the file and takes only this tool's block out of it. */
export const stripsRegion = (item) => item.action === REMOVE && item.strip !== undefined
export const willWrite = (item) => item.action === CREATE || item.action === UPDATE

/** A conflict this tool can answer by adding to the file rather than replacing it. */
export const canAppend = (item) => item.appendWrite !== undefined

const APPLIED = new Set(['overwrite', 'append'])

/**
 * Applies a plan that has already had its conflicts resolved.
 *
 * `resolutions` maps a path to `overwrite`, `append` or `skip`. A conflict with no
 * resolution is skipped; the default has to be the one that cannot destroy work, and
 * so is an `append` asked for on a file that has no way to accept one.
 *
 * `removals` is `planRemovals`'s output. Pass an empty list to write everything and
 * take nothing away; the caller decides that, because "leave my files alone" is a
 * flag, not a property of the plan.
 */
export async function applyPlan(
  items,
  { manifest, manifestPath, resolutions = new Map(), removals = [], dryRun = false, generatorVersion },
) {
  const next = { ...manifest, files: { ...manifest.files }, generatorVersion: generatorVersion ?? (await packageVersion()) }
  const written = []
  const skipped = []
  const removed = []

  for (const item of items) {
    const asked = item.action === CONFLICT ? (resolutions.get(item.path) ?? 'skip') : null
    const resolution = asked === 'append' && !canAppend(item) ? 'skip' : asked

    if (item.action === CONFLICT && !APPLIED.has(resolution)) {
      // The manifest entry is left exactly as it was, on purpose. Adopting the edited
      // file's hash here would mark it as ours and quietly overwrite it next run.
      skipped.push(item)
      continue
    }

    if (item.action === KEPT) {
      skipped.push(item)
      continue
    }

    if (item.action === CREATE || item.action === UPDATE || APPLIED.has(resolution)) {
      const bytes = resolution === 'append' ? item.appendWrite : item.write
      if (!dryRun) {
        await mkdir(dirname(item.absolute), { recursive: true })
        await writeFile(item.absolute, bytes, 'utf8')
      }
      // What gets recorded is the hash of the content we generated, which for a
      // region-managed file is the region's interior and not the bytes just written.
      // Recording the whole file here is what would make the next run overwrite
      // somebody's own content without asking.
      next.files[item.path] = hashContent(item.desired)
      written.push(resolution === null ? item : { ...item, resolution })
      continue
    }

    // UNCHANGED and ADOPT: nothing to write, but the manifest learns the hash.
    next.files[item.path] = item.hash
  }

  for (const item of removals) {
    // Left exactly as it was, manifest entry included, for the same reason a skipped
    // conflict keeps its own. Dropping the entry here would make the file untracked,
    // and a later run that re-selects the target would overwrite it without asking.
    if (item.action === ORPHANED) {
      skipped.push(item)
      continue
    }

    delete next.files[item.path]
    if (item.action === FORGET) continue

    if (!dryRun) {
      if (item.strip !== undefined) await writeFile(item.absolute, item.strip, 'utf8')
      // Empty parent directories are left behind on purpose. `.cursor/rules/` may hold
      // rules this tool never wrote, and inferring that a directory is ours because we
      // put one file in it is exactly the guess that loses somebody's work.
      else await rm(item.absolute, { force: true })
    }
    removed.push(item)
  }

  const manifestChanged = serialiseManifest(next) !== serialiseManifest(manifest)
  if (manifestChanged && !dryRun) await writeManifest(manifestPath, next)

  return { manifest: next, written, skipped, removed, manifestChanged }
}
