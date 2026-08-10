import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Deprecated, single-file, per-tool convention formats; not the tools' *current*
 * ones. A file here is a claim that the tool that wrote it has since moved to
 * something else (usually native `AGENTS.md` support), sourced from that tool's own
 * docs, not assumed. Re-check before adding an entry, and before trusting one that's
 * already here; the same discipline `config.js`'s `TARGETS` holds itself to.
 *
 * Deliberately short, and deliberately not a glob. `.clinerules` and a bare
 * `.aiderrules` are not in this list on purpose:
 *
 *   - `.clinerules` is Cline's *current*, live convention file; Cline does not read
 *     `AGENTS.md` natively (an open feature request, unresolved as of this writing).
 *     Flagging it would offer to gut a config real Cline setups still depend on.
 *   - `.aiderrules` isn't a real Aider filename to begin with; Aider's convention
 *     file defaults to `CONVENTIONS.md`, or whatever `--conventions-file` points at,
 *     both too generic to safely assume are agent-specific.
 *
 * A wrong entry here doesn't just miss a conflict; it offers to erase a file a tool
 * still reads. When in doubt, leave it out.
 */
export const FOREIGN_CONVENTIONS = [
  {
    path: '.cursorrules',
    tool: 'Cursor',
    why: 'deprecated since Cursor 0.43 in favor of .cursor/rules/*.mdc; Cursor\'s Agent mode, the default since 2026, silently ignores a root .cursorrules file entirely',
  },
  {
    path: '.windsurfrules',
    tool: 'Windsurf',
    why: 'the deprecated predecessor to Windsurf\'s native root AGENTS.md support, per Windsurf\'s own docs',
  },
]

const MENTIONS_AGENTS_MD = /AGENTS\.md/i

/**
 * One entry per registry item, whether or not the file exists; callers filter.
 * `aligned` means the file already points at `AGENTS.md`, so there's nothing to do:
 * `clean` only ever has to reason about `exists && !aligned`.
 */
export async function scanForeignConventions(root) {
  return Promise.all(
    FOREIGN_CONVENTIONS.map(async (entry) => {
      let content = null
      try {
        content = await readFile(join(root, entry.path), 'utf8')
      } catch (error) {
        // ENOENT: nothing there. EISDIR: something's there, but not the single-file
        // convention this entry means; e.g. a `.clinerules/` directory shape at a
        // path that, for a different tool, is a flat file. Neither is a hit.
        if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error
      }

      return {
        ...entry,
        exists: content !== null,
        aligned: content !== null && MENTIONS_AGENTS_MD.test(content),
        content,
      }
    }),
  )
}
