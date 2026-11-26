import { computed, signal } from '@angular/core';
import { vi } from 'vitest';
import type {
  CheckOutcome,
  CheckPhase,
  HistoryEntry,
  Player,
  RoomMode,
} from '../app/services/room.service';

/** Writable-signal stand-in for RoomService, for component tests. */
export function createRoomServiceStub() {
  const connected = signal(true);
  const serverReady = signal(true);
  return {
    phase: signal<'voting' | 'revealed'>('voting'),
    votes: signal<Record<string, string>>({}),
    uniquePlayers: signal<Player[]>([]),
    checkPlayers: signal<Player[]>([]),
    confidentCount: signal(0),
    checkPhase: signal<CheckPhase>('setup'),
    connected,
    serverReady,
    serverOutdated: signal(false),
    canRequestChecks: computed(() => connected() && serverReady()),
    storyName: signal(''),
    isObserver: signal(false),
    mode: signal<RoomMode>('points'),
    timerState: signal<'idle' | 'running' | 'paused'>('idle'),
    timerEndTime: signal<number | null>(null),
    timerRemainingOnPause: signal(0),
    timerDuration: signal(60),
    timerVisible: signal(false),
    checkStartedAt: signal<number | null>(null),
    checkOutcome: signal<CheckOutcome | null>(null),
    serverOffset: signal(0),
    myPeerId: signal('me'),
    itemUrl: signal(''),
    resolvedHistory: signal<HistoryEntry[]>([]),
    skipNotice: signal<string | null>(null),
    joinedMidCheck: signal(false),
    amConfident: signal(false),
    connect: vi.fn<(code: string, name: string) => void>(),
    disconnect: vi.fn<() => void>(),
    revealVotes: vi.fn<() => void>(),
    resetRound: vi.fn<() => void>(),
    newRound: vi.fn<() => void>(),
    resetTimer: vi.fn<() => void>(),
    pauseTimer: vi.fn<() => void>(),
    startTimer: vi.fn<() => void>(),
    adjustDuration: vi.fn<(delta: number) => void>(),
    updateHistoryStory: vi.fn<(timestamp: number, story: string) => void>(),
    deleteHistoryEntry: vi.fn<(timestamp: number) => void>(),
    toggleObserver: vi.fn<() => void>(),
    setMode: vi.fn<(mode: RoomMode) => void>(),
    startCheck: vi.fn<() => void>(),
    cancelCheck: vi.fn<() => void>(),
    skipItem: vi.fn<() => void>(),
    nextItem: vi.fn<() => void>(),
    setConfident: vi.fn<(confident: boolean) => void>(),
    updateStoryName: vi.fn<(name: string) => void>(),
    updateItemUrl: vi.fn<(url: string) => void>(),
  };
}

export type RoomServiceStub = ReturnType<typeof createRoomServiceStub>;
