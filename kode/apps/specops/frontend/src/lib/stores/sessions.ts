import { writable, get } from 'svelte/store';
import { api, openEventStream } from '../api';
import { executionGroupKey, type SpecOpsSession, type TranscriptEntry } from '../types';

interface LoadSessionsOptions {
  showLoading?: boolean;
}

type RealtimeTranscriptEntry = TranscriptEntry & {
  entry_id?: string;
  revision?: number;
  final?: boolean;
};

interface RealtimeTranscriptPayload {
  session_id?: string;
  execution_id?: string;
  generation?: number;
  process_generation?: number;
  sequence?: number;
  entry_id?: string;
  revision?: number;
  final?: boolean;
  delta?: string;
  entry?: RealtimeTranscriptEntry;
}

interface SpecOpsSessionEvent {
  session_id?: string;
  at?: string;
  payload?: RealtimeTranscriptPayload & {
    entries?: TranscriptEntry[];
  };
}

export const sessions = writable<SpecOpsSession[]>([]);
export const sessionsLoading = writable<boolean>(false);
export const sessionsError = writable<string | null>(null);

export const activeSessionId = writable<string | null>(null);
export const activeSession = writable<SpecOpsSession | null>(null);
export const activeTranscript = writable<SpecOpsSession['transcript'] | undefined>(undefined);

let es: EventSource | null = null;
let selectRequest = 0;
const realtimeSequences = new Map<string, number>();
const realtimeRecoveries = new Map<string, { sessionId: string; maxSequence: number }>();

function sessionSummary(session: SpecOpsSession): SpecOpsSession {
  return {
    id: session.id,
    title: session.title,
    backend_key: session.backend_key,
    run_id: session.run_id,
    phase: session.phase,
    state: session.state,
    execution: session.execution,
    current_execution: session.current_execution,
    document_path: session.document_path,
    required_action: session.required_action,
    decisions: session.decisions,
    workflow: session.workflow,
    agents: session.agents,
    updated_at: session.updated_at,
  };
}

function updateSessionSummary(session: SpecOpsSession): void {
  const summary = sessionSummary(session);
  sessions.update((items) => items.map((item) => (item.id === session.id ? { ...item, ...summary } : item)));
}

function transcriptEntryKey(entry: TranscriptEntry): string {
  const realtimeId = (entry as RealtimeTranscriptEntry).entry_id;
  if (realtimeId) return `entry:${realtimeId}`;
  const kind = entry.kind ?? 'text';
  const groupKey = executionGroupKey(entry.execution_id, entry.kode_session_id) ?? '';
  if (kind !== 'text' && entry.tool_call_id) {
    return [groupKey, kind, entry.tool_call_id].join('\u0000');
  }
  return [groupKey, entry.role, kind, entry.text].join('\u0000');
}

/** Server history is authoritative; retain only local optimistic entries absent from it. */
function mergeTranscript(local: TranscriptEntry[] = [], remote: TranscriptEntry[] = []): TranscriptEntry[] {
  const remoteKeys = new Set(remote.map(transcriptEntryKey));
  return [...remote, ...local.filter((entry) => !remoteKeys.has(transcriptEntryKey(entry)))];
}

function appendTranscriptEntries(sessionId: string, entries: TranscriptEntry[], updatedAt?: string): void {
  if (entries.length === 0) return;
  let changed = false;
  let transcript: TranscriptEntry[] = [];
  activeSession.update((session) => {
    if (session?.id !== sessionId) return session;
    transcript = [...(session.transcript ?? [])];
    const seen = new Set(transcript.map(transcriptEntryKey));
    for (const entry of entries) {
      const key = transcriptEntryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      transcript.push(entry);
      changed = true;
    }
    if (!changed) return session;
    activeTranscript.set(transcript);
    return { ...session, transcript };
  });
  // When activeSession is already set (same session), activeTranscript is updated above.
  // When it's not set (no session selected yet), just skip — no active view cares.
  if (changed && updatedAt) {
    sessions.update((items) => items.map((item) => (item.id === sessionId ? { ...item, updated_at: updatedAt } : item)));
  }
}

function scheduleRealtimeRecovery(key: string, sessionId: string, sequence: number): void {
  const existing = realtimeRecoveries.get(key);
  if (existing !== undefined) {
    existing.maxSequence = Math.max(existing.maxSequence, sequence);
    return;
  }
  const recovery = { sessionId, maxSequence: sequence };
  realtimeRecoveries.set(key, recovery);
  void (async () => {
    for (;;) {
      const target = recovery.maxSequence;
      if (!(await refreshSession(sessionId))) {
        if (realtimeRecoveries.get(key) === recovery) realtimeRecoveries.delete(key);
        return;
      }
      if (realtimeRecoveries.get(key) !== recovery) return;
      realtimeSequences.set(key, Math.max(realtimeSequences.get(key) ?? 0, target));
      if (recovery.maxSequence === target) {
        realtimeRecoveries.delete(key);
        return;
      }
    }
  })();
}

