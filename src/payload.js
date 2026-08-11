import { readFile } from 'node:fs/promises'
import { relative, sep } from 'node:path'

import { serialiseConfig, viewModel } from './config.js'
import { GENERATED, USER } from './plan.js'
import { render } from './template.js'

const TEMPLATE_ROOT = new URL('../templates/', import.meta.url)

/**
 * Manifest keys and display paths are always posix-shaped, whatever the host is. A
 * manifest written on Windows has to stay readable by the same repo checked out on
 * anything else, or the provenance lookup misses and every file reads as foreign.
 */
export const toPosix = (path) => path.split(sep).join('/')

/**
 * Phase 1 writes instruction files only. The pull request template, the description
 * gate and its workflow are `bootstrap`'s payload, not `init`'s; they are GitHub-side
 * setup, and `init` makes no GitHub-side changes.
 *
 * `appendable` marks the files a conflict can be answered by adding to rather than
 * replacing; see `region.js`. It is opt-in, and the two that opt out do so for the
 * same reason: their generated content opens with YAML frontmatter, which only has
 * meaning at the top of a file. Appended halfway down, it is a stray `---` block and
 * the directives it carries are silently lost.
 */
const LOCAL_FILES = [
  { target: 'agents-md', template: 'AGENTS.md.tmpl', path: 'AGENTS.md', appendable: true },
  { target: 'agents-md', template: 'workflow/WORKFLOW.md.tmpl', path: 'docs/WORKFLOW.md', appendable: true },
  { target: 'agents-md', template: 'workflow/BRANCHING.md.tmpl', path: 'docs/BRANCHING.md', appendable: true },
  {
    target: 'agents-md',
    template: 'workflow/COMMIT_CONVENTIONS.md.tmpl',
    path: 'docs/COMMIT_CONVENTIONS.md',
    appendable: true,
  },
  {
    target: 'agents-md',
    template: 'protocol/SESSION_PROTOCOL.md.tmpl',
    path: 'docs/SESSION_PROTOCOL.md',
    appendable: true,
  },
  { target: 'claude', template: 'shims/CLAUDE.md.tmpl', path: 'CLAUDE.md', appendable: true },
  { target: 'claude', template: 'skill/SKILL.md.tmpl', path: '.claude/skills/nice-and-tidy/SKILL.md' },
  {
    target: 'copilot',
    template: 'shims/copilot-instructions.md.tmpl',
    path: '.github/copilot-instructions.md',
    appendable: true,
  },
  { target: 'cursor', template: 'shims/cursor-rules.mdc.tmpl', path: '.cursor/rules/nice-and-tidy.mdc' },
]

/**
 * A global install writes only where something actually loads the file from.
 *
 * The canonical copy under `~/.config` is a reference, not a hook; no tool reads a
 * global `AGENTS.md` on its own, and `init --global` says so rather than leaving the
 * impression that it wired something up. Editing a user's existing machine-wide
 * instruction file to import it is a change to their environment, so that stays a
 * printed suggestion and a human runs it.
 */
const GLOBAL_FILES = [
  { target: 'agents-md', template: 'AGENTS.md.tmpl', path: '.config/nice-and-tidy/AGENTS.md', appendable: true },
  { target: 'claude', template: 'skill/SKILL.md.tmpl', path: '.claude/skills/nice-and-tidy/SKILL.md' },
]

export function filesFor(kind) {
  return kind === 'global' ? GLOBAL_FILES : LOCAL_FILES
}

/** Targets that have nothing to install at this scope, so the CLI can say so. */
export function inertTargets(kind, targets) {
  const available = new Set(filesFor(kind).map((file) => file.target))
  return targets.filter((target) => !available.has(target))
}

/**
 * What each target actually puts on disk at this scope, target → paths.
 *
 * Read straight off the payload table so the choice offered to somebody and the files
 * they get can never describe two different installs.
 */
export function filesByTarget(kind) {
  const grouped = new Map()
  for (const file of filesFor(kind)) {
    if (!grouped.has(file.target)) grouped.set(file.target, [])
    grouped.get(file.target).push(file.path)
  }
  return grouped
}

/**
 * Files this scope knows how to write for a target that is *not* selected: the set a
 * run may consider removing.
 *
 * Deliberately derived from `filesFor`, not from "everything in the manifest that
 * isn't in today's payload." The manifest is shared with `bootstrap`, whose PR
 * template, description gate and CI workflow never appear in an `init` payload; the
 * broader rule would have `init` delete all three on every run. This tool only ever
 * proposes removing a file it can name in advance and say which target produced.
 *
 * A path that some *selected* target also writes is excluded. No entry does that
 * today, and if one ever does, the selected target keeping its file is the answer that
 * cannot lose anything.
 */
export function orphanedFiles(kind, targets) {
  const selected = new Set(targets)
  const files = filesFor(kind)
  const kept = new Set(files.filter((file) => selected.has(file.target)).map((file) => file.path))

  return files
    .filter((file) => !selected.has(file.target) && !kept.has(file.path))
    .map((file) => ({ path: file.path, target: file.target, appendable: file.appendable === true }))
}

const MEMORY_STARTER_TEMPLATE = 'protocol/MEMORY_STARTER.md.tmpl'

export async function buildPayload(scope, config) {
  const model = viewModel(config)
  const targets = new Set(config.targets)

  const entries = [
    {
      path: toPosix(relative(scope.root, scope.configPath)),
      contents: serialiseConfig(config),
      ownership: USER,
    },
  ]

  for (const file of filesFor(scope.kind)) {
    if (!targets.has(file.target)) continue
    const source = await readFile(new URL(file.template, TEMPLATE_ROOT), 'utf8')
    entries.push({
      path: file.path,
      contents: render(source, model, { origin: `templates/${file.template}` }),
      ownership: GENERATED,
      target: file.target,
      appendable: file.appendable === true,
    })
  }

  // The memory file is scoped to a repo, never a machine; a global install has
  // nowhere of its own for session notes to belong to. `ownership: USER`, like the
  // config: written once if nothing is there, then never touched again regardless of
  // what an agent writes into it afterward. See plan.js; a USER-owned file that
  // already exists is always KEPT, never diffed or flagged as a conflict.
  if (scope.kind === 'local') {
    const source = await readFile(new URL(MEMORY_STARTER_TEMPLATE, TEMPLATE_ROOT), 'utf8')
    entries.push({
      path: config.protocol.memoryFile,
      contents: render(source, model, { origin: `templates/${MEMORY_STARTER_TEMPLATE}` }),
      ownership: USER,
    })
  }

  return entries
}
