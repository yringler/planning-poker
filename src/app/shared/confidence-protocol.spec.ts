import { describe, expect, it } from 'vitest';
import {
  checkPhase,
  normaliseCheck,
  parseClientMessage,
  type CheckState,
} from './confidence-protocol';

const T0 = 1_700_000_000_000;
const json = (v: unknown) => JSON.stringify(v);

describe('parseClientMessage', () => {
  it('PROTO-PARSE-01: invalid JSON', () => {
    expect(parseClientMessage('not json')).toBeNull();
  });

  it('PROTO-PARSE-02: JSON that is not an object', () => {
    for (const raw of ['null', '42', '"hello"', 'true']) expect(parseClientMessage(raw)).toBeNull();
  });

  it('PROTO-PARSE-03: arrays', () => {
    expect(parseClientMessage('[{"type":"hello","clientId":1}]')).toBeNull();
  });

  it('PROTO-PARSE-04: hello', () => {
    expect(parseClientMessage('{"type":"hello","clientId":42}')).toEqual({
      type: 'hello',
      clientId: 42,
    });
  });

  it('PROTO-PARSE-05: hello without a numeric clientId', () => {
    expect(parseClientMessage(json({ type: 'hello', clientId: '42' }))).toBeNull();
    expect(parseClientMessage(json({ type: 'hello' }))).toBeNull();
    expect(parseClientMessage(json({ type: 'hello', clientId: null }))).toBeNull();
  });

  it('PROTO-PARSE-06: hello with a clientId that parses to Infinity', () => {
    expect(parseClientMessage('{"type":"hello","clientId":1e400}')).toBeNull();
  });

  it('PROTO-PARSE-07: hello skips the round check', () => {
    expect(parseClientMessage('{"type":"hello","clientId":7,"round":"x"}')).toEqual({
      type: 'hello',
      clientId: 7,
    });
  });

  // PIN: awareness ids are uint32, but fractional / negative clientIds are accepted
  it('PROTO-PARSE-08: fractional and negative clientIds are accepted', () => {
    expect(parseClientMessage(json({ type: 'hello', clientId: 1.5 }))).toEqual({
      type: 'hello',
      clientId: 1.5,
    });
    expect(parseClientMessage(json({ type: 'hello', clientId: -1 }))).toEqual({
      type: 'hello',
      clientId: -1,
    });
  });

  it('PROTO-PARSE-09: every check action', () => {
    for (const action of ['start', 'cancel', 'skip', 'next']) {
      expect(parseClientMessage(json({ type: 'check', action, round: 3 }))).toEqual({
        type: 'check',
        action,
        round: 3,
      });
    }
  });

  it('PROTO-PARSE-10: unknown or missing action', () => {
    expect(parseClientMessage(json({ type: 'check', action: 'explode', round: 3 }))).toBeNull();
    expect(parseClientMessage(json({ type: 'check', round: 3 }))).toBeNull();
  });

  it('PROTO-PARSE-11: missing or non-finite round', () => {
    expect(parseClientMessage(json({ type: 'check', action: 'start' }))).toBeNull();
    expect(parseClientMessage(json({ type: 'check', action: 'start', round: '3' }))).toBeNull();
    expect(parseClientMessage('{"type":"check","action":"start","round":1e400}')).toBeNull();
    expect(parseClientMessage(json({ type: 'check', action: 'start', round: null }))).toBeNull();
  });

  it('PROTO-PARSE-12: mode', () => {
    expect(parseClientMessage(json({ type: 'mode', mode: 'points', round: 0 }))).toEqual({
      type: 'mode',
      mode: 'points',
      round: 0,
    });
    expect(parseClientMessage(json({ type: 'mode', mode: 'confidence', round: 0 }))).toEqual({
      type: 'mode',
      mode: 'confidence',
      round: 0,
    });
  });

  it('PROTO-PARSE-13: unknown mode', () => {
    expect(parseClientMessage(json({ type: 'mode', mode: 'chaos', round: 0 }))).toBeNull();
  });

  it('PROTO-PARSE-14: unknown or missing type', () => {
    expect(parseClientMessage(json({ type: 'time', now: 1, round: 0 }))).toBeNull();
    expect(parseClientMessage(json({ round: 0 }))).toBeNull();
  });

  it('PROTO-PARSE-15: extra keys are dropped', () => {
    const raw = '{"type":"check","action":"next","round":2,"evil":true,"__proto__":{}}';
    const msg = parseClientMessage(raw);
    expect(msg).toEqual({ type: 'check', action: 'next', round: 2 });
    expect(Object.keys(msg ?? {})).toEqual(['type', 'action', 'round']);
  });
});

