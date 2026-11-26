import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { FakeProvider, fakeProviderFactory } from '../../testing/fake-provider';
import type { CheckOutcome, CheckState, HistoryEntry } from '../shared/confidence-protocol';
import { RoomService, Y_PROVIDER_FACTORY } from './room.service';

const T0 = 1_700_000_000_000;
type Uuid = `${string}-${string}-${string}-${string}-${string}`;

let svc: RoomService;
let p: FakeProvider;
let uuidCalls = 0;

const session = (d: Y.Doc = p.doc) => d.getMap<unknown>('session');
const running = (round: number, extra: Partial<CheckState> = {}): CheckState => ({
  itemId: 'item-1',
  round,
  startedAt: T0,
  outcome: null,
  checks: 1,
  log: [],
  ...extra,
});

function join(
  code = 'ABC123',
  name = 'Ann',
  { connected = true, synced = true } = {},
): FakeProvider {
  svc.connect(code, name);
  const provider = FakeProvider.instances.at(-1);
  if (!provider) throw new Error('no provider created');
  p = provider;
  if (connected) p.status('connected');
  if (synced) p.synced(true);
  return p;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('pp-peer-id', 'me');
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  uuidCalls = 0;
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `uuid-${++uuidCalls}` as Uuid);
  TestBed.configureTestingModule({
    providers: [{ provide: Y_PROVIDER_FACTORY, useValue: fakeProviderFactory }],
  });
  svc = TestBed.inject(RoomService);
});

