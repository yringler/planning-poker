import { Injectable, InjectionToken, signal, computed, DestroyRef, inject } from '@angular/core';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import type { Awareness } from 'y-protocols/awareness';
import { environment } from '../../environments/environment';
import {
  CHECK_KEY,
  CONFIDENCE_MAP,
  ITEM_URL_KEY,
  MODE_KEY,
  checkPhase,
  type CheckAction,
  type CheckState,
  type ClientMessage,
  type HistoryEntry,
  type RoomMode,
  type ServerMessage,
} from '../shared/confidence-protocol';
import {
  confidencePlayers,
  confidentIdsForRound,
  pointPlayers,
  resolveHistory,
  type Player,
} from './room-logic';

export type { Player } from './room-logic';

/** The parts of y-partyserver's `YProvider` that RoomService uses. */
export interface ProviderLike {
  readonly awareness: Awareness;
  on(event: 'status', cb: (e: { status: string }) => void): void;
  on(event: 'synced', cb: (synced: boolean) => void): void;
  on(event: 'custom-message', cb: (raw: string) => void): void;
  sendMessage(msg: string): void;
  destroy(): void;
}

export type YProviderFactory = (
  host: string,
  room: string,
  doc: Y.Doc,
  opts: { party: string },
) => ProviderLike;

/** Creates the realtime provider; tests swap in a fake that opens no WebSocket. */
export const Y_PROVIDER_FACTORY = new InjectionToken<YProviderFactory>('Y_PROVIDER_FACTORY', {
  providedIn: 'root',
  factory: () => (host, room, doc, opts) => new YProvider(host, room, doc, opts),
});

export type {
  CheckAttempt,
  CheckOutcome,
  CheckPhase,
  CheckState,
  HistoryEntry,
  RoomMode,
} from '../shared/confidence-protocol';
export { CHECK_DURATION_MS } from '../shared/confidence-protocol';

@Injectable({ providedIn: 'root' })
export class RoomService {
  private doc: Y.Doc | null = null;
  private provider: ProviderLike | null = null;
  private destroyRef = inject(DestroyRef);
  private createProvider = inject(Y_PROVIDER_FACTORY);

  readonly storyName = signal('');
  readonly phase = signal<'voting' | 'revealed'>('voting');
  readonly votes = signal<Record<string, string>>({});
  private readonly players = signal<Player[]>([]);
  /** peerId → last known display name, persisted in Yjs so departed voters stay labeled. */
  private readonly peerNames = signal<Record<string, string>>({});
  readonly timerDuration = signal(60);
  readonly timerEndTime = signal<number | null>(null);
  readonly timerState = signal<'idle' | 'running' | 'paused'>('idle');
  readonly timerRemainingOnPause = signal(0);
  readonly timerVisible = signal(false);

  // --- Confidence check state (mirrored from the doc; `mode`/`check` are server-written) ---
  /** Missing in the doc (older rooms) = point voting. */
  readonly mode = signal<RoomMode>('points');
  readonly itemUrl = signal('');
  private readonly check = signal<CheckState | null>(null);
  readonly checkRound = computed(() => this.check()?.round ?? 0);
  /** Server-clock start of the current round. */
  readonly checkStartedAt = computed(() => this.check()?.startedAt ?? null);
  readonly checkOutcome = computed(() => this.check()?.outcome ?? null);
  readonly checkLog = computed(() => this.check()?.log ?? []);
  readonly checkPhase = computed(() => checkPhase(this.mode(), this.check()));
  /** peerId → round number in which that peer marked themselves confident. */
  private readonly confidenceRaw = signal<Record<string, number>>({});
  /** Estimated server clock minus local clock, in ms (from the server's `time` messages). */
  readonly serverOffset = signal(0);
  /** Local-only, short-lived message after this client skipped an item. */
  readonly skipNotice = signal<string | null>(null);
  private skipNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** True when this client first saw the current round already running (joined mid-check). */
  readonly joinedMidCheck = signal(false);
  private roomCode = '';

