import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import { SelectField } from './FormControls';

const LEVEL_OPTIONS = [
  { value: 'ALL', label: 'All Levels' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARN', label: 'WARN' },
  { value: 'ERROR', label: 'ERROR' },
];

export default function LogsPanel({ logs, deviceId, onRefresh, onClear }) {
  const [sourceTab, setSourceTab] = useState('all'); // 'all' | 'device' | 'server'
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (logs || []).filter((item) => {
      if (sourceTab !== 'all' && item.source !== sourceTab) return false;
      if (levelFilter !== 'ALL' && item.level !== levelFilter) return false;
      if (q) {
        const hay = `${item.event || ''} ${item.detail || ''} ${item.device_id || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, sourceTab, levelFilter, search]);

  return (
    <article className="card panel">
      <header className="panel-head">
        <h2>
          <Icon name="terminal" /> Server &amp; ESP32 Device Logs
        </h2>

        <div className="seg" role="tablist" aria-label="Log source filter">
          <button
            type="button"
            className={sourceTab === 'all' ? 'active' : ''}
            onClick={() => setSourceTab('all')}
          >
            All Logs
          </button>
          <button
            type="button"
            className={sourceTab === 'device' ? 'active' : ''}
            onClick={() => setSourceTab('device')}
          >
            ESP32 Device ({deviceId || 'all'})
          </button>
          <button
            type="button"
            className={sourceTab === 'server' ? 'active' : ''}
            onClick={() => setSourceTab('server')}
          >
            Server &amp; MQTT
          </button>
        </div>

        <div className="logs-toolbar">
          <input
            type="text"
            className="logs-search"
            placeholder="Filter logs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <SelectField
            value={levelFilter}
            options={LEVEL_OPTIONS}
            onChange={(v) => setLevelFilter(v)}
            ariaLabel="Filter log level"
          />
          <button type="button" className="btn" onClick={onRefresh}>
            Refresh
          </button>
          <button type="button" className="btn" onClick={onClear}>
            Clear
          </button>
        </div>
      </header>

      <div className="table-wrap logs-table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Time (Local)</th>
              <th>Source</th>
              <th>Device</th>
              <th>Level</th>
              <th>Event</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan="6" className="muted center">
                  No log entries matching current filter
                </td>
              </tr>
            ) : (
              filtered.map((item) => (
                <tr key={item.id || `${item.ts}-${item.event}`}>
                  <td className="mono">{new Date(item.ts).toLocaleTimeString()}</td>
                  <td>
                    <span className="log-pill">
                      {item.source === 'device' ? 'ESP32' : 'SERVER'}
                    </span>
                  </td>
                  <td className="mono">{item.device_id || '—'}</td>
                  <td>
                    <span className="log-pill">{item.level || 'INFO'}</span>
                  </td>
                  <td className="mono">{item.event}</td>
                  <td className="log-detail-cell">{item.detail}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </article>
  );
}
