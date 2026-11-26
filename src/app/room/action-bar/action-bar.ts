import { Component, computed, inject, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-action-bar',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <wa-card appearance="filled">
      <div class="wa-flank" style="align-items: center; flex-wrap: wrap; gap: var(--wa-space-s)">
        @if (room.mode() === 'confidence') {
          <span class="status-text">{{ checkStatus() }}</span>
          <div slot="end" class="wa-cluster wa-gap-s">
            @switch (room.checkPhase()) {
              @case ('setup') {
                <wa-button
                  variant="brand"
                  appearance="filled"
                  [attr.disabled]="!room.storyName().trim() || !room.connected() ? '' : null"
                  (click)="room.startCheck()"
                >
                  <wa-icon slot="start" name="play"></wa-icon>
                  Start check
                </wa-button>
              }
              @case ('checking') {
                <wa-button
                  variant="neutral"
                  appearance="outlined"
                  [attr.disabled]="room.connected() ? null : ''"
                  (click)="room.cancelCheck()"
                >
                  <wa-icon slot="start" name="xmark"></wa-icon>
                  Cancel check
                </wa-button>
              }
              @case ('confident') {
                <wa-button
                  variant="brand"
                  appearance="filled"
                  [attr.disabled]="room.connected() ? null : ''"
                  (click)="room.nextItem()"
                >
                  <wa-icon slot="start" name="plus"></wa-icon>
                  Next item
                </wa-button>
              }
              @case ('paused') {
                <wa-button
                  variant="brand"
                  appearance="filled"
                  [attr.disabled]="room.connected() ? null : ''"
                  (click)="room.startCheck()"
                >
                  <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
                  Restart check
                </wa-button>
                <wa-button
                  variant="neutral"
                  appearance="outlined"
                  [attr.disabled]="room.connected() ? null : ''"
                  (click)="room.skipItem()"
                >
                  <wa-icon slot="start" name="forward"></wa-icon>
                  Skip item
                </wa-button>
              }
            }
            <wa-button
              variant="neutral"
              [attr.appearance]="room.isObserver() ? 'filled' : 'outlined'"
              (click)="room.toggleObserver()"
            >
              <wa-icon slot="start" name="eye-slash"></wa-icon>
              {{ room.isObserver() ? 'Observing' : 'Observe' }}
            </wa-button>
          </div>
        } @else if (room.phase() === 'revealed') {
          <div class="average-display">
            <wa-icon name="chart-bar"></wa-icon>
            <span class="average-value">{{ averageText() }}</span>
            @if (averageValue() !== null) {
              <wa-copy-button
                [attr.value]="averageValue()"
                copy-label="Copy final points"
                success-label="Copied!"
              ></wa-copy-button>
            }
          </div>
          <div slot="end" class="wa-cluster wa-gap-s">
            <wa-button variant="brand" appearance="filled" (click)="room.newRound()">
              <wa-icon slot="start" name="plus"></wa-icon>
              New Round
            </wa-button>
            <wa-button variant="neutral" appearance="outlined" (click)="room.resetRound()">
              <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
              Reset
            </wa-button>
          </div>
        } @else {
          <span class="status-text">
            @if (allVoted()) {
              <wa-icon name="circle-check" style="color: var(--wa-color-success-fill-loud)"></wa-icon>
            }
            {{ statusMessage() }}
          </span>
          <div slot="end" class="wa-cluster wa-gap-s">
            <wa-button
              variant="brand"
              appearance="filled"
              (click)="revealAndCopy()"
            >
              <wa-icon slot="start" name="eye"></wa-icon>
              Reveal Votes
            </wa-button>
            <wa-button variant="neutral" appearance="outlined" (click)="room.resetRound()">
              <wa-icon slot="start" name="arrow-rotate-left"></wa-icon>
              Reset
            </wa-button>
            <wa-button
              variant="neutral"
              [attr.appearance]="room.isObserver() ? 'filled' : 'outlined'"
              (click)="room.toggleObserver()"
            >
              <wa-icon slot="start" name="eye-slash"></wa-icon>
              {{ room.isObserver() ? 'Observing' : 'Observe' }}
            </wa-button>
          </div>
        }
      </div>
    </wa-card>
  `,
  styles: `
    wa-card {
      --spacing: var(--wa-space-m) var(--wa-space-l);
    }

    .status-text {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      color: var(--wa-color-neutral-on-quiet);
      font-size: 0.95rem;
    }

    .average-display {
      display: flex;
      align-items: center;
      gap: var(--wa-space-xs);
      color: var(--wa-color-neutral-on-quiet);
    }

    .average-value {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--wa-color-brand-fill-loud);
    }
  `,
})
export class ActionBarComponent {
  readonly room = inject(RoomService);

  readonly voteCount = computed(() => Object.keys(this.room.votes()).length);

  readonly voters = computed(() => this.room.uniquePlayers().filter((p) => !p.observer));

  readonly allVoted = computed(() => {
    const voters = this.voters();
    const votes = this.room.votes();
    return voters.length > 0 && voters.every((p) => votes[p.peerId] != null);
  });

  readonly statusMessage = computed(() => {
    if (this.allVoted()) {
      return 'All votes in!';
    }
    return `Waiting for votes… (${this.voteCount()}/${this.voters().length})`;
  });

  readonly checkStatus = computed(() => {
    if (!this.room.connected()) return 'Reconnecting…';
    switch (this.room.checkPhase()) {
      case 'setup':
        return this.room.storyName().trim() ? 'Ready to check.' : 'Name the item to start.';
      case 'checking':
        return 'Check in progress…';
      case 'confident':
        return 'Item confirmed.';
      case 'paused':
        return 'Restart when the discussion is done, or skip the item.';
    }
  });

  /** Final points for the revealed round (formatted average), or null if no numeric votes. */
  readonly averageValue = computed(() => {
    const numericVotes = Object.values(this.room.votes())
      .map((v) => parseFloat(v))
      .filter((v) => !isNaN(v));
    if (numericVotes.length === 0) return null;
    const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
    return avg % 1 === 0 ? avg.toString() : avg.toFixed(1);
  });

  readonly averageText = computed(() => {
    const value = this.averageValue();
    return value === null ? 'No numeric votes' : `Avg: ${value}`;
  });

  /** Reveals votes and copies the final points (average) to the clipboard. */
  revealAndCopy(): void {
    const value = this.averageValue();
    this.room.revealVotes();
    if (value === null) return;
    navigator.clipboard
      .writeText(value)
      .catch((err: unknown) => console.error('Failed to copy final points', err));
  }
}
