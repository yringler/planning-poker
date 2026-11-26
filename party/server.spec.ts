import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { D, T0 } from './test/clock';
import { FakeStorage } from './test/fake-storage';
import { createHarness, internals, type Harness } from './test/harness';
import {
  cancel,
  CONFIDENT,
  CONFIDENT_HISTORY,
  mode,
  next,
  PAUSED,
  PAUSED_CHECK,
  PAUSED_LOG,
  running,
  SETUP,
  SETUP_CHECK,
  skip,
  start,
} from './test/fixtures';

vi.mock('partyserver', async () => await import('./test/fake-partyserver'));

const time = (now: number) => ({ type: 'time', now });
const sorted = (ids: string[]) => [...ids].sort();

/** A cold-DO snapshot: a check of round 5 that started at T0, with p1 confident. */
function coldSnapshot(): FakeStorage {
  const doc = new Y.Doc();
  doc.transact(() => {
    const session = doc.getMap('session');
    session.set('mode', 'confidence');
    session.set('storyName', 'S');
    session.set('check', {
      itemId: 'i',
      round: 5,
      startedAt: T0,
      outcome: null,
      checks: 1,
      log: [],
    });
    doc.getMap('confidence').set('p1', 5);
  });
  const storage = new FakeStorage();
  storage.data.set('snapshot', Y.encodeStateAsUpdate(doc));
  return storage;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

describe('onCustomMessage', () => {
  it('SRV-MSG-01: hello merges ppClientId into existing connection state', async () => {
    const conn = h.addConnection();
    conn.state = { __ypsAwarenessIds: [7], foo: 1 };
    await h.request(conn, { type: 'hello', clientId: 7 });
    expect(conn.state).toEqual({ __ypsAwarenessIds: [7], foo: 1, ppClientId: 7 });
  });

  it('SRV-MSG-02: hello on a connection with null state', async () => {
    const conn = h.addConnection();
    await h.request(conn, { type: 'hello', clientId: 7 });
    expect(conn.state).toEqual({ ppClientId: 7 });
  });

  it('SRV-MSG-03: hello gets no time reply', async () => {
    const conn = h.addConnection();
    conn.send.mockClear();
    conn.sent = [];
    await h.request(conn, { type: 'hello', clientId: 7 });
    expect(conn.custom()).toEqual([]);
  });

  it('SRV-MSG-04: a stale request is ignored but still answered with the time', async () => {
    await h.seed({ ...SETUP, check: { ...SETUP_CHECK, round: 2 } });
    const conn = h.addConnection();
    await h.request(conn, start(1));
    expect(h.check()).toMatchObject({ round: 2, startedAt: null });
    expect(conn.custom().at(-1)).toEqual(time(T0));
    expect(h.storage.setAlarm).not.toHaveBeenCalled();
  });

  it('SRV-MSG-05: malformed input changes nothing and is answered with the time', async () => {
    await h.seed(SETUP);
    const conn = h.addConnection();
    const before = h.session.toJSON();
    await h.request(conn, 'xx');
    expect(h.session.toJSON()).toEqual(before);
    expect(conn.custom().at(-1)).toEqual(time(T0));
  });

  it('SRV-MSG-06: a current-round request is dispatched and answered', async () => {
    await h.seed(SETUP);
    const conn = h.addConnection();
    await h.request(conn, start(4));
    expect(h.check().round).toBe(5);
    expect(conn.custom().at(-1)).toEqual(time(T0));
  });

  it('SRV-MSG-07: a mode request is dispatched', async () => {
    await h.seed({ ...SETUP, mode: 'points' });
    await h.request(h.addConnection(), mode('confidence', 4));
    expect(h.session.get('mode')).toBe('confidence');
  });

  it('SRV-MSG-08: errors are caught and logged', async () => {
    await h.seed(SETUP);
    const err = new Error('boom');
    h.storage.setAlarm.mockRejectedValueOnce(err);
    await expect(h.request(h.addConnection(), start(4))).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('custom message failed', err);
    expect(h.check()).toMatchObject({ round: 5, startedAt: T0 });
  });

  it('SRV-MSG-09: a garbage check is normalised before starting', async () => {
    await h.seed({ mode: 'confidence', storyName: 'S', check: 'garbage' });
    await h.request(h.addConnection(), start(0));
    expect(h.session.get('check')).toEqual({
      itemId: 'uuid-1',
      round: 1,
      startedAt: T0,
      outcome: null,
      checks: 1,
      log: [],
    });
  });

  it('SRV-MSG-10: a repeated start for the same round is stale the second time', async () => {
    await h.seed(SETUP);
    const conn = h.addConnection();
    await h.request(conn, start(4));
    await h.request(conn, start(4));
    expect(h.check()).toMatchObject({ round: 5, checks: 1 });
  });
});

describe('startCheck', () => {
  it('SRV-START-01: starts a round from setup', async () => {
    await h.seed({ ...SETUP, confidence: { p1: 4, p2: 3 } });
    const p1 = await h.addPlayer('p1', 'Ann');
    const p2 = await h.addPlayer('p2', 'Bob');
    await h.request(p1.conn, start(4));
    expect(h.session.get('check')).toEqual({
      itemId: 'item-1',
      round: 5,
      startedAt: T0,
      outcome: null,
      checks: 1,
      log: [],
    });
    expect(h.confidence()).toEqual({});
    expect(h.storage.alarm).toBe(T0 + D);
    expect(p1.conn.custom()).toContainEqual(time(T0));
    expect(p2.conn.custom()).toContainEqual(time(T0));
    expect(h.storage.data.has('snapshot')).toBe(true);
    expect(h.phase()).toBe('checking');
  });

  it('SRV-START-02: restarts from a pause, keeping the item and log', async () => {
    await h.seed(PAUSED);
    await h.request(h.addConnection(), start(6));
    expect(h.check()).toEqual({
      itemId: 'item-1',
      round: 7,
      startedAt: T0,
      outcome: null,
      checks: 3,
      log: PAUSED_LOG,
    });
  });

  it('SRV-START-03: creates an item id when there is none', async () => {
    await h.seed({ ...SETUP, check: { ...SETUP_CHECK, itemId: '' } });
    await h.request(h.addConnection(), start(4));
    expect(h.check().itemId).toBe('uuid-1');
  });

  it('SRV-START-04: does nothing in points mode', async () => {
    await h.seed({ ...SETUP, mode: 'points' });
    const other = h.addConnection();
    const conn = h.addConnection();
    other.sent = [];
    await h.request(conn, start(4));
    expect(h.check()).toEqual(SETUP_CHECK);
    expect(h.storage.setAlarm).not.toHaveBeenCalled();
    expect(other.custom()).toEqual([]);
  });

  it.each([['   '], [undefined], [5]])(
    'SRV-START-05: does nothing without a story name (%s)',
    async (storyName) => {
      await h.seed({ ...SETUP, storyName });
      if (storyName === undefined) h.session.delete('storyName');
      await h.request(h.addConnection(), start(4));
      expect(h.check()).toEqual(SETUP_CHECK);
    },
  );

  it('SRV-START-06: does nothing while a round is running', async () => {
    const { p1 } = await running(h);
    const calls = h.storage.setAlarm.mock.calls.length;
    h.advanceTo(T0 + 1000);
    await h.request(p1.conn, start(5));
    expect(h.check()).toMatchObject({ round: 5, startedAt: T0, checks: 1 });
    expect(h.storage.setAlarm.mock.calls.length).toBe(calls);
  });

  it('SRV-START-07: does nothing once the item is confirmed', async () => {
    await h.seed(CONFIDENT);
    const before = h.session.get('check');
    await h.request(h.addConnection(), start(6));
    expect(h.session.get('check')).toEqual(before);
  });

  it("SRV-START-08: the server's own writes don't trigger an evaluation", async () => {
    await h.seed(SETUP);
    const spy = vi.spyOn(internals(h.server), 'evaluate');
    await h.request(h.addConnection(), start(4));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('cancelCheck', () => {
  it('SRV-CANCEL-01: cancels the running round', async () => {
    const { p1 } = await running(h);
    await h.setConfident('p1', 5);
    h.advanceTo(T0 + 10_000);
    await h.request(p1.conn, cancel(5));
    expect(h.session.get('check')).toEqual({
      itemId: 'item-1',
      round: 5,
      startedAt: null,
      outcome: null,
      checks: 0,
      log: [],
    });
    expect(h.confidence()).toEqual({});
    expect(h.storage.alarm).toBeNull();
    expect(h.storage.deleteAlarm).toHaveBeenCalled();
    expect(h.phase()).toBe('setup');
  });

  it('SRV-CANCEL-02: checks never go below 0', async () => {
    await h.seed({
      mode: 'confidence',
      check: { ...SETUP_CHECK, round: 5, startedAt: T0, checks: 0 },
    });
    await h.request(h.addConnection(), cancel(5));
    expect(h.check().checks).toBe(0);
  });

  it.each([
    ['PAUSED', PAUSED, 6],
    ['CONFIDENT', CONFIDENT, 6],
    ['SETUP', SETUP, 4],
  ] as const)('SRV-CANCEL-03: does nothing when %s', async (_name, seed, round) => {
    await h.seed(seed);
    const before = h.session.get('check');
    await h.request(h.addConnection(), cancel(round));
    expect(h.session.get('check')).toEqual(before);
    expect(h.storage.deleteAlarm).not.toHaveBeenCalled();
  });

  it('SRV-CANCEL-04: confidence after a cancel ends nothing', async () => {
    const { p1 } = await running(h);
    h.advanceTo(T0 + 10_000);
    await h.request(p1.conn, cancel(5));
    await h.setConfident('p1', 5);
    await h.setConfident('p2', 5);
    expect(h.phase()).toBe('setup');
    expect(h.check().outcome).toBeNull();
    expect(h.history()).toEqual([]);
  });
});

describe('skipItem', () => {
  it('SRV-SKIP-01: records a skipped entry and starts a fresh item', async () => {
    await h.seed({ ...PAUSED, confidence: { p1: 6 } });
    await h.request(h.addConnection(), skip(6));
    expect(h.history()[0]).toEqual({
      kind: 'confidence',
      id: 'item-1',
      story: 'Story A',
      timestamp: T0,
      votes: {},
      players: {},
      result: 'skipped',
      checks: 2,
      attempts: PAUSED_LOG,
      url: 'https://x.io/1',
    });
    expect(h.session.get('check')).toEqual({
      itemId: 'uuid-1',
      round: 6,
      startedAt: null,
      outcome: null,
      checks: 0,
      log: [],
    });
    expect(h.session.get('storyName')).toBe('');
    expect(h.session.get('itemUrl')).toBe('');
    expect(h.confidence()).toEqual({});
    expect(h.storage.alarm).toBeNull();
  });

  it('SRV-SKIP-02: a blank url is not recorded', async () => {
    await h.seed({ ...PAUSED, itemUrl: '   ' });
    await h.request(h.addConnection(), skip(6));
    expect('url' in h.history()[0]).toBe(false);
  });

  it('SRV-SKIP-03: an item already in history is not recorded twice', async () => {
    await h.seed({ ...PAUSED, history: [CONFIDENT_HISTORY] });
    await h.request(h.addConnection(), skip(6));
    expect(h.history()).toHaveLength(1);
    expect(h.check().itemId).toBe('uuid-1');
  });

  it('SRV-SKIP-04: an item without an id gets one in history', async () => {
    await h.seed({ ...PAUSED, check: { ...PAUSED_CHECK, itemId: '' } });
    await h.request(h.addConnection(), skip(6));
    expect(h.history()[0].id).toBe('uuid-1');
    expect(h.check().itemId).toBe('uuid-2');
  });

  it.each([
    ['RUNNING', null, 5],
    ['CONFIDENT', CONFIDENT, 6],
    ['SETUP', SETUP, 4],
  ] as const)('SRV-SKIP-05: does nothing when %s', async (_name, seed, round) => {
    if (seed) await h.seed(seed);
    else await running(h);
    const history = h.history();
    const before = h.session.get('check');
    await h.request(h.addConnection(), skip(round));
    expect(h.history()).toEqual(history);
    expect(h.session.get('check')).toEqual(before);
  });

  it('SRV-SKIP-06: two skips for the same round record one entry', async () => {
    await h.seed(PAUSED);
    const conn = h.addConnection();
    await h.request(conn, skip(6));
    await h.request(conn, skip(6));
    expect(h.history()).toHaveLength(1);
  });
});

describe('nextItem', () => {
  it('SRV-NEXT-01: clears a confirmed item', async () => {
    await h.seed(CONFIDENT);
    await h.request(h.addConnection(), next(6));
    expect(h.session.get('check')).toEqual({
      itemId: 'uuid-1',
      round: 6,
      startedAt: null,
      outcome: null,
      checks: 0,
      log: [],
    });
    expect(h.session.get('storyName')).toBe('');
    expect(h.session.get('itemUrl')).toBe('');
    expect(h.history()).toHaveLength(1);
  });

  it('SRV-NEXT-02: does nothing when paused or running', async () => {
    await h.seed(PAUSED);
    const before = h.session.get('check');
    await h.request(h.addConnection(), next(6));
    expect(h.session.get('check')).toEqual(before);

    const h2 = await createHarness();
    await running(h2);
    const running2 = h2.session.get('check');
    await h2.request(h2.addConnection(), next(5));
    expect(h2.session.get('check')).toEqual(running2);
  });
});

describe('setMode', () => {
  it('SRV-MODE-01: switching to confidence keeps the item and clears confidence', async () => {
    await h.seed({
      mode: 'points',
      storyName: 'Story A',
      check: { ...SETUP_CHECK, round: 3 },
      confidence: { p1: 3 },
    });
    await h.request(h.addConnection(), mode('confidence', 3));
    expect(h.session.get('mode')).toBe('confidence');
    expect(h.check()).toMatchObject({
      itemId: 'item-1',
      round: 3,
      startedAt: null,
      outcome: null,
    });
    expect(h.session.get('storyName')).toBe('Story A');
    expect(h.confidence()).toEqual({});
  });

  it('SRV-MODE-02: leaving a pause keeps the item', async () => {
    await h.seed(PAUSED);
    await h.request(h.addConnection(), mode('points', 6));
    expect(h.session.get('mode')).toBe('points');
    expect(h.session.get('check')).toEqual({
      itemId: 'item-1',
      round: 6,
      startedAt: null,
      outcome: null,
      checks: 2,
      log: PAUSED_LOG,
    });
    expect(h.session.get('storyName')).toBe('Story A');
    expect(h.session.get('itemUrl')).toBe(' https://x.io/1 ');
  });

  it('SRV-MODE-03: leaving a confirmed item clears it', async () => {
    await h.seed(CONFIDENT);
    await h.request(h.addConnection(), mode('points', 6));
    expect(h.session.get('mode')).toBe('points');
    expect(h.session.get('storyName')).toBe('');
    expect(h.session.get('itemUrl')).toBe('');
    expect(h.session.get('check')).toEqual({
      itemId: 'uuid-1',
      round: 6,
      startedAt: null,
      outcome: null,
      checks: 0,
      log: [],
    });
  });

  it('SRV-MODE-04: ignored while checking', async () => {
    const { p1 } = await running(h);
    const before = h.session.get('check');
    await h.request(p1.conn, mode('points', 5));
    expect(h.session.get('mode')).toBe('confidence');
    expect(h.session.get('check')).toEqual(before);
    expect(h.storage.alarm).toBe(T0 + D);
  });

  it('SRV-MODE-05: the same mode changes nothing', async () => {
    await h.seed({ ...SETUP, confidence: { p1: 4 } });
    const before = { session: h.session.toJSON(), confidence: h.confidence() };
    await h.request(h.addConnection(), mode('confidence', 4));
    expect({ session: h.session.toJSON(), confidence: h.confidence() }).toEqual(before);
  });
});

describe('endCheck', () => {
  it('SRV-END-01: ends early when every player is confident', async () => {
    await running(h);
    h.advanceTo(T0 + 5000);
    await h.setConfident('p1', 5);
    expect(h.phase()).toBe('checking');
    h.storage.put.mockClear();
    await h.setConfident('p2', 5);
    const outcome = h.check().outcome;
    expect(outcome).toMatchObject({ result: 'confident', at: T0 + 5000, notConfident: {} });
    expect(sorted(outcome?.confident ?? [])).toEqual(['p1', 'p2']);
    expect(h.check().log).toEqual([]);
    expect(h.history()[0]).toEqual({
      kind: 'confidence',
      id: 'item-1',
      story: 'Story A',
      timestamp: T0 + 5000,
      votes: {},
      players: {},
      result: 'confident',
      checks: 1,
      attempts: [],
    });
    expect(h.storage.alarm).toBeNull();
    expect(h.storage.put).toHaveBeenCalledWith('snapshot', expect.any(Uint8Array));
  });

  it('SRV-END-02: keeps checking while someone is not confident', async () => {
    await running(h);
    const calls = h.storage.setAlarm.mock.calls.length;
    await h.setConfident('p1', 5);
    expect(h.phase()).toBe('checking');
    expect(h.storage.alarm).toBe(T0 + D);
    expect(h.storage.setAlarm.mock.calls.length).toBe(calls);
  });

  it('SRV-END-03: zero players never counts as all confident', async () => {
    await h.seed(SETUP);
    await h.request(h.addConnection(), start(4));
    h.advanceTo(T0 + 1000);
    await h.clientWrite(() => h.session.set('storyName', 'x'));
    expect(h.phase()).toBe('checking');
  });

  // PIN: a check with nobody in it times out as paused with an empty "not confident" list
  it('SRV-END-04: zero players pauses at the deadline', async () => {
    await h.seed(SETUP);
    await h.request(h.addConnection(), start(4));
    h.advanceTo(T0 + D);
    await h.fireAlarm();
    expect(h.check().outcome).toEqual({
      result: 'paused',
      at: T0 + D,
      notConfident: {},
      confident: [],
    });
    expect(h.check().log).toEqual([{ check: 1, notConfident: [] }]);
  });

  it('SRV-END-05: confidence from an older round does not count', async () => {
    await running(h);
    await h.setConfident('p1', 4);
    await h.setConfident('p2', 4);
    expect(h.phase()).toBe('checking');
  });

  it('SRV-END-06: a player who switches to observer stops counting', async () => {
    const { p2 } = await running(h);
    await h.setConfident('p1', 5);
    await p2.setObserver(true);
    expect(h.check().outcome).toMatchObject({
      result: 'confident',
      confident: ['p1'],
      notConfident: {},
    });
  });

  it('SRV-END-07: a player who leaves stops counting', async () => {
    const { p2 } = await running(h);
    await h.setConfident('p1', 5);
    await h.disconnect(p2.conn);
    expect(h.check().outcome).toMatchObject({ result: 'confident', confident: ['p1'] });
  });

  // BUG: party/server.ts:60-74: PlanningPoker doesn't override onClose. When the leaving
  // connection's awareness ids weren't recorded (hello-only ownership), y-partyserver removes no
  // state, no awareness change fires and nothing queues an evaluation until the alarm.
  it.fails('SRV-END-08: a hello-only player who leaves stops counting', async () => {
    await h.seed(SETUP);
    const p1 = await h.addPlayer('p1', 'Ann');
    const p2 = await h.addPlayer('p2', 'Bob', { ownership: 'hello' });
    await h.request(p1.conn, start(4));
    await h.setConfident('p1', 5);
    h.advanceTo(T0 + 20_000);
    await h.disconnect(p2.conn);
    expect(h.check().outcome).toMatchObject({ result: 'confident', at: T0 + 20_000 });
  });

  it('SRV-END-09: times out as paused with who was not confident', async () => {
    await running(h);
    h.advanceTo(T0 + 10_000);
    await h.setConfident('p1', 5);
    h.storage.deleteAlarm.mockClear();
    h.advanceTo(T0 + D);
    await h.fireAlarm();
    expect(h.check().outcome).toEqual({
      result: 'paused',
      at: T0 + D,
      notConfident: { p2: 'Bob' },
      confident: ['p1'],
    });
    expect(h.check().log).toEqual([{ check: 1, notConfident: ['Bob'] }]);
    expect(h.history()).toEqual([]);
    expect(h.storage.deleteAlarm).not.toHaveBeenCalled();
  });

  it('SRV-END-10: confidence after the deadline does not count', async () => {
    await running(h);
    h.advanceTo(T0 + 10_000);
    await h.setConfident('p1', 5);
    h.advanceTo(T0 + D + 500);
    await h.setConfident('p2', 5);
    expect(h.check().outcome).toMatchObject({
      result: 'paused',
      notConfident: { p2: 'Bob' },
      at: T0 + D,
    });
    await h.fireAlarm();
    expect(h.check().log).toHaveLength(1);
  });

  it('SRV-END-11: a late alarm stamps the deadline, not the current time', async () => {
    await running(h);
    h.advanceTo(T0 + D + 5000);
    await h.fireAlarm();
    expect(h.check().outcome?.at).toBe(T0 + D);
  });

  it('SRV-END-12: a restart ignores the previous round', async () => {
    const { p1 } = await running(h);
    await h.setConfident('p1', 5);
    const t1 = T0 + 10_000;
    h.advanceTo(t1);
    await h.request(p1.conn, cancel(5));
    await h.request(p1.conn, start(5));
    expect(h.check().round).toBe(6);
    h.advanceTo(t1 + D);
    await h.fireAlarm();
    expect(Object.keys(h.check().outcome?.notConfident ?? {}).sort()).toEqual(['p1', 'p2']);
  });

  it('SRV-END-13: a garbage check written by a client is survived', async () => {
    await running(h);
    await h.clientWrite(() => h.session.set('check', 'garbage'));
    expect(console.error).not.toHaveBeenCalled();
    expect(h.phase()).toBe('setup');
  });

  it('SRV-END-14: a malformed outcome written by a client is normalised', async () => {
    await running(h);
    const current = h.session.get('check') as object;
    await h.clientWrite(() =>
      h.session.set('check', { ...current, outcome: { result: 'paused' } }),
    );
    expect(h.phase()).toBe('paused');
    const before = h.session.get('check');
    h.advanceTo(T0 + D);
    await expect(h.fireAlarm()).resolves.toBeUndefined();
    expect(h.session.get('check')).toEqual(before);
  });
});

describe('onAlarm', () => {
  it('SRV-ALARM-01: an early alarm re-arms for the deadline', async () => {
    await running(h);
    h.advanceTo(T0 + 30_000);
    await h.fireAlarm();
    expect(h.check().outcome).toBeNull();
    expect(h.storage.alarm).toBe(T0 + D);
  });

  it('SRV-ALARM-02: does nothing when no check is running', async () => {
    const { p1 } = await running(h);
    await h.request(p1.conn, cancel(5));
    h.storage.setAlarm.mockClear();
    await h.fireAlarm();
    expect(h.phase()).toBe('setup');
    expect(h.storage.setAlarm).not.toHaveBeenCalled();
  });

  it('SRV-ALARM-03: resets armedDeadline', async () => {
    await h.seed(SETUP);
    internals(h.server).armedDeadline = 123;
    await h.fireAlarm();
    expect(internals(h.server).armedDeadline).toBeNull();
  });

  it('SRV-ALARM-04: errors are caught and logged', async () => {
    await running(h);
    const err = new Error('x');
    vi.spyOn(internals(h.server), 'endCheck').mockRejectedValueOnce(err);
    h.advanceTo(T0 + D);
    await expect(h.fireAlarm()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('alarm failed', err);
  });

  it('SRV-ALARM-05: a cold DO past the deadline ends the round once', async () => {
    const cold = await createHarness({ storage: coldSnapshot(), now: T0 + D + 1000 });
    await cold.fireAlarm();
    expect(cold.check().outcome).toEqual({
      result: 'paused',
      at: T0 + D,
      notConfident: {},
      confident: [],
    });
    expect(cold.check().log).toHaveLength(1);
  });
});

describe('evaluate / queueEvaluate', () => {
  it('SRV-EVAL-01: coalesces many updates into one evaluation', async () => {
    await running(h);
    const spy = vi.spyOn(internals(h.server), 'evaluate');
    for (let i = 0; i < 5; i++) h.doc.transact(() => h.session.set('storyName', `s${i}`), 'client');
    await h.clientWrite(() => undefined);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('SRV-EVAL-02: an awareness change triggers an evaluation', async () => {
    await running(h);
    const spy = vi.spyOn(internals(h.server), 'evaluate');
    await h.addPlayer('p3', 'Cy');
    expect(spy).toHaveBeenCalled();
    expect(h.phase()).toBe('checking');
  });

  it('SRV-EVAL-03: a cold DO before the deadline re-arms the alarm', async () => {
    const cold = await createHarness({ storage: coldSnapshot(), now: T0 + 20_000 });
    expect(cold.storage.setAlarm).toHaveBeenCalledWith(T0 + D);
    expect(cold.phase()).toBe('checking');
  });

  it('SRV-EVAL-04: a cold DO past the deadline ends the round on start', async () => {
    const cold = await createHarness({ storage: coldSnapshot(), now: T0 + D + 1000 });
    expect(cold.check().outcome).toMatchObject({ result: 'paused', at: T0 + D });
  });

  it('SRV-EVAL-05: re-arms when the armed deadline is unknown', async () => {
    await running(h);
    h.storage.setAlarm.mockClear();
    internals(h.server).armedDeadline = null;
    await h.clientWrite(() => h.session.set('storyName', 'x'));
    expect(h.storage.setAlarm).toHaveBeenCalledTimes(1);
    expect(h.storage.setAlarm).toHaveBeenCalledWith(T0 + D);
  });

  it('SRV-EVAL-06: does nothing outside a check', async () => {
    await h.seed(SETUP);
    await h.clientWrite(() => h.session.set('storyName', 'x'));
    expect(h.storage.setAlarm).not.toHaveBeenCalled();
    expect(h.check().outcome).toBeNull();
  });

  it('SRV-EVAL-07: errors are logged and later writes still evaluate', async () => {
    await running(h);
    const err = new Error('e');
    const endCheck = vi.spyOn(internals(h.server), 'endCheck').mockRejectedValueOnce(err);
    await h.clientWrite(() => h.session.set('storyName', 'x'));
    expect(console.error).toHaveBeenCalledWith('evaluate failed', err);
    expect(internals(h.server).evaluateQueued).toBe(false);
    endCheck.mockClear();
    await h.clientWrite(() => h.session.set('storyName', 'y'));
    expect(endCheck).toHaveBeenCalled();
  });
});

describe('persistence', () => {
  it('SRV-PERSIST-01: a saved snapshot loads into an equal doc', async () => {
    await running(h);
    await h.setConfident('p1', 5);
    await h.setConfident('p2', 5);
    expect(h.history()).toHaveLength(1);
    await h.server.onSave();
    const b = await createHarness({ storage: h.storage });
    expect(b.session.toJSON()).toEqual(h.session.toJSON());
    expect(b.history()).toEqual(h.history());
    expect(b.confidence()).toEqual(h.confidence());
  });

  it('SRV-PERSIST-02: starts empty without a snapshot', async () => {
    const fresh = await createHarness();
    expect(fresh.session.size).toBe(0);
    expect(fresh.storage.setAlarm).not.toHaveBeenCalled();
  });

  it('SRV-PERSIST-03: client writes are saved after a 2 s debounce', async () => {
    await h.seed(SETUP);
    vi.advanceTimersByTime(10_000);
    h.storage.put.mockClear();
    await h.clientWrite(() => h.session.set('storyName', 'x'));
    vi.advanceTimersByTime(1999);
    expect(h.storage.put).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.storage.put).toHaveBeenCalledWith('snapshot', expect.any(Uint8Array));
  });

  it('SRV-PERSIST-04: a cancel is persisted by the debounced save', async () => {
    const { p1 } = await running(h);
    await h.request(p1.conn, cancel(5));
    h.storage.put.mockClear();
    vi.advanceTimersByTime(2000);
    await Promise.resolve();
    expect(h.storage.put).toHaveBeenCalled();
    const b = await createHarness({ storage: h.storage });
    expect(b.phase()).toBe('setup');
  });
});

describe('default fetch', () => {
  it('falls back to 404 when no party matches', async () => {
    const { default: worker } = await import('./server');
    const fetchFn = worker.fetch as (r: Request, env: unknown) => Promise<Response>;
    const res = await fetchFn(new Request('http://x/unknown'), {});
    expect(res.status).toBe(404);
  });
});
