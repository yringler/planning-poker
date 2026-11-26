import { TestBed } from '@angular/core/testing';
import type { TooltipItem, TooltipModel } from 'chart.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRoomServiceStub, type RoomServiceStub } from '../../../testing/room-service-stub';
import { RoomService, type HistoryEntry } from '../../services/room.service';
import { VotingDeviationChartComponent } from './voting-deviation-chart';

const T0 = 1_700_000_000_000;
let stub: RoomServiceStub;
let c: VotingDeviationChartComponent;

const R = (votes: Record<string, string>, players: Record<string, string>): HistoryEntry => ({
  story: 'S',
  timestamp: T0,
  votes,
  players,
});
/** Sets history given OLDEST first (the service stores newest first). */
const rounds = (...entries: HistoryEntry[]) => stub.resolvedHistory.set([...entries].reverse());
const dataset = (label: string) => c.chartData().datasets.find((d) => d.label === label)?.data;

beforeEach(() => {
  stub = createRoomServiceStub();
  TestBed.configureTestingModule({ providers: [{ provide: RoomService, useValue: stub }] });
  c = TestBed.runInInjectionContext(() => new VotingDeviationChartComponent());
});

describe('chartData', () => {
  const names = { p1: 'Ann', p2: 'Bob', p3: 'Cy' };

  it('CHART-01: confidence entries are left out', () => {
    stub.resolvedHistory.set([
      { ...R({}, {}), kind: 'confidence', result: 'confident' },
      R({ p1: '1' }, names),
    ]);
    expect(c.pointHistory()).toHaveLength(1);
  });

  it('CHART-02: z-scores per round, oldest first', () => {
    rounds(R({ p1: '3', p2: '5' }, names), R({ p1: '8', p2: '2' }, names));
    const data = c.chartData();
    expect(data.labels).toEqual(['1', '2']);
    expect(data.datasets.map((d) => d.label)).toEqual([
      'Ann',
      'Ann (avg |z|)',
      'Bob',
      'Bob (avg |z|)',
    ]);
    expect(dataset('Ann')).toEqual([-1, 1]);
    expect(dataset('Bob')).toEqual([1, -1]);
    expect(dataset('Ann (avg |z|)')).toEqual([1, 1]);
  });

  it('CHART-03: equal votes are 0', () => {
    rounds(R({ p1: '5', p2: '5' }, names), R({ p1: '5', p2: '5' }, names));
    for (const d of c.chartData().datasets) expect(d.data).toEqual([0, 0]);
  });

  it('CHART-04: non-numeric votes are null', () => {
    rounds(R({ p1: '?', p2: '3', p3: '5' }, names), R({ p1: '1', p2: '1', p3: '1' }, names));
    expect(dataset('Ann')?.[0]).toBeNull();
    expect(dataset('Bob')?.[0]).toBe(-1);
    expect(dataset('Cy')?.[0]).toBe(1);
  });

  it('CHART-05: missing rounds and the running mean of |z|', () => {
    rounds(R({ p2: '5' }, names), R({ p1: '1', p2: '3' }, names), R({ p1: '3', p2: '1' }, names));
    expect(dataset('Ann')).toEqual([null, -1, 1]);
    expect(dataset('Ann (avg |z|)')).toEqual([null, 1, 1]);
    expect(dataset('Bob')).toEqual([0, 1, -1]);
  });

  it('CHART-06: players are matched by name across peerIds', () => {
    rounds(
      R({ p1: '1', p2: '3' }, { p1: 'Ann', p2: 'Bob' }),
      R({ p7: '3', p2: '1' }, { p7: 'Ann', p2: 'Bob' }),
    );
    const ann = c.chartData().datasets.filter((d) => d.label === 'Ann');
    expect(ann).toHaveLength(1);
    expect(ann[0].data.filter((v) => v !== null)).toHaveLength(2);
  });

  it('CHART-07: rounds to 2 decimals', () => {
    rounds(R({ p1: '1', p2: '2', p3: '4' }, names));
    expect(dataset('Ann')).toEqual([-1.07]);
    expect(dataset('Bob')).toEqual([-0.27]);
    expect(dataset('Cy')).toEqual([1.34]);
  });

  it('CHART-08: toggles hide datasets', () => {
    rounds(R({ p1: '1', p2: '2' }, names));
    c.toggleZScores(false);
    expect(c.chartData().datasets.map((d) => d.label)).toEqual(['Ann (avg |z|)', 'Bob (avg |z|)']);
    c.toggleAvgAbsZ(false);
    expect(c.chartData().datasets).toEqual([]);
  });

  // Unnamed voters can't be followed across rounds, so they get no line of their own (their
  // votes still count towards each round's average and spread).
  it('CHART-09: unnamed voters get no dataset', () => {
    const players = { p1: 'Ann' };
    rounds(R({ p9: '5', p1: '3' }, players), R({ p9: '5', p1: '3' }, players));
    const allNull = c
      .chartData()
      .datasets.filter((d) => d.data.every((v) => v === null))
      .map((d) => d.label);
    expect(allNull).toEqual([]);
    expect(c.chartData().datasets.map((d) => d.label)).toEqual(['Ann', 'Ann (avg |z|)']);
  });

  it('CHART-10: colours wrap after 10 players', () => {
    const votes: Record<string, string> = {};
    const players: Record<string, string> = {};
    for (let i = 0; i < 11; i++) {
      votes[`p${i}`] = String(i);
      players[`p${i}`] = `Player ${i}`;
    }
    rounds(R(votes, players));
    const p10 = c.chartData().datasets.find((d) => d.label === 'Player 10');
    expect(p10?.borderColor).toBe('#2563eb');
  });
});

describe('chartOptions callbacks', () => {
  it('CHART-11: tooltip label', () => {
    const label = c.chartOptions.plugins!.tooltip!.callbacks!.label!;
    const call = (y: number | null, name: string) =>
      label.call(
        {} as TooltipModel<'line'>,
        { parsed: { y }, dataset: { label: name } } as unknown as TooltipItem<'line'>,
      );
    expect(call(null, 'Ann')).toBe('Ann: no vote');
    expect(call(1.234, 'Ann')).toBe('Ann: +1.23σ');
    expect(call(-0.5, 'Ann')).toBe('Ann: -0.50σ');
    expect(call(0, 'Ann')).toBe('Ann: 0.00σ');
    expect(call(0.5, 'Ann (avg |z|)')).toBe('Ann (avg |z|): 0.50σ');
  });

  it('CHART-12: y tick labels', () => {
    const ticks = c.chartOptions.scales?.['y']?.ticks as unknown as {
      callback: (value: number) => string;
    };
    expect(ticks.callback(2)).toBe('+2');
    expect(ticks.callback(0)).toBe('0');
    expect(ticks.callback(-1)).toBe('-1');
  });
});