  /** peerIds confident in the current round (values from older rounds are ignored). */
  readonly confidentIds = computed(() =>
    confidentIdsForRound(this.confidenceRaw(), this.checkRound()),
  );

  readonly uniquePlayers = computed(() =>
    this.mode() === 'confidence' ? this.confidencePlayers() : this.pointPlayers(),
  );

  /** Point voting: deduped by name, keeping departed voters until the round is cleared. */
  private readonly pointPlayers = computed(() =>
    pointPlayers(this.players(), this.votes(), this.peerNames()),
  );

  /**
   * Confidence check: deduped by peerId (same as the server's count), so two people with the
   * same name both count. In a pause, revealed not-confident players who left stay listed.
   */
  private readonly confidencePlayers = computed(() =>
    confidencePlayers(this.players(), this.peerNames(), this.checkPhase(), this.checkOutcome()),
  );
  readonly onlineCount = computed(() => this.uniquePlayers().filter((p) => !p.offline).length);

  /** Who a confidence check counts: connected non-observers (confidence mode: by peerId). */
  readonly checkPlayers = computed(() =>
    this.uniquePlayers().filter((p) => !p.offline && !p.observer),
  );
  readonly confidentCount = computed(() => {
    const confident = this.confidentIds();
    return this.checkPlayers().filter((p) => confident.has(p.peerId)).length;
  });
  readonly amConfident = computed(() => this.confidentIds().has(this.myPeerId()));
  private readonly history = signal<HistoryEntry[]>([]);
  readonly myPeerId = signal('');
  readonly connected = signal(false);
  readonly isObserver = signal(false);

  readonly resolvedHistory = computed(() =>
    resolveHistory(
      this.history(),
      this.pointPlayers().filter((p) => !p.offline),
      this.peerNames(),
    ),
  );

