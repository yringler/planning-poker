import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
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
  `,
  styles: `
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
  private router = inject(Router);

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code')!;
    const name = localStorage.getItem('pp-name');
    if (!name) {
      this.router.navigate(['/']);
      return;
    }
    this.room.connect(code, name);
  }

  ngOnDestroy(): void {
    this.room.disconnect();
  }
}
