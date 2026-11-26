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
  isRecord,
  normaliseCheck,
  parseClientMessage,
  type CheckState,
  type HistoryEntry,
  type RoomMode,
  type ServerMessage,
} from '../src/app/shared/confidence-protocol';
import { CLIENT_ID_KEY, connectedPlayers } from './connected-players';

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
  // NOTE: this class relies on `hibernate` being false (the partyserver default): the Yjs doc,
  // server-side awareness, the evaluation state below and getConnections() all live in memory
  // for as long as any socket is open.

  private evaluateQueued = false;
  /** Deadline the DO alarm was last armed for (null = none armed by this instance). */
  private armedDeadline: number | null = null;
  /** Who was confident at the last evaluation before the deadline (late toggles don't count). */
  private preDeadline: { round: number; confident: Set<string> } | null = null;

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
    this.queueEvaluate();
  }

  override onConnect(conn: Connection, ctx: ConnectionContext): void {
    super.onConnect(conn, ctx);
    // INVARIANT: send `time` synchronously here, before any `await`. The client treats a server
    // that hasn't sent `time` by the time it syncs as outdated (RoomService `serverOutdated`), and
    // its sync completes with our reply to its first sync message. Sending `time` now puts it
    // ahead of that reply. Pinned by SRV-WIRE-03.
    this.sendTime(conn);
  }

  override onClose(conn: Connection, code: number, reason: string, wasClean: boolean): void {
    super.onClose(conn, code, reason, wasClean);
    // y-partyserver only fires an awareness change for the awareness ids it recorded on this
    // connection. A player known through `hello` alone leaves without one, so re-evaluate here.
    this.queueEvaluate();
  }

  override async onCustomMessage(conn: Connection, raw: string): Promise<void> {
    try {
      const msg = parseClientMessage(raw);
      if (msg?.type === 'hello') {
        // Remember which awareness client this connection is (see connectedPlayers)
        const clientId = msg.clientId;
        conn.setState((prev: unknown) => ({
          ...(isRecord(prev) ? prev : {}),
          [CLIENT_ID_KEY]: clientId,
        }));
        this.queueEvaluate();
        return;
      }
      if (msg) {
        // Requests name the round the client saw; a stale request (e.g. a late Cancel that
        // arrives after someone restarted) must not act on a newer round.
        if (msg.round !== this.readCheck().round) {
          // ignore
        } else if (msg.type === 'mode') {
          this.setMode(msg.mode);
        } else {
          switch (msg.action) {
            case 'start':
              await this.startCheck();
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
      }
      // Reply with the server clock so the client can refresh its offset estimate
      this.sendTime(conn);
    } catch (err) {
      console.error('custom message failed', err);
    }
  }

  override async onAlarm(): Promise<void> {
    try {
      this.armedDeadline = null;
      const check = this.readCheck();
      if (this.phase() !== 'checking' || check.startedAt == null) return;
      const deadline = check.startedAt + CHECK_DURATION_MS;
      if (Date.now() < deadline) {
        // Fired early: try again at the deadline
        await this.armAlarm(deadline);
        return;
      }
      await this.endCheck(check.round, true);
    } catch (err) {
      console.error('alarm failed', err);
    }
  }

  // --- Requests ---

  private setMode(mode: RoomMode): void {
    if (this.phase() === 'checking') return;
    const itemDone = this.phase() === 'confident';
    this.transact(() => {
      if (this.mode() === mode) return;
      this.session.set(MODE_KEY, mode);
      // Leave any finished/paused check behind; the item is kept unless it's done
      this.resetCheck(itemDone);
    });
  }

  private async startCheck(): Promise<void> {
    // Only from setup or a pause: a confirmed item is already recorded (use Next item)
    const phase = this.phase();
    if (this.mode() !== 'confidence' || (phase !== 'setup' && phase !== 'paused')) return;
    if (!this.sessionString('storyName').trim()) return;
    const prev = this.readCheck();
    const startedAt = Date.now();
    const round = prev.round + 1;
    this.transact(() => {
      this.clearConfidence();
      this.writeCheck({
        ...prev,
        itemId: prev.itemId || crypto.randomUUID(),
        round,
        startedAt,
        outcome: null,
        checks: prev.checks + 1,
      });
    });
    this.preDeadline = { round, confident: new Set() };
    this.broadcastTime();
    await this.armAlarm(startedAt + CHECK_DURATION_MS);
    await this.onSave();
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
    void this.disarmAlarm();
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
      this.evaluate().catch((err) => console.error('evaluate failed', err));
    });
  }

  private async evaluate(): Promise<void> {
    const check = this.readCheck();
    if (this.phase() !== 'checking' || check.startedAt == null) return;
    const deadline = check.startedAt + CHECK_DURATION_MS;
    if (Date.now() >= deadline) {
      // Past the deadline (e.g. the alarm ran on a cold DO before clients re-synced the check)
      await this.endCheck(check.round, true);
      return;
    }
    this.preDeadline = { round: check.round, confident: this.confidentIds(check.round) };
    if (this.armedDeadline !== deadline) await this.armAlarm(deadline);
    await this.endCheck(check.round, false);
  }

  /**
   * Ends round `round` as confident (if every counted player is) or, on timeout, as paused.
   * No-op if the round already ended or a newer one started.
   */
  private async endCheck(round: number, timedOut: boolean): Promise<void> {
    const check = this.readCheck();
    if (this.phase() !== 'checking' || check.round !== round || check.startedAt == null) return;
    const deadline = check.startedAt + CHECK_DURATION_MS;
    const now = Date.now();
    if (timedOut ? now < deadline : now >= deadline) return;

    const players = this.connectedPlayers();
    // On timeout, use who was confident before the deadline when we know it
    const confidentIds =
      timedOut && this.preDeadline?.round === round
        ? this.preDeadline.confident
        : this.confidentIds(round);
    const confident: string[] = [];
    const notConfident: Record<string, string> = {};
    for (const [peerId, name] of players) {
      if (confidentIds.has(peerId)) confident.push(peerId);
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
    if (allConfident) await this.disarmAlarm();
    await this.onSave();
  }

  // --- Helpers ---

  private get session(): Y.Map<unknown> {
    return this.document.getMap('session');
  }

  private transact(fn: () => void): void {
    this.document.transact(fn, SERVER_ORIGIN);
  }

  private sessionString(key: string): string {
    const value = this.session.get(key);
    return typeof value === 'string' ? value : '';
  }

  private mode(): RoomMode {
    return this.session.get(MODE_KEY) === 'confidence' ? 'confidence' : 'points';
  }

  /** The stored check, normalised so a malformed value can't make transitions throw. */
  private readCheck(): CheckState {
    return normaliseCheck(this.session.get(CHECK_KEY));
  }

  private writeCheck(check: CheckState): void {
    this.session.set(CHECK_KEY, check);
  }

  private phase() {
    return checkPhase(this.mode(), this.readCheck());
  }

  private async armAlarm(deadline: number): Promise<void> {
    this.armedDeadline = deadline;
    await this.ctx.storage.setAlarm(deadline);
  }

  private async disarmAlarm(): Promise<void> {
    this.armedDeadline = null;
    await this.ctx.storage.deleteAlarm();
  }

  private confidentIds(round: number): Set<string> {
    const ids = new Set<string>();
    this.document.getMap<unknown>(CONFIDENCE_MAP).forEach((value, peerId) => {
      if (value === round) ids.add(peerId);
    });
    return ids;
  }

  /** Connected, non-observer players by peerId (see `connectedPlayers`). */
  private connectedPlayers(): Map<string, string> {
    return connectedPlayers(this.getConnections(), this.document.awareness.getStates());
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
    void this.disarmAlarm();
  }

  private clearConfidence(): void {
    const confidence = this.document.getMap(CONFIDENCE_MAP);
    Array.from(confidence.keys()).forEach((k) => confidence.delete(k));
  }

  private insertHistory(result: 'confident' | 'skipped'): void {
    const check = this.readCheck();
    const history = this.document.getArray<HistoryEntry>('history');
    if (check.itemId && history.toArray().some((e) => e?.id === check.itemId)) return;
    const url = this.sessionString(ITEM_URL_KEY).trim();
    const entry: HistoryEntry = {
      kind: 'confidence',
      id: check.itemId || crypto.randomUUID(),
      story: this.sessionString('storyName'),
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
    return (await routePartykitRequest(request, env)) ?? new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
