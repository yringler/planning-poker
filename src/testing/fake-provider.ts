import { vi } from 'vitest';
import * as Y from 'yjs';
import {
  applyAwarenessUpdate,
  Awareness,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import type { ProviderLike, YProviderFactory } from '../app/services/room.service';

type Handler = (...args: unknown[]) => void;

/** Stand-in for y-partyserver's YProvider: no WebSocket, events are emitted by the test. */
export class FakeProvider implements ProviderLike {
  static instances: FakeProvider[] = [];
  readonly awareness: Awareness;
  sendMessage = vi.fn<(m: string) => void>();
  destroy = vi.fn(() => this.awareness.destroy());
  private handlers = new Map<string, Handler[]>();
  private remotes = new Map<number, Awareness>();

  constructor(
    public host: string,
    public room: string,
    public doc: Y.Doc,
    public opts: { party: string },
  ) {
    this.awareness = new Awareness(doc);
    FakeProvider.instances.push(this);
  }

  on(event: string, cb: (...args: never[]) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb as Handler]);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((cb) => cb(...args));
  }

  status(s: 'connected' | 'disconnected' | 'connecting'): void {
    this.emit('status', { status: s });
  }

  synced(v = true): void {
    this.emit('synced', v);
  }

  custom(raw: string): void {
    this.emit('custom-message', raw);
  }

  /** Applies a remote peer's awareness state; returns its clientID. */
  addRemote(state: { name: string; peerId: string; observer?: boolean }): number {
    const remoteDoc = new Y.Doc();
    const aw = new Awareness(remoteDoc);
    clearInterval(aw._checkInterval);
    aw.setLocalState(state);
    applyAwarenessUpdate(this.awareness, encodeAwarenessUpdate(aw, [remoteDoc.clientID]), 'remote');
    this.remotes.set(remoteDoc.clientID, aw);
    return remoteDoc.clientID;
  }

  removeRemote(clientId: number): void {
    removeAwarenessStates(this.awareness, [clientId], 'remote');
    this.remotes.delete(clientId);
  }

  /** Applies writes made by a remote peer that starts from this doc's current state. */
  remote(fn: (d: Y.Doc) => void): void {
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, Y.encodeStateAsUpdate(this.doc));
    const before = Y.encodeStateVector(this.doc);
    remoteDoc.transact(() => fn(remoteDoc));
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(remoteDoc, before), 'remote');
  }

  /** Stops every fake's awareness interval (call after each test). */
  static reset(): void {
    for (const p of FakeProvider.instances) clearInterval(p.awareness._checkInterval);
    FakeProvider.instances = [];
  }
}

export const fakeProviderFactory: YProviderFactory = (h, r, d, o) => new FakeProvider(h, r, d, o);
