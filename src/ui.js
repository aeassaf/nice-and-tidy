import { createInterface } from 'node:readline/promises'

import { unifiedDiff } from './diff.js'

const colourEnabled =
  process.env.FORCE_COLOR !== undefined ||
  (Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb')

// Built from a char code rather than embedded literally: an invisible control byte in
// source survives exactly until the first editor or copy-paste that helpfully strips it.
const ESC = String.fromCharCode(27)
const wrap = (code) => (text) => (colourEnabled ? `${ESC}[${code}m${text}${ESC}[0m` : text)

export const bold = wrap('1')
export const dim = wrap('2')
export const red = wrap('31')
export const green = wrap('32')
export const yellow = wrap('33')
export const cyan = wrap('36')

export const ACTION_LABEL = {
  create: green('create   '),
  update: cyan('update   '),
  unchanged: dim('unchanged'),
  adopt: dim('adopt    '),
  kept: dim('kept     '),
  conflict: yellow('conflict '),
  remove: red('remove   '),
  orphaned: yellow('orphaned '),
}

export const CONFLICT_EXPLANATION = {
  untracked: 'already existed and was not written by this tool',
  edited: 'was written by this tool, then edited by hand',
  'region-untracked': 'holds a generated block this install has no record of writing',
  'region-edited': 'holds a generated block that was then edited by hand',
}

/**
 * Why a file for a deselected target was left in place instead of removed. Every one
 * of these says "somebody's work is in this file," which is the whole reason removal
 * stops here and prints a path rather than a `rm`.
 */
export const ORPHAN_EXPLANATION = {
  untracked: 'this install has no record of writing it. Left alone; delete it yourself if you want it gone',
  edited: 'written by this tool, then edited by hand. Left alone; delete it yourself if you want it gone',
  'region-edited': 'its generated block was edited by hand. Left alone; remove the block yourself',
}

export function printDiff(item, write = (line) => process.stdout.write(line)) {
  const diff = unifiedDiff(item.actual, item.desired, {
    fromLabel: `a/${item.path}`,
    toLabel: `b/${item.path}`,
  })
  for (const line of diff.split('\n')) {
    if (line === '') continue
    if (line.startsWith('+')) write(`${green(line)}\n`)
    else if (line.startsWith('-')) write(`${red(line)}\n`)
    else if (line.startsWith('@@')) write(`${cyan(line)}\n`)
    else write(`${dim(line)}\n`)
  }
}

/**
 * One readline interface for the whole run, not one per question.
 *
 * Closing an interface built on `process.stdin` pauses the stream, so a fresh
 * interface for the second conflicted file gets EOF instead of the user's answer and
 * silently resolves to the default.
 *
 * Skip is that default, on a bare Enter and on a stream that ends mid-prompt: the
 * answer that cannot destroy somebody's work is the one allowed to happen by accident.
 *
 * Append is offered per question rather than always, because not every caller has
 * anywhere to put it; a JSON config cannot be appended to, and a deprecated
 * convention file has no block to manage. An option that silently does nothing is
 * worse than one that isn't offered.
 *
 * `a` stays abort even though "append" starts with it. The key for append is `+`, and
 * the full word is accepted too; someone who types `a` meaning append gets the answer
 * that writes nothing, which is the safe half of that collision.
 */
export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let rl = null

  return {
    async ask({ allowAppend = false } = {}) {
      rl ??= createInterface({ input, output })
      const options = [
        'y = overwrite',
        `${bold('N')} = keep mine`,
        ...(allowAppend ? ['+ = append ours below yours'] : []),
        'a = abort',
      ]
      try {
        const answer = await rl.question(`  ${bold('overwrite')} it? [${options.join(' / ')}] `)
        const choice = answer.trim().toLowerCase()
        if (choice === 'y' || choice === 'yes') return 'overwrite'
        if (choice === 'a' || choice === 'abort') return 'abort'
        if (allowAppend && (choice === '+' || choice === 'append')) return 'append'
        return 'skip'
      } catch {
        return 'skip'
      }
    },
    /**
     * A free-text answer, for the questions that are not "overwrite it?".
     *
     * Three outcomes the caller has to tell apart: the trimmed line, `''` for a bare
     * Enter, and `null` for a stream that ended with nothing left to give. Enter means
     * "take the default" and EOF means "nobody is here". Collapsing them is how a
     * pipe ends up silently answering a question on somebody's behalf.
     *
     * Parsing and re-asking belong to the caller. This module knows how to read a line
     * and colour a diff; it does not know what an agent target is.
     */
    async line(question) {
      rl ??= createInterface({ input, output })
      try {
        return (await rl.question(question)).trim()
      } catch {
        return null
      }
    },
    close() {
      rl?.close()
      rl = null
    },
  }
}
