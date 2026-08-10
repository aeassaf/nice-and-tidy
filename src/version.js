import { readFile } from 'node:fs/promises'

/**
 * The running CLI's own version, read from `package.json` rather than hard-coded —
 * one number to bump at release time, not two.
 */
let cached
export async function packageVersion() {
  cached ??= JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  return cached
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)/

/**
 * Compares two `major.minor.patch[-...]` strings. Anything after the patch number
 * (a prerelease or build tag) is ignored — this only needs to answer "did the repo
 * move backwards," not implement full semver precedence.
 *
 * Returns null, not a thrown error, for a string that does not parse as semver — a
 * manifest written by some future version format is a reason to skip the comparison,
 * not to crash the upgrade that would otherwise fix it.
 */
export function compareVersions(a, b) {
  const pa = SEMVER.exec(a)
  const pb = SEMVER.exec(b)
  if (!pa || !pb) return null

  for (let i = 1; i <= 3; i++) {
    const diff = Number(pa[i]) - Number(pb[i])
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}
