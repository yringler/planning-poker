import { Component, inject, OnInit, OnDestroy, signal, computed, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import confetti from 'canvas-confetti';
import { RoomService } from '../services/room.service';
import { SessionHeaderComponent } from './session-header/session-header';
import { CardGridComponent } from './card-grid/card-grid';
import { ParticipantsListComponent } from './participants-list/participants-list';
import { ActionBarComponent } from './action-bar/action-bar';
import { VotingHistoryComponent } from './voting-history/voting-history';

@Component({
  selector: 'app-room',
  imports: [
    FormsModule,
    SessionHeaderComponent,
    CardGridComponent,
    ParticipantsListComponent,
    ActionBarComponent,
    VotingHistoryComponent,
  ],
  template: `
    @if (awaitingName()) {
      <div class="name-prompt-overlay">
        <div class="name-prompt-card">
          <h1>Planning Poker</h1>
          <p class="subtitle">Enter your name to join the room</p>
          <label for="name">Your Name</label>
          <input
            id="name"
            type="text"
            [(ngModel)]="pendingName"
            placeholder="Enter your name"
            (keydown.enter)="submitName()"
            autofocus
          />
          <button class="btn primary" [disabled]="!pendingName.trim()" (click)="submitName()">
            Join Room
          </button>
        </div>
      </div>
    } @else {
      <div class="room-container">
        <app-session-header />

        <input
          type="text"
          class="story-input"
          placeholder="Story name (optional)"
          [ngModel]="room.storyName()"
          (ngModelChange)="room.updateStoryName($event)"
        />

        <app-card-grid />
        <app-participants-list />
        <app-action-bar />
        <app-voting-history />
      </div>
    }
  `,
  styles: `
    .name-prompt-overlay {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }

    .name-prompt-card {
      background: #fff;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
      width: 100%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
    }

    .name-prompt-card h1 {
      font-size: 2.5rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 0.5rem;
    }

    .subtitle {
      color: #64748b;
      margin: 0 0 1.5rem;
      font-size: 1.1rem;
    }

    label {
      display: block;
      font-weight: 600;
      color: #334155;
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
    }

    input {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
      box-sizing: border-box;
      margin-bottom: 1rem;
    }

    input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .btn {
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn.primary {
      background: #2563eb;
      color: #fff;
    }

    .btn.primary:hover:not(:disabled) {
      background: #1d4ed8;
    }

    .room-container {
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
    }

    .story-input {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
      margin-bottom: 1.5rem;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }

    .story-input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
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
    const votes = this.room.votes();
    if (phase !== 'revealed') return false;
    const voteValues = Object.values(votes);
    if (voteValues.length < 2) return false;
    return voteValues.every(v => v === voteValues[0]);
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
      // bottom-left → up-right
      confetti({ particleCount: 5, angle: 55, spread: 80, origin: { x: 0, y: 1 }, colors: ['#2563eb', '#16a34a', '#f59e0b'] });
      // bottom-right → up-left
      confetti({ particleCount: 5, angle: 125, spread: 80, origin: { x: 1, y: 1 }, colors: ['#2563eb', '#16a34a', '#f59e0b'] });
      // top-left → down-right
      confetti({ particleCount: 5, angle: 325, spread: 80, origin: { x: 0, y: 0 }, colors: ['#2563eb', '#16a34a', '#f59e0b'] });
      // top-right → down-left
      confetti({ particleCount: 5, angle: 235, spread: 80, origin: { x: 1, y: 0 }, colors: ['#2563eb', '#16a34a', '#f59e0b'] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
  }
}
