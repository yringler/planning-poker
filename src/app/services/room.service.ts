import { Injectable, signal, computed, DestroyRef, inject, effect } from '@angular/core';
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';
import { environment } from '../../environments/environment';

export interface Player {
  name: string;
  peerId: string;
  observer?: boolean;
  /** True for a player who left the room but whose vote is kept for this round. */
  offline?: boolean;
}

export type RoomMode = 'points' | 'confidence';

/** Derived state of a confidence check. `setup` = item being prepared, no check running. */
export type CheckPhase = 'setup' | 'checking' | 'confident' | 'paused';

/** Fixed length of a confidence check. */
export const CHECK_DURATION_MS = 60_000;

/**
 * How long a non-leader client waits before performing a shared transition (timeout or
 * all-confident) itself, in case the leader is gone or slow. Transitions are idempotent.
 */
const TRANSITION_FALLBACK_MS = 2_000;

/** Result of one check round, written once when the round ends (single key → coherent LWW). */
export interface CheckOutcome {
  round: number;
  result: 'confident' | 'paused';
  /** When the round ended (freezes the timer display). */
  at: number;
  /** peerId → name of players who were not confident when time ran out. */
  notConfident: Record<string, string>;
  /** peerIds of players who were confident when the round ended. */
  confident: string[];
}

/** One check of the current item that timed out with people not confident. */
export interface CheckAttempt {
  check: number;
  notConfident: string[];
}

export interface HistoryEntry {
  story: string;
  timestamp: number;
  votes: Record<string, string>;
  players: Record<string, string>;
  /** Missing = point-voting round. */
  kind?: 'confidence';
  /** Confidence entries: stable item id, used to drop duplicate concurrent inserts. */
  id?: string;
  url?: string;
  result?: 'confident' | 'skipped';
  /** Number of checks run for the item. */
  checks?: number;
  /** Checks that ended paused, with who wasn't confident. */
  attempts?: CheckAttempt[];
}

@Injectable({ providedIn: 'root' })
export class RoomService {
  private doc: Y.Doc | null = null;
  private provider: YProvider | null = null;
  private destroyRef = inject(DestroyRef);

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

  // --- Confidence check state (all mirrored from the `session` map / `confidence` map) ---
  /** Missing in the doc (older rooms) = point voting. */
  readonly mode = signal<RoomMode>('points');
  readonly itemUrl = signal('');
  private readonly itemId = signal('');
  /** Incremented on every (re)start; confidence values and outcomes are tagged with it. */
  readonly checkRound = signal(0);
  readonly checkStartedAt = signal<number | null>(null);
  readonly checkOutcome = signal<CheckOutcome | null>(null);
  readonly checkLog = signal<CheckAttempt[]>([]);
  /** peerId → round number in which that peer marked themselves confident. */
  private readonly confidenceRaw = signal<Record<string, number>>({});
  /** True when this client has the lowest awareness clientID, so it performs transitions first. */
  private readonly isLeader = signal(false);
  /** Local-only, short-lived message after this client skipped an item. */
  readonly skipNotice = signal<string | null>(null);
  private skipNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  /** When this client connected; used to tell a player they joined mid-check. */
  readonly joinedAt = signal(0);

  readonly checkPhase = computed<CheckPhase>(() => {
    if (this.mode() !== 'confidence' || this.checkStartedAt() == null) return 'setup';
    const outcome = this.checkOutcome();
    if (outcome && outcome.round === this.checkRound()) return outcome.result;
    return 'checking';
  });

  /** peerIds confident in the current round (values from older rounds are ignored). */
  readonly confidentIds = computed(() => {
    const round = this.checkRound();
    const raw = this.confidenceRaw();
    return new Set(Object.keys(raw).filter((id) => raw[id] === round));
  });

  readonly uniquePlayers = computed(() => {
    const confidenceMode = this.mode() === 'confidence';
    // In confidence mode "has voted" means confident this round; point votes are ignored.
    const confident = this.confidentIds();
    const votes = confidenceMode
      ? Object.fromEntries([...confident].map((id) => [id, 'confident']))
      : this.votes();
    const names = this.peerNames();
    const online = this.players();
    const onlineIds = new Set(online.map((p) => p.peerId));
    // Players who voted and then left: keep them (and their vote) until the round is cleared.
    // In a paused confidence check, keep the revealed not-confident players instead.
    const outcome = this.checkOutcome();
    const keptIds = confidenceMode
      ? this.checkPhase() === 'paused' && outcome
        ? Object.keys(outcome.notConfident)
        : []
      : Object.keys(votes);
    const departed: Player[] = keptIds
      .filter((peerId) => !onlineIds.has(peerId))
      .map((peerId) => ({ name: names[peerId] ?? 'Unknown', peerId, offline: true }));

    const seen = new Map<string, Player>();
    for (const p of [...online, ...departed]) {
      const existing = seen.get(p.name);
      // Prefer the entry that has voted; otherwise the first (online before departed) wins
      if (!existing || (!votes[existing.peerId] && votes[p.peerId])) {
        seen.set(p.name, p);
      }
    }
    return Array.from(seen.values());
  });
  readonly onlineCount = computed(() => this.uniquePlayers().filter((p) => !p.offline).length);