  connect(roomCode: string, playerName: string): void {
    this.disconnect();

    this.doc = new Y.Doc();
    const peerId = this.getOrCreatePeerId();
    this.myPeerId.set(peerId);
    this.roomCode = roomCode;
    let synced = false;

    // `party` is the kebab-cased Durable Object binding name in wrangler.jsonc
    this.provider = this.createProvider(
      environment.partyHost,
      `planning-poker-${roomCode}`,
      this.doc,
      { party: 'planning-poker' },
    );
    this.provider.on('status', ({ status }: { status: string }) => {
      this.connected.set(status === 'connected');
      if (status === 'connected' && this.doc) {
        this.send({ type: 'hello', clientId: this.doc.clientID });
      }
    });
    this.provider.on('synced', (isSynced: boolean) => {
      if (!isSynced || synced) return;
      synced = true;
      initSession();
    });
    this.provider.on('custom-message', (raw: string) => this.onServerMessage(raw));

    // Set awareness
    const savedObserver = localStorage.getItem('pp-observer') === 'true';
    this.isObserver.set(savedObserver);
    this.provider.awareness.setLocalState({ name: playerName, peerId, observer: savedObserver || undefined });

    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');
    const namesMap = this.doc.getMap<string>('names');
    const historyArray = this.doc.getArray<HistoryEntry>('history');
    const confidenceMap = this.doc.getMap<number>(CONFIDENCE_MAP);

    // Initialize session if empty. Only after the first sync: writing defaults into the empty
    // local doc would race with (and could overwrite) the room's existing values.
    const initSession = () => {
      if (!this.doc) return;
      this.doc.transact(() => {
        if (namesMap.get(peerId) !== playerName) {
          namesMap.set(peerId, playerName);
        }
        if (!sessionMap.has('phase')) {
          sessionMap.set('phase', 'voting');
        }
        if (!sessionMap.has('storyName')) {
          sessionMap.set('storyName', '');
        }
        if (!sessionMap.has('timerDuration')) {
          sessionMap.set('timerDuration', 60);
        }
        if (!sessionMap.has('timerState')) {
          sessionMap.set('timerState', 'idle');
        }
        if (!sessionMap.has('timerVisible')) {
          sessionMap.set('timerVisible', false);
        }
      });
    };

    // Observe session map
    const syncSession = () => {
      this.storyName.set((sessionMap.get('storyName') as string) ?? '');
      this.phase.set((sessionMap.get('phase') as 'voting' | 'revealed') ?? 'voting');
      this.timerDuration.set((sessionMap.get('timerDuration') as number) ?? 60);
      this.timerEndTime.set((sessionMap.get('timerEndTime') as number) ?? null);
      this.timerState.set((sessionMap.get('timerState') as 'idle' | 'running' | 'paused') ?? 'idle');
      this.timerRemainingOnPause.set((sessionMap.get('timerRemainingOnPause') as number) ?? 0);
      this.timerVisible.set((sessionMap.get('timerVisible') as boolean) ?? false);
      this.mode.set(sessionMap.get(MODE_KEY) === 'confidence' ? 'confidence' : 'points');
      this.itemUrl.set((sessionMap.get(ITEM_URL_KEY) as string) ?? '');
      this.check.set((sessionMap.get(CHECK_KEY) as CheckState) ?? null);
      this.trackMidCheckJoin(!synced);
    };
    sessionMap.observe(syncSession);
    syncSession();

    // Observe votes
    const syncVotes = () => {
      const v: Record<string, string> = {};
      votesMap.forEach((val, key) => {
        v[key] = val as string;
      });
      this.votes.set(v);
    };
    votesMap.observe(syncVotes);
    syncVotes();

    // Observe confidence
    const syncConfidence = () => {
      this.confidenceRaw.set(confidenceMap.toJSON() as Record<string, number>);
    };
    confidenceMap.observe(syncConfidence);
    syncConfidence();

    // Observe peer names
    const syncNames = () => {
      this.peerNames.set(namesMap.toJSON() as Record<string, string>);
    };
    namesMap.observe(syncNames);
    syncNames();

    // Observe history
    const syncHistory = () => {
      this.history.set(historyArray.toArray());
    };
    historyArray.observe(syncHistory);
    syncHistory();

    // Observe awareness for players
    const syncPlayers = () => {
      const states = this.provider!.awareness.getStates();
      const playerList: Player[] = [];
      states.forEach((state: Record<string, unknown>) => {
        if (state?.['name'] && state?.['peerId']) {
          playerList.push({
            name: state['name'] as string,
            peerId: state['peerId'] as string,
            observer: !!state['observer'],
          });
        }
      });
      this.players.set(playerList);
    };
    this.provider.awareness.on('change', syncPlayers);
    syncPlayers();

    this.destroyRef.onDestroy(() => this.disconnect());
  }

  disconnect(): void {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    if (this.doc) {
      this.doc.destroy();
      this.doc = null;
    }
    this.connected.set(false);
    this.isObserver.set(false);
    this.players.set([]);
    this.peerNames.set({});
    this.votes.set({});
    this.history.set([]);
    this.phase.set('voting');
    this.storyName.set('');
    this.timerDuration.set(60);
    this.timerEndTime.set(null);
    this.timerState.set('idle');
    this.timerRemainingOnPause.set(0);
    this.timerVisible.set(false);
    this.mode.set('points');
    this.itemUrl.set('');
    this.check.set(null);
    this.confidenceRaw.set({});
    this.serverOffset.set(0);
    this.joinedMidCheck.set(false);
    if (this.skipNoticeTimer) clearTimeout(this.skipNoticeTimer);
    this.skipNoticeTimer = null;
    this.skipNotice.set(null);
  }

  toggleObserver(): void {
    if (!this.provider) return;
    const next = !this.isObserver();
    this.isObserver.set(next);
    if (next) {
      localStorage.setItem('pp-observer', 'true');
    } else {
      localStorage.removeItem('pp-observer');
    }
    const current = this.provider.awareness.getLocalState() ?? {};
    this.provider.awareness.setLocalState({ ...current, observer: next || undefined });
    if (next) {
      // Remove any existing vote when becoming an observer
      this.doc?.getMap('votes').delete(this.myPeerId());
      this.doc?.getMap(CONFIDENCE_MAP).delete(this.myPeerId());
    }
  }

