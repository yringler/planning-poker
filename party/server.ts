import { routePartykitRequest, type Connection, type ConnectionContext } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import {
  CHECK_DURATION_MS,
  CHECK_KEY,
  CONFIDENCE_MAP,
  ITEM_URL_KEY,
  MODE_KEY,
  checkPhase,
  type CheckState,
  type ClientMessage,
  type HistoryEntry,
  type RoomMode,
  type ServerMessage,
} from '../src/app/shared/confidence-protocol';

interface Env {
  PlanningPoker: DurableObjectNamespace<PlanningPoker>;
}

const SNAPSHOT_KEY = 'snapshot';
/** Transaction origin for the server's own writes (so they don't re-trigger evaluation). */
const SERVER_ORIGIN = 'planning-poker-server';

// One Durable Object per room. The Yjs doc lives in memory while clients are
// connected; a full-state snapshot is written to the DO's own storage so the
// room survives everyone leaving (equivalent to y-partykit's `snapshot` mode).
//
// The DO is also the single authority for confidence checks: clients send requests
// (start / cancel / skip / next / mode) as custom messages, and only the server writes
// `session.check`, `session.mode` and confidence history entries. It stamps start times
// with its own clock, ends rounds via a DO alarm, and ends them early when every
// connected non-observer player (by peerId, from server-side awareness) is confident.
export class PlanningPoker extends YServer<Env> {
  private evaluateQueued = false;

  override async onLoad(): Promise<void> {
    const snapshot = await this.ctx.storage.get<Uint8Array>(SNAPSHOT_KEY);
    if (snapshot) {
      Y.applyUpdate(this.document, snapshot);
    }
  }

  override async onSave(): Promise<void> {
    await this.ctx.storage.put(SNAPSHOT_KEY, Y.encodeStateAsUpdate(this.document));
  }