function acceptRealtimeSequence(sessionId: string, payload: RealtimeTranscriptPayload): boolean {
  if (payload.sequence === undefined) return true;
  const generation = payload.generation ?? payload.process_generation ?? 0;
  const key = `${sessionId}\u0000${payload.execution_id ?? ''}\u0000${generation}`;
  const recovery = realtimeRecoveries.get(key);
  if (recovery !== undefined) {
    recovery.maxSequence = Math.max(recovery.maxSequence, payload.sequence);
    return false;
  }
  const previous = realtimeSequences.get(key);
  if (previous !== undefined && payload.sequence <= previous) return false;
  if (payload.sequence !== (previous ?? 0) + 1) {
    scheduleRealtimeRecovery(key, sessionId, payload.sequence);
    return false;
  }
  realtimeSequences.set(key, payload.sequence);
  return true;
}

function upsertRealtimeTranscript(
  sessionId: string,
  payload: RealtimeTranscriptPayload,
  eventType: 'session.transcript_delta' | 'session.transcript_upsert',
  updatedAt?: string,
): void {
  if (!acceptRealtimeSequence(sessionId, payload)) return;
  const entryId = payload.entry_id ?? payload.entry?.entry_id;
  if (!entryId) {
    void refreshSession(sessionId);
    return;
  }

  let changed = false;
  activeSession.update((session) => {
    if (session?.id !== sessionId) return session;
    const transcript = [...(session.transcript ?? [])];
    const index = transcript.findIndex((entry) => (entry as RealtimeTranscriptEntry).entry_id === entryId);
    const previous = index === -1 ? undefined : transcript[index] as RealtimeTranscriptEntry;
    const incoming = payload.entry ?? (previous === undefined
      ? {
          entry_id: entryId,
          revision: payload.revision,
          final: payload.final,
          role: 'agent' as const,
          text: payload.delta ?? '',
          execution_id: payload.execution_id,
        }
      : {
          ...previous,
          revision: payload.revision ?? previous.revision,
          final: payload.final ?? previous.final,
          text: eventType === 'session.transcript_delta' ? `${previous.text}${payload.delta ?? ''}` : previous.text,
        });
    if (previous?.revision !== undefined && incoming.revision !== undefined && incoming.revision <= previous.revision) return session;
    if (index === -1) transcript.push(incoming);
    else transcript[index] = { ...previous, ...incoming };
    changed = true;
    activeTranscript.set(transcript);
    return { ...session, transcript };
  });
  if (changed && updatedAt) {
    sessions.update((items) => items.map((item) => (item.id === sessionId ? { ...item, updated_at: updatedAt } : item)));
  }
}

// ============ Realtime transcript coalescing (perf) ============
// The SSE stream delivers one transcript_delta per agent token — dozens per
// second. Applying each synchronously re-renders the whole chat thread and
// destroys in-progress text selections. Buffer transcript events and flush
// them in order at most once per animation frame: Svelte 5 batches effects
// within one synchronous flush, so the DOM still updates exactly once per
// frame, while per-event O(transcript) recomputes collapse into one.
interface PendingTranscriptEvent {
  sessionId: string;
  type: 'session.transcript_appended' | 'session.transcript_delta' | 'session.transcript_upsert';
  payload: RealtimeTranscriptPayload & { entries?: TranscriptEntry[] };
  at?: string;
}

let pendingTranscriptEvents: PendingTranscriptEvent[] = [];
let transcriptFlushHandle: number | null = null;
let transcriptFlushIsTimer = false;

function flushPendingTranscriptEvents(): void {
  transcriptFlushHandle = null;
  const events = pendingTranscriptEvents;
  pendingTranscriptEvents = [];
  for (const event of events) {
    if (event.type === 'session.transcript_appended') {
      appendTranscriptEntries(event.sessionId, event.payload.entries ?? [], event.at);
    } else {
      upsertRealtimeTranscript(event.sessionId, event.payload, event.type, event.at);
    }
  }
}

function cancelTranscriptFlush(): void {
  if (transcriptFlushHandle === null) return;
  if (transcriptFlushIsTimer) window.clearTimeout(transcriptFlushHandle);
  else cancelAnimationFrame(transcriptFlushHandle);
  transcriptFlushHandle = null;
}

