import { describe, expect, it } from 'vitest';
import {
  normaliseCheck,
  type CheckOutcome,
  type HistoryEntry,
} from '../shared/confidence-protocol';
import {
  confidencePlayers,
  confidentIdsForRound,
  pointPlayers,
  resolveHistory,
  type Player,
} from './room-logic';

const T0 = 1_700_000_000_000;
const P = (name: string, peerId: string, extra: Partial<Player> = {}): Player => ({
  name,
  peerId,
  ...extra,
});

describe('pointPlayers', () => {
  it('CLI-PTS-01: online players unchanged, in order', () => {
    expect(pointPlayers([P('Ann', 'p1'), P('Bob', 'p2')], {}, {})).toEqual([
      P('Ann', 'p1'),
      P('Bob', 'p2'),
    ]);
  });

  it('CLI-PTS-02: departed voters stay, offline, with their known name', () => {
    expect(pointPlayers([P('Ann', 'p1')], { p9: '5' }, { p9: 'Cy' })).toEqual([
      P('Ann', 'p1'),
      { name: 'Cy', peerId: 'p9', offline: true },
    ]);
  });

  it('CLI-PTS-03: departed voters without a name are Unknown', () => {
    expect(pointPlayers([], { p9: '5' }, {})).toEqual([
      { name: 'Unknown', peerId: 'p9', offline: true },
    ]);
  });

  // PIN: after a rejoin under a new peerId, the old voted entry wins, so the online Ann
  // shows as offline (and drops out of onlineCount)
  it('CLI-PTS-04: a rejoin shows the old voted entry', () => {
    expect(pointPlayers([P('Ann', 'p2')], { p1: '5' }, { p1: 'Ann' })).toEqual([
      { name: 'Ann', peerId: 'p1', offline: true },
    ]);
  });

  it('CLI-PTS-05: the online entry wins when both voted', () => {
    expect(pointPlayers([P('Ann', 'p2')], { p1: '5', p2: '8' }, { p1: 'Ann' })).toEqual([
      P('Ann', 'p2'),
    ]);
  });

  // PIN: two different people with the same name collapse into one entry
  it('CLI-PTS-06: same-named people collapse to the first', () => {
    expect(pointPlayers([P('Ann', 'p1'), P('Ann', 'p2')], {}, {})).toEqual([P('Ann', 'p1')]);
  });

  it('CLI-PTS-07: same-named people collapse to the one who voted', () => {
    expect(pointPlayers([P('Ann', 'p1'), P('Ann', 'p2')], { p2: '3' }, {})).toEqual([
      P('Ann', 'p2'),
    ]);
  });

  it('CLI-PTS-08: keeps the observer flag', () => {
    expect(pointPlayers([P('Ann', 'p1', { observer: true })], {}, {})).toEqual([
      P('Ann', 'p1', { observer: true }),
    ]);
  });

  // PIN: several unnamed departed voters collapse into one Unknown entry
  it('CLI-PTS-09: unnamed departed voters collapse into one Unknown', () => {
    expect(pointPlayers([], { p8: '1', p9: '2' }, {})).toEqual([
      { name: 'Unknown', peerId: 'p8', offline: true },
    ]);
  });
});

describe('confidencePlayers', () => {
  const OUT = (nc: Record<string, string>): CheckOutcome => ({
    result: 'paused',
    at: T0,
    notConfident: nc,
    confident: [],
  });

  it('CLI-CPL-01: tabs of one peer count once', () => {
    expect(confidencePlayers([P('Ann', 'p1'), P('Ann', 'p1')], {}, 'checking', null)).toHaveLength(
      1,
    );
  });

  it('CLI-CPL-02: same-named peers both count', () => {
    expect(confidencePlayers([P('Ann', 'p1'), P('Ann', 'p2')], {}, 'checking', null)).toHaveLength(
      2,
    );
  });

  it('CLI-CPL-03: observer in any tab wins, either order', () => {
    const a = P('Ann', 'p1', { observer: false });
    const b = P('Ann', 'p1', { observer: true });
    const expected = [{ name: 'Ann', peerId: 'p1', observer: true }];
    expect(confidencePlayers([a, b], {}, 'checking', null)).toEqual(expected);
    expect(confidencePlayers([b, a], {}, 'checking', null)).toEqual(expected);
  });

  it('CLI-CPL-04: paused keeps departed not-confident players, preferring names', () => {
    expect(
      confidencePlayers([P('Ann', 'p1')], { p9: 'Cyrus' }, 'paused', OUT({ p1: 'Ann', p9: 'Cy' })),
    ).toEqual([P('Ann', 'p1'), { name: 'Cyrus', peerId: 'p9', offline: true }]);
  });

  it('CLI-CPL-05: falls back to the outcome name', () => {
    expect(confidencePlayers([P('Ann', 'p1')], {}, 'paused', OUT({ p1: 'Ann', p9: 'Cy' }))).toEqual(
      [P('Ann', 'p1'), { name: 'Cy', peerId: 'p9', offline: true }],
    );
  });

  it('CLI-CPL-06: only a pause lists departed players', () => {
    for (const phase of ['confident', 'checking'] as const) {
      const result = confidencePlayers([P('Ann', 'p1')], {}, phase, OUT({ p9: 'Cy' }));
      expect(result.map((p) => p.peerId)).toEqual(['p1']);
    }
  });

  // RoomService passes session.check through normaliseCheck, so a stored outcome missing
  // notConfident reaches confidencePlayers with an empty one.
  it('CLI-CPL-07: an outcome stored without notConfident does not throw', () => {
    const { outcome } = normaliseCheck({ startedAt: T0, outcome: { result: 'paused' } });
    expect(confidencePlayers([P('Ann', 'p1')], {}, 'paused', outcome)).toEqual([P('Ann', 'p1')]);
  });
});

