import { readFile } from 'node:fs/promises'

import { viewModel } from './config.js'
import { GENERATED } from './plan.js'
import { render } from './template.js'

const TEMPLATE_ROOT = new URL('../templates/', import.meta.url)

/**
 * `bootstrap`'s file-writing half — the PR template, its description gate and the
 * workflow that runs it. Kept in its own list, distinct from `payload.js`'s
 * `LOCAL_FILES`, because these are GitHub-side setup and `init` never touches
 * GitHub — see `payload.js`'s own note on the same boundary.
 *
 * `check-pr-description.mjs` and its test are copied verbatim — no `{{ }}` in
 * either, and `render()` on a file with no placeholders is a no-op, so running them
 * through the same path as the rest costs nothing and keeps this list uniform.
 */
const BOOTSTRAP_FILES = [
  { template: 'workflow/pull_request_template.md.tmpl', path: '.github/pull_request_template.md' },
  { template: 'workflow/pr-description.yml.tmpl', path: '.github/workflows/pr-description.yml' },
  { template: 'workflow/ci.yml.tmpl', path: '.github/workflows/ci.yml' },
  { template: 'workflow/check-pr-description.mjs', path: 'scripts/check-pr-description.mjs' },
  { template: 'workflow/check-pr-description.test.mjs', path: 'scripts/check-pr-description.test.mjs' },
]

export async function buildBootstrapPayload(config) {
  const model = viewModel(config)

  return Promise.all(
    BOOTSTRAP_FILES.map(async (file) => {
      const source = await readFile(new URL(file.template, TEMPLATE_ROOT), 'utf8')
      return {
        path: file.path,
        contents: render(source, model, { origin: `templates/${file.template}` }),
        ownership: GENERATED,
      }
    }),
  )
}
