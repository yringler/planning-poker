// Computed signals only. The confidence-check buttons (start / cancel / skip / next /
// confident) are deliberately not covered here: a separate follow-up owns that flow.
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRoomServiceStub, type RoomServiceStub } from '../../../testing/room-service-stub';
import { RoomService, type CheckOutcome, type Player } from '../../services/room.service';
import { normaliseCheck } from '../../shared/confidence-protocol';
import { ConfidenceCheckComponent } from './confidence-check';

const T0 = 1_700_000_000_000;
let stub: RoomServiceStub;
let c: ConfidenceCheckComponent;

const players = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i}`, peerId: `p${i}` }));
const outcome = (o: Partial<CheckOutcome>): CheckOutcome => ({
  result: 'paused',
  at: T0,
  notConfident: {},
  confident: [],
  ...o,
});

beforeEach(() => {
  stub = createRoomServiceStub();
  TestBed.configureTestingModule({ providers: [{ provide: RoomService, useValue: stub }] });
  c = TestBed.runInInjectionContext(() => new ConfidenceCheckComponent());
});

describe('ConfidenceCheckComponent', () => {
  it('CC-01: percent and total', () => {
    stub.confidentCount.set(2);
    expect(c.percent()).toBe(0);
    expect(c.total()).toBe(0);
    stub.checkPlayers.set(players(3));
    expect(c.percent()).toBe(67);
    expect(c.total()).toBe(3);
  });

  it('CC-02: endTime converts the server deadline to the local clock', () => {
    stub.checkStartedAt.set(T0);
    stub.serverOffset.set(2000);
    expect(c.endTime()).toBe(T0 + 58_000);
    stub.checkStartedAt.set(null);
    expect(c.endTime()).toBeNull();
  });

  it('CC-03: stoppedAt converts the outcome time', () => {
    stub.serverOffset.set(-1000);
    stub.checkOutcome.set(outcome({ at: T0 + 30_000 }));
    expect(c.stoppedAt()).toBe(T0 + 31_000);
    stub.checkOutcome.set(null);
    expect(c.stoppedAt()).toBeNull();
    stub.checkOutcome.set(outcome({ at: 0 }));
    expect(c.stoppedAt()).toBe(1000);
  });

  it('CC-04: not-confident list and totals', () => {
    stub.checkOutcome.set(outcome({ notConfident: { p1: 'Ann', p2: 'Bob' }, confident: ['p3'] }));
    expect(c.notConfident()).toEqual([
      { peerId: 'p1', name: 'Ann' },
      { peerId: 'p2', name: 'Bob' },
    ]);
    expect(c.outcomeConfident()).toBe(1);
    expect(c.outcomeTotal()).toBe(3);
  });

  it('CC-05: iWasNotConfident', () => {
    stub.checkOutcome.set(outcome({ notConfident: { p1: 'Ann', p2: 'Bob' }, confident: ['p3'] }));
    stub.myPeerId.set('p2');
    expect(c.iWasNotConfident()).toBe(true);
    stub.myPeerId.set('p3');
    expect(c.iWasNotConfident()).toBe(false);
  });

  // RoomService passes session.check through normaliseCheck, so a stored outcome missing
  // notConfident reaches the component with an empty one.
  it('CC-06: an outcome stored without notConfident does not throw', () => {
    stub.checkOutcome.set(normaliseCheck({ startedAt: 0, outcome: { result: 'paused' } }).outcome);
    expect(c.notConfident()).toEqual([]);
    expect(c.iWasNotConfident()).toBe(false);
  });

  it('CC-07: ticket link', () => {
    stub.itemUrl.set('javascript:x');
    expect(c.ticket()).toBeNull();
    stub.itemUrl.set('https://a.io/1');
    expect(c.ticket()).toEqual({ href: 'https://a.io/1', host: 'a.io' });
  });
});