  vote(value: string): void {
    this.doc?.getMap('votes').set(this.myPeerId(), value);
  }

  clearVote(): void {
    this.doc?.getMap('votes').delete(this.myPeerId());
  }

  revealVotes(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');
    const historyArray = this.doc.getArray<HistoryEntry>('history');

    const playerNames: Record<string, string> = {};
    votesMap.forEach((_, peerId) => {
      const name = this.peerNames()[peerId];
      if (name) playerNames[peerId] = name;
    });
    this.uniquePlayers().forEach(p => {
      if (!p.offline) playerNames[p.peerId] = p.name;
    });

    const currentVotes: Record<string, string> = {};
    votesMap.forEach((val, key) => {
      currentVotes[key] = val as string;
    });

    this.doc.transact(() => {
      historyArray.insert(0, [{
        story: (sessionMap.get('storyName') as string) || '',
        timestamp: Date.now(),
        votes: currentVotes,
        players: playerNames,
      }]);
      sessionMap.set('phase', 'revealed');
    });
    this.resetTimer();
  }

  updateHistoryStory(timestamp: number, newStory: string): void {
    if (!this.doc) return;
    const historyArray = this.doc.getArray<HistoryEntry>('history');
    const entries = historyArray.toArray();
    const index = entries.findIndex(e => e.timestamp === timestamp);
    if (index === -1) return;
    const updated = { ...entries[index], story: newStory };
    this.doc.transact(() => {
      historyArray.delete(index, 1);
      historyArray.insert(index, [updated]);
    });
  }

  deleteHistoryEntry(timestamp: number): void {
    if (!this.doc) return;
    const historyArray = this.doc.getArray<HistoryEntry>('history');
    const index = historyArray.toArray().findIndex(e => e.timestamp === timestamp);
    if (index === -1) return;
    this.doc.transact(() => historyArray.delete(index, 1));
  }

  resetRound(): void {
    if (!this.doc) return;
    this.doc.transact(() => {
      const votesMap = this.doc!.getMap('votes');
      const keys = Array.from(votesMap.keys());
      keys.forEach(k => votesMap.delete(k));
      this.doc!.getMap('session').set('phase', 'voting');
    });
    this.resetTimer();
  }

  newRound(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');

    this.doc.transact(() => {
      // Clear votes
      const keys = Array.from(votesMap.keys());
      keys.forEach(k => votesMap.delete(k));

      // Reset
      sessionMap.set('phase', 'voting');
      sessionMap.set('storyName', '');
    });
    this.resetTimer();
  }

  updateStoryName(name: string): void {
    this.doc?.getMap('session').set('storyName', name);
  }

  toggleTimerVisible(): void {
    if (!this.doc) return;
    this.doc.getMap('session').set('timerVisible', !this.timerVisible());
  }

  startTimer(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    const remaining =
      this.timerState() === 'paused' ? this.timerRemainingOnPause() : this.timerDuration();
    this.doc.transact(() => {
      sessionMap.set('timerEndTime', Date.now() + remaining * 1000);
      sessionMap.set('timerState', 'running');
      sessionMap.set('timerRemainingOnPause', 0);
    });
  }

  pauseTimer(): void {
    if (!this.doc) return;
    const endTime = this.timerEndTime();
    if (!endTime) return;
    const remaining = Math.max(0, (endTime - Date.now()) / 1000);
    const sessionMap = this.doc.getMap('session');
    this.doc.transact(() => {
      sessionMap.set('timerState', 'paused');
      sessionMap.set('timerRemainingOnPause', remaining);
      sessionMap.set('timerEndTime', null);
    });
  }

  resetTimer(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    this.doc.transact(() => {
      sessionMap.set('timerState', 'idle');
      sessionMap.set('timerEndTime', null);
      sessionMap.set('timerRemainingOnPause', 0);
    });
  }