describe('normaliseCheck', () => {
  const DEFAULT: CheckState = {
    itemId: '',
    round: 0,
    startedAt: null,
    outcome: null,
    checks: 0,
    log: [],
  };
  const VALID: CheckState = {
    itemId: 'item-1',
    round: 6,
    startedAt: T0 - 120_000,
    outcome: { result: 'paused', at: T0 - 60_000, notConfident: { p2: 'Bob' }, confident: ['p1'] },
    checks: 2,
    log: [
      { check: 1, notConfident: ['Bob'] },
      { check: 2, notConfident: ['Bob', 'Cy'] },
    ],
  };

  it('PROTO-NORM-01: non-records give the default', () => {
    for (const v of [undefined, null, 'x', 42, []]) expect(normaliseCheck(v)).toEqual(DEFAULT);
  });

  it('PROTO-NORM-02: a valid check round-trips as a copy', () => {
    const result = normaliseCheck(VALID);
    expect(result).toEqual(VALID);
    expect(result).not.toBe(VALID);
  });

  it('PROTO-NORM-03: wrong field types give defaults', () => {
    expect(normaliseCheck({ itemId: 123, round: NaN, startedAt: Infinity, checks: '3' })).toEqual(
      DEFAULT,
    );
  });

  it('PROTO-NORM-04: startedAt 0 is kept', () => {
    expect(normaliseCheck({ round: 5, startedAt: 0 })).toMatchObject({ round: 5, startedAt: 0 });
  });

  it('PROTO-NORM-05: an invalid outcome becomes null', () => {
    for (const outcome of [{ result: 'bogus', at: 1 }, [], 'paused']) {
      expect(normaliseCheck({ outcome }).outcome).toBeNull();
    }
  });

  it('PROTO-NORM-06: a partial outcome is filled in', () => {
    expect(normaliseCheck({ outcome: { result: 'paused' } }).outcome).toEqual({
      result: 'paused',
      at: 0,
      notConfident: {},
      confident: [],
    });
  });

  it('PROTO-NORM-07: non-string notConfident names are dropped', () => {
    const v = { outcome: { result: 'paused', notConfident: { a: 'Ann', b: 5, c: null } } };
    expect(normaliseCheck(v).outcome?.notConfident).toEqual({ a: 'Ann' });
  });

  it('PROTO-NORM-08: an array notConfident becomes {}', () => {
    const v = { outcome: { result: 'confident', notConfident: ['Ann'] } };
    expect(normaliseCheck(v).outcome?.notConfident).toEqual({});
  });

  it('PROTO-NORM-09: confident keeps only strings', () => {
    const mixed = { outcome: { result: 'confident', confident: ['p1', 2, null, 'p2'] } };
    expect(normaliseCheck(mixed).outcome?.confident).toEqual(['p1', 'p2']);
    const str = { outcome: { result: 'confident', confident: 'p1' } };
    expect(normaliseCheck(str).outcome?.confident).toEqual([]);
  });

  it('PROTO-NORM-10: log keeps only record entries, normalised', () => {
    const v = { log: [{ check: 1, notConfident: ['Ann', 3] }, 'x', null, [1], { check: '2' }] };
    expect(normaliseCheck(v).log).toEqual([
      { check: 1, notConfident: ['Ann'] },
      { check: 0, notConfident: [] },
    ]);
  });

  it('PROTO-NORM-11: a non-array log becomes []', () => {
    expect(normaliseCheck({ log: {} }).log).toEqual([]);
  });

  it('PROTO-NORM-12: deep-frozen input does not throw', () => {
    const freeze = <T>(o: T): T => {
      if (o && typeof o === 'object') {
        Object.values(o).forEach(freeze);
        Object.freeze(o);
      }
      return o;
    };
    const frozen = freeze(structuredClone(VALID));
    expect(() => normaliseCheck(frozen)).not.toThrow();
  });
});

describe('checkPhase', () => {
  const C = (o: Partial<CheckState> = {}): CheckState => ({
    itemId: 'i',
    round: 1,
    startedAt: T0,
    outcome: null,
    checks: 1,
    log: [],
    ...o,
  });
  const outcome = (result: 'confident' | 'paused') => ({
    result,
    at: 0,
    notConfident: {},
    confident: [],
  });

  it('PROTO-PHASE-01: points mode is always setup', () => {
    expect(checkPhase('points', C())).toBe('setup');
    expect(checkPhase('points', C({ outcome: outcome('confident') }))).toBe('setup');
  });

  it('PROTO-PHASE-02: no check is setup', () => {
    expect(checkPhase('confidence', null)).toBe('setup');
    expect(checkPhase('confidence', undefined)).toBe('setup');
  });

  it('PROTO-PHASE-03: not started is setup even with an outcome', () => {
    expect(checkPhase('confidence', C({ startedAt: null, outcome: outcome('paused') }))).toBe(
      'setup',
    );
  });

  it('PROTO-PHASE-04: started without an outcome is checking', () => {
    expect(checkPhase('confidence', C())).toBe('checking');
    expect(checkPhase('confidence', C({ startedAt: 0 }))).toBe('checking');
  });

  it('PROTO-PHASE-05: the outcome result is the phase', () => {
    expect(checkPhase('confidence', C({ outcome: outcome('confident') }))).toBe('confident');
    expect(checkPhase('confidence', C({ outcome: outcome('paused') }))).toBe('paused');
  });

  // PIN: an unnormalised bogus result passes straight through; callers must normalise first
  it('PROTO-PHASE-06: a bogus outcome result is returned as is', () => {
    const bogus = C({ outcome: { result: 'bogus' } as unknown as CheckState['outcome'] });
    expect(checkPhase('confidence', bogus)).toBe('bogus');
  });
});