  /** Who a confidence check counts: connected, non-observer, deduped by name. */
  readonly checkPlayers = computed(() =>
    this.uniquePlayers().filter((p) => !p.offline && !p.observer),
  );
  readonly confidentCount = computed(() => {
    const confident = this.confidentIds();
    return this.checkPlayers().filter((p) => confident.has(p.peerId)).length;
  });
  readonly allConfident = computed(() => {
    const total = this.checkPlayers().length;
    return total > 0 && this.confidentCount() === total;
  });
  readonly amConfident = computed(() => this.confidentIds().has(this.myPeerId()));
  private readonly history = signal<HistoryEntry[]>([]);
  readonly myPeerId = signal('');
  readonly connected = signal(false);
  readonly isObserver = signal(false);

  readonly resolvedHistory = computed(() => {
    const currentPlayers = this.uniquePlayers().filter((p) => !p.offline);
    const names = this.peerNames();
    // Two clients may record the same confidence item concurrently; keep the first copy.
    const seenIds = new Set<string>();
    const history = this.history().filter((entry) => {
      if (!entry.id) return true;
      if (seenIds.has(entry.id)) return false;
      seenIds.add(entry.id);
      return true;
    });

    const onlineNameCount = new Map<string, number>();
    for (const p of currentPlayers) {
      onlineNameCount.set(p.name, (onlineNameCount.get(p.name) ?? 0) + 1);
    }

    return history.map(entry => {
      const resolvedPlayers: Record<string, string> = { ...entry.players };

      for (const peerId of Object.keys(entry.votes)) {
        if (resolvedPlayers[peerId]) continue;
        if (names[peerId]) {
          resolvedPlayers[peerId] = names[peerId];
          continue;
        }

        for (const p of currentPlayers) {
          if (onlineNameCount.get(p.name) !== 1) continue;
          if (p.peerId !== peerId) continue;

          const oldEntry = Object.entries(entry.players).find(([, n]) => n === p.name);
          if (!oldEntry) continue;

          const [oldPeerId] = oldEntry;
          const oldPeerOnline = currentPlayers.some(cp => cp.peerId === oldPeerId);
          if (oldPeerOnline) continue;

          resolvedPlayers[peerId] = p.name;
          break;
        }
      }

      return { ...entry, players: resolvedPlayers };
    });
  });

  constructor() {
    // Timeout: when the shared deadline passes, end the round as paused (or confident).
    effect((onCleanup) => {
      const startedAt = this.checkStartedAt();
      if (this.checkPhase() !== 'checking' || startedAt == null) return;
      const round = this.checkRound();
      const delay =
        Math.max(0, startedAt + CHECK_DURATION_MS - Date.now()) +
        (this.isLeader() ? 0 : TRANSITION_FALLBACK_MS);
      const id = setTimeout(() => this.endCheck(round, true), delay);
      onCleanup(() => clearTimeout(id));
    });

    // Early finish: as soon as every counted player is confident.
    effect((onCleanup) => {
      if (this.checkPhase() !== 'checking' || !this.allConfident()) return;
      const round = this.checkRound();
      const id = setTimeout(
        () => this.endCheck(round, false),
        this.isLeader() ? 0 : TRANSITION_FALLBACK_MS,
      );
      onCleanup(() => clearTimeout(id));
    });
  }

