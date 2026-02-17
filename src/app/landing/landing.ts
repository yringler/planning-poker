import { Component, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-landing',
  imports: [FormsModule],
  template: `
    <div class="landing">
      <h1>Planning Poker</h1>
      <p class="subtitle">Real-time estimation for agile teams</p>

      <div class="card">
        <label for="name">Your Name</label>
        <input
          id="name"
          type="text"
          [(ngModel)]="name"
          placeholder="Enter your name"
          (keydown.enter)="name() ? null : undefined"
        />

        <div class="actions">
          <div class="create-section">
            <button class="btn primary" [disabled]="!name().trim()" (click)="createSession()">
              Create Session
            </button>
          </div>

          <div class="divider">
            <span>or</span>
          </div>

          <div class="join-section">
            <input
              type="text"
              [(ngModel)]="roomCode"
              placeholder="Room code"
              class="room-code-input"
              maxlength="6"
              (keydown.enter)="joinSession()"
            />
            <button
              class="btn secondary"
              [disabled]="!name().trim() || !roomCode().trim()"
              (click)="joinSession()"
            >
              Join Session
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .landing {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }

    h1 {
      font-size: 2.5rem;
      font-weight: 700;
      color: #1e293b;
      margin: 0 0 0.5rem;
    }

    .subtitle {
      color: #64748b;
      margin: 0 0 2rem;
      font-size: 1.1rem;
    }

    .card {
      background: #fff;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06);
      width: 100%;
      max-width: 400px;
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
    }

    input:focus {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .actions {
      margin-top: 1.5rem;
    }

    .btn {
      width: 100%;
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

    .btn.secondary {
      background: #f1f5f9;
      color: #334155;
    }

    .btn.secondary:hover:not(:disabled) {
      background: #e2e8f0;
    }

    .divider {
      display: flex;
      align-items: center;
      margin: 1.25rem 0;
      color: #94a3b8;
      font-size: 0.875rem;
    }

    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: #e2e8f0;
    }

    .divider span {
      padding: 0 1rem;
    }

    .join-section {
      display: flex;
      gap: 0.5rem;
    }

    .room-code-input {
      text-transform: uppercase;
      flex: 1;
    }

    .join-section .btn {
      width: auto;
      white-space: nowrap;
    }
  `,
})
export class LandingComponent {
  name = signal(localStorage.getItem('pp-name') ?? '');
  roomCode = signal('');

  constructor(private router: Router) {}

  createSession(): void {
    this.saveName();
    const code = this.generateCode();
    this.router.navigate(['/room', code]);
  }

  joinSession(): void {
    this.saveName();
    const code = this.roomCode().trim().toUpperCase();
    if (code) {
      this.router.navigate(['/room', code]);
    }
  }

  private saveName(): void {
    const n = this.name().trim();
    localStorage.setItem('pp-name', n);
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }
}
