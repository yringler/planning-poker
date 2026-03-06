import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  effect,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import confetti from 'canvas-confetti';
import { RoomService } from '../services/room.service';
import { SessionHeaderComponent } from './session-header/session-header';
import { CardGridComponent } from './card-grid/card-grid';
import { ParticipantsListComponent } from './participants-list/participants-list';
import { ActionBarComponent } from './action-bar/action-bar';
import { VotingHistoryComponent } from './voting-history/voting-history';
import { VotingDeviationChartComponent } from './voting-deviation-chart/voting-deviation-chart';

@Component({
  selector: 'app-room',
  imports: [
    FormsModule,
    SessionHeaderComponent,
    CardGridComponent,
    ParticipantsListComponent,
    ActionBarComponent,
    VotingHistoryComponent,
    VotingDeviationChartComponent,
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (awaitingName()) {
      <div class="name-prompt-overlay">
        <wa-card style="width: 100%; max-width: 420px">
          <div class="wa-stack wa-gap-m">
            <div class="wa-stack wa-gap-xs">
              <h1>Planning Poker</h1>
              <p class="subtitle">Enter your name to join the room</p>
            </div>
            <wa-input
              label="Your Name"
              placeholder="Enter your name"
              [value]="pendingName"
              (input)="pendingName = $any($event.target).value"
              (keydown.enter)="submitName()"
              autofocus
            ></wa-input>
            <wa-button
              variant="brand"
              appearance="filled"
              style="width: 100%"
              [attr.disabled]="!pendingName.trim() ? '' : null"
              (click)="submitName()"
            >
              Join Room
            </wa-button>
          </div>
        </wa-card>
      </div>
    } @else {
      <div class="room-container wa-stack wa-gap-l">
        <app-session-header />

        <wa-input
          placeholder="Story name (optional)"
          [value]="room.storyName()"
          (input)="room.updateStoryName($any($event.target).value)"
          style="width: 100%"
        >
          <wa-icon slot="start" name="book"></wa-icon>
        </wa-input>

        @if (!room.isObserver()) {
          <app-card-grid />
        }
        <app-participants-list />
        <app-action-bar />
        <app-voting-history />
        <app-voting-deviation-chart />
      </div>
    }
  `,
  styles: `
    .name-prompt-overlay {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: var(--wa-space-2xl);
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0;
      color: var(--wa-color-brand-fill-loud);
    }

    .subtitle {
      color: var(--wa-color-neutral-on-quiet);
      margin: 0;
      font-size: 1.1rem;
    }

    wa-card {
      --spacing: var(--wa-space-xl);
    }

    .room-container {
      max-width: 720px;
      margin: 0 auto;
      padding: var(--wa-space-2xl) var(--wa-space-xl);
    }
  `,
})
export class RoomComponent implements OnInit, OnDestroy {
  readonly room = inject(RoomService);
  private route = inject(ActivatedRoute);

  awaitingName = signal(false);
  pendingName = '';
  private roomCode = '';
  private confettiFired = false;

  readonly hasConsensus = computed(() => {
    const phase = this.room.phase();
    if (phase !== 'revealed') return false;
    const votes = this.room.votes();
    const players = this.room.uniquePlayers();
    const observerIds = new Set(players.filter((p) => p.observer).map((p) => p.peerId));
    const voteValues = Object.entries(votes)
      .filter(([peerId]) => !observerIds.has(peerId))
      .map(([, v]) => v);
    if (voteValues.length < 2) return false;
    return voteValues.every((v) => v === voteValues[0]);
  });

  constructor() {
    effect(() => {
      if (this.hasConsensus()) {
        if (!this.confettiFired) {
          this.confettiFired = true;
          this.fireConfetti();
        }
      } else {
        this.confettiFired = false;
      }
    });
  }

  ngOnInit(): void {
    this.roomCode = this.route.snapshot.paramMap.get('code')!;
    const name = localStorage.getItem('pp-name');
    if (!name) {
      this.awaitingName.set(true);
      return;
    }
    this.room.connect(this.roomCode, name);
  }

  submitName(): void {
    const name = this.pendingName.trim();
    if (!name) return;
    localStorage.setItem('pp-name', name);
    this.awaitingName.set(false);
    this.room.connect(this.roomCode, name);
  }

  ngOnDestroy(): void {
    this.room.disconnect();
  }

  private fireConfetti(): void {
    const end = Date.now() + 3000;
    const frame = () => {
      confetti({
        particleCount: 5,
        angle: 55,
        spread: 80,
        origin: { x: 0, y: 1 },
        colors: ['#2563eb', '#16a34a', '#f59e0b'],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }
}