  connect(roomCode: string, playerName: string): void {
    this.disconnect();

    this.doc = new Y.Doc();
    const peerId = this.getOrCreatePeerId();
    this.myPeerId.set(peerId);
    this.joinedAt.set(Date.now());

    // `party` is the kebab-cased Durable Object binding name in wrangler.jsonc
    this.provider = new YProvider(environment.partyHost, `planning-poker-${roomCode}`, this.doc, {
      party: 'planning-poker',
    });

    // Set awareness
    const savedObserver = localStorage.getItem('pp-observer') === 'true';
    this.isObserver.set(savedObserver);
    this.provider.awareness.setLocalState({ name: playerName, peerId, observer: savedObserver || undefined });

    const sessionMap = this.doc.getMap('session');
    const votesMap = this.doc.getMap('votes');
    const namesMap = this.doc.getMap<string>('names');
    const historyArray = this.doc.getArray<HistoryEntry>('history');
    const confidenceMap = this.doc.getMap<number>('confidence');

    // Initialize session if empty
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

    // Observe session map
    const syncSession = () => {
      this.storyName.set((sessionMap.get('storyName') as string) ?? '');
      this.phase.set((sessionMap.get('phase') as 'voting' | 'revealed') ?? 'voting');
      this.timerDuration.set((sessionMap.get('timerDuration') as number) ?? 60);
      this.timerEndTime.set((sessionMap.get('timerEndTime') as number) ?? null);
      this.timerState.set((sessionMap.get('timerState') as 'idle' | 'running' | 'paused') ?? 'idle');
      this.timerRemainingOnPause.set((sessionMap.get('timerRemainingOnPause') as number) ?? 0);
      this.timerVisible.set((sessionMap.get('timerVisible') as boolean) ?? false);
      this.mode.set(sessionMap.get('mode') === 'confidence' ? 'confidence' : 'points');
      this.itemUrl.set((sessionMap.get('itemUrl') as string) ?? '');
      this.itemId.set((sessionMap.get('itemId') as string) ?? '');
      this.checkRound.set((sessionMap.get('checkRound') as number) ?? 0);
      this.checkStartedAt.set((sessionMap.get('checkStartedAt') as number) ?? null);
      this.checkOutcome.set((sessionMap.get('checkOutcome') as CheckOutcome) ?? null);
      this.checkLog.set((sessionMap.get('checkLog') as CheckAttempt[]) ?? []);
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
      let lowestClientId = Infinity;
      states.forEach((state: Record<string, unknown>, clientId: number) => {
        if (state?.['peerId']) lowestClientId = Math.min(lowestClientId, clientId);
        if (state?.['name'] && state?.['peerId']) {
          playerList.push({
            name: state['name'] as string,
            peerId: state['peerId'] as string,
            observer: !!state['observer'],
          });
        }
      });
      this.players.set(playerList);
      this.isLeader.set(lowestClientId === this.doc?.clientID);
    };
    this.provider.awareness.on('change', syncPlayers);
    syncPlayers();

    this.connected.set(true);

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
    this.itemId.set('');
    this.checkRound.set(0);
    this.checkStartedAt.set(null);
    this.checkOutcome.set(null);
    this.checkLog.set([]);
    this.confidenceRaw.set({});
    this.isLeader.set(false);
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
      this.doc?.getMap('confidence').delete(this.myPeerId());
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

  setMode(mode: RoomMode): void {
    if (!this.doc || mode === this.mode() || this.checkPhase() === 'checking') return;
    const sessionMap = this.doc.getMap('session');
    const itemDone = this.checkPhase() === 'confident';
    this.doc.transact(() => {
      sessionMap.set('mode', mode);
      // Leave any finished/paused check behind; the item name is kept unless it's done.
      this.clearCheck(itemDone);
    });
  }

  updateItemUrl(url: string): void {
    this.doc?.getMap('session').set('itemUrl', url);
  }

  /** Starts (or restarts) the check for the current item: everyone not confident, full timer. */
  startCheck(): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    this.doc.transact(() => {
      if (sessionMap.get('mode') !== 'confidence') return;
      if (this.readPhase() === 'checking') return;
      if (!((sessionMap.get('storyName') as string) ?? '').trim()) return;
      this.clearConfidence();
      sessionMap.set('checkRound', ((sessionMap.get('checkRound') as number) ?? 0) + 1);
      sessionMap.set('checkStartedAt', Date.now());
      sessionMap.set('checkOutcome', null);
      sessionMap.set('itemChecks', ((sessionMap.get('itemChecks') as number) ?? 0) + 1);
      if (!sessionMap.get('itemId')) sessionMap.set('itemId', crypto.randomUUID());
    });
  }

  /** Abandons the running check without recording it. */
  cancelCheck(): void {
    if (!this.doc) return;
    this.doc.transact(() => {
      if (this.readPhase() !== 'checking') return;
      const sessionMap = this.doc!.getMap('session');
      sessionMap.set('checkStartedAt', null);
      sessionMap.set('checkOutcome', null);
      // A cancelled check doesn't count towards the item's checks
      const checks = (sessionMap.get('itemChecks') as number) ?? 1;
      sessionMap.set('itemChecks', Math.max(0, checks - 1));
      this.clearConfidence();
    });
  }

  setConfident(confident: boolean): void {
    if (!this.doc || this.isObserver() || this.checkPhase() !== 'checking') return;
    const confidenceMap = this.doc.getMap<number>('confidence');
    if (confident) {
      confidenceMap.set(this.myPeerId(), this.checkRound());
    } else {
      confidenceMap.delete(this.myPeerId());
    }
  }

