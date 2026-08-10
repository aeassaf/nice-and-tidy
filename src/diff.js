import { normalise } from './hash.js'

/**
 * A unified diff, hand-rolled so the CLI keeps zero runtime dependencies.
 *
 * `npx nice-and-tidy init` should be a cold start with nothing to download. Pulling
 * in a diff library to print a handful of small markdown files would trade that away
 * for about eighty lines of code.
 */

const CONTEXT = 3

/**
 * Beyond this, the quadratic LCS table stops being free. The files this tool writes
 * are a few hundred lines; anything past the guard is not a generated file we know
 * how to diff usefully, so say so instead of allocating gigabytes.
 */
const MAX_CELLS = 4_000_000

export function toLines(text) {
  const value = normalise(text)
  if (value === '') return []
  const lines = value.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

const endsWithNewline = (text) => text === '' || normalise(text).endsWith('\n')

/**
 * Returns a unified diff, or an empty string when the two sides are identical after
 * line-ending normalisation; the same normalisation the provenance hash uses, so
 * "no diff to show" and "hash matches" can never disagree.
 */
export function unifiedDiff(before, after, { fromLabel = 'on disk', toLabel = 'would write' } = {}) {
  const a = toLines(before)
  const b = toLines(after)

  if (normalise(before) === normalise(after)) return ''

  if (a.length * b.length > MAX_CELLS) {
    return (
      `--- ${fromLabel}\n+++ ${toLabel}\n` +
      `@@ file too large to diff inline @@\n` +
      `  ${a.length} lines on disk, ${b.length} lines would be written.\n`
    )
  }

  const ops = diffOps(a, b)
  const changed = ops.flatMap((op, index) => (op.type === ' ' ? [] : [index]))

  // Same lines, different newline termination. The hash sees a difference here, so
  // the file gets reported as a conflict; and a conflict that renders an empty diff
  // is the one thing this must never do.
  if (changed.length === 0) return newlineOnlyDiff(a, before, after, fromLabel, toLabel)

  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`]

  for (const [first, last] of groupHunks(changed)) {
    const from = Math.max(0, first - CONTEXT)
    const to = Math.min(ops.length - 1, last + CONTEXT)
    const slice = ops.slice(from, to + 1)

    const oldCount = slice.filter((op) => op.type !== '+').length
    const newCount = slice.filter((op) => op.type !== '-').length
    const oldStart = slice.find((op) => op.oldLine !== undefined)?.oldLine ?? 0
    const newStart = slice.find((op) => op.newLine !== undefined)?.newLine ?? 0

    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const op of slice) out.push(`${op.type}${op.text}`)

    // Only meaningful on the final hunk, and only when that hunk reaches the end.
    if (to === ops.length - 1) {
      if (a.length > 0 && !endsWithNewline(before)) out.push('\\ No newline at end of file (on disk)')
      if (b.length > 0 && !endsWithNewline(after)) out.push('\\ No newline at end of file (would write)')
    }
  }

  return `${out.join('\n')}\n`
}

/** A one-line summary for a listing that has no room for the diff itself. */
export function changeSummary(before, after) {
  const ops = diffOps(toLines(before), toLines(after))
  const added = ops.filter((op) => op.type === '+').length
  const removed = ops.filter((op) => op.type === '-').length
  return `+${added} -${removed}`
}

function newlineOnlyDiff(lines, before, after, fromLabel, toLabel) {
  if (lines.length === 0) return ''

  const start = Math.max(1, lines.length - CONTEXT + 1)
  const tail = lines.slice(start - 1)

  const out = [`--- ${fromLabel}`, `+++ ${toLabel}`, `@@ -${start},${tail.length} +${start},${tail.length} @@`]
  for (const line of tail) out.push(` ${line}`)
  if (!endsWithNewline(before)) out.push('\\ No newline at end of file (on disk)')
  if (!endsWithNewline(after)) out.push('\\ No newline at end of file (would write)')

  return `${out.join('\n')}\n`
}

function diffOps(a, b) {
  const cols = b.length + 1
  const table = new Int32Array((a.length + 1) * cols)

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + (j + 1)] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)])
    }
  }

  const ops = []
  let i = 0
  let j = 0
  let oldLine = 1
  let newLine = 1

  const push = (type, text) => {
    const op = { type, text }
    if (type !== '+') op.oldLine = oldLine++
    if (type !== '-') op.newLine = newLine++
    ops.push(op)
  }

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(' ', a[i])
      i++
      j++
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      // Ties break toward a deletion so a replaced line reads `-old` then `+new`.
      push('-', a[i++])
    } else {
      push('+', b[j++])
    }
  }
  while (i < a.length) push('-', a[i++])
  while (j < b.length) push('+', b[j++])

  return ops
}

/** Changed lines closer together than two context windows share one hunk. */
function groupHunks(changed) {
  const groups = []
  let start = changed[0]
  let previous = changed[0]

  for (const index of changed.slice(1)) {
    if (index - previous > CONTEXT * 2) {
      groups.push([start, previous])
      start = index
    }
    previous = index
  }
  groups.push([start, previous])

  return groups
}
