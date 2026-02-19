import { Component, inject, computed, signal } from '@angular/core';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { ChartData, ChartOptions } from 'chart.js';
import { RoomService } from '../../services/room.service';

const COLORS = [
  '#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed',
  '#0891b2', '#be185d', '#65a30d', '#ea580c', '#4338ca',
];

@Component({
  selector: 'app-voting-deviation-chart',
  imports: [BaseChartDirective],
  providers: [provideCharts(withDefaultRegisterables())],
  template: `
    @if (room.history().length > 1) {
      <div class="section">
        <h2>Voting Deviation</h2>
        <p class="subtitle">Each player's vote z-score (deviation ÷ std dev) per issue</p>
        <div class="controls">
          <label><input type="checkbox" [checked]="showZScores()" (change)="toggleZScores($any($event.target).checked)"> Z-scores</label>
          <label><input type="checkbox" [checked]="showAvgAbsZ()" (change)="toggleAvgAbsZ($any($event.target).checked)"> Avg |z|</label>
        </div>
        <div class="chart-container">
          <canvas baseChart
            [data]="chartData()"
            [options]="chartOptions"
            type="line">
          </canvas>
        </div>
      </div>
    }
  `,
  styles: `
    h2 {
      font-size: 1rem;
      font-weight: 600;
      color: #475569;
      margin: 0 0 0.25rem;
    }

    .subtitle {
      font-size: 0.8rem;
      color: #94a3b8;
      margin: 0 0 1rem;
    }

    .controls {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.75rem;

      label {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.8rem;
        color: #64748b;
        cursor: pointer;
      }
    }

    .chart-container {
      background: #fff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 1.25rem;
    }
  `,
})
export class VotingDeviationChartComponent {
  readonly room = inject(RoomService);

  showZScores = signal(true);
  showAvgAbsZ = signal(true);

  toggleZScores(checked: boolean) { this.showZScores.set(checked); }
  toggleAvgAbsZ(checked: boolean) { this.showAvgAbsZ.set(checked); }

  readonly chartOptions: ChartOptions<'line'> = {
    responsive: true,
    spanGaps: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { font: { size: 12 }, padding: 16 },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = ctx.parsed.y;
            const label = ctx.dataset.label ?? '';
            if (value === null) return `${label}: no vote`;
            if (label.endsWith('(avg |z|)')) {
              return `${label}: ${value.toFixed(2)}σ`;
            }
            const sign = value > 0 ? '+' : '';
            return `${label}: ${sign}${value.toFixed(2)}σ`;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Issue #', color: '#64748b', font: { size: 11 } },
        grid: { color: '#f1f5f9' },
        ticks: { color: '#64748b', font: { size: 11 } },
      },
      y: {
        title: { display: true, text: 'Z-score (std deviations from avg)', color: '#64748b', font: { size: 11 } },
        grid: {
          color: (ctx) => (ctx.tick.value === 0 ? '#94a3b8' : '#f1f5f9'),
        },
        ticks: {
          color: '#64748b',
          font: { size: 11 },
          callback: (value) => {
            const n = Number(value);
            return (n > 0 ? '+' : '') + n;
          },
        },
      },
    },
  };

  readonly chartData = computed((): ChartData<'line'> => {
    // History is stored newest-first; reverse so issue #1 is the oldest
    const history = [...this.room.resolvedHistory()].reverse();

    // Collect all unique player names
    const playerNames = new Set<string>();
    for (const entry of history) {
      for (const [peerId] of Object.entries(entry.votes)) {
        const name = entry.players[peerId] || 'Unknown';
        playerNames.add(name);
      }
    }

    const players = Array.from(playerNames);
    const labels = history.map((_, i) => String(i + 1));

    const datasets = players.flatMap((playerName, colorIdx) => {
      const zScores: (number | null)[] = history.map((entry) => {
        // Find this player's vote in this entry
        const peerId = Object.keys(entry.players).find(
          (id) => entry.players[id] === playerName,
        );
        if (!peerId) return null;

        const voteStr = entry.votes[peerId];
        const vote = parseFloat(voteStr);
        if (isNaN(vote)) return null;

        // Compute round average and standard deviation of numeric votes
        const numericVotes = Object.values(entry.votes)
          .map((v) => parseFloat(v))
          .filter((v) => !isNaN(v));
        if (numericVotes.length === 0) return null;

        const avg = numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length;
        const stdDev = Math.sqrt(
          numericVotes.reduce((a, b) => a + (b - avg) ** 2, 0) / numericVotes.length
        );
        if (stdDev === 0) return 0;
        return parseFloat(((vote - avg) / stdDev).toFixed(2));
      });

      // Cumulative mean absolute z-score up to each issue
      const cumulativeMeanAbsZ: (number | null)[] = [];
      let runningSum = 0;
      let runningCount = 0;
      for (const z of zScores) {
        if (z !== null) {
          runningSum += Math.abs(z);
          runningCount++;
        }
        cumulativeMeanAbsZ.push(runningCount > 0 ? parseFloat((runningSum / runningCount).toFixed(2)) : null);
      }

      const color = COLORS[colorIdx % COLORS.length];
      const result = [];
      if (this.showZScores()) {
        result.push({
          label: playerName,
          data: zScores,
          borderColor: color,
          backgroundColor: color + '22',
          pointBackgroundColor: color,
          pointRadius: 5,
          pointHoverRadius: 7,
          tension: 0.3,
          fill: false,
        });
      }
      if (this.showAvgAbsZ()) {
        result.push({
          label: `${playerName} (avg |z|)`,
          data: cumulativeMeanAbsZ,
          borderColor: color,
          backgroundColor: 'transparent',
          pointBackgroundColor: color,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: false,
          borderDash: [5, 5],
        });
      }
      return result;
    });

    return { labels, datasets };
  });
}