function scheduleTranscriptFlush(): void {
  if (transcriptFlushHandle !== null) return;
  // Hidden windows never receive rAF; fall back to a timer so the transcript
  // still converges while the console window is in the background
  // (WKWebView throttles background timers, which is acceptable here).
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    transcriptFlushHandle = requestAnimationFrame(flushPendingTranscriptEvents);
    transcriptFlushIsTimer = false;
  } else {
    transcriptFlushHandle = window.setTimeout(flushPendingTranscriptEvents, 250);
    transcriptFlushIsTimer = true;
  }
}

function queueTranscriptEvent(event: PendingTranscriptEvent): void {
  pendingTranscriptEvents.push(event);
  scheduleTranscriptFlush();
}

// A rAF scheduled right before the window is hidden would stall indefinitely;
// swap it to a timer when that happens.
function onVisibilityForTranscriptFlush(): void {
  if (transcriptFlushHandle === null || transcriptFlushIsTimer) return;
  if (document.visibilityState === 'hidden') {
    cancelTranscriptFlush();
    scheduleTranscriptFlush();
  }
}

export async function loadSessions(options: LoadSessionsOptions = {}): Promise<void> {
  const showLoading = options.showLoading ?? true;
  if (showLoading) {
    sessionsLoading.set(true);
    sessionsError.set(null);
  }
  try {
    const res = await api.get<{ sessions: SpecOpsSession[] }>('/api/sessions');
    sessions.set(res.sessions ?? []);
    sessionsError.set(null);
  } catch (err) {
    sessionsError.set(err instanceof Error ? err.message : String(err));
  } finally {
    if (showLoading) sessionsLoading.set(false);
  }
}

export async function selectSession(id: string): Promise<void> {
  const previousId = get(activeSessionId);
  const previousSession = get(activeSession);
  const shouldClear = previousId !== id;
  const request = ++selectRequest;

  activeSessionId.set(id);
  if (shouldClear) {
    activeSession.set(null);
    activeTranscript.set(undefined);
  }

  try {
    const res = await api.get<{ session: SpecOpsSession }>(`/api/sessions/${id}`);
    if (request !== selectRequest || get(activeSessionId) !== id) return;
    activeSession.set(res.session);
    activeTranscript.set(res.session?.transcript);
    updateSessionSummary(res.session);
  } catch {
    if (request !== selectRequest || get(activeSessionId) !== id) return;
    if (shouldClear || previousSession?.id !== id) {
      activeSession.set(null);
      activeTranscript.set(undefined);
    }
  }
}

export async function refreshSession(id: string): Promise<boolean> {
  try {
    const res = await api.get<{ session: SpecOpsSession }>(`/api/sessions/${id}`);
    activeSession.update((session) => {
      if (session?.id !== id) return session;
      // Reconcile the full persisted transcript as a safety net for SSE events
      // missed before subscription or during a reconnect. Do not clear local
      // optimistic messages that the server has not persisted yet.
      const transcript = mergeTranscript(session.transcript, res.session?.transcript);
      activeTranscript.set(transcript);
      return { ...session, ...res.session, transcript };
    });
    updateSessionSummary(res.session);
    return true;
  } catch {
    return false;
  }
}

export function subscribeEvents(): void {
  if (es !== null) return;
  document.addEventListener('visibilitychange', onVisibilityForTranscriptFlush);
  es = openEventStream((type, data) => {
    const activeId = get(activeSessionId);
    // Server-side events carry session_id at the top level of the event object
    // (see domain/session-events.ts SpecOpsSessionEvent).
    const evt = data as SpecOpsSessionEvent | undefined;
    const sid = evt?.session_id;
    if (type === 'session.created') {
      loadSessions({ showLoading: false });
      if (sid && sid === activeId) selectSession(sid);
    } else if (type === 'session.transcript_appended' || type === 'session.transcript_delta' || type === 'session.transcript_upsert') {
      // High-frequency transcript events go through the rAF coalescing queue
      // above; ordering across the three event types is preserved.
      if (sid && sid === activeId && evt?.payload) {
        queueTranscriptEvent({ sessionId: sid, type, payload: evt.payload, at: evt?.at });
      }
    } else if (type === 'session.updated' || type === 'session.status_changed' || type === 'session.action_required' || type === 'session.closed') {
      if (sid && sid === activeId) refreshSession(sid);
    }
  }, () => {
    const activeId = get(activeSessionId);
    if (activeId !== null) void refreshSession(activeId);
    void loadSessions({ showLoading: false });
  });
}

export function unsubscribeEvents(): void {
  document.removeEventListener('visibilitychange', onVisibilityForTranscriptFlush);
  cancelTranscriptFlush();
  // Drain anything still queued so un-subscribing never drops events.
  flushPendingTranscriptEvents();
  if (es !== null) {
    es.close();
    es = null;
    realtimeSequences.clear();
    realtimeRecoveries.clear();
  }
}
