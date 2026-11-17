import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import { NumberField, SelectField, SwitchField } from './FormControls';

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '--';
  let s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  s %= 86400;
  const h = Math.floor(s / 3600);
  s %= 3600;
  const m = Math.floor(s / 60);
  s %= 60;
  return (
    (d ? `${d}d ` : '') +
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  );
}

const DEFAULT_FORM = {
  telemetry_interval_s: 10,
  temp_offset_c: 0,
  humidity_offset: 0,
  pressure_offset_hpa: 0,
  sea_level_hpa: 1013.25,
  gas_baseline_kohm: 0,
  display_brightness: 200,
  auto_brightness: true,
  screen_dim_s: 30,
  screen_off_s: 120,
  gps_baud: 9600,
};

const BAUD_OPTIONS = [4800, 9600, 19200, 38400, 57600, 115200].map((b) => ({
  value: b,
  label: `${b} bps`,
}));

export default function CalibrationPanel({
  device,
  latest,
  stats,
  mqtt,
  config,
  onSaveConfig,
}) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [statusMsg, setStatusMsg] = useState({ kind: '', text: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setForm({
      telemetry_interval_s: config.telemetry_interval_s ?? 10,
      temp_offset_c: config.temp_offset_c ?? 0,
      humidity_offset: config.humidity_offset ?? 0,
      pressure_offset_hpa: config.pressure_offset_hpa ?? 0,
      sea_level_hpa: config.sea_level_hpa ?? 1013.25,
      gas_baseline_kohm: config.gas_baseline_kohm ?? 0,
      display_brightness: config.display_brightness ?? 200,
      auto_brightness: !!config.auto_brightness,
      screen_dim_s: config.screen_dim_s ?? 30,
      screen_off_s: config.screen_off_s ?? 120,
      gps_baud: config.gps_baud ?? 9600,
    });
  }, [config]);

  function updateField(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setStatusMsg({ kind: '', text: 'Saving configuration…' });
    try {
      const payload = {
        telemetry_interval_s: Number(form.telemetry_interval_s),
        temp_offset_c: Number(form.temp_offset_c),
        humidity_offset: Number(form.humidity_offset),
        pressure_offset_hpa: Number(form.pressure_offset_hpa),
        sea_level_hpa: Number(form.sea_level_hpa),
        gas_baseline_kohm: Number(form.gas_baseline_kohm),
        display_brightness: Number(form.display_brightness),
        auto_brightness: Boolean(form.auto_brightness),
        screen_dim_s: Number(form.screen_dim_s),
        screen_off_s: Number(form.screen_off_s),
        gps_baud: Number(form.gps_baud),
      };
      const saved = await onSaveConfig(payload);
      setStatusMsg({
        kind: 'ok',
        text: saved.pushed
          ? `Saved v${saved.version} · pushed via retained MQTT`
          : `Saved v${saved.version} · queued for next boot`,
      });
    } catch (err) {
      setStatusMsg({ kind: 'err', text: err.message });
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    if (!config) return;
    setForm({
      telemetry_interval_s: config.telemetry_interval_s ?? 10,
      temp_offset_c: config.temp_offset_c ?? 0,
      humidity_offset: config.humidity_offset ?? 0,
      pressure_offset_hpa: config.pressure_offset_hpa ?? 0,
      sea_level_hpa: config.sea_level_hpa ?? 1013.25,
      gas_baseline_kohm: config.gas_baseline_kohm ?? 0,
      display_brightness: config.display_brightness ?? 200,
      auto_brightness: !!config.auto_brightness,
      screen_dim_s: config.screen_dim_s ?? 30,
      screen_off_s: config.screen_off_s ?? 120,
      gps_baud: config.gps_baud ?? 9600,
    });
    setStatusMsg({ kind: '', text: '' });
  }

  const cv = device?.cfg_version;
  const want = config?.version;
  const inSync = want && cv !== null && cv !== undefined && cv >= want;

  return (
    <section className="grid-2">
      {/* System Status */}
      <article className="card panel">
        <header className="panel-head">
          <h2>
            <Icon name="microchip" /> Hardware &amp; Link Diagnostics
          </h2>
        </header>
        <dl className="kv">
          <dt>Device Unit</dt>
          <dd>{device ? `${device.id} (${device.name})` : '--'}</dd>

          <dt>Owner Profile</dt>
          <dd>{device?.owner_username || 'Unclaimed'}</dd>

          <dt>Claim Code</dt>
          <dd className="mono">{device?.claim_code || '--'}</dd>

          <dt>Firmware Build</dt>
          <dd className="mono">{device?.fw || latest?.fw || '--'}</dd>

          <dt>Device IP</dt>
          <dd className="mono">{device?.ip || '--'}</dd>

          <dt>Config Sync</dt>
          <dd>
            <span>{cv ?? '--'}</span>
            {want && cv !== null && cv !== undefined && (
              <span className="tag" style={{ marginLeft: 8 }}>
                {inSync ? 'in sync' : `pending v${want}`}
              </span>
            )}
          </dd>

          <dt>ESP32 Uptime</dt>
          <dd className="mono">{formatDuration(latest?.uptime_ms)}</dd>

          <dt>Free SRAM Heap</dt>
          <dd className="mono">
            {latest?.heap ? `${(latest.heap / 1024).toFixed(1)} KiB` : '--'}
          </dd>

          <dt>Offline Ring Buffer</dt>
          <dd className="mono">{latest?.buffered ?? '--'} samples</dd>

          <dt>Active Transport</dt>
          <dd>
            {latest?.transport || '--'}
            {latest?.replay ? ' (replayed)' : ''}
          </dd>

          <dt>Clock Source</dt>
          <dd className="mono">{latest?.ts_source || '--'}</dd>

          <dt>Mosquitto Broker</dt>
          <dd>
            {mqtt
              ? `${mqtt.connected ? 'Connected' : 'DISCONNECTED'} · rx ${mqtt.received} · err ${mqtt.rejected}`
              : '--'}
          </dd>

          <dt>24h Ingestion</dt>
          <dd>
            {stats
              ? `${stats.n ?? 0} total (${stats.replayed ?? 0} replayed, ${stats.fixes ?? 0} GPS fixes)`
              : '--'}
          </dd>
        </dl>
      </article>

      {/* Calibration & Startup Config */}
      <article className="card panel">
        <header className="panel-head">
          <h2>
            <Icon name="settings-sliders" /> Calibration &amp; Power Parameters
          </h2>
          {config && (
            <span className="muted small">
              v{config.version}
              {config._updated_at ? ` · ${new Date(config._updated_at).toLocaleString()}` : ''}
              {config._updated_by ? ` by ${config._updated_by}` : ''}
            </span>
          )}
        </header>

        <form className="cfg-grid" onSubmit={handleSubmit} noValidate>
          <div className="cfg-field">
            <span className="cfg-label">Telemetry interval</span>
            <NumberField
              value={form.telemetry_interval_s}
              min={2}
              max={3600}
              step={1}
              unit="s"
              onChange={(v) => updateField('telemetry_interval_s', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Temp offset</span>
            <NumberField
              value={form.temp_offset_c}
              min={-20}
              max={20}
              step={0.1}
              unit="°C"
              onChange={(v) => updateField('temp_offset_c', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Humidity offset</span>
            <NumberField
              value={form.humidity_offset}
              min={-30}
              max={30}
              step={0.1}
              unit="%RH"
              onChange={(v) => updateField('humidity_offset', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Pressure offset</span>
            <NumberField
              value={form.pressure_offset_hpa}
              min={-50}
              max={50}
              step={0.1}
              unit="hPa"
              onChange={(v) => updateField('pressure_offset_hpa', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Sea-level QNH</span>
            <NumberField
              value={form.sea_level_hpa}
              min={850}
              max={1100}
              step={0.1}
              unit="hPa"
              onChange={(v) => updateField('sea_level_hpa', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Gas baseline (0 = auto)</span>
            <NumberField
              value={form.gas_baseline_kohm}
              min={0}
              max={5000}
              step={1}
              unit="kOhm"
              onChange={(v) => updateField('gas_baseline_kohm', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">TFT Backlight (5–255)</span>
            <NumberField
              value={form.display_brightness}
              min={5}
              max={255}
              step={5}
              onChange={(v) => updateField('display_brightness', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Screen dim timeout</span>
            <NumberField
              value={form.screen_dim_s}
              min={5}
              max={3600}
              step={5}
              unit="s"
              onChange={(v) => updateField('screen_dim_s', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Screen sleep timeout</span>
            <NumberField
              value={form.screen_off_s}
              min={10}
              max={86400}
              step={10}
              unit="s"
              onChange={(v) => updateField('screen_off_s', v)}
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">GPS UART Baud Rate</span>
            <SelectField
              value={form.gps_baud}
              options={BAUD_OPTIONS}
              onChange={(v) => updateField('gps_baud', Number(v))}
              ariaLabel="GPS UART Baud Rate"
            />
          </div>

          <div className="cfg-full">
            <SwitchField
              checked={form.auto_brightness}
              onChange={(v) => updateField('auto_brightness', v)}
              label="Enable LDR ambient light auto-brightness (GPIO 34)"
            />
          </div>

          <div className="cfg-actions">
            <span className="small" role="status">
              {statusMsg.text}
            </span>
            <button type="button" className="btn" onClick={handleRevert}>
              Revert
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Pushing…' : 'Save & Push to ESP32'}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}
