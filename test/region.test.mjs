/**
 * The markers, on their own.
 *
 * Everything append does downstream rests on one property: what `findRegion` reads
 * back out is exactly what `appendRegion` put in. If that round trip is lossy, the
 * interior hash never matches on a re-run and the whole feature degrades into asking
 * about the same file forever; or, worse, stops being able to tell "we wrote this"
 * from "somebody edited it."
 *
 * The refusals matter as much as the round trip. A half-written or duplicated fence
 * has to read as "no region," because "no region" is what falls back to the
 * whole-file rules, and those stop and ask.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendRegion, findRegion, hasRegion, replaceRegion, wrapRegion } from '../src/region.js'

const BODY = '# Generated\n\nRead AGENTS.md.\n'
const MINE = '# My own notes\n\nRun `pnpm dev`.\n'

// --- the round trip -----------------------------------------------------------

test('what goes into a region comes back out of it, byte for byte', () => {
  assert.equal(findRegion(appendRegion(MINE, BODY)).body, BODY)
})

test('a body with no trailing newline round-trips too', () => {
  assert.equal(findRegion(appendRegion(MINE, 'one line')).body, 'one line')
})

test('appending keeps every byte that was already there', () => {
  assert.ok(appendRegion(MINE, BODY).startsWith(MINE))
})

test('appending to a file that does not end in a newline does not run the two together', () => {
  const appended = appendRegion('no trailing newline', BODY)
  assert.match(appended, /^no trailing newline\n/)
  assert.equal(findRegion(appended).body, BODY)
})

test('an empty file gets the region and no leading blank line', () => {
  assert.equal(appendRegion('', BODY), wrapRegion(BODY))
  assert.equal(appendRegion('   \n\n', BODY), wrapRegion(BODY))
})

test('a CRLF file still reads its region back as the body that was written', () => {
  // Git can rewrite line endings with nobody touching the file. Reading that as an
  // edit would stop and ask about a file nobody opened.
  const crlf = appendRegion(MINE, BODY).replace(/\n/g, '\r\n')
  assert.equal(findRegion(crlf).body, BODY)
})

// --- rewriting in place -------------------------------------------------------

test('replacing a region leaves everything outside it untouched', () => {
  const replaced = replaceRegion(appendRegion(MINE, BODY), '# Newer\n')

  assert.ok(replaced.startsWith(MINE), "the user's own content moved or changed")
  assert.equal(findRegion(replaced).body, '# Newer\n')
  assert.doesNotMatch(replaced, /Read AGENTS\.md/)
})

test('replacing keeps content that sits after the region as well as before it', () => {
  const withTail = `${appendRegion(MINE, BODY)}\n## A section I added afterwards\n`
  const replaced = replaceRegion(withTail, '# Newer\n')

  assert.ok(replaced.startsWith(MINE))
  assert.match(replaced, /## A section I added afterwards\n$/)
})

test('replacing a region twice is stable', () => {
  const once = replaceRegion(appendRegion(MINE, BODY), '# Newer\n')
  assert.equal(replaceRegion(once, '# Newer\n'), once)
})

// --- the refusals -------------------------------------------------------------

test('a file with no markers has no region', () => {
  assert.equal(findRegion(MINE), null)
  assert.equal(hasRegion(MINE), false)
  assert.equal(replaceRegion(MINE, BODY), null)
})

test('half a fence is not a region', () => {
  const appended = appendRegion(MINE, BODY)
  assert.equal(findRegion(appended.replace(/^<!-- nice-and-tidy:end -->$/m, '')), null)
  assert.equal(findRegion(appended.replace(/^<!-- nice-and-tidy:begin[^\n]*$/m, '')), null)
})

test('duplicated markers are refused rather than guessed between', () => {
  // Two regions is somebody's paste, and picking one of them would rewrite bytes on a
  // guess. Reading it as "no region" hands it to the whole-file rules, which ask.
  const twice = `${appendRegion(MINE, BODY)}${wrapRegion('# Another\n')}`
  assert.equal(findRegion(twice), null)
})

test('an end marker before its begin is refused', () => {
  assert.equal(findRegion(`${'<!-- nice-and-tidy:end -->'}\nstuff\n${'<!-- nice-and-tidy:begin -->'}\n`), null)
})

test('a marker is matched by its prefix, so rewording the framing keeps old regions readable', () => {
  // The begin marker carries a sentence explaining itself. A later release that
  // rewords that sentence must not orphan every region an older one wrote.
  const older = `${MINE}\n<!-- nice-and-tidy:begin -->\n\n${BODY}\n<!-- nice-and-tidy:end -->\n`
  assert.equal(findRegion(older).body, BODY)
})

test('an indented copy of the markers is prose about them, not a fence', () => {
  // A code sample in somebody's own documentation. Matching it would hand this tool a
  // licence to rewrite the bytes between two lines it never wrote.
  const indented = `${MINE}\n    <!-- nice-and-tidy:begin -->\n    sample\n    <!-- nice-and-tidy:end -->\n`
  assert.equal(findRegion(indented), null)
})
