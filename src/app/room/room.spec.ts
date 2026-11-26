import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createRoomServiceStub, type RoomServiceStub } from '../../testing/room-service-stub';
import { RoomService } from '../services/room.service';
import { RoomComponent } from './room';

let stub: RoomServiceStub;
let fire: MockInstance<() => void>;

function create(): RoomComponent {
  return TestBed.runInInjectionContext(() => new RoomComponent());
}

beforeEach(() => {
  localStorage.clear();
  stub = createRoomServiceStub();
  fire = vi
    .spyOn(RoomComponent.prototype as unknown as { fireConfetti(): void }, 'fireConfetti')
    .mockImplementation(() => undefined);
  TestBed.configureTestingModule({
    providers: [
      { provide: RoomService, useValue: stub },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: convertToParamMap({ code: 'ABC123' }) } },
      },
    ],
  });
});

afterEach(() => vi.restoreAllMocks());

describe('hasConsensus', () => {
  const consensus = (votes: Record<string, string>, phase: 'voting' | 'revealed' = 'revealed') => {
    stub.phase.set(phase);
    stub.votes.set(votes);
    return create().hasConsensus();
  };

  it('ROOM-CONS-01: not while voting', () => {
    expect(consensus({ p1: '5', p2: '5' }, 'voting')).toBe(false);
  });
  it('ROOM-CONS-02: equal votes', () => {
    expect(consensus({ p1: '5', p2: '5' })).toBe(true);
  });
  it('ROOM-CONS-03: needs two votes', () => {
    expect(consensus({ p1: '5' })).toBe(false);
  });
  it('ROOM-CONS-04: different votes', () => {
    expect(consensus({ p1: '5', p2: '8' })).toBe(false);
  });
  it('ROOM-CONS-05: ignores ?', () => {
    expect(consensus({ p1: '5', p2: '5', p3: '?' })).toBe(true);
  });
  it('ROOM-CONS-06: only ? votes', () => {
    expect(consensus({ p1: '?', p2: '?' })).toBe(false);
  });
  it("ROOM-CONS-07: ignores observers' votes", () => {
    stub.uniquePlayers.set([
      { name: 'Ann', peerId: 'p1' },
      { name: 'Bob', peerId: 'p2', observer: true },
      { name: 'Cy', peerId: 'p3' },
    ]);
    expect(consensus({ p1: '5', p2: '8', p3: '5' })).toBe(true);
  });
  it('ROOM-CONS-08: departed votes count', () => {
    stub.uniquePlayers.set([{ name: 'Ann', peerId: 'p1' }]);
    expect(consensus({ p1: '5', p9: '8' })).toBe(false);
  });
});

describe('confetti effects', () => {
  it('ROOM-EFF-01: fires when a watched check becomes confident', () => {
    stub.checkPhase.set('checking');
    create();
    TestBed.tick();
    stub.checkPhase.set('confident');
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('ROOM-EFF-02: not for a check that was already confident on load', () => {
    stub.checkPhase.set('confident');
    create();
    TestBed.tick();
    expect(fire).not.toHaveBeenCalled();
  });

  it('ROOM-EFF-03: only checking → confident fires', () => {
    create();
    TestBed.tick();
    stub.checkPhase.set('confident');
    TestBed.tick();
    stub.checkPhase.set('paused');
    TestBed.tick();
    stub.checkPhase.set('confident');
    TestBed.tick();
    expect(fire).not.toHaveBeenCalled();
  });

  it('ROOM-EFF-04: consensus fires once per reveal', () => {
    stub.phase.set('revealed');
    stub.votes.set({ p1: '5', p2: '8' });
    create();
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(0);
    stub.votes.set({ p1: '5', p2: '5' });
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    stub.votes.set({ p1: '5', p2: '5' });
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    stub.phase.set('voting');
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    stub.phase.set('revealed');
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(2);
  });

  // PIN: unlike the confidence effect, consensus confetti also fires on load/join
  it('ROOM-EFF-05: consensus confetti fires on load', () => {
    stub.phase.set('revealed');
    stub.votes.set({ p1: '5', p2: '5' });
    create();
    TestBed.tick();
    expect(fire).toHaveBeenCalledTimes(1);
  });
});

describe('init / name prompt', () => {
  it('ROOM-INIT-01: connects with the saved name', () => {
    localStorage.setItem('pp-name', 'Ann');
    const c = create();
    c.ngOnInit();
    expect(stub.connect).toHaveBeenCalledWith('ABC123', 'Ann');
    expect(c.awaitingName()).toBe(false);
  });

  it('ROOM-INIT-02: asks for a name first', () => {
    const c = create();
    c.ngOnInit();
    expect(c.awaitingName()).toBe(true);
    expect(stub.connect).not.toHaveBeenCalled();
  });

  it('ROOM-INIT-03: submitting a name saves it trimmed and connects', () => {
    const c = create();
    c.ngOnInit();
    c.pendingName = '  Bob ';
    c.submitName();
    expect(localStorage.getItem('pp-name')).toBe('Bob');
    expect(stub.connect).toHaveBeenCalledWith('ABC123', 'Bob');
    expect(c.awaitingName()).toBe(false);
  });

  it('ROOM-INIT-04: a blank name does nothing', () => {
    const c = create();
    c.ngOnInit();
    c.pendingName = '   ';
    c.submitName();
    expect(localStorage.getItem('pp-name')).toBeNull();
    expect(stub.connect).not.toHaveBeenCalled();
    expect(c.awaitingName()).toBe(true);
  });

  it('ROOM-INIT-05: disconnects on destroy', () => {
    create().ngOnDestroy();
    expect(stub.disconnect).toHaveBeenCalled();
  });
});