  override async onStart(): Promise<void> {
    await super.onStart();
    this.document.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== SERVER_ORIGIN) this.queueEvaluate();
    });
    // Fires when players join, leave (connection closed) or toggle observer
    this.document.awareness.on('change', () => this.queueEvaluate());
    // A check may have been running when the DO was evicted: make sure its deadline fires
    const check = this.readCheck();
    if (this.phase() === 'checking' && check.startedAt != null) {
      await this.ctx.storage.setAlarm(check.startedAt + CHECK_DURATION_MS);
    }
  }

  override onConnect(conn: Connection, ctx: ConnectionContext): void {
    super.onConnect(conn, ctx);
    this.sendTime(conn);
  }

  override onCustomMessage(conn: Connection, raw: string): void {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    if (msg.type === 'mode') {
      this.setMode(msg.mode);
    } else if (msg.type === 'check') {
      switch (msg.action) {
        case 'start':
          this.startCheck();
          break;
        case 'cancel':
          this.cancelCheck();
          break;
        case 'skip':
          this.skipItem();
          break;
        case 'next':
          this.nextItem();
          break;
      }
    }
    // Reply with the server clock so the client can refresh its offset estimate
    this.sendTime(conn);
  }

  override async onAlarm(): Promise<void> {
    const check = this.readCheck();
    if (this.phase() !== 'checking' || check.startedAt == null) return;
    const deadline = check.startedAt + CHECK_DURATION_MS;
    if (Date.now() < deadline) {
      // Fired early: try again at the deadline
      await this.ctx.storage.setAlarm(deadline);
      return;
    }
    this.endCheck(check.round, true);
  }

  // --- Requests ---

  private setMode(mode: RoomMode): void {
    if (mode !== 'points' && mode !== 'confidence') return;
    if (this.phase() === 'checking') return;
    const itemDone = this.phase() === 'confident';
    this.transact(() => {
      if ((this.session.get(MODE_KEY) ?? 'points') === mode) return;
      this.session.set(MODE_KEY, mode);
      // Leave any finished/paused check behind; the item is kept unless it's done
      this.resetCheck(itemDone);
    });
  }

  private startCheck(): void {
    if (this.mode() !== 'confidence' || this.phase() === 'checking') return;
    if (!((this.session.get('storyName') as string) ?? '').trim()) return;
    const prev = this.readCheck();
    const startedAt = Date.now();
    this.transact(() => {
      this.clearConfidence();
      this.writeCheck({
        ...prev,
        itemId: prev.itemId || crypto.randomUUID(),
        round: prev.round + 1,
        startedAt,
        outcome: null,
        checks: prev.checks + 1,
      });
    });
    void this.ctx.storage.setAlarm(startedAt + CHECK_DURATION_MS);
    this.broadcastTime();
  }

  private cancelCheck(): void {
    if (this.phase() !== 'checking') return;
    const prev = this.readCheck();
    this.transact(() => {
      this.clearConfidence();
      // A cancelled check doesn't count towards the item's checks
      const checks = Math.max(0, prev.checks - 1);
      this.writeCheck({ ...prev, startedAt: null, outcome: null, checks });
    });
    void this.ctx.storage.deleteAlarm();
  }

  private skipItem(): void {
    if (this.phase() !== 'paused') return;
    this.transact(() => {
      this.insertHistory('skipped');
      this.resetCheck(true);
    });
  }

  private nextItem(): void {
    if (this.phase() !== 'confident') return;
    this.transact(() => this.resetCheck(true));
  }

  // --- Transitions ---

  private queueEvaluate(): void {
    if (this.evaluateQueued) return;
    this.evaluateQueued = true;
    // Don't write from inside another transaction's update/awareness handler
    queueMicrotask(() => {
      this.evaluateQueued = false;
      const check = this.readCheck();
      if (this.phase() === 'checking') this.endCheck(check.round, false);
    });
  }

  /**
   * Ends round `round` as confident (if every counted player is) or, on timeout, as paused.
   * No-op if the round already ended or a newer one started.
   */
  private endCheck(round: number, timedOut: boolean): void {
    const check = this.readCheck();
    if (this.phase() !== 'checking' || check.round !== round || check.startedAt == null) return;
    const deadline = check.startedAt + CHECK_DURATION_MS;
    const now = Date.now();
    if (timedOut && now < deadline) return;

    const players = this.connectedPlayers();
    const confidence = this.document.getMap<number>(CONFIDENCE_MAP);
    const confident: string[] = [];
    const notConfident: Record<string, string> = {};
    for (const [peerId, name] of players) {
      if (confidence.get(peerId) === round) confident.push(peerId);
      else notConfident[peerId] = name;
    }
    const allConfident = players.size > 0 && confident.length === players.size;
    if (!allConfident && !timedOut) return;

    this.transact(() => {
      const next: CheckState = {
        ...check,
        outcome: {
          result: allConfident ? 'confident' : 'paused',
          at: Math.min(now, deadline),
          notConfident,
          confident,
        },
      };
      if (!allConfident) {
        const attempt = { check: check.checks, notConfident: Object.values(notConfident) };
        next.log = [...check.log, attempt];
      }
      this.writeCheck(next);
      if (allConfident) this.insertHistory('confident');
    });
    if (allConfident) void this.ctx.storage.deleteAlarm();
  }

  // --- Helpers ---

  private get session(): Y.Map<unknown> {
    return this.document.getMap('session');
  }

  private transact(fn: () => void): void {
    this.document.transact(fn, SERVER_ORIGIN);
  }

  private mode(): RoomMode {
    return this.session.get(MODE_KEY) === 'confidence' ? 'confidence' : 'points';
  }

  private readCheck(): CheckState {
    const stored = this.session.get(CHECK_KEY) as CheckState | undefined;
    return (
      stored ?? {
        itemId: '',
        round: 0,
        startedAt: null,
        outcome: null,
        checks: 0,
        log: [],
      }
    );
  }

  private writeCheck(check: CheckState): void {
    this.session.set(CHECK_KEY, check);
  }

  private phase() {
    return checkPhase(this.mode(), this.session.get(CHECK_KEY) as CheckState | undefined);
  }

  /** Connected, non-observer players by peerId (several tabs of one browser count once). */
  private connectedPlayers(): Map<string, string> {
    const players = new Map<string, string>();
    const observers = new Set<string>();
    this.document.awareness.getStates().forEach((state: Record<string, unknown>) => {
      const peerId = state?.['peerId'];
      const name = state?.['name'];
      if (typeof peerId !== 'string' || typeof name !== 'string') return;
      if (state['observer']) observers.add(peerId);
      else players.set(peerId, name);
    });
    // A peer observing in any tab doesn't count
    for (const id of observers) players.delete(id);
    return players;
  }

  /** Resets the check; with `clearItem`, starts a fresh item (keeps the round counter). */
  private resetCheck(clearItem: boolean): void {
    const prev = this.readCheck();
    this.clearConfidence();
    if (clearItem) {
      this.session.set('storyName', '');
      this.session.set(ITEM_URL_KEY, '');
      this.writeCheck({
        itemId: crypto.randomUUID(),
        round: prev.round,
        startedAt: null,
        outcome: null,
        checks: 0,
        log: [],
      });
    } else {
      this.writeCheck({ ...prev, startedAt: null, outcome: null });
    }
    void this.ctx.storage.deleteAlarm();
  }

  private clearConfidence(): void {
    const confidence = this.document.getMap(CONFIDENCE_MAP);
    Array.from(confidence.keys()).forEach((k) => confidence.delete(k));
  }

  private insertHistory(result: 'confident' | 'skipped'): void {
    const check = this.readCheck();
    const history = this.document.getArray<HistoryEntry>('history');
    if (check.itemId && history.toArray().some((e) => e.id === check.itemId)) return;
    const url = ((this.session.get(ITEM_URL_KEY) as string) ?? '').trim();
    const entry: HistoryEntry = {
      kind: 'confidence',
      id: check.itemId || crypto.randomUUID(),
      story: (this.session.get('storyName') as string) || '',
      timestamp: Date.now(),
      votes: {},
      players: {},
      result,
      checks: check.checks,
      attempts: check.log,
    };
    if (url) entry.url = url;
    history.insert(0, [entry]);
  }

  private sendTime(conn: Connection): void {
    const msg: ServerMessage = { type: 'time', now: Date.now() };
    this.sendCustomMessage(conn, JSON.stringify(msg));
  }

  private broadcastTime(): void {
    const msg: ServerMessage = { type: 'time', now: Date.now() };
    this.broadcastCustomMessage(JSON.stringify(msg));
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return (
      (await routePartykitRequest(request, env)) ?? new Response('Not Found', { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