  adjustDuration(delta: number): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    const newDuration = Math.max(10, this.timerDuration() + delta);
    this.doc.transact(() => {
      sessionMap.set('timerDuration', newDuration);
      if (this.timerState() === 'running') {
        const endTime = this.timerEndTime();
        if (endTime) {
          sessionMap.set('timerEndTime', endTime + delta * 1000);
        }
      } else if (this.timerState() === 'paused') {
        sessionMap.set(
          'timerRemainingOnPause',
          Math.max(0, this.timerRemainingOnPause() + delta),
        );
      }
    });
  }

  // --- Confidence check ---
  // Clients only *request* check transitions; the Durable Object performs them (single
  // writer, server clock, server-side deadline and all-confident detection).

  /** Current time on the server's clock, as estimated from its `time` messages. */
  serverNow(): number {
    return Date.now() + this.serverOffset();
  }

  setMode(mode: RoomMode): void {
    if (mode === this.mode() || this.checkPhase() === 'checking') return;
    this.send({ type: 'mode', mode, round: this.checkRound() });
  }

  updateItemUrl(url: string): void {
    this.doc?.getMap('session').set(ITEM_URL_KEY, url);
  }

  /** Starts (or restarts) the check for the current item. */
  startCheck(): void {
    this.sendCheck('start');
  }

  /** Abandons the running check without recording it. */
  cancelCheck(): void {
    this.sendCheck('cancel');
  }

  /** Records an unresolved (paused) item as not confident and moves on. */
  skipItem(): void {
    if (this.checkPhase() !== 'paused' || !this.sendCheck('skip')) return;
    this.skipNotice.set('Skipped. Recorded as not confident.');
    if (this.skipNoticeTimer) clearTimeout(this.skipNoticeTimer);
    this.skipNoticeTimer = setTimeout(() => this.skipNotice.set(null), 4000);
  }

  /** Clears the confirmed item so the next one can be set up. */
  nextItem(): void {
    this.sendCheck('next');
  }

  setConfident(confident: boolean): void {
    if (!this.doc || !this.connected() || this.isObserver()) return;
    if (this.checkPhase() !== 'checking') return;
    const confidenceMap = this.doc.getMap<number>(CONFIDENCE_MAP);
    if (confident) {
      confidenceMap.set(this.myPeerId(), this.checkRound());
    } else {
      confidenceMap.delete(this.myPeerId());
    }
  }

  private sendCheck(action: CheckAction): boolean {
    return this.send({ type: 'check', action, round: this.checkRound() });
  }

  /** Sends a request to the server; returns false (and does nothing) while disconnected. */
  private send(msg: ClientMessage): boolean {
    if (!this.provider || !this.connected()) return false;
    try {
      this.provider.sendMessage(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  private onServerMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === 'time' && typeof msg.now === 'number') {
      // Ignores one-way latency (tens of ms), which is fine for a 1-minute countdown
      this.serverOffset.set(msg.now - Date.now());
    }
  }

  /**
   * Remembers (per tab, across reloads) whether this client first saw the current round
   * already running, i.e. joined mid-check rather than being there when it started.
   */
  private trackMidCheckJoin(initialLoad: boolean): void {
    if (this.checkPhase() !== 'checking') {
      this.joinedMidCheck.set(false);
      return;
    }
    const key = `pp-check-seen-${this.roomCode}`;
    const round = this.checkRound();
    let seen: { round: number; mid: boolean } | null = null;
    try {
      seen = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    } catch {
      seen = null;
    }
    if (seen?.round !== round) {
      seen = { round, mid: initialLoad };
      try {
        sessionStorage.setItem(key, JSON.stringify(seen));
      } catch {
        // Storage unavailable: the hint just may reappear after a reload
      }
    }
    this.joinedMidCheck.set(seen.mid);
  }

  private getOrCreatePeerId(): string {
    const key = 'pp-peer-id';
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    return id;
  }
}
