import { describe, expect, it } from 'vitest';
import { connectedPlayers, type ConnectionLike } from './connected-players';

const conn = (readyState: number, state: unknown): ConnectionLike => ({ readyState, state });
const states = (entries: [number, unknown][]) => new Map<number, unknown>(entries);
const ann = { peerId: 'p1', name: 'Ann' };
const bob = { peerId: 'p2', name: 'Bob' };
const asObject = (m: Map<string, string>) => Object.fromEntries(m);

describe('connectedPlayers', () => {
  it('SRV-PLAYERS-01: counts states owned via __ypsAwarenessIds', () => {
    const result = connectedPlayers([conn(1, { __ypsAwarenessIds: [10] })], states([[10, ann]]));
    expect(asObject(result)).toEqual({ p1: 'Ann' });
  });

  it('SRV-PLAYERS-02: counts states owned via the hello clientId', () => {
    const result = connectedPlayers([conn(1, { ppClientId: 10 })], states([[10, ann]]));
    expect(asObject(result)).toEqual({ p1: 'Ann' });
  });

  it('SRV-PLAYERS-03: combines both ownership sources', () => {
    const result = connectedPlayers(
      [conn(1, { __ypsAwarenessIds: [10], ppClientId: 11 })],
      states([
        [10, ann],
        [11, bob],
      ]),
    );
    expect(asObject(result)).toEqual({ p1: 'Ann', p2: 'Bob' });
  });

  it('SRV-PLAYERS-04: ignores connections that are not OPEN', () => {
    const s = states([[10, ann]]);
    expect(connectedPlayers([conn(3, { __ypsAwarenessIds: [10] })], s).size).toBe(0);
    expect(connectedPlayers([conn(0, { __ypsAwarenessIds: [10] })], s).size).toBe(0);
  });

  it('SRV-PLAYERS-05: ignores leftover states with no connection', () => {
    expect(connectedPlayers([], states([[10, ann]])).size).toBe(0);
  });

  it('SRV-PLAYERS-06: ignores states without a string peerId and name', () => {
    const result = connectedPlayers(
      [conn(1, { __ypsAwarenessIds: [10, 11, 12, 13] })],
      states([
        [10, { name: 'Ann' }],
        [11, { peerId: 'p2', name: 5 }],
        [12, null],
        [13, { peerId: 3, name: 'X' }],
      ]),
    );
    expect(result.size).toBe(0);
  });

  // PIN: two tabs of one peer with different names: the last state wins
  it('SRV-PLAYERS-07: dedupes tabs of one peer by peerId (last name wins)', () => {
    const result = connectedPlayers(
      [conn(1, { __ypsAwarenessIds: [10, 11] })],
      states([
        [10, { peerId: 'p1', name: 'Ann' }],
        [11, { peerId: 'p1', name: 'Ann B' }],
      ]),
    );
    expect(asObject(result)).toEqual({ p1: 'Ann B' });
  });

  it('SRV-PLAYERS-08: a peer observing in any tab is not counted, in either order', () => {
    const c = [conn(1, { __ypsAwarenessIds: [10, 11] })];
    const observer = { ...ann, observer: true };
    expect(
      connectedPlayers(
        c,
        states([
          [10, ann],
          [11, observer],
        ]),
      ).size,
    ).toBe(0);
    expect(
      connectedPlayers(
        c,
        states([
          [11, observer],
          [10, ann],
        ]),
      ).size,
    ).toBe(0);
  });

  it('SRV-PLAYERS-09: an observer only removes their own peer', () => {
    const result = connectedPlayers(
      [conn(1, { __ypsAwarenessIds: [10, 11] })],
      states([
        [10, ann],
        [11, { ...bob, observer: true }],
      ]),
    );
    expect(asObject(result)).toEqual({ p1: 'Ann' });
  });

  it('SRV-PLAYERS-10: tolerates non-record connection state', () => {
    const s = states([[10, ann]]);
    for (const state of [null, [10], 'x']) {
      expect(connectedPlayers([conn(1, state)], s).size).toBe(0);
    }
  });

  it('SRV-PLAYERS-11: ignores non-number awareness ids', () => {
    const result = connectedPlayers(
      [conn(1, { __ypsAwarenessIds: ['10', 10] })],
      states([[10, ann]]),
    );
    expect(asObject(result)).toEqual({ p1: 'Ann' });
  });

  it('SRV-PLAYERS-12: ignores a non-finite or non-number hello clientId', () => {
    const s = states([[10, ann]]);
    expect(connectedPlayers([conn(1, { ppClientId: NaN })], s).size).toBe(0);
    expect(connectedPlayers([conn(1, { ppClientId: '10' })], s).size).toBe(0);
  });

  it('SRV-PLAYERS-13: falsy observer values count as a player', () => {
    for (const observer of [0, '']) {
      const result = connectedPlayers(
        [conn(1, { __ypsAwarenessIds: [10] })],
        states([[10, { ...ann, observer }]]),
      );
      expect(asObject(result)).toEqual({ p1: 'Ann' });
    }
  });
});
