// Replaces the `partyserver` module (which imports `cloudflare:workers`) in Node tests.
// y-partyserver's real `withYjs` mixin runs on top of this `Server`.
import { vi } from 'vitest';
import type { FakeStorage } from './fake-storage';

export class FakeConnection {
  /** 0 CONNECTING, 1 OPEN, 3 CLOSED */
  readyState = 1;
  state: unknown = null;
  sent: (string | Uint8Array)[] = [];
  constructor(public id: string) {}
  send = vi.fn((m: string | Uint8Array) => {
    this.sent.push(m);
  });
  close = vi.fn(() => {
    this.readyState = 3;
  });
  setState(arg: unknown): unknown {
    this.state = typeof arg === 'function' ? (arg as (p: unknown) => unknown)(this.state) : arg;
    return this.state;
  }
  /** Parsed `__YPS:` custom messages, e.g. [{ type: 'time', now: T0 }]. */
  custom(): unknown[] {
    return this.sent
      .filter((m): m is string => typeof m === 'string' && m.startsWith('__YPS:'))
      .map((m) => JSON.parse(m.slice(6)) as unknown);
  }
}

export interface FakeCtx {
  storage: FakeStorage;
  id: { name?: string };
}

export class Server<Env = unknown> {
  static options = { hibernate: false };
  connections = new Map<string, FakeConnection>();
  name = 'planning-poker-TEST01';
  constructor(
    public ctx: FakeCtx,
    public env: Env,
  ) {}
  getConnections(): Iterable<FakeConnection> {
    return this.connections.values();
  }
  getConnection(id: string): FakeConnection | undefined {
    return this.connections.get(id);
  }
  onStart(): void | Promise<void> {}
  onConnect(_c: unknown, _ctx: unknown): void {}
  onMessage(_c: unknown, _m: unknown): void {}
  onClose(_c: unknown, ..._a: unknown[]): void {}
  onAlarm(): void | Promise<void> {}
  broadcast(msg: string, without: string[] = []): void {
    for (const c of this.connections.values()) if (!without.includes(c.id)) c.send(msg);
  }
}

export const routePartykitRequest = vi.fn(async (): Promise<Response | null> => null);
