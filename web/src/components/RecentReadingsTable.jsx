import React, { useState } from 'react';
import Icon from './Icon';
import { fmt } from './MetricCards';
import { SelectField } from './FormControls';

const EXPORT_OPTIONS = [
  { value: '1', label: '1 hour' },
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
];

export default function RecentReadingsTable({ deviceId, recent }) {
  const [exportHours, setExportHours] = useState('24');

  const exportUrl = deviceId
    ? `/api/devices/${encodeURIComponent(deviceId)}/export.csv?hours=${exportHours}`
    : '#';

  return (
    <article className="card panel">
      <header className="panel-head">
        <h2>
          <Icon name="table-list" /> Recent Telemetry Packets
        </h2>
        <div className="spacer" />
        <div className="export-select-label">
          <span className="small muted">Window</span>
          <SelectField
            value={exportHours}
            options={EXPORT_OPTIONS}
            onChange={(v) => setExportHours(String(v))}
            ariaLabel="Export time window"
          />
        </div>
        <a className="btn btn-primary" href={exportUrl} download>
          Export CSV
        </a>
      </header>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Timestamp (Local)</th>
              <th>Seq</th>
              <th>Temp °C</th>
              <th>RH %</th>
              <th>hPa</th>
              <th>AQI</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Alt m</th>
              <th>Sats</th>
              <th>RSSI</th>
              <th>Transport</th>
            </tr>
          </thead>
          <tbody>
            {!recent || recent.length === 0 ? (
              <tr>
                <td colSpan="12" className="muted center">
                  No telemetry packets recorded yet
                </td>
              </tr>
            ) : (
              recent.map((t) => (
                <tr key={`${t.ts}-${t.seq ?? t.id}`} className={t.replay ? 'replay' : ''}>
                  <td>{new Date(t.ts).toLocaleString()}</td>
                  <td>{t.seq ?? ''}</td>
                  <td>{fmt(t.temp_c)}</td>
                  <td>{fmt(t.humidity)}</td>
                  <td>{fmt(t.pressure_hpa)}</td>
                  <td>{fmt(t.aqi, 0)}</td>
                  <td>{t.gps_fix ? fmt(t.lat, 6) : '—'}</td>
                  <td>{t.gps_fix ? fmt(t.lon, 6) : '—'}</td>
                  <td>{t.gps_fix ? fmt(t.alt, 0) : '—'}</td>
                  <td>{t.sats ?? ''}</td>
                  <td>{t.rssi ?? ''}</td>
                  <td>
                    <span className="transport-cell">
                      <span>{t.transport || ''}</span>
                      {t.replay ? (
                        <Icon
                          name="rotate-right"
                          className="replay-icon"
                          title="Replayed from ESP32 offline buffer"
                        />
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}
