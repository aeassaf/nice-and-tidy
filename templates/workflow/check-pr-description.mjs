#!/usr/bin/env node
/**
 * Enforces .github/pull_request_template.md on every pull request.
 *
 * A template that is only *offered* gets skipped. This makes it a check.
 *
 * Deliberately dependency-free: no package.json of its own, no bundler, no test
 * framework beyond `node --test`, which ships in the Node the workflow already
 * installs. Runs standalone in any repo's CI, regardless of that repo's own toolchain.
 *
 * Usage:
 *   PR_BODY="$(gh pr view 1 --json body -q .body)" node scripts/check-pr-description.mjs
 *   node scripts/check-pr-description.mjs --file some-body.md
 *   gh pr view 1 --json body -q .body | node scripts/check-pr-description.mjs
 */

/**
 * The template's sections, in the order they appear in it. Presence is enforced;
 * order is not — enforcing order makes the gate brittle without making descriptions
 * better.
 */
export const REQUIRED_SECTIONS = [
  'Issues',
  "What's tricky",
  'How to test',
  'Dependencies',
  'Screenshots',
]

/**
 * Headings are compared loosely on purpose. A gate that fails on a curly apostrophe
 * or a trailing colon is a gate people route around instead of using.
 */
function normaliseHeading(text) {
  return text
    .replace(/[‘’ʼ]/g, "'") // curly apostrophes → straight
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Removes HTML comments while preserving line structure, so section boundaries stay
 * at the same line numbers.
 *
 * This is what makes "template left untouched" detectable: the guidance in the
 * template lives in comments, so an unedited section strips to nothing and fails.
 */
function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (match) => match.replace(/[^\n]/g, ''))
}

const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/

/**
 * Level 1 and 2 headings close a section. Level 3+ is treated as content, so a PR is
 * free to use sub-headings inside "How to test".
 */
function isSectionBoundary(level) {
  return level <= 2
}

export function parseSections(body) {
  const lines = stripComments(body.replace(/\r\n?/g, '\n')).split('\n')
  const sections = new Map()

  let current = null
  for (const line of lines) {
    const match = HEADING.exec(line)
    if (match && isSectionBoundary(match[1].length)) {
      current = { heading: normaliseHeading(match[2]), lines: [] }
      // First occurrence wins; a duplicated heading appends to the section it repeats.
      if (!sections.has(current.heading)) sections.set(current.heading, current.lines)
      else current.lines = sections.get(current.heading)
      continue
    }
    if (current) current.lines.push(line)
  }

  return sections
}

/**
 * A section counts as filled if it contains at least one letter or digit once the
 * comments are gone. That rejects the untouched template, a bare bullet, and `...`,
 * while accepting "None" — which is the honest answer for Dependencies and
 * Screenshots on plenty of PRs, and is worth writing rather than leaving blank.
 */
function hasContent(lines) {
  return /[\p{L}\p{N}]/u.test(lines.join('\n'))
}

export function validate(body) {
  const problems = []

  if (!body || !body.trim()) {
    return [
      {
        section: null,
        problem: 'The PR description is empty. Fill in .github/pull_request_template.md.',
      },
    ]
  }

  const sections = parseSections(body)

  for (const name of REQUIRED_SECTIONS) {
    const key = normaliseHeading(name)
    if (!sections.has(key)) {
      problems.push({ section: name, problem: `Missing the "## ${name}" section.` })
    } else if (!hasContent(sections.get(key))) {
      problems.push({
        section: name,
        problem: `"## ${name}" is empty. Replace the template's guidance comment with a real answer.`,
      })
    }
  }

  return problems
}

async function readBody(argv) {
  const fileFlag = argv.indexOf('--file')
  if (fileFlag !== -1) {
    const { readFile } = await import('node:fs/promises')
    return readFile(argv[fileFlag + 1], 'utf8')
  }
  if (process.env.PR_BODY !== undefined) return process.env.PR_BODY
  if (process.stdin.isTTY) return ''

  let stdin = ''
  for await (const chunk of process.stdin) stdin += chunk
  return stdin
}

async function main() {
  const body = await readBody(process.argv.slice(2))
  const problems = validate(body)
  const inActions = Boolean(process.env.GITHUB_ACTIONS)

  if (problems.length === 0) {
    console.log(`PR description: all ${REQUIRED_SECTIONS.length} template sections present and filled.`)
    return 0
  }

  for (const { problem } of problems) {
    console.error(inActions ? `::error::${problem}` : `  ✗ ${problem}`)
  }
  console.error(
    '\nEvery PR must follow .github/pull_request_template.md.' +
      '\nEdit the description on the PR — the check re-runs on edit.' +
      '\n"None" is a valid answer for Dependencies and Screenshots; leaving a section blank is not.',
  )
  return 1
}

// Only run the CLI when executed directly, so the test file can import the parser.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main())
}
