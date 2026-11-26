import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRoomServiceStub, type RoomServiceStub } from '../../../testing/room-service-stub';
import { RoomService, type HistoryEntry } from '../../services/room.service';
import { VotingHistoryComponent } from './voting-history';

const T0 = 1_700_000_000_000;
const SEP = '  ·  ';
let stub: RoomServiceStub;
let c: VotingHistoryComponent;

const entry = (o: Partial<HistoryEntry>): HistoryEntry => ({
  story: 'S',
  timestamp: T0,
  votes: {},
  players: {},
  kind: 'confidence',
  ...o,
});

beforeEach(() => {
  stub = createRoomServiceStub();
  TestBed.configureTestingModule({ providers: [{ provide: RoomService, useValue: stub }] });
  c = TestBed.runInInjectionContext(() => new VotingHistoryComponent());
});

describe('checkSummary', () => {
  it('VH-01: confident lists not-confident attempts', () => {
    const e = entry({
      result: 'confident',
      checks: 2,
      attempts: [{ check: 1, notConfident: ['Dana', 'Lee'] }],
    });
    expect(c.checkSummary(e)).toBe('Checks: 2' + SEP + 'Not confident on check 1: Dana, Lee');
  });

  it('VH-02: confident with empty attempts', () => {
    const e = entry({ result: 'confident', checks: 2, attempts: [{ check: 1, notConfident: [] }] });
    expect(c.checkSummary(e)).toBe('Checks: 2');
  });

  it('VH-03: skipped shows only the last check', () => {
    const e = entry({
      result: 'skipped',
      checks: 2,
      attempts: [
        { check: 1, notConfident: ['Dana'] },
        { check: 2, notConfident: ['Lee', 'Kim'] },
      ],
    });
    expect(c.checkSummary(e)).toBe('Checks: 2' + SEP + 'Last check: Lee, Kim');
  });

  it('VH-04: skipped without attempts', () => {
    expect(c.checkSummary(entry({ result: 'skipped', checks: 0, attempts: [] }))).toBe('Checks: 0');
  });

  it('VH-05: checks falls back to the attempt count', () => {
    const attempts = [1, 2, 3].map((check) => ({ check, notConfident: [] }));
    expect(c.checkSummary(entry({ result: 'confident', attempts }))).toMatch(/^Checks: 3/);
  });

  it('VH-06: no checks and no attempts', () => {
    expect(c.checkSummary(entry({ result: 'confident' }))).toBe('Checks: 0');
  });
});

describe('averages', () => {
  it.each([
    [{ a: '3', b: '5' }, '4'],
    [{ a: '1', b: '2' }, '1.5'],
    [{ a: '1', b: '2', c: '2' }, '1.7'],
    [{ a: '0' }, '0'],
    [{ a: '?' }, null],
    [{}, null],
  ])('VH-07: averageValue(%o)', (votes, value) => {
    expect(c.averageValue(votes)).toBe(value);
  });

  it('VH-07: calcAverage', () => {
    expect(c.calcAverage({ a: '3', b: '5' })).toBe('Avg: 4');
    expect(c.calcAverage({ a: '?' })).toBe('No numeric votes');
  });
});

describe('edit flow', () => {
  it('VH-08: saving trims and clears editing', () => {
    c.startEdit(T0, 'Old');
    expect(c.editingTimestamp()).toBe(T0);
    expect(c.editingValue()).toBe('Old');
    c.editingValue.set('  New ');
    c.saveEdit(T0);
    expect(stub.updateHistoryStory).toHaveBeenCalledWith(T0, 'New');
    expect(c.editingTimestamp()).toBeNull();
  });

  it('VH-09: cancel and delete', () => {
    c.startEdit(T0, 'Old');
    c.cancelEdit();
    expect(c.editingTimestamp()).toBeNull();
    c.deleteEntry(T0);
    expect(stub.deleteHistoryEntry).toHaveBeenCalledWith(T0);
  });
});
