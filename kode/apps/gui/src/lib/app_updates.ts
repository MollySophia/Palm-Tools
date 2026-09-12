import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { Update } from '@tauri-apps/plugin-updater'
import { get, writable } from 'svelte/store'

const preferenceKey = 'kode.updates.beta'
function readBeta(): boolean {
  try { return localStorage.getItem(preferenceKey) === 'true' } catch { return false }
}

export const updates = writable({
  beta: readBeta(),
  // Deliberately session-only: test downgrade must be opted into after launch.
  ignoreVersion: false,
  currentVersion: '',
  update: null as Update | null,
  phase: 'idle' as 'idle' | 'checking' | 'downloading' | 'installing' | 'installed',
  checked: false,
  pendingVersion: null as string | null,
  error: '',
  downloaded: 0,
  contentLength: null as number | null,
})

let generation = 0
type Metadata = ConstructorParameters<typeof Update>[0]
const close = (update: Update | null) => { void update?.close().catch(console.info) }

export async function checkForUpdates(): Promise<void> {
  const state = get(updates)
  if (state.phase !== 'idle') return
  const request = ++generation
  updates.update(s => ({ ...s, phase: 'checking', error: '', update: null, pendingVersion: null }))
  close(state.update)
  try {
    const currentVersion = await getVersion()
    if (request !== generation) return
    updates.update(s => ({ ...s, currentVersion }))
    const result = await invoke<{ update: Metadata | null; pendingVersion: string | null }>(
      'check_app_update', { beta: state.beta, ignoreVersion: state.ignoreVersion },
    )
    const update = result.update ? new Update(result.update) : null
    if (request !== generation) { close(update); return }
    updates.update(s => ({ ...s, update, pendingVersion: result.pendingVersion, checked: true, phase: 'idle' }))
  } catch (error) {
    if (request === generation) updates.update(s => ({ ...s, phase: 'idle', error: String(error) }))
  }
}

export function setBetaUpdates(beta: boolean): void {
  changeCheckOptions({ beta })
}

export function setIgnoreUpdateVersion(ignoreVersion: boolean): void {
  changeCheckOptions({ ignoreVersion })
}

function changeCheckOptions(options: { beta?: boolean; ignoreVersion?: boolean }): void {
  const state = get(updates)
  if (['downloading', 'installing', 'installed'].includes(state.phase)) return
  ++generation
  close(state.update)
  if (options.beta !== undefined) {
    try { localStorage.setItem(preferenceKey, String(options.beta)) } catch { /* Session preference still works. */ }
  }
  updates.update(s => ({ ...s, ...options, phase: 'idle', checked: false, error: '', update: null, pendingVersion: null }))
  void checkForUpdates()
}

export async function installAppUpdate(): Promise<void> {
  const { update, phase } = get(updates)
  if (!update || phase !== 'idle') return
  updates.update(s => ({ ...s, phase: 'downloading', downloaded: 0, contentLength: null, error: '' }))
  try {
    await update.downloadAndInstall(event => {
      if (event.event === 'Started') updates.update(s => ({ ...s, contentLength: event.data.contentLength ?? null }))
      else if (event.event === 'Progress') updates.update(s => ({ ...s, downloaded: s.downloaded + event.data.chunkLength }))
      else if (event.event === 'Finished') updates.update(s => ({ ...s, phase: 'installing' }))
    }, { timeout: 120_000 })
    updates.update(s => ({ ...s, phase: 'installed' }))
    close(update)
  } catch (error) {
    updates.update(s => ({ ...s, phase: 'idle', error: String(error) }))
  }
}

export async function restartAfterUpdate(): Promise<void> {
  try { await relaunch() }
  catch (error) { updates.update(s => ({ ...s, error: String(error) })) }
}

export function startUpdateChecks(): () => void {
  void checkForUpdates()
  const timer = setInterval(() => { void checkForUpdates() }, 4 * 60 * 60 * 1000)
  const online = () => { void checkForUpdates() }
  window.addEventListener('online', online)
  return () => {
    clearInterval(timer)
    window.removeEventListener('online', online)
    ++generation
    const state = get(updates)
    if (state.phase === 'checking') updates.update(s => ({ ...s, phase: 'idle' }))
    if (state.phase === 'idle') { close(state.update); updates.update(s => ({ ...s, update: null })) }
  }
}
