import {
  ApplicationRef,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  effect,
  inject,
  input,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-timer',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <wa-card appearance="filled">
      <div class="wa-flank" style="align-items: center; flex-wrap: wrap; gap: var(--wa-space-s)">
        <span class="timer-display" [class.warning]="isWarning()">{{ displayTime() }}</span>
        <ng-content />
        @if (isObserver() && endTime() == null) {
          <div slot="end" class="wa-cluster wa-gap-xs">
            @if (room.timerState() === 'idle') {
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(-60)"
              >
                −1m
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(-30)"
              >
                −30s
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(30)"
              >
                +30s
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(60)"
              >
                +1m
              </wa-button>
              <wa-button
                size="small"
                variant="brand"
                appearance="filled"
                (click)="room.startTimer()"
              >
                <wa-icon slot="start" name="play"></wa-icon>
                Start
              </wa-button>
            } @else if (room.timerState() === 'running') {
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(-60)"
              >
                −1m
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(-30)"
              >
                −30s
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(30)"
              >
                +30s
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.adjustDuration(60)"
              >
                +1m
              </wa-button>
              @if (isFinished()) {
                <wa-button size="small" variant="neutral" appearance="outlined" (click)="reset()">
                  <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
                  Reset
                </wa-button>
              } @else {
                <wa-button
                  size="small"
                  variant="neutral"
                  appearance="outlined"
                  (click)="room.pauseTimer()"
                >
                  <wa-icon slot="start" name="pause"></wa-icon>
                  Pause
                </wa-button>
                <wa-button
                  size="small"
                  variant="neutral"
                  appearance="outlined"
                  (click)="room.resetTimer()"
                >
                  <wa-icon slot="start" name="stop"></wa-icon>
                  Stop
                </wa-button>
              }
            } @else {
              <wa-button
                size="small"
                variant="brand"
                appearance="filled"
                (click)="room.startTimer()"
              >
                <wa-icon slot="start" name="play"></wa-icon>
                Resume
              </wa-button>
              <wa-button
                size="small"
                variant="neutral"
                appearance="outlined"
                (click)="room.resetTimer()"
              >
                <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
                Reset
              </wa-button>
            }
          </div>
        }
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
export class TimerComponent implements OnInit {
  readonly isObserver = input(false);
  /**
   * Fixed countdown mode (confidence check): counts down to this local-clock timestamp, with
   * no controls. When unset, the timer shows the room's shared point-voting timer.
   */
  readonly endTime = input<number | null>(null);
  /** With `endTime`: freeze the display at the time remaining at this moment. */
  readonly stoppedAt = input<number | null>(null);
  /** With `endTime`: never show more than this (guards against clock-offset error). */
  readonly maxSeconds = input(Infinity);
  readonly room = inject(RoomService);
  private appRef = inject(ApplicationRef);

  readonly displayTime = signal('1:00');
  readonly isWarning = signal(false);
  readonly isFinished = signal(false);

  constructor() {
    // (Re)start ticking when the inputs change; a frozen fixed countdown doesn't tick at all.
    effect((onCleanup) => {
      const fixed = this.endTime() != null;
      const frozen = fixed && this.stoppedAt() != null;
      untracked(() => this.update());
      if (frozen) return;
      const id = setInterval(() => {
        this.update();
        // Fixed mode only sets signals, which schedule change detection on their own
        if (!fixed) this.appRef.tick();
      }, 250);
      onCleanup(() => clearInterval(id));
    });
  }

  ngOnInit(): void {
    // Inputs are set by now: render the right value on the first frame
    this.update();
  }

  private update(): void {
    const fixedEnd = this.endTime();
    if (fixedEnd != null) {
      const now = this.stoppedAt() ?? Date.now();
      const remaining = Math.ceil((fixedEnd - now) / 1000);
      this.formatTime(Math.min(this.maxSeconds(), Math.max(0, remaining)));
      return;
    }
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
