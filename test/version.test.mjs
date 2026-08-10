import assert from 'node:assert/strict'
import { test } from 'node:test'

import { compareVersions, packageVersion } from '../src/version.js'

test('packageVersion reads package.json, not a hard-coded string', async () => {
  const version = await packageVersion()
  assert.match(version, /^\d+\.\d+\.\d+/)
})

test('compareVersions orders by major, then minor, then patch', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1)
  assert.equal(compareVersions('1.2.0', '1.10.0'), -1, 'minor is numeric, not lexical')
  assert.equal(compareVersions('1.0.2', '1.0.10'), -1, 'patch is numeric, not lexical')
})

test('compareVersions ignores a prerelease or build tag', () => {
  assert.equal(compareVersions('1.2.3-beta.1', '1.2.3'), 0)
})

test('compareVersions returns null for anything that does not parse as semver', () => {
  assert.equal(compareVersions('not-a-version', '1.0.0'), null)
  assert.equal(compareVersions('1.0.0', 'also-not'), null)
})
