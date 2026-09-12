import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { webcrypto } from 'node:crypto'
import { mockIPC } from '@tauri-apps/api/mocks'
import { get } from 'svelte/store'
import { updates, checkForUpdates, setBetaUpdates, setIgnoreUpdateVersion, installAppUpdate, restartAfterUpdate } from '../src/lib/app_updates.ts'

const storage = new Map<string, string>()
Object.assign(globalThis, {
  window: { crypto: webcrypto },
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
})
const metadata = (rid: number, version: string) => ({ rid, version, currentVersion: '0.3.0', rawJson: {} })
const flush = () => new Promise(resolve => setImmediate(resolve))
beforeEach(() => {
  storage.clear()
  updates.set({ beta: false, ignoreVersion: false, currentVersion: '', update: null, phase: 'idle', checked: false, pendingVersion: null, error: '', downloaded: 0, contentLength: null })
})

test('changing channel discards and closes an obsolete in-flight update', async () => {
  let completeOld!: (value: unknown) => void
  const closed: number[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'plugin:app|version') return '0.3.0'
    if (cmd === 'plugin:resources|close') { closed.push(args.rid as number); return }
    if (cmd === 'check_app_update') {
      if (args.beta) return { update: metadata(2, '0.4.0-beta.1'), pendingVersion: null }
      return new Promise(resolve => { completeOld = resolve })
    }
    throw new Error(cmd)
  })
  const old = checkForUpdates()
  await flush()
  setBetaUpdates(true)
  await flush()
  completeOld({ update: metadata(1, '0.3.1'), pendingVersion: null })
  await old
  assert.equal(get(updates).update?.version, '0.4.0-beta.1')
  assert.equal(storage.get('kode.updates.beta'), 'true')
  assert.deepEqual(closed, [1])
})

test('failed checks can be retried and incomplete releases are not up-to-date', async () => {
  let attempts = 0
  mockIPC(cmd => {
    if (cmd === 'plugin:app|version') return '0.3.0'
    if (cmd === 'check_app_update') {
      if (++attempts === 1) throw new Error('offline')
      return { update: null, pendingVersion: '0.4.0' }
    }
  })
  await checkForUpdates()
  assert.match(get(updates).error, /offline/)
  assert.equal(get(updates).phase, 'idle')
  await checkForUpdates()
  assert.equal(get(updates).error, '')
  assert.equal(get(updates).pendingVersion, '0.4.0')
})

test('debug option invalidates old checks and is never persisted', async () => {
  let completeOld!: (value: unknown) => void
  const closed: number[] = []
  mockIPC((cmd, args) => {
    if (cmd === 'plugin:app|version') return '9.0.0'
    if (cmd === 'plugin:resources|close') { closed.push(args.rid as number); return }
    if (cmd === 'check_app_update') {
      if (args.ignoreVersion) return { update: metadata(6, '0.3.0'), pendingVersion: null }
      return new Promise(resolve => { completeOld = resolve })
    }
  })
  const old = checkForUpdates()
  await flush()
  setIgnoreUpdateVersion(true)
  await flush()
  completeOld({ update: metadata(5, '10.0.0'), pendingVersion: null })
  await old
  assert.equal(get(updates).update?.version, '0.3.0')
  assert.deepEqual(closed, [5])
  assert.equal(storage.size, 0)
  setIgnoreUpdateVersion(false)
  await flush()
  completeOld({ update: null, pendingVersion: null })
  await flush()
  assert.equal(get(updates).update, null)
  assert.equal(get(updates).ignoreVersion, false)
  assert.deepEqual(closed, [5, 6])
})

test('installation blocks channel changes and duplicate installs; restart is explicit', async () => {
  let completeInstall!: () => void
  let installs = 0
  let restarts = 0
  mockIPC(cmd => {
    if (cmd === 'plugin:app|version') return '0.3.0'
    if (cmd === 'check_app_update') return { update: metadata(3, '0.4.0'), pendingVersion: null }
    if (cmd === 'plugin:updater|download_and_install') {
      installs++
      return new Promise<void>(resolve => { completeInstall = resolve })
    }
    if (cmd === 'plugin:process|restart') restarts++
  })
  await checkForUpdates()
  const installation = installAppUpdate()
  await flush()
  setBetaUpdates(true)
  await installAppUpdate()
  setIgnoreUpdateVersion(true)
  assert.equal(get(updates).ignoreVersion, false)
  assert.equal(get(updates).beta, false)
  assert.equal(installs, 1)
  completeInstall()
  await installation
  assert.equal(get(updates).phase, 'installed')
  assert.equal(restarts, 0)
  await restartAfterUpdate()
  assert.equal(restarts, 1)
})

test('signature/download failure leaves an explicit install retry available', async () => {
  let attempts = 0
  mockIPC(cmd => {
    if (cmd === 'plugin:app|version') return '0.3.0'
    if (cmd === 'check_app_update') return { update: metadata(4, '0.4.0'), pendingVersion: null }
    if (cmd === 'plugin:updater|download_and_install' && ++attempts === 1) throw new Error('invalid signature')
  })
  await checkForUpdates()
  await installAppUpdate()
  assert.equal(get(updates).phase, 'idle')
  assert.match(get(updates).error, /invalid signature/)
  await installAppUpdate()
  assert.equal(get(updates).phase, 'installed')
  assert.equal(get(updates).error, '')
})
