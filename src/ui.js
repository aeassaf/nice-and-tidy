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
}

export const CONFLICT_EXPLANATION = {
  untracked: 'already existed and was not written by this tool',
  edited: 'was written by this tool, then edited by hand',
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
 */
export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let rl = null

  return {
    async ask() {
      rl ??= createInterface({ input, output })
      try {
        const answer = await rl.question(
          `  ${bold('overwrite')} it? [y = overwrite / ${bold('N')} = keep mine / a = abort] `,
        )
        const choice = answer.trim().toLowerCase()
        if (choice === 'y' || choice === 'yes') return 'overwrite'
        if (choice === 'a' || choice === 'abort') return 'abort'
        return 'skip'
      } catch {
        return 'skip'
      }
    },
    close() {
      rl?.close()
      rl = null
    },
  }
}
