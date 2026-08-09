import { homedir } from 'node:os'
import { join } from 'node:path'

import { CONFIG_FILENAME } from './config.js'

/**
 * Where an install reads and writes.
 *
 * Local and global are not the same tree with a different prefix. A local install
 * lives entirely inside one repository. A global install writes into two unrelated
 * places under the home directory and must not drop a config file or a dot-directory
 * into the top of it, so the paths are stated rather than derived.
 */

export function localScope(root) {
  return {
    kind: 'local',
    root,
    configPath: join(root, CONFIG_FILENAME),
    manifestPath: join(root, '.nice-and-tidy', 'manifest.json'),
    label: root,
  }
}

export function globalScope(home = homedir()) {
  const base = join(home, '.config', 'nice-and-tidy')
  return {
    kind: 'global',
    root: home,
    configPath: join(base, CONFIG_FILENAME),
    manifestPath: join(base, 'manifest.json'),
    label: home,
  }
}
