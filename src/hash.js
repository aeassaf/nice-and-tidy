import { createHash } from 'node:crypto'

/**
 * Line endings are normalised before hashing.
 *
 * Git's `core.autocrlf` can rewrite a checked-out file's line endings without a human
 * touching it. Hashing raw bytes would read that as "somebody hand-edited this" and
 * stop to ask on a file nobody opened. Normalising costs us the ability to detect a
 * line-ending-only edit, which is not an edit worth protecting.
 */
export function normalise(text) {
  return text.replace(/\r\n?/g, '\n')
}

export function hashContent(text) {
  return createHash('sha256').update(normalise(text), 'utf8').digest('hex')
}
