import { Component, inject, signal, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RoomService } from '../../services/room.service';

@Component({
  selector: 'app-voting-history',
  imports: [DatePipe, KeyValuePipe],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    @if (room.resolvedHistory().length > 0) {
      <div class="wa-stack wa-gap-s">
        <h2>Voting History</h2>
        @for (entry of room.resolvedHistory(); track entry.timestamp) {
          <wa-card class="history-card">
            <div class="history-header">
              @if (editingTimestamp() === entry.timestamp) {
                <div class="wa-cluster wa-gap-xs" style="align-items: center">
                  <wa-input
                    class="story-name-input"
                    size="small"
                    [value]="editingValue()"
                    (input)="editingValue.set($any($event.target).value)"
                    (keydown.enter)="saveEdit(entry.timestamp)"
                    (keydown.escape)="cancelEdit()"
                  ></wa-input>
                  <wa-icon name="check" class="action-icon save" (click)="saveEdit(entry.timestamp)"></wa-icon>
                  <wa-icon name="xmark" class="action-icon cancel" (click)="cancelEdit()"></wa-icon>
                </div>
              } @else {
                <div class="wa-cluster wa-gap-xs story-wrap" style="align-items: center">
                  <span class="story-name">{{ entry.story || 'Untitled' }}</span>
                  <wa-icon name="pencil" class="action-icon edit" (click)="startEdit(entry.timestamp, entry.story || '')"></wa-icon>
                  <wa-icon name="trash" class="action-icon delete" (click)="deleteEntry(entry.timestamp)"></wa-icon>
                </div>
              }
              <div class="meta">
                <span class="timestamp">{{ entry.timestamp | date:'M/d/yyyy h:mm a' }}</span>
                <span class="average">{{ calcAverage(entry.votes) }}</span>
              </div>
            </div>
            <wa-divider style="margin: var(--wa-space-s) 0"></wa-divider>
            <div class="wa-grid wa-gap-2xs" style="--min-column-size: 160px">
              @for (vote of entry.votes | keyvalue; track vote.key) {
                <div class="vote-entry">
                  <span class="voter-name">{{ entry.players[vote.key] || 'Unknown' }}</span>
                  <span class="vote-value">{{ vote.value }}</span>
                </div>
              }
            </div>
          </wa-card>
        }
      </div>
    }
  `,
  styles: `
    h2 {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--wa-color-neutral-on-quiet);
      margin: 0;
    }

    .history-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--wa-space-s);
    }

    .story-name {
      font-weight: 600;
      color: var(--wa-color-neutral-on-default);
      font-size: 1rem;
    }

    .action-icon {
      cursor: pointer;
      font-size: 0.8rem;
      transition: color 0.15s, opacity 0.15s;
    }

    .story-wrap .action-icon {
      opacity: 0;
    }

    .history-card:hover .story-wrap .action-icon {
      opacity: 1;
    }

    .action-icon.edit {
      color: var(--wa-color-neutral-on-quiet);
    }
    .action-icon.edit:hover {
      color: var(--wa-color-brand-fill-loud);
    }

    .action-icon.delete {
      color: var(--wa-color-neutral-on-quiet);
    }
    .action-icon.delete:hover {
      color: var(--wa-color-danger-fill-loud);
    }

    .action-icon.save {
      color: var(--wa-color-success-fill-loud);
    }

    .action-icon.cancel {
      color: var(--wa-color-neutral-on-quiet);
    }
    .action-icon.cancel:hover {
      color: var(--wa-color-danger-fill-loud);
    }

    .story-name-input {
      min-width: 160px;
    }

    .meta {
      text-align: right;
      flex-shrink: 0;
    }

    .timestamp {
      display: block;
      color: var(--wa-color-neutral-on-quiet);
      font-size: 0.78rem;
    }

    .average {
      display: block;
      color: var(--wa-color-brand-fill-loud);
      font-weight: 700;
      font-size: 0.875rem;
    }

    .vote-entry {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--wa-space-2xs) var(--wa-space-xs);
      background: var(--wa-color-surface-lowered);
      border-radius: var(--wa-border-radius-s);
      font-size: 0.875rem;
      gap: var(--wa-space-s);
    }

    .voter-name {
      color: var(--wa-color-neutral-on-quiet);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .vote-value {
      font-weight: 700;
      color: var(--wa-color-brand-fill-loud);
      flex-shrink: 0;
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
      const waInput = document.querySelector<HTMLElement & { focus(): void }>('.story-name-input');
      waInput?.focus();
    });
  }

  saveEdit(timestamp: number): void {
    this.room.updateHistoryStory(timestamp, this.editingValue().trim());
    this.editingTimestamp.set(null);
  }

  cancelEdit(): void {
    this.editingTimestamp.set(null);
  }

  deleteEntry(timestamp: number): void {
    this.room.deleteHistoryEntry(timestamp);
  }

  calcAverage(votes: Record<string, string>): string {
    const nums = Object.values(votes)
      .map((v) => parseFloat(v))
      .filter((v) => !isNaN(v));
    if (nums.length === 0) return 'No numeric votes';
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `Avg: ${avg % 1 === 0 ? avg.toString() : avg.toFixed(1)}`;
  }
}
