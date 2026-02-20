import { Component, inject, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-voting-history',
  imports: [DatePipe, KeyValuePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (room.history().length > 0) {
      <div class="section">
        <h2>Voting History</h2>
        @for (entry of room.resolvedHistory(); track entry.timestamp) {
          <div class="history-card">
            <div class="history-header">
              @if (editingTimestamp() === entry.timestamp) {
                <span class="story-name-wrap">
                  <input
                    class="story-name-input"
                    [value]="editingValue()"
                    (input)="editingValue.set($any($event.target).value)"
                    (keydown.enter)="saveEdit(entry.timestamp)"
                    (keydown.escape)="cancelEdit()"
                    #editInput
                  />
                  <wa-icon name="check" class="save-icon" (click)="saveEdit(entry.timestamp)"></wa-icon>
                  <wa-icon name="xmark" class="cancel-icon" (click)="cancelEdit()"></wa-icon>
                </span>
              } @else {
                <span class="story-name-wrap">
                  <span class="story-name">{{ entry.story || 'Untitled' }}</span>
                  <wa-icon name="pencil" class="edit-icon" (click)="startEdit(entry.timestamp, entry.story || '')"></wa-icon>
                </span>
              }
              <div class="meta">
                <span class="timestamp">{{ entry.timestamp | date:'M/d/yyyy h:mm a' }}</span>
                <span class="average">{{ calcAverage(entry.votes) }}</span>
              </div>
            </div>
            <div class="votes-grid">
              @for (vote of entry.votes | keyvalue; track vote.key) {
                <div class="vote-entry">
                  <span class="voter-name">{{ entry.players[vote.key] || 'Unknown' }}</span>
                  <span class="vote-value">{{ vote.value }}</span>
                </div>
              }
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    h2 {
      font-size: 1rem;
      font-weight: 600;
      color: #475569;
      margin: 0 0 0.75rem;
    }

    .history-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 1rem 1.25rem;
      margin-bottom: 0.75rem;
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.75rem;
    }

    .story-name-wrap {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .story-name {
      font-weight: 600;
      color: #1e293b;
      font-size: 1rem;
    }

    .edit-icon {
      font-size: 0.8rem;
      color: #94a3b8;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .history-card:hover .edit-icon {
      opacity: 1;
    }

    .edit-icon:hover {
      color: #2563eb;
    }

    .save-icon {
      font-size: 0.85rem;
      color: #16a34a;
      cursor: pointer;
    }

    .save-icon:hover {
      color: #15803d;
    }

    .cancel-icon {
      font-size: 0.85rem;
      color: #94a3b8;
      cursor: pointer;
    }

    .cancel-icon:hover {
      color: #ef4444;
    }

    .story-name-input {
      font-weight: 600;
      color: #1e293b;
      font-size: 1rem;
      border: 1px solid #2563eb;
      border-radius: 4px;
      padding: 0 4px;
      outline: none;
      background: #fff;
      min-width: 120px;
    }

    .meta {
      text-align: right;
    }

    .timestamp {
      display: block;
      color: #94a3b8;
      font-size: 0.8rem;
    }

    .average {
      display: block;
      color: #2563eb;
      font-weight: 700;
      font-size: 0.9rem;
      margin-top: 0.125rem;
    }

    .votes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.375rem;
    }

    .vote-entry {
      display: flex;
      justify-content: space-between;
      padding: 0.375rem 0.5rem;
      background: #f8fafc;
      border-radius: 6px;
      font-size: 0.875rem;
    }

    .voter-name {
      color: #475569;
    }

    .vote-value {
      font-weight: 600;
      color: #1e293b;
    }
  `,
})
export class VotingHistoryComponent {
  readonly room = inject(RoomService);
  readonly editingTimestamp = signal<number | null>(null);
  readonly editingValue = signal('');

  startEdit(timestamp: number, story: string): void {
    this.editingTimestamp.set(timestamp);
    this.editingValue.set(story);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.story-name-input');
      input?.focus();
      input?.select();
    });
  }

  saveEdit(timestamp: number): void {
    this.room.updateHistoryStory(timestamp, this.editingValue().trim());
    this.editingTimestamp.set(null);
  }

  cancelEdit(): void {
    this.editingTimestamp.set(null);
  }

  calcAverage(votes: Record<string, string>): string {
    const nums = Object.values(votes).map(v => parseFloat(v)).filter(v => !isNaN(v));
    if (nums.length === 0) return 'No numeric votes';
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `Avg: ${avg % 1 === 0 ? avg.toString() : avg.toFixed(1)}`;
  }
}
