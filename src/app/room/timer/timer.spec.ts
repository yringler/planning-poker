import { ApplicationRef } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createRoomServiceStub, type RoomServiceStub } from '../../../testing/room-service-stub';
import { RoomService } from '../../services/room.service';
import { TimerComponent } from './timer';

const T0 = 1_700_000_000_000;
let stub: RoomServiceStub;
let tick: MockInstance<() => void>;

interface Inputs {
  endTime?: number | null;
  stoppedAt?: number | null;
  maxSeconds?: number;
}

function create(inputs: Inputs = {}): ComponentFixture<TimerComponent> {
  const fixture = TestBed.createComponent(TimerComponent);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  tick.mockClear();
  return fixture;
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval'] });
  stub = createRoomServiceStub();
  TestBed.configureTestingModule({ providers: [{ provide: RoomService, useValue: stub }] });
  tick = vi.spyOn(TestBed.inject(ApplicationRef), 'tick');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fixed countdown (confidence check)', () => {
  it('TIMER-01: shows the time to the end', () => {
    const c = create({ endTime: T0 + 60_000 }).componentInstance;
    expect(c.displayTime()).toBe('1:00');
    expect(c.isWarning()).toBe(false);
  });

  it('TIMER-02: rounds up and warns in the last 10 s', () => {
    const c = create({ endTime: T0 + 60_000 }).componentInstance;
    vi.setSystemTime(T0 + 50_001);
    vi.advanceTimersByTime(250);
    expect(c.displayTime()).toBe('0:10');
    expect(c.isWarning()).toBe(true);
  });

  it('TIMER-03: past the end shows 0:00 without warning', () => {
    const c = create({ endTime: T0 - 1 }).componentInstance;
    expect(c.displayTime()).toBe('0:00');
    expect(c.isWarning()).toBe(false);
  });

  it('TIMER-04: capped at maxSeconds', () => {
    expect(create({ endTime: T0 + 65_000, maxSeconds: 60 }).componentInstance.displayTime()).toBe(
      '1:00',
    );
  });

  it('TIMER-05: frozen at stoppedAt, with no interval', () => {
    const c = create({ endTime: T0 + 60_000, stoppedAt: T0 + 12_500 }).componentInstance;
    expect(c.displayTime()).toBe('0:48');
    vi.advanceTimersByTime(5000);
    expect(c.displayTime()).toBe('0:48');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('TIMER-06: ticks without forcing app change detection', () => {
    const c = create({ endTime: T0 + 60_000 }).componentInstance;
    vi.advanceTimersByTime(1000);
    expect(c.displayTime()).toBe('0:59');
    expect(tick).not.toHaveBeenCalled();
  });
});

describe('shared timer', () => {
  it('TIMER-07: idle shows the duration', () => {
    stub.timerDuration.set(90);
    expect(create().componentInstance.displayTime()).toBe('1:30');
  });

  // PIN: the display floors the seconds, but the warning uses the raw value, so 10.5 s
  // shows "0:10" without the warning
  it('TIMER-08: paused shows the remainder', () => {
    stub.timerState.set('paused');
    stub.timerRemainingOnPause.set(45.7);
    const c = create().componentInstance;
    expect(c.displayTime()).toBe('0:45');
    expect(c.isWarning()).toBe(false);
    stub.timerRemainingOnPause.set(9.5);
    vi.advanceTimersByTime(250);
    expect(c.displayTime()).toBe('0:09');
    expect(c.isWarning()).toBe(true);
    stub.timerRemainingOnPause.set(10.5);
    vi.advanceTimersByTime(250);
    expect(c.displayTime()).toBe('0:10');
    expect(c.isWarning()).toBe(false);
  });

  it('TIMER-09: running counts down and ticks the app', () => {
    stub.timerState.set('running');
    stub.timerEndTime.set(T0 + 30_000);
    const c = create().componentInstance;
    vi.advanceTimersByTime(20_500);
    expect(c.displayTime()).toBe('0:09');
    expect(c.isWarning()).toBe(true);
    expect(tick).toHaveBeenCalled();
  });

  function finish(): TimerComponent {
    stub.timerState.set('running');
    stub.timerEndTime.set(T0 + 1000);
    const c = create().componentInstance;
    vi.advanceTimersByTime(1250);
    return c;
  }

  it('TIMER-10: finishes at 0', () => {
    const c = finish();
    expect(c.displayTime()).toBe('0:00');
    expect(c.isFinished()).toBe(true);
  });

  it('TIMER-11: a restart by another client clears isFinished', () => {
    const c = finish();
    stub.timerEndTime.set(T0 + 1250 + 60_000);
    vi.advanceTimersByTime(250);
    expect(c.isFinished()).toBe(false);
    expect(['1:00', '0:59']).toContain(c.displayTime());
  });

  it('TIMER-12: reset clears isFinished and resets the room timer', () => {
    const c = finish();
    c.reset();
    expect(c.isFinished()).toBe(false);
    expect(stub.resetTimer).toHaveBeenCalled();
  });

  it('TIMER-13: switching inputs replaces the interval', () => {
    stub.timerDuration.set(90);
    const fixture = create({ endTime: T0 + 60_000 });
    expect(fixture.componentInstance.displayTime()).toBe('1:00');
    fixture.componentRef.setInput('endTime', null);
    fixture.detectChanges();
    expect(vi.getTimerCount()).toBe(1);
    expect(fixture.componentInstance.displayTime()).toBe('1:30');
  });
});