describe('resolveHistory', () => {
  const E = (votes: Record<string, string>, players: Record<string, string>): HistoryEntry => ({
    story: 'S',
    timestamp: T0,
    votes,
    players,
  });
  const players = (h: HistoryEntry[]) => h[0].players;

  it('CLI-HIST-01: the entry name wins', () => {
    expect(players(resolveHistory([E({ p1: '5' }, { p1: 'Ann' })], [], { p1: 'Other' }))).toEqual({
      p1: 'Ann',
    });
  });

  it('CLI-HIST-02: falls back to names', () => {
    expect(players(resolveHistory([E({ p1: '5' }, {})], [], { p1: 'Ann' }))).toEqual({
      p1: 'Ann',
    });
  });

  it('CLI-HIST-03: matches an online voter to an offline same-name entry', () => {
    expect(players(resolveHistory([E({ p2: '5' }, { p1: 'Ann' })], [P('Ann', 'p2')], {}))).toEqual({
      p1: 'Ann',
      p2: 'Ann',
    });
  });

  it('CLI-HIST-04: no match when the name is not unique online', () => {
    const current = [P('Ann', 'p2'), P('Ann', 'p1')];
    expect(players(resolveHistory([E({ p2: '5' }, { p1: 'Ann' })], current, {}))).toEqual({
      p1: 'Ann',
    });
  });

  it('CLI-HIST-05: no match when the old peer is online', () => {
    const current = [P('Ann', 'p2'), P('Bob', 'p1')];
    expect(players(resolveHistory([E({ p2: '5' }, { p1: 'Ann' })], current, {}))).toEqual({
      p1: 'Ann',
    });
  });

  it('CLI-HIST-06: an online voter is named from the current players', () => {
    expect(players(resolveHistory([E({ p2: '5' }, {})], [P('Ann', 'p2')], {}))).toEqual({
      p2: 'Ann',
    });
  });

  it('CLI-HIST-07: an empty entry name falls back to names', () => {
    expect(players(resolveHistory([E({ p1: '5' }, { p1: '' })], [], { p1: 'Ann' }))).toEqual({
      p1: 'Ann',
    });
  });

  it('CLI-HIST-08: unknown voters stay unnamed', () => {
    expect(players(resolveHistory([E({ p9: '5' }, {})], [], {}))).toEqual({});
  });

  it('CLI-HIST-09: frozen inputs are not mutated', () => {
    const entry = Object.freeze({
      ...E({ p1: '5', p2: '3' }, Object.freeze({ p1: 'Ann' })),
      votes: Object.freeze({ p1: '5', p2: '3' }),
    });
    const history: HistoryEntry[] = [entry];
    const current: Player[] = [Object.freeze(P('Bob', 'p2'))];
    Object.freeze(history);
    Object.freeze(current);
    const result = resolveHistory(history, current, Object.freeze({ p2: 'Bob' }));
    expect(result[0]).not.toBe(entry);
    expect(result[0].players).toEqual({ p1: 'Ann', p2: 'Bob' });
    expect(entry.players).toEqual({ p1: 'Ann' });
  });

  it('CLI-HIST-10: order and other fields are preserved', () => {
    const e1: HistoryEntry = { ...E({}, {}), kind: 'confidence', id: 'a', result: 'skipped' };
    const e2: HistoryEntry = { ...E({}, {}), timestamp: T0 - 1, id: 'b' };
    const result = resolveHistory([e1, e2], [], {});
    expect(result).toEqual([e1, e2]);
  });
});

describe('confidentIdsForRound', () => {
  it('SVC-DER-01 (pure): only values equal to the round count', () => {
    expect([...confidentIdsForRound({ p1: 5, p2: 4, p3: '5' }, 5)]).toEqual(['p1']);
  });
});
