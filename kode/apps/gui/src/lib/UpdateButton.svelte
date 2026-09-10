<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { getVersion } from '@tauri-apps/api/app'
  import { relaunch } from '@tauri-apps/plugin-process'
  import { check, type Update } from '@tauri-apps/plugin-updater'
  import { currentLocale, t } from './i18n'
  import { pushToast } from './toast'

  let update: Update | null = $state(null)
  let currentVersion = $state('')
  let phase: 'idle' | 'downloading' | 'installing' = $state('idle')
  let downloaded = $state(0)
  let contentLength: number | null = $state(null)
  let disposed = false

  let tr = $derived.by(() => {
    void $currentLocale
    return (key: string, params?: Record<string, string | number>) => t(key, params)
  })

  let progress = $derived(
    contentLength && contentLength > 0
      ? Math.min(100, Math.round((downloaded / contentLength) * 100))
      : null
  )

  onMount(async () => {
    try {
      currentVersion = await getVersion()
      const available = await check({ timeout: 15_000 })
      if (disposed) {
        await available?.close()
        return
      }
      update = available
    } catch (error) {
      // 启动时的后台检查不应因离线或 GitHub 不可达打扰用户。
      console.info('update check unavailable', error)
    }
  })

  onDestroy(() => {
    disposed = true
    if (phase === 'idle') void update?.close()
  })

  async function installUpdate() {
    if (!update || phase !== 'idle') return

    phase = 'downloading'
    downloaded = 0
    contentLength = null

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength ?? null
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
        } else if (event.event === 'Finished') {
          phase = 'installing'
        }
      }, { timeout: 120_000 })

      pushToast({
        severity: 'success',
        title: tr('update.installed'),
        detail: tr('update.restarting'),
        durationMs: 8_000,
      })
      await relaunch()
    } catch (error) {
      phase = 'idle'
      pushToast({
        severity: 'error',
        title: tr('update.failed'),
        detail: String(error),
        durationMs: 8_000,
      })
    }
  }
</script>

{#if update}
  <button
    type="button"
    class="update-button"
    class:busy={phase !== 'idle'}
    class:installing={phase === 'installing'}
    onclick={installUpdate}
    disabled={phase !== 'idle'}
    aria-label={phase === 'idle'
      ? tr('update.availableAria', { version: update.version })
      : tr('update.progressAria', { progress: progress ?? 0 })}
    title={phase === 'idle'
      ? tr('update.tooltip', { current: currentVersion, next: update.version })
      : phase === 'installing'
        ? tr('update.installing')
        : progress == null
          ? tr('update.downloading')
          : tr('update.progress', { progress })}
    style={`--update-progress: ${progress ?? 0}%`}
  >
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
      <path d="M5 20h14" />
    </svg>
  </button>
{/if}

<style>
  .update-button {
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0;
    border: 1px solid color-mix(in srgb, var(--acc) 48%, var(--bd-default));
    border-radius: var(--rad-sm);
    background: color-mix(in srgb, var(--acc) 12%, var(--bg-elevated));
    color: var(--acc);
    font: var(--fw-med) 11px/1 var(--font-ui);
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease, transform 100ms ease;
  }

  .update-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--acc) 19%, var(--bg-elevated));
    border-color: var(--acc);
  }

  .update-button:focus-visible {
    outline: 2px solid var(--acc);
    outline-offset: 2px;
  }

  .update-button:active:not(:disabled) {
    transform: translateY(1px);
  }

  .update-button:disabled {
    cursor: wait;
    opacity: 0.78;
    background:
      linear-gradient(var(--bg-elevated), var(--bg-elevated)) padding-box,
      conic-gradient(var(--acc) var(--update-progress), var(--bd-default) 0) border-box;
    border-color: transparent;
  }

  .update-button.busy:not(.installing) svg {
    animation: update-pulse 900ms ease-in-out infinite alternate;
  }

  .update-button.installing svg {
    animation: update-install 900ms linear infinite;
  }

  @keyframes update-pulse {
    from { opacity: 0.45; transform: translateY(-1px); }
    to { opacity: 1; transform: translateY(1px); }
  }

  @keyframes update-install {
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .update-button { transition: none; }
    .update-button.busy svg { animation: none; }
  }
</style>
