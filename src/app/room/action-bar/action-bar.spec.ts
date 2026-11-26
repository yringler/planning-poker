import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoomServiceStub, type RoomServiceStub } from '../../../testing/room-service-stub';
import { RoomService } from '../../services/room.service';
import { ActionBarComponent } from './action-bar';

let stub: RoomServiceStub;
const create = () => TestBed.runInInjectionContext(() => new ActionBarComponent());

beforeEach(() => {
  stub = createRoomServiceStub();
  TestBed.configureTestingModule({ providers: [{ provide: RoomService, useValue: stub }] });
});

afterEach(() => vi.restoreAllMocks());

describe('ActionBarComponent', () => {
  const ann = { name: 'Ann', peerId: 'p1' };
  const bob = { name: 'Bob', peerId: 'p2' };

  it('AB-01: observers are not waited for', () => {
    stub.uniquePlayers.set([ann, { ...bob, observer: true }]);
    stub.votes.set({ p1: '5' });
    const c = create();
    expect(c.allVoted()).toBe(true);
    expect(c.statusMessage()).toBe('All votes in!');
  });

  it('AB-02: nobody to vote', () => {
    stub.uniquePlayers.set([{ ...ann, observer: true }]);
    const c = create();
    expect(c.allVoted()).toBe(false);
    expect(c.statusMessage()).toBe('Waiting for votes… (0/0)');
  });

  it('AB-03: progress', () => {
    stub.uniquePlayers.set([ann, bob]);
    stub.votes.set({ p1: '5' });
    expect(create().statusMessage()).toBe('Waiting for votes… (1/2)');
  });

  // PIN: an empty-string vote counts as voted (`!= null`)
  it('AB-04: an empty vote counts', () => {
    stub.uniquePlayers.set([ann]);
    stub.votes.set({ p1: '' });
    expect(create().allVoted()).toBe(true);
  });

  it('AB-05: reconnecting', () => {
    stub.connected.set(false);
    for (const phase of ['setup', 'checking', 'confident', 'paused'] as const) {
      stub.checkPhase.set(phase);
      expect(create().checkStatus()).toBe('Reconnecting…');
    }
  });

  it('AB-06: a status per check phase', () => {
    const status = () => create().checkStatus();
    stub.storyName.set('  ');
    expect(status()).toBe('Name the item to start.');
    stub.storyName.set('X');
    expect(status()).toBe('Ready to check.');
    stub.checkPhase.set('checking');
    expect(status()).toBe('Check in progress…');
    stub.checkPhase.set('confident');
    expect(status()).toBe('Item confirmed.');
    stub.checkPhase.set('paused');
    expect(status()).toBe('Restart when the discussion is done, or skip the item.');
  });

  it.each([
    [{ a: '3', b: '5' }, '4', 'Avg: 4'],
    [{ a: '1', b: '2' }, '1.5', 'Avg: 1.5'],
    [{ a: '1', b: '2', c: '2' }, '1.7', 'Avg: 1.7'],
    [{ a: '0' }, '0', 'Avg: 0'],
    [{ a: '?' }, null, 'No numeric votes'],
    [{}, null, 'No numeric votes'],
  ])('AB-07: average of %o', (votes, value, text) => {
    stub.votes.set(votes);
    const c = create();
    expect(c.averageValue()).toBe(value);
    expect(c.averageText()).toBe(text);
  });

  describe('revealAndCopy', () => {
    let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;

    beforeEach(() => {
      writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    });

    it('AB-08: reveals and copies the average', () => {
      stub.votes.set({ a: '3', b: '5' });
      create().revealAndCopy();
      expect(stub.revealVotes).toHaveBeenCalled();
      expect(writeText).toHaveBeenCalledWith('4');
    });

    it('AB-09: nothing to copy without numeric votes', () => {
      stub.votes.set({ a: '?' });
      create().revealAndCopy();
      expect(stub.revealVotes).toHaveBeenCalled();
      expect(writeText).not.toHaveBeenCalled();
    });

    it('AB-10: clipboard errors are logged', async () => {
      const err = new Error('denied');
      writeText.mockRejectedValue(err);
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      stub.votes.set({ a: '3' });
      create().revealAndCopy();
      await Promise.resolve();
      await Promise.resolve();
      expect(log).toHaveBeenCalledWith('Failed to copy final points', err);
    });
  });
});
