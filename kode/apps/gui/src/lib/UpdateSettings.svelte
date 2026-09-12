<script lang="ts">
  import { updates, setBetaUpdates, setIgnoreUpdateVersion, checkForUpdates, installAppUpdate, restartAfterUpdate } from './app_updates'
  import { currentLocale, t } from './i18n'
  let tr = $derived.by(() => { void $currentLocale; return (key: string, params?: Record<string, string | number>) => t(key, params) })
  let installing = $derived(['downloading', 'installing', 'installed'].includes($updates.phase))
  let progress = $derived($updates.contentLength ? Math.min(100, Math.round($updates.downloaded / $updates.contentLength * 100)) : null)
</script>

<section>
  <h2>{tr('settings.updates.title')}</h2>
  <p>{tr('settings.updates.description')}</p>
  <p class="version">{tr('settings.updates.current', { version: $updates.currentVersion || '—' })}</p>
  <label class="beta">
    <input type="checkbox" role="switch" checked={$updates.beta} disabled={installing} onchange={e => setBetaUpdates(e.currentTarget.checked)} />
    <span><strong>{tr('settings.updates.beta')}</strong><span class="hint">{tr('settings.updates.betaHint')}</span></span>
  </label>
  <label class="beta debug">
    <input type="checkbox" role="switch" checked={$updates.ignoreVersion} disabled={installing} onchange={e => setIgnoreUpdateVersion(e.currentTarget.checked)} />
    <span><strong>{tr('settings.updates.ignoreVersion')}</strong><span class="hint">{tr('settings.updates.ignoreVersionHint')}</span></span>
  </label>
  <div class="status" role="status" aria-live="polite">
    {#if $updates.phase === 'checking'}
      {tr('settings.updates.checking')}
    {:else if $updates.phase === 'downloading'}
      {progress == null ? tr('update.downloading') : tr('update.progress', { progress })}
    {:else if $updates.phase === 'installing'}
      {tr('update.installing')}
    {:else if $updates.phase === 'installed'}
      {tr('settings.updates.ready')}
    {:else if $updates.update}
      {tr('settings.updates.available', { version: $updates.update.version })}
    {:else if $updates.pendingVersion}
      {tr('settings.updates.pending', { version: $updates.pendingVersion })}
    {:else if $updates.checked && !$updates.error}
      {tr($updates.ignoreVersion ? 'settings.updates.noRelease' : 'settings.updates.latest')}
    {/if}
  </div>
  {#if $updates.error}<p class="error" role="alert">{tr('update.failed')}: {$updates.error}</p>{/if}
  <div class="actions">
    <button disabled={$updates.phase !== 'idle'} onclick={() => checkForUpdates()}>{tr('settings.updates.check')}</button>
    {#if $updates.phase === 'installed'}
      <button class="primary" onclick={() => restartAfterUpdate()}>{tr('settings.updates.restart')}</button>
    {:else if $updates.update}
      <button class="primary" disabled={$updates.phase !== 'idle'} onclick={() => installAppUpdate()}>{tr('update.action', { version: $updates.update.version })}</button>
    {/if}
  </div>
  <p class="hint">{tr('settings.updates.restartHint')}</p>
</section>

<style>
  section { max-width: 640px; }
  h2 { margin: 0 0 8px; font-size: 18px; color: var(--fg-primary); }
  p { color: var(--fg-secondary); line-height: 1.6; }
  .version { margin: 24px 0; color: var(--fg-primary); }
  .beta { display: flex; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid var(--bd-default); border-radius: var(--rad-md); background: var(--bg-elevated); cursor: pointer; }
  input { margin-top: 3px; accent-color: var(--acc); }
  .debug { margin-top: 12px; }
  strong { display: block; font-weight: 500; }
  .hint { display: block; margin-top: 8px; font-size: 12px; color: var(--fg-secondary); line-height: 1.6; }
  .status { min-height: 44px; padding-top: 20px; line-height: 1.6; }
  .error { color: var(--st-err); overflow-wrap: anywhere; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; }
  button { padding: 9px 14px; border: 1px solid var(--bd-default); border-radius: var(--rad-sm); background: var(--bg-elevated); color: var(--fg-primary); font: inherit; cursor: pointer; }
  button.primary { border-color: var(--acc); color: var(--acc); }
  button:disabled { opacity: .5; cursor: default; }
  button:hover:not(:disabled) { background: color-mix(in srgb, var(--acc) 10%, var(--bg-elevated)); }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--acc); outline-offset: 3px; }
</style>
