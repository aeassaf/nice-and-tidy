#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { bootstrap } from '../src/commands/bootstrap.js'
import { clean } from '../src/commands/clean.js'
import { EXIT_USAGE, init } from '../src/commands/init.js'
import { upgrade } from '../src/commands/upgrade.js'
import { packageVersion } from '../src/version.js'

const OPTIONS = {
  global: { type: 'boolean', short: 'g', default: false },
  local: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  'keep-existing': { type: 'boolean', default: false },
  'dry-run': { type: 'boolean', default: false },
  // Two flags rather than one negatable boolean: `allowNegative` landed after the
  // oldest Node this package supports, and a flag that silently does nothing on an
  // older runtime is worse than a flag that does not exist.
  gitflow: { type: 'boolean', default: false },
  'no-gitflow': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
}

const USAGE = `nice-and-tidy — an issue-first Git workflow and session protocol, installed into any repo.

Usage
  nice-and-tidy init [options]        write the instruction files and the config
  nice-and-tidy diff [options]        show what init would change, write nothing
  nice-and-tidy upgrade [options]     pull in a newer release: re-run init, and offer
                                       to add any config keys the old file predates
  nice-and-tidy bootstrap [options]   one-time GitHub-side setup: PR template, its
                                       description gate, labels, milestones
  nice-and-tidy clean [options]       find deprecated per-tool convention files
                                       (e.g. .cursorrules) that predate this repo's
                                       AGENTS.md and now conflict with it

Options
  -g, --global        install for the current user instead of the current repo
      --local         install into the current repo (the default)
      --dry-run       same as \`diff\` for init; for bootstrap/clean, report without creating anything
      --keep-existing apply everything except files that differ, and leave those alone
      --force         overwrite files that differ, without asking; for clean, replace every
                       flagged file with a pointer to AGENTS.md, without asking
      --gitflow       branch off develop            (only when creating the config)
      --no-gitflow    branch off main, trunk-based  (only when creating the config)
  -h, --help          show this
  -v, --version       print the version

\`bootstrap\` needs \`nice-and-tidy init\` run first (it reads the config init writes)
and \`gh\` installed and logged in. It creates labels and milestones from config —
skipping ones that already exist — and prints, but never runs, the command to flip
the repository's default branch.

\`upgrade\` needs \`nice-and-tidy init\` run first (it reads the manifest init writes)
and refuses to run against an older release than the one already installed unless
you pass \`--force\`.

Re-running is safe. A file this tool wrote and nobody touched gets updated; a file
somebody edited gets shown as a diff and left alone unless you say otherwise.
`

async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (error) {
    process.stderr.write(`${error.message}\n\nRun \`nice-and-tidy --help\`.\n`)
    return EXIT_USAGE
  }

  const { values, positionals } = parsed
  const command = positionals[0] ?? (values.help || values.version ? null : 'help')

  if (values.version) {
    process.stdout.write(`${await packageVersion()}\n`)
    return 0
  }
  if (values.help || command === 'help' || command === null) {
    process.stdout.write(USAGE)
    return 0
  }

  if (positionals.length > 1) {
    process.stderr.write(`Unexpected argument "${positionals[1]}".\n\nRun \`nice-and-tidy --help\`.\n`)
    return EXIT_USAGE
  }

  if (values.global && values.local) {
    process.stderr.write('Pass --global or --local, not both.\n')
    return EXIT_USAGE
  }
  if (values.gitflow && values['no-gitflow']) {
    process.stderr.write('Pass --gitflow or --no-gitflow, not both.\n')
    return EXIT_USAGE
  }
  if (values.force && values['keep-existing']) {
    process.stderr.write('Pass --force or --keep-existing, not both — they are opposite answers.\n')
    return EXIT_USAGE
  }

  const shared = {
    global: values.global,
    force: values.force,
    keepExisting: values['keep-existing'],
    gitflow: values.gitflow ? true : values['no-gitflow'] ? false : undefined,
  }

  switch (command) {
    case 'init':
      return init({ ...shared, dryRun: values['dry-run'] })
    case 'diff':
      return init({ ...shared, dryRun: true, force: false, keepExisting: false })
    case 'upgrade':
      return upgrade({ ...shared, dryRun: values['dry-run'] })
    case 'bootstrap':
      return bootstrap({ ...shared, dryRun: values['dry-run'] })
    case 'clean':
      return clean({ force: values.force, dryRun: values['dry-run'] })
    default:
      process.stderr.write(`Unknown command "${command}".\n\nRun \`nice-and-tidy --help\`.\n`)
      return EXIT_USAGE
  }
}

process.exitCode = await main(process.argv.slice(2))
