/**
 * A managed region: the block this tool owns inside a file it does not.
 *
 * Overwrite and keep-mine are both all-or-nothing answers to "this file already
 * exists." Append is the third: the generated content goes at the end, fenced by two
 * markers, and everything outside them belongs to whoever wrote it.
 *
 * The markers are load-bearing, not decoration. They are how a later run knows which
 * bytes it is allowed to rewrite — so for an appended file the manifest records the
 * hash of the region's *interior*, never the whole file. Recording the whole file
 * would make the next run read `update` and replace somebody's own content with a
 * bare copy of ours, without asking. That is the one failure this engine exists to
 * prevent, so every ambiguity here resolves to "no region" and falls back to the
 * whole-file rules, which stop and ask.
 *
 * Markers are matched by their `nice-and-tidy:begin` / `:end` prefix rather than by
 * the full line, so a later release can reword the framing sentence without orphaning
 * every region already written by an older one.
 */
import { normalise } from './hash.js'

export const BEGIN =
  '<!-- nice-and-tidy:begin — generated. This block is rewritten on every run; anything outside these markers is yours. -->'
export const END = '<!-- nice-and-tidy:end -->'

// Column zero, because that is where this tool writes them. An indented copy is a
// code sample in somebody's own prose, not a fence to start rewriting bytes inside.
const BEGIN_RE = /^<!--\s*nice-and-tidy:begin[^\n]*?-->[ \t]*\r?$/gm
const END_RE = /^<!--\s*nice-and-tidy:end[^\n]*?-->[ \t]*\r?$/gm

const matches = (text, re) => [...text.matchAll(new RegExp(re.source, re.flags))]

/**
 * Splits a file around its managed region, or returns `null` when there isn't exactly
 * one well-formed pair of markers.
 *
 * `null` is the answer for a file with no markers, with only half a pair, with the end
 * before the begin, or with duplicates — a hand-mangled fence is not something to
 * guess at. Callers treat `null` as "whole-file rules apply," which for a file we have
 * a region hash for means the hashes disagree and it becomes a conflict.
 *
 * `before` and `after` are the original bytes, so rewriting the region preserves them
 * exactly. `body` is normalised, because it is only ever hashed and compared — never
 * written back.
 *
 * Both markers own their own line, including the newline that ends it. That is what
 * makes `replaceRegion` idempotent: leave the newline after the end marker in `after`
 * and every rewrite adds one more blank line to the file than the last.
 */
export function findRegion(text) {
  const begins = matches(text, BEGIN_RE)
  const ends = matches(text, END_RE)
  if (begins.length !== 1 || ends.length !== 1) return null

  const [begin] = begins
  const [end] = ends
  const bodyStart = begin.index + begin[0].length
  if (end.index < bodyStart) return null

  return {
    before: text.slice(0, begin.index),
    body: unpad(normalise(text.slice(bodyStart, end.index))),
    after: text.slice(end.index + end[0].length).replace(/^\r?\n/, ''),
  }
}

export const hasRegion = (text) => findRegion(text) !== null

/** The exact bytes of a region holding `body`. `findRegion` reverses this. */
export const wrapRegion = (body) => `${BEGIN}\n\n${body}\n${END}\n`

/** Adds a region at the end of a file that does not have one, keeping what's there. */
export function appendRegion(actual, body) {
  if (actual.trim() === '') return wrapRegion(body)
  const base = actual.endsWith('\n') ? actual : `${actual}\n`
  return `${base}\n${wrapRegion(body)}`
}

/**
 * Rewrites an existing region in place. Everything outside it survives byte for byte,
 * which is what makes `update` safe on a file that is only partly ours.
 */
export function replaceRegion(actual, body) {
  const region = findRegion(actual)
  if (region === null) return null
  return `${region.before}${wrapRegion(body)}${region.after}`
}

/** Undoes the padding `wrapRegion` adds, without insisting on it. */
function unpad(inner) {
  const head = inner.startsWith('\n\n') ? inner.slice(2) : inner.startsWith('\n') ? inner.slice(1) : inner
  return head.endsWith('\n') ? head.slice(0, -1) : head
}
