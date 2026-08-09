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
 * gate and its workflow are `bootstrap`'s payload, not `init`'s — they are GitHub-side
 * setup, and `init` makes no GitHub-side changes.
 */
const LOCAL_FILES = [
  { target: 'agents-md', template: 'AGENTS.md.tmpl', path: 'AGENTS.md' },
  { target: 'claude', template: 'shims/CLAUDE.md.tmpl', path: 'CLAUDE.md' },
  { target: 'claude', template: 'skill/SKILL.md.tmpl', path: '.claude/skills/nice-and-tidy/SKILL.md' },
  { target: 'copilot', template: 'shims/copilot-instructions.md.tmpl', path: '.github/copilot-instructions.md' },
  { target: 'cursor', template: 'shims/cursor-rules.mdc.tmpl', path: '.cursor/rules/nice-and-tidy.mdc' },
  { target: 'windsurf', template: 'shims/windsurfrules.tmpl', path: '.windsurfrules' },
]

/**
 * A global install writes only where something actually loads the file from.
 *
 * The canonical copy under `~/.config` is a reference, not a hook — no tool reads a
 * global `AGENTS.md` on its own, and `init --global` says so rather than leaving the
 * impression that it wired something up. Editing a user's existing machine-wide
 * instruction file to import it is a change to their environment, so that stays a
 * printed suggestion and a human runs it.
 */
const GLOBAL_FILES = [
  { target: 'agents-md', template: 'AGENTS.md.tmpl', path: '.config/nice-and-tidy/AGENTS.md' },
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
    })
  }

  return entries
}