afterEach(() => {
  svc.disconnect();
  FakeProvider.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('connect / disconnect / observer', () => {
  it('SVC-CONN-01: creates the provider and sets awareness', () => {
    join();
    expect(p.host).toBe('localhost:8787');
    expect(p.room).toBe('planning-poker-ABC123');
    expect(p.opts).toEqual({ party: 'planning-poker' });
    expect(p.awareness.getLocalState()).toEqual({ name: 'Ann', peerId: 'me', observer: undefined });
    expect(svc.myPeerId()).toBe('me');
  });

  it('SVC-CONN-02: creates and persists a peer id once', () => {
    localStorage.clear();
    join();
    expect(svc.myPeerId()).toBe('uuid-1');
    expect(localStorage.getItem('pp-peer-id')).toBe('uuid-1');
    join();
    expect(svc.myPeerId()).toBe('uuid-1');
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('SVC-CONN-03: restores observer mode', () => {
    localStorage.setItem('pp-observer', 'true');
    join();
    expect(svc.isObserver()).toBe(true);
    expect(p.awareness.getLocalState()).toMatchObject({ observer: true });
  });

  it('SVC-CONN-04: sends hello on connect', () => {
    join('ABC123', 'Ann', { connected: false });
    p.status('connected');
    expect(svc.connected()).toBe(true);
    expect(p.sendMessage).toHaveBeenCalledTimes(1);
    expect(p.sendMessage).toHaveBeenCalledWith(
      JSON.stringify({ type: 'hello', clientId: p.doc.clientID }),
    );
    p.status('disconnected');
    expect(svc.connected()).toBe(false);
    expect(p.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('SVC-CONN-05: writes session defaults only after the first sync', () => {
    join('ABC123', 'Ann', { synced: false });
    expect(session().size).toBe(0);
    expect(p.doc.getMap('names').size).toBe(0);
    p.synced(true);
    expect(session().toJSON()).toEqual({
      phase: 'voting',
      storyName: '',
      timerDuration: 60,
      timerState: 'idle',
      timerVisible: false,
    });
    expect(p.doc.getMap('names').toJSON()).toEqual({ me: 'Ann' });
  });

  it("SVC-CONN-06: doesn't overwrite the room's existing values", () => {
    join('ABC123', 'Ann', { synced: false });
    p.remote((d) => {
      session(d).set('phase', 'revealed');
      session(d).set('timerDuration', 90);
    });
    p.synced(true);
    expect(svc.phase()).toBe('revealed');
    expect(svc.timerDuration()).toBe(90);
  });

  it('SVC-CONN-07: initialises once', () => {
    join('ABC123', 'Ann', { synced: false });
    p.synced(false);
    expect(session().size).toBe(0);
    p.synced(true);
    expect(session().get('phase')).toBe('voting');
    p.remote((d) => d.getMap('names').set('me', 'Other'));
    p.synced(true);
    expect(p.doc.getMap('names').get('me')).toBe('Other');
  });

  it('SVC-CONN-08: disconnect resets every signal', () => {
    join();
    p.remote((d) => {
      const s = session(d);
      s.set('phase', 'revealed');
      s.set('storyName', 'S');
      s.set('timerState', 'running');
      s.set('timerEndTime', T0 + 1000);
      s.set('timerRemainingOnPause', 5);
      s.set('timerDuration', 90);
      s.set('timerVisible', true);
      s.set('mode', 'confidence');
      s.set('itemUrl', 'https://x.io');
      s.set('check', running(1));
      d.getMap('votes').set('me', '5');
      d.getMap('confidence').set('me', 1);
      d.getArray<HistoryEntry>('history').push([
        { story: 'S', timestamp: T0, votes: {}, players: {} },
      ]);
    });
    p.custom(JSON.stringify({ type: 'time', now: T0 + 500 }));
    p.addRemote({ name: 'Bob', peerId: 'p2' });
    svc.skipNotice.set('x');
    svc.joinedMidCheck.set(true);
    const provider = p;

    svc.disconnect();

    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(svc.connected()).toBe(false);
    expect(svc.isObserver()).toBe(false);
    expect(svc.uniquePlayers()).toEqual([]);
    expect(svc.votes()).toEqual({});
    expect(svc.resolvedHistory()).toEqual([]);
    expect(svc.phase()).toBe('voting');
    expect(svc.storyName()).toBe('');
    expect(svc.timerDuration()).toBe(60);
    expect(svc.timerEndTime()).toBeNull();
    expect(svc.timerState()).toBe('idle');
    expect(svc.timerRemainingOnPause()).toBe(0);
    expect(svc.timerVisible()).toBe(false);
    expect(svc.mode()).toBe('points');
    expect(svc.itemUrl()).toBe('');
    expect(svc.checkPhase()).toBe('setup');
    expect(svc.checkRound()).toBe(0);
    expect(svc.confidentIds().size).toBe(0);
    expect(svc.serverOffset()).toBe(0);
    expect(svc.joinedMidCheck()).toBe(false);
    expect(svc.skipNotice()).toBeNull();
    // PIN: the peer id survives a disconnect
    expect(svc.myPeerId()).toBe('me');
  });

  it('SVC-CONN-09: toggling observer persists and drops my vote and confidence', () => {
    join();
    svc.vote('5');
    p.remote((d) => {
      session(d).set('mode', 'confidence');
      session(d).set('check', running(1));
      d.getMap('confidence').set('me', 1);
    });
    svc.toggleObserver();
    expect(localStorage.getItem('pp-observer')).toBe('true');
    expect(p.awareness.getLocalState()).toEqual({ name: 'Ann', peerId: 'me', observer: true });
    expect(p.doc.getMap('votes').has('me')).toBe(false);
    expect(p.doc.getMap('confidence').has('me')).toBe(false);

    svc.toggleObserver();
    expect(localStorage.getItem('pp-observer')).toBeNull();
    expect(p.awareness.getLocalState()).toEqual({ name: 'Ann', peerId: 'me', observer: undefined });
  });

  it('SVC-CONN-10: toggling observer while disconnected does nothing', () => {
    expect(() => svc.toggleObserver()).not.toThrow();
    expect(svc.isObserver()).toBe(false);
    expect(localStorage.getItem('pp-observer')).toBeNull();
  });
});

describe('timer', () => {
  const setTimer = (values: Record<string, unknown>) =>
    p.remote((d) => Object.entries(values).forEach(([k, v]) => session(d).set(k, v)));

  beforeEach(() => {
    join();
    vi.setSystemTime(T0);
  });

  it('SVC-TMR-01: starts from the duration', () => {
    svc.startTimer();
    expect(svc.timerEndTime()).toBe(T0 + 60_000);
    expect(svc.timerState()).toBe('running');
    expect(svc.timerRemainingOnPause()).toBe(0);
  });

  it('SVC-TMR-02: resumes from the paused remainder', () => {
    setTimer({ timerState: 'paused', timerRemainingOnPause: 25.5 });
    svc.startTimer();
    expect(svc.timerEndTime()).toBe(T0 + 25_500);
  });

  it('SVC-TMR-03: pauses with the remaining seconds', () => {
    setTimer({ timerState: 'running', timerEndTime: T0 + 60_000 });
    vi.setSystemTime(T0 + 15_000);
    svc.pauseTimer();
    expect(svc.timerState()).toBe('paused');
    expect(svc.timerRemainingOnPause()).toBe(45);
    expect(svc.timerEndTime()).toBeNull();
  });

  it('SVC-TMR-04: an overdue pause keeps 0 seconds', () => {
    setTimer({ timerState: 'running', timerEndTime: T0 + 5000 });
    vi.setSystemTime(T0 + 9000);
    svc.pauseTimer();
    expect(svc.timerRemainingOnPause()).toBe(0);
  });

  it('SVC-TMR-05: pausing without an end time does nothing', () => {
    const spy = vi.fn();
    session().observe(spy);
    svc.pauseTimer();
    expect(spy).not.toHaveBeenCalled();
  });

  it('SVC-TMR-06: reset', () => {
    svc.startTimer();
    svc.resetTimer();
    expect(svc.timerState()).toBe('idle');
    expect(svc.timerEndTime()).toBeNull();
    expect(svc.timerRemainingOnPause()).toBe(0);
  });

  it('SVC-TMR-07: adjusting an idle timer clamps at 10 s', () => {
    svc.adjustDuration(30);
    expect(svc.timerDuration()).toBe(90);
    svc.adjustDuration(-60);
    expect(svc.timerDuration()).toBe(30);
    svc.adjustDuration(-60);
    expect(svc.timerDuration()).toBe(10);
    expect(svc.timerEndTime()).toBeNull();
  });

  it('SVC-TMR-08: adjusting a running timer moves the end time', () => {
    setTimer({ timerState: 'running', timerDuration: 60, timerEndTime: T0 + 60_000 });
    svc.adjustDuration(30);
    expect(svc.timerDuration()).toBe(90);
    expect(svc.timerEndTime()).toBe(T0 + 90_000);
  });

  it('SVC-TMR-09: adjusting a paused timer clamps the remainder at 0', () => {
    setTimer({ timerState: 'paused', timerDuration: 60, timerRemainingOnPause: 20 });
    svc.adjustDuration(-30);
    expect(svc.timerDuration()).toBe(30);
    expect(svc.timerRemainingOnPause()).toBe(0);
  });

  it('SVC-TMR-10: a clamped adjustment does not move a running timer', () => {
    setTimer({ timerState: 'running', timerDuration: 10, timerEndTime: T0 + 10_000 });
    svc.adjustDuration(-30);
    expect(svc.timerDuration()).toBe(10);
    expect(svc.timerEndTime()).toBe(T0 + 10_000);
  });

  it('SVC-TMR-11: a partly clamped adjustment moves the end time by the applied delta', () => {
    setTimer({ timerState: 'running', timerDuration: 20, timerEndTime: T0 + 20_000 });
    svc.adjustDuration(-30);
    expect(svc.timerDuration()).toBe(10);
    expect(svc.timerEndTime()).toBe(T0 + 10_000);
  });

  it('SVC-TMR-13: a partly clamped adjustment moves a paused timer by the applied delta', () => {
    setTimer({ timerState: 'paused', timerDuration: 20, timerRemainingOnPause: 15 });
    svc.adjustDuration(-30);
    expect(svc.timerDuration()).toBe(10);
    expect(svc.timerRemainingOnPause()).toBe(5);
  });

  it('SVC-TMR-12: toggles timer visibility', () => {
    svc.toggleTimerVisible();
    expect(svc.timerVisible()).toBe(true);
    svc.toggleTimerVisible();
    expect(svc.timerVisible()).toBe(false);
  });
});

describe('voting and history', () => {
  const entry = (story: string, timestamp: number): HistoryEntry => ({
    story,
    timestamp,
    votes: {},
    players: {},
  });
  const history = () => p.doc.getArray<HistoryEntry>('history').toArray();
  const seedHistory = (entries: HistoryEntry[]) =>
    p.remote((d) => d.getArray<HistoryEntry>('history').push(entries));

  beforeEach(() => join());

  it('SVC-VOTE-01: vote and clear', () => {
    svc.vote('5');
    expect(svc.votes()).toEqual({ me: '5' });
    svc.clearVote();
    expect(svc.votes()).toEqual({});
  });

  it('SVC-VOTE-02: reveal records names and votes', () => {
    p.remote((d) => {
      session(d).set('storyName', 'S');
      d.getMap('votes').set('p9', '8');
      d.getMap('names').set('p9', 'Cy');
    });
    svc.vote('5');
    p.addRemote({ name: 'Bob', peerId: 'p2' });
    svc.startTimer();
    svc.revealVotes();
    expect(history()[0]).toEqual({
      story: 'S',
      timestamp: T0,
      votes: { me: '5', p9: '8' },
      players: { me: 'Ann', p9: 'Cy', p2: 'Bob' },
    });
    expect(svc.phase()).toBe('revealed');
    expect(svc.timerState()).toBe('idle');
  });

  it('SVC-VOTE-03: online names override stored names', () => {
    p.remote((d) => d.getMap('names').set('me', 'Old'));
    svc.vote('5');
    svc.revealVotes();
    expect(history()[0].players['me']).toBe('Ann');
  });

  it('SVC-VOTE-04: reset round keeps the story', () => {
    p.remote((d) => {
      session(d).set('phase', 'revealed');
      session(d).set('storyName', 'S');
      d.getMap('votes').set('p2', '3');
    });
    svc.startTimer();
    svc.resetRound();
    expect(svc.votes()).toEqual({});
    expect(svc.phase()).toBe('voting');
    expect(svc.storyName()).toBe('S');
    expect(svc.timerState()).toBe('idle');
  });

  it('SVC-VOTE-05: new round clears the story', () => {
    p.remote((d) => {
      session(d).set('phase', 'revealed');
      session(d).set('storyName', 'S');
    });
    svc.vote('5');
    svc.newRound();
    expect(svc.votes()).toEqual({});
    expect(svc.phase()).toBe('voting');
    expect(svc.storyName()).toBe('');
  });

  it('SVC-VOTE-06: edits a history story by timestamp', () => {
    const [a, b, c] = [entry('A', 1), entry('B', 2), entry('C', 3)];
    seedHistory([a, b, c]);
    svc.updateHistoryStory(2, 'New');
    expect(history()).toEqual([a, { ...b, story: 'New' }, c]);
  });

  it('SVC-VOTE-07: deletes a history entry by timestamp', () => {
    const [a, b, c] = [entry('A', 1), entry('B', 2), entry('C', 3)];
    seedHistory([a, b, c]);
    svc.deleteHistoryEntry(2);
    expect(history()).toEqual([a, c]);
    svc.deleteHistoryEntry(999);
    expect(history()).toEqual([a, c]);
  });

  // PIN: edit and delete are keyed by timestamp, so of two entries with the same timestamp
  // only the first can be targeted
  it('SVC-VOTE-08: entries with the same timestamp collide', () => {
    const [a, b] = [entry('A', T0), entry('B', T0)];
    seedHistory([a, b]);
    svc.updateHistoryStory(T0, 'X');
    expect(history()).toEqual([{ ...a, story: 'X' }, b]);
    svc.deleteHistoryEntry(T0);
    expect(history()).toEqual([b]);
  });

  it('SVC-VOTE-09: write methods are safe while not connected', () => {
    svc.disconnect();
    expect(() => {
      svc.vote('1');
      svc.clearVote();
      svc.revealVotes();
      svc.resetRound();
      svc.newRound();
      svc.updateStoryName('x');
      svc.updateItemUrl('x');
      svc.updateHistoryStory(1, 'x');
      svc.deleteHistoryEntry(1);
      svc.startTimer();
      svc.pauseTimer();
      svc.resetTimer();
      svc.adjustDuration(10);
      svc.toggleTimerVisible();
    }).not.toThrow();
  });
});

describe('confidence requests', () => {
  const PAUSED_OUTCOME: CheckOutcome = {
    result: 'paused',
    at: T0,
    notConfident: {},
    confident: [],
  };
  const inCheck = (check: CheckState) =>
    p.remote((d) => {
      d.getMap('session').set('mode', 'confidence');
      d.getMap('session').set('check', check);
    });
  /** Requests sent after the `hello` that every (re)connect sends first. */
  const requests = () => p.sendMessage.mock.calls.map(([m]) => m).slice(1);

  beforeEach(() => join());

  it('SVC-REQ-01: start / cancel / next name the round the client saw', () => {
    expect(p.sendMessage.mock.calls[0]).toEqual([
      JSON.stringify({ type: 'hello', clientId: p.doc.clientID }),
    ]);
    inCheck(running(3));
    svc.startCheck();
    svc.cancelCheck();
    svc.nextItem();
    expect(requests()).toEqual([
      '{"type":"check","action":"start","round":3}',
      '{"type":"check","action":"cancel","round":3}',
      '{"type":"check","action":"next","round":3}',
    ]);
  });

  it('SVC-REQ-02: nothing is sent while disconnected', () => {
    p.status('disconnected');
    svc.startCheck();
    expect(requests()).toEqual([]);
  });

  it('SVC-REQ-03: skip sends the request and shows a notice for 4 s', () => {
    inCheck(running(3, { outcome: PAUSED_OUTCOME }));
    svc.skipItem();
    expect(requests()).toEqual(['{"type":"check","action":"skip","round":3}']);
    expect(svc.skipNotice()).toBe('Skipped. Recorded as not confident.');
    vi.advanceTimersByTime(3999);
    expect(svc.skipNotice()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(svc.skipNotice()).toBeNull();
  });

  it('SVC-REQ-04: a second skip restarts the notice timer', () => {
    inCheck(running(3, { outcome: PAUSED_OUTCOME }));
    svc.skipItem();
    vi.advanceTimersByTime(3000);
    svc.skipItem();
    vi.advanceTimersByTime(3999);
    expect(svc.skipNotice()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(svc.skipNotice()).toBeNull();
  });

  it('SVC-REQ-05: no notice when the skip could not be sent', () => {
    inCheck(running(3, { outcome: PAUSED_OUTCOME }));
    p.status('disconnected');
    svc.skipItem();
    expect(svc.skipNotice()).toBeNull();
    p.status('connected');
    p.sendMessage.mockImplementation(() => {
      throw new Error('socket closed');
    });
    svc.skipItem();
    expect(svc.skipNotice()).toBeNull();
  });

  it('SVC-REQ-06: skip is only sent from a pause', () => {
    inCheck(running(3));
    svc.skipItem();
    expect(requests()).toEqual([]);
    expect(svc.skipNotice()).toBeNull();
  });

  it('SVC-REQ-07: mode requests, except for the current mode or while checking', () => {
    svc.setMode('confidence');
    expect(requests()).toEqual(['{"type":"mode","mode":"confidence","round":0}']);
    svc.setMode('points');
    expect(requests()).toHaveLength(1);
    inCheck(running(2));
    svc.setMode('points');
    expect(requests()).toHaveLength(1);
  });

  it('SVC-REQ-08: confident writes the round, not confident removes it', () => {
    inCheck(running(5));
    svc.setConfident(true);
    expect(p.doc.getMap('confidence').toJSON()).toEqual({ me: 5 });
    expect(svc.amConfident()).toBe(true);
    svc.setConfident(false);
    expect(p.doc.getMap('confidence').toJSON()).toEqual({});
    expect(svc.amConfident()).toBe(false);
  });

  it.each([
    ['disconnected', () => p.status('disconnected')],
    ['an observer', () => svc.toggleObserver()],
    ['paused', () => inCheck(running(5, { outcome: PAUSED_OUTCOME }))],
  ])('SVC-REQ-09: confident does nothing when %s', (_label, arrange) => {
    inCheck(running(5));
    arrange();
    svc.setConfident(true);
    expect(p.doc.getMap('confidence').toJSON()).toEqual({});
  });
});

describe('server support for confidence checks', () => {
  const time = () => p.custom(JSON.stringify({ type: 'time', now: T0 }));

  it('SVC-SRV-01: a current server sends time before the sync completes', () => {
    join('ABC123', 'Ann', { synced: false });
    expect(svc.canRequestChecks()).toBe(false);
    time();
    p.synced(true);
    expect(svc.serverReady()).toBe(true);
    expect(svc.serverOutdated()).toBe(false);
    expect(svc.canRequestChecks()).toBe(true);
    p.status('disconnected');
    expect(svc.canRequestChecks()).toBe(false);
  });

  it('SVC-SRV-02: synced without time means the server predates confidence checks', () => {
    join();
    expect(svc.serverOutdated()).toBe(true);
    expect(svc.canRequestChecks()).toBe(false);
    // A late `time` (e.g. after a redeploy and reconnect) clears it
    time();
    expect(svc.serverOutdated()).toBe(false);
    expect(svc.canRequestChecks()).toBe(true);
  });

  it('SVC-SRV-03: disconnect resets it', () => {
    join();
    time();
    svc.disconnect();
    expect(svc.serverReady()).toBe(false);
    expect(svc.serverOutdated()).toBe(false);
  });
});

describe('server messages', () => {
  beforeEach(() => join());

  it('SVC-MSG-01: time messages set the clock offset', () => {
    p.custom(JSON.stringify({ type: 'time', now: T0 + 1500 }));
    expect(svc.serverOffset()).toBe(1500);
    expect(svc.serverNow()).toBe(T0 + 1500);
  });

  it('SVC-MSG-02: other messages are ignored', () => {
    p.custom('xx');
    p.custom('{"type":"other","now":5}');
    p.custom('{"type":"time","now":"5"}');
    expect(svc.serverOffset()).toBe(0);
  });

  it('SVC-MSG-03: negative offsets', () => {
    p.custom(JSON.stringify({ type: 'time', now: T0 - 800 }));
    expect(svc.serverOffset()).toBe(-800);
  });

  it('SVC-MSG-04: a null payload is ignored', () => {
    expect(() => p.custom('null')).not.toThrow();
    expect(svc.serverOffset()).toBe(0);
  });
});

describe('derived signals', () => {
  const confidenceRound = (round: number, check: Partial<CheckState> = {}) =>
    p.remote((d) => {
      session(d).set('mode', 'confidence');
      session(d).set('check', running(round, check));
    });

  beforeEach(() => join());

  it('SVC-DER-01: only confidence for the current round counts', () => {
    confidenceRound(5);
    p.remote((d) => {
      const m = d.getMap<unknown>('confidence');
      m.set('p1', 5);
      m.set('p2', 4);
      m.set('p3', '5');
    });
    expect([...svc.confidentIds()]).toEqual(['p1']);
  });

  it('SVC-DER-02: check players exclude observers', () => {
    confidenceRound(5);
    p.addRemote({ name: 'Bob', peerId: 'p2' });
    p.addRemote({ name: 'Cy', peerId: 'p3', observer: true });
    p.remote((d) => {
      d.getMap('confidence').set('me', 5);
      d.getMap('confidence').set('p3', 5);
    });
    expect(svc.checkPlayers().map((x) => x.peerId)).toEqual(['me', 'p2']);
    expect(svc.amConfident()).toBe(true);
    expect(svc.onlineCount()).toBe(3);
  });

  it('SVC-DER-03: departed not-confident players are not online or counted', () => {
    confidenceRound(5, {
      outcome: { result: 'paused', at: T0, notConfident: { p9: 'Cy' }, confident: [] },
    });
    expect(svc.uniquePlayers().map((x) => x.peerId)).toEqual(['me', 'p9']);
    expect(svc.onlineCount()).toBe(1);
    expect(svc.checkPlayers().map((x) => x.peerId)).toEqual(['me']);
  });

  it('SVC-DER-04: points mode uses the pointPlayers rules', () => {
    p.remote((d) => {
      d.getMap('votes').set('p9', '5');
      d.getMap('names').set('p9', 'Cy');
    });
    expect(svc.uniquePlayers()).toEqual([
      { name: 'Ann', peerId: 'me', observer: false },
      { name: 'Cy', peerId: 'p9', offline: true },
    ]);
  });

  it('SVC-DER-05: a bogus outcome is normalised like the server does', () => {
    p.remote((d) => {
      session(d).set('mode', 'confidence');
      session(d).set('check', { round: 1, startedAt: T0, outcome: { result: 'bogus' } });
    });
    expect(svc.checkPhase()).toBe('checking');
  });

  it('SVC-DER-06: an outcome without notConfident does not throw', () => {
    p.remote((d) => {
      session(d).set('mode', 'confidence');
      session(d).set('check', { round: 1, startedAt: T0, outcome: { result: 'paused' } });
    });
    expect(() => svc.uniquePlayers()).not.toThrow();
  });
});

describe('mid-check join tracking', () => {
  const KEY = 'pp-check-seen-ABC123';
  const runRound = (round: number) =>
    p.remote((d) => {
      session(d).set('mode', 'confidence');
      session(d).set('check', running(round));
    });
  const joinMidCheck = () => {
    join('ABC123', 'Ann', { synced: false });
    runRound(5);
    p.synced(true);
  };

  it('SVC-MID-01: joining during a running round', () => {
    joinMidCheck();
    expect(svc.joinedMidCheck()).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe('{"round":5,"mid":true}');
  });

  it('SVC-MID-02: a round started after joining', () => {
    joinMidCheck();
    runRound(6);
    expect(svc.joinedMidCheck()).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBe('{"round":6,"mid":false}');
  });

  it('SVC-MID-03: a reload keeps what this tab saw', () => {
    sessionStorage.setItem(KEY, '{"round":5,"mid":false}');
    joinMidCheck();
    expect(svc.joinedMidCheck()).toBe(false);
  });

  it('SVC-MID-04: not checking resets the flag but not storage', () => {
    joinMidCheck();
    p.remote((d) =>
      session(d).set(
        'check',
        running(5, { outcome: { result: 'paused', at: T0, notConfident: {}, confident: [] } }),
      ),
    );
    expect(svc.joinedMidCheck()).toBe(false);
    expect(sessionStorage.getItem(KEY)).toBe('{"round":5,"mid":true}');
  });

  it('SVC-MID-05: storage failures are tolerated', () => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k) {
      if (this === sessionStorage) throw new Error('blocked');
      return getItem.call(this, k);
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
      if (this === sessionStorage) throw new Error('blocked');
      setItem.call(this, k, v);
    });
    join('ABC123', 'Ann', { synced: false });
    expect(() => runRound(5)).not.toThrow();
    expect(svc.joinedMidCheck()).toBe(true);
    // Without storage the first sighting is still remembered in memory, so the next session
    // update (here the post-sync defaults) keeps the hint within this tab.
    p.synced(true);
    expect(svc.joinedMidCheck()).toBe(true);
  });

  it('SVC-MID-06: corrupt storage is treated as unseen', () => {
    sessionStorage.setItem(KEY, '{');
    joinMidCheck();
    expect(svc.joinedMidCheck()).toBe(true);
    expect(sessionStorage.getItem(KEY)).toBe('{"round":5,"mid":true}');
  });

  it('SVC-MID-07: a stored record without mid gives false', () => {
    sessionStorage.setItem(KEY, '{"round":5}');
    joinMidCheck();
    expect(svc.joinedMidCheck()).toBe(false);
  });
});
