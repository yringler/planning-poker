import { vi } from 'vitest';
import * as Y from 'yjs';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import {
  checkPhase,
  normaliseCheck,
  type CheckPhase,
  type CheckState,
  type HistoryEntry,
  type RoomMode,
} from '../../src/app/shared/confidence-protocol';
import { PlanningPoker } from '../server';
import { flush } from './clock';
import { FakeConnection } from './fake-partyserver';
import { FakeStorage } from './fake-storage';

type ServerArgs = ConstructorParameters<typeof PlanningPoker>;
type Conn = Parameters<PlanningPoker['onCustomMessage']>[0];

/** Private members of PlanningPoker that the specs observe or stub. */
export interface ServerInternals {
  evaluateQueued: boolean;
  armedDeadline: number | null;
  evaluate(): Promise<void>;
  endCheck(round: number, timedOut: boolean): Promise<void>;
}

export const internals = (server: PlanningPoker): ServerInternals =>
  server as unknown as ServerInternals;

export const asConn = (c: FakeConnection): Conn => c as unknown as Conn;

export interface SeedValues {
  mode?: RoomMode;
  storyName?: unknown;
  itemUrl?: string;
  check?: unknown;
  confidence?: Record<string, number>;
  history?: HistoryEntry[];
}

export interface PlayerHandle {
  conn: FakeConnection;
  clientId: number;
  setObserver(v: boolean): Promise<void>;
}

export type Ownership = 'awareness' | 'hello' | 'both';

export interface Harness {
  server: PlanningPoker;
  storage: FakeStorage;
  doc: Y.Doc;
  session: Y.Map<unknown>;
  seed(v: SeedValues): Promise<void>;
  /** A connection with no awareness state (counts as nobody). */
  addConnection(id?: string): FakeConnection;
  addPlayer(
    peerId: string,
    name: string,
    opts?: { observer?: boolean; ownership?: Ownership },
  ): Promise<PlayerHandle>;
  disconnect(conn: FakeConnection): Promise<void>;
  clientWrite(fn: () => void): Promise<void>;
  setConfident(peerId: string, round: number): Promise<void>;
  request(conn: FakeConnection, msg: object | string): Promise<void>;
  fireAlarm(): Promise<void>;
  check(): CheckState;
  phase(): CheckPhase;
  history(): HistoryEntry[];
  confidence(): Record<string, unknown>;
  advanceTo(t: number): void;
}

export async function createHarness(
  opts: { storage?: FakeStorage; now?: number } = {},
): Promise<Harness> {
  if (opts.now != null) vi.setSystemTime(opts.now);
  const storage = opts.storage ?? new FakeStorage();
  const ctx = { storage, id: { name: 'planning-poker-TEST01' } };
  const server = new PlanningPoker(ctx as unknown as ServerArgs[0], {} as ServerArgs[1]);
  const fake = server as unknown as { connections: Map<string, FakeConnection> };
  const doc: Y.Doc = server.document;
  const session = doc.getMap<unknown>('session');
  await server.onStart();
  await flush();

  let connSeq = 0;
  const addConnection = (id = `conn-${++connSeq}`): FakeConnection => {
    const conn = new FakeConnection(id);
    fake.connections.set(id, conn);
    server.onConnect(asConn(conn), { request: new Request('http://x') } as Parameters<
      PlanningPoker['onConnect']
    >[1]);
    return conn;
  };

  const request = async (conn: FakeConnection, msg: object | string): Promise<void> => {
    await server.onCustomMessage(asConn(conn), typeof msg === 'string' ? msg : JSON.stringify(msg));
    await flush();
  };

  const clientWrite = async (fn: () => void): Promise<void> => {
    doc.transact(fn, 'client');
    await flush();
  };

  const h: Harness = {
    server,
    storage,
    doc,
    session,
    async seed(v) {
      doc.transact(() => {
        if (v.mode !== undefined) session.set('mode', v.mode);
        if (v.storyName !== undefined) session.set('storyName', v.storyName);
        if (v.itemUrl !== undefined) session.set('itemUrl', v.itemUrl);
        if (v.check !== undefined) session.set('check', v.check);
        if (v.confidence) {
          const map = doc.getMap<number>('confidence');
          for (const [k, round] of Object.entries(v.confidence)) map.set(k, round);
        }
        if (v.history) doc.getArray<HistoryEntry>('history').push(v.history);
      }, 'seed');
      await flush();
    },
    addConnection,
    async addPlayer(peerId, name, { observer, ownership = 'awareness' } = {}) {
      const conn = addConnection();
      const clientDoc = new Y.Doc();
      const aw = new Awareness(clientDoc);
      clearInterval(aw._checkInterval);
      const origin = ownership === 'hello' ? null : conn;
      const push = (): void =>
        applyAwarenessUpdate(
          server.document.awareness,
          encodeAwarenessUpdate(aw, [clientDoc.clientID]),
          origin,
        );
      aw.setLocalState({ peerId, name, observer });
      push();
      if (ownership !== 'awareness') {
        await request(conn, { type: 'hello', clientId: clientDoc.clientID });
      }
      await flush();
      return {
        conn,
        clientId: clientDoc.clientID,
        async setObserver(v: boolean) {
          aw.setLocalState({ peerId, name, observer: v });
          push();
          await flush();
        },
      };
    },
    async disconnect(conn) {
      conn.readyState = 3;
      fake.connections.delete(conn.id);
      server.onClose(asConn(conn), 1000, '', true);
      await flush();
    },
    clientWrite,
    setConfident: (peerId, round) =>
      clientWrite(() => doc.getMap<number>('confidence').set(peerId, round)),
    request,
    async fireAlarm() {
      storage.alarm = null;
      await server.onAlarm();
      await flush();
    },
    check: () => normaliseCheck(session.get('check')),
    phase: () =>
      checkPhase(
        session.get('mode') === 'confidence' ? 'confidence' : 'points',
        normaliseCheck(session.get('check')),
      ),
    history: () => doc.getArray<HistoryEntry>('history').toArray(),
    confidence: () => doc.getMap<unknown>('confidence').toJSON(),
    advanceTo: (t) => vi.setSystemTime(t),
  };
  return h;
}
