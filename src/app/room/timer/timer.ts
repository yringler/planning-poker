import {
  ApplicationRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-timer',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <wa-card appearance="filled">
      <div
        class="wa-flank"
        style="align-items: center; flex-wrap: wrap; gap: var(--wa-space-s)"
      >
        <span class="timer-display" [class.warning]="isWarning()">{{ displayTime() }}</span>
        <div slot="end" class="wa-cluster wa-gap-xs">
          @if (room.timerState() === 'idle') {
            <wa-button size="small" variant="neutral" appearance="outlined" (click)="room.adjustDuration(-60)">
              −1m
            </wa-button>
            <wa-button size="small" variant="neutral" appearance="outlined" (click)="room.adjustDuration(60)">
              +1m
            </wa-button>
            <wa-button size="small" variant="brand" appearance="filled" (click)="room.startTimer()">
              <wa-icon slot="start" name="play"></wa-icon>
              Start
            </wa-button>
          } @else if (room.timerState() === 'running') {
            @if (isFinished()) {
              <wa-button size="small" variant="neutral" appearance="outlined" (click)="reset()">
                <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
                Reset
              </wa-button>
            } @else {
              <wa-button size="small" variant="neutral" appearance="outlined" (click)="room.pauseTimer()">
                <wa-icon slot="start" name="pause"></wa-icon>
                Pause
              </wa-button>
              <wa-button size="small" variant="neutral" appearance="outlined" (click)="room.resetTimer()">
                <wa-icon slot="start" name="stop"></wa-icon>
                Stop
              </wa-button>
            }
          } @else {
            <wa-button size="small" variant="brand" appearance="filled" (click)="room.startTimer()">
              <wa-icon slot="start" name="play"></wa-icon>
              Resume
            </wa-button>
            <wa-button size="small" variant="neutral" appearance="outlined" (click)="room.resetTimer()">
              <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
              Reset
            </wa-button>
          }
        </div>
      </div>
    </wa-card>
  `,
  styles: `
    wa-card {
      --spacing: var(--wa-space-m) var(--wa-space-l);
    }

    .timer-display {
      font-family: monospace;
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--wa-color-neutral-on-quiet);
      min-width: 4ch;
    }

    .timer-display.warning {
      color: var(--wa-color-danger-fill-loud);
    }
  `,
})
export class TimerComponent {
  readonly room = inject(RoomService);
  private destroyRef = inject(DestroyRef);
  private appRef = inject(ApplicationRef);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  readonly displayTime = signal('1:00');
  readonly isWarning = signal(false);
  readonly isFinished = signal(false);

  constructor() {
    this.startTicking();
    this.destroyRef.onDestroy(() => this.stopTicking());
  }

  private startTicking(): void {
    this.update();
    this.intervalId = setInterval(() => {
      this.update();
      this.appRef.tick();
    }, 250);
  }

  private stopTicking(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private update(): void {
    const state = this.room.timerState();
    const endTime = this.room.timerEndTime();

    if (state === 'running' && endTime) {
      const remaining = Math.max(0, (endTime - Date.now()) / 1000);
      this.formatTime(remaining);
      if (remaining <= 0) {
        this.formatTime(0);
        this.isFinished.set(true);
      }
    } else if (state === 'paused') {
      this.formatTime(this.room.timerRemainingOnPause());
    } else {
      this.formatTime(this.room.timerDuration());
    }
  }

  reset(): void {
    this.isFinished.set(false);
    this.room.resetTimer();
  }

  private formatTime(seconds: number): void {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this.displayTime.set(`${m}:${s.toString().padStart(2, '0')}`);
    this.isWarning.set(seconds > 0 && seconds <= 10);
  }
}
