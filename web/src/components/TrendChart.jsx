import React, { useEffect, useRef } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Filler,
  Tooltip,
} from 'chart.js';
import Icon from './Icon';
import { fmt } from './MetricCards';

Chart.register(LineController, LineElement, PointElement, LinearScale, Filler, Tooltip);
Chart.defaults.font.family = "'Roboto', -apple-system, BlinkMacSystemFont, sans-serif";
Chart.defaults.color = '#18181b';

export const METRICS = {
  temp_c: { label: 'Temperature', unit: '°C', color: '#0066ff', d: 1, icon: 'temperature-high' },
  humidity: { label: 'Humidity', unit: '%RH', color: '#0066ff', d: 1, icon: 'humidity' },
  pressure_hpa: { label: 'Pressure', unit: 'hPa', color: '#0066ff', d: 1, icon: 'gauge-circle-bolt' },
  aqi: { label: 'AQI / IAQ', unit: '', color: '#0066ff', d: 0, icon: 'wind' },
};

export const RANGES = [
  { h: 0.25, label: '15m' },
  { h: 1, label: '1h' },
  { h: 6, label: '6h' },
  { h: 24, label: '24h' },
  { h: 168, label: '7d' },
];

export default function TrendChart({ metric, hours, points, onMetricChange, onHoursChange }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);
  const metaRef = useRef({ metric, hours });
  metaRef.current = { metric, hours };

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            data: [],
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.25,
            fill: true,
            spanGaps: false,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#09090b',
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            callbacks: {
              title: (items) =>
                items.length ? new Date(items[0].parsed.x).toLocaleString() : '',
              label: (item) => {
                const m = METRICS[metaRef.current.metric];
                return `${m.label}: ${fmt(item.parsed.y, m.d)} ${m.unit}`.trim();
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            grid: { color: '#f4f4f5' },
            ticks: {
              color: '#52525b',
              maxTicksLimit: 7,
              callback: (v) => {
                const d = new Date(v);
                return metaRef.current.hours > 24
                  ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              },
            },
          },
          y: {
            grid: { color: '#f4f4f5' },
            ticks: { color: '#52525b' },
          },
        },
      },
    });
    chartRef.current = chart;
    return () => {
      chart.destroy();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const m = METRICS[metric];
    const ds = chart.data.datasets[0];
    ds.borderColor = m.color;
    ds.backgroundColor = 'rgba(0, 102, 255, 0.08)';
    ds.label = m.label;
    ds.data = (points || [])
      .filter((p) => p[metric] !== null && p[metric] !== undefined)
      .map((p) => ({ x: p.t * 1000, y: p[metric] }));

    const now = Date.now();
    chart.options.scales.x.min = now - hours * 3600e3;
    chart.options.scales.x.max = now;
    chart.update('none');
  }, [metric, hours, points]);

  return (
    <article className="card panel">
      <header className="panel-head">
        <h2>
          <Icon name="chart-line-up" /> Telemetry Trend
        </h2>

        <div className="seg" role="tablist" aria-label="Metric selection">
          {Object.entries(METRICS).map(([key, m]) => (
            <button
              key={key}
              type="button"
              className={metric === key ? 'active' : ''}
              onClick={() => onMetricChange(key)}
            >
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="seg" role="group" aria-label="Time window">
          {RANGES.map((r) => (
            <button
              key={r.h}
              type="button"
              className={hours === r.h ? 'active' : ''}
              onClick={() => onHoursChange(r.h)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>
      <div className="chart-box">
        <canvas ref={canvasRef} aria-label="Telemetry trend chart" />
      </div>
    </article>
  );
}