  /** Records an unresolved (paused) item as not confident and moves on. */
  skipItem(): void {
    if (!this.doc) return;
    let skipped = false;
    this.doc.transact(() => {
      if (this.readPhase() !== 'paused') return;
      const log = this.doc!.getMap('session').get('checkLog') as CheckAttempt[];
      this.insertCheckHistory('skipped', log);
      this.clearCheck(true);
      skipped = true;
    });
    if (!skipped) return;
    this.skipNotice.set('Skipped. Recorded as not confident.');
    if (this.skipNoticeTimer) clearTimeout(this.skipNoticeTimer);
    this.skipNoticeTimer = setTimeout(() => this.skipNotice.set(null), 4000);
  }

  /** Clears the finished item so the next one can be set up. */
  nextItem(): void {
    if (!this.doc) return;
    this.doc.transact(() => {
      if (this.readPhase() === 'checking') return;
      this.clearCheck(true);
    });
  }

  /**
   * Ends round `round` as confident (if everyone counted is) or, on timeout, as paused.
   * Safe to call from several clients at once: it re-reads the doc and does nothing if the
   * round already ended or a newer round started.
   */
  private endCheck(round: number, timedOut: boolean): void {
    if (!this.doc) return;
    const sessionMap = this.doc.getMap('session');
    this.doc.transact(() => {
      if (this.readPhase() !== 'checking') return;
      if ((sessionMap.get('checkRound') as number) !== round) return;
      const startedAt = sessionMap.get('checkStartedAt') as number;
      const now = Date.now();
      if (timedOut && now < startedAt + CHECK_DURATION_MS) return;

      const confidenceMap = this.doc!.getMap<number>('confidence');
      const players = this.checkPlayers();
      const confident = players.filter((p) => confidenceMap.get(p.peerId) === round);
      const allConfident = players.length > 0 && confident.length === players.length;
      if (!allConfident && !timedOut) return;

      const notConfident: Record<string, string> = {};
      for (const p of players) {
        if (confidenceMap.get(p.peerId) !== round) notConfident[p.peerId] = p.name;
      }
      const outcome: CheckOutcome = {
        round,
        result: allConfident ? 'confident' : 'paused',
        at: Math.min(now, startedAt + CHECK_DURATION_MS),
        notConfident,
        confident: confident.map((p) => p.peerId),
      };
      sessionMap.set('checkOutcome', outcome);

      const log = [...((sessionMap.get('checkLog') as CheckAttempt[]) ?? [])];
      if (allConfident) {
        this.insertCheckHistory('confident', log);
      } else {
        const check = (sessionMap.get('itemChecks') as number) ?? log.length + 1;
        log.push({ check, notConfident: Object.values(notConfident) });
        sessionMap.set('checkLog', log);
      }
    });
  }

  private insertCheckHistory(
    result: 'confident' | 'skipped',
    log: CheckAttempt[] | undefined,
  ): void {
    const sessionMap = this.doc!.getMap('session');
    const historyArray = this.doc!.getArray<HistoryEntry>('history');
    const id = (sessionMap.get('itemId') as string) || crypto.randomUUID();
    if (historyArray.toArray().some((e) => e.id === id)) return;
    historyArray.insert(0, [
      {
        kind: 'confidence',
        id,
        story: (sessionMap.get('storyName') as string) || '',
        url: ((sessionMap.get('itemUrl') as string) ?? '').trim() || undefined,
        timestamp: Date.now(),
        votes: {},
        players: {},
        result,
        checks: (sessionMap.get('itemChecks') as number) ?? 0,
        attempts: log ?? [],
      },
    ]);
  }

  /** Resets check state; with `clearItem`, also the item (name, link, id, log). */
  private clearCheck(clearItem: boolean): void {
    const sessionMap = this.doc!.getMap('session');
    sessionMap.set('checkStartedAt', null);
    sessionMap.set('checkOutcome', null);
    this.clearConfidence();
    if (clearItem) {
      sessionMap.set('storyName', '');
      sessionMap.set('itemUrl', '');
      sessionMap.set('itemId', crypto.randomUUID());
      sessionMap.set('checkLog', []);
      sessionMap.set('itemChecks', 0);
    }
  }

  private clearConfidence(): void {
    const confidenceMap = this.doc!.getMap('confidence');
    Array.from(confidenceMap.keys()).forEach((k) => confidenceMap.delete(k));
  }

  /** Check phase read straight from the doc (inside transactions, before signals update). */
  private readPhase(): CheckPhase {
    const sessionMap = this.doc!.getMap('session');
    if (sessionMap.get('mode') !== 'confidence') return 'setup';
    if (sessionMap.get('checkStartedAt') == null) return 'setup';
    const outcome = sessionMap.get('checkOutcome') as CheckOutcome | null;
    if (outcome && outcome.round === sessionMap.get('checkRound')) return outcome.result;
    return 'checking';
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
