import { Component, inject, computed } from '@angular/core';
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
            const deviation = ctx.parsed.y;
            if (deviation === null) return `${ctx.dataset.label}: no vote`;
            const sign = deviation > 0 ? '+' : '';
            return `${ctx.dataset.label}: ${sign}${deviation.toFixed(2)}σ`;
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

    const datasets = players.map((playerName, colorIdx) => {
      const data: (number | null)[] = history.map((entry) => {
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

      const color = COLORS[colorIdx % COLORS.length];
      return {
        label: playerName,
        data,
        borderColor: color,
        backgroundColor: color + '22',
        pointBackgroundColor: color,
        pointRadius: 5,
        pointHoverRadius: 7,
        tension: 0.3,
        fill: false,
      };
    });

    return { labels, datasets };
  });
}
