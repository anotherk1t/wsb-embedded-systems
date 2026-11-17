import React from 'react';
import Icon from './Icon';

export function aqiCategory(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return { name: 'N/A' };
  if (v <= 50) return { name: 'Excellent' };
  if (v <= 100) return { name: 'Good' };
  if (v <= 150) return { name: 'Light pollution' };
  if (v <= 200) return { name: 'Moderate' };
  if (v <= 300) return { name: 'Heavy' };
  return { name: 'Severe' };
}

export function fmt(v, d = 1) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '--';
  return Number(v).toFixed(d);
}

export function ago(iso) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function MetricCards({ latest, stats, device, activeMetric, onSelectMetric }) {
  const t = latest || {};
  const st = stats || {};
  const cat = aqiCategory(t.aqi);

  const aqiExtras = [];
  if (t.eco2_ppm !== null && t.eco2_ppm !== undefined) aqiExtras.push(`eCO2 ${fmt(t.eco2_ppm, 0)} ppm`);
  if (t.tvoc_ppb !== null && t.tvoc_ppb !== undefined) aqiExtras.push(`TVOC ${fmt(t.tvoc_ppb, 0)} ppb`);
  if (t.gas_kohm !== null && t.gas_kohm !== undefined) aqiExtras.push(`Gas ${fmt(t.gas_kohm, 1)} kOhm`);

  return (
    <section className="cards" aria-label="Live sensor metrics">
      <article
        className={`card metric ${activeMetric === 'temp_c' ? 'metric-selected' : ''}`}
        onClick={() => onSelectMetric('temp_c')}
      >
        <header>
          <Icon name="temperature-high" />
          <span>Ambient Temperature</span>
        </header>
        <div className="metric-value">
          <span>{fmt(t.temp_c, 1)}</span>
          <small>°C</small>
        </div>
        <footer className="muted small">
          24h: {fmt(st.temp_min)} – {fmt(st.temp_max)} °C (avg {fmt(st.temp_avg)})
        </footer>
      </article>

      <article
        className={`card metric ${activeMetric === 'humidity' ? 'metric-selected' : ''}`}
        onClick={() => onSelectMetric('humidity')}
      >
        <header>
          <Icon name="humidity" />
          <span>Relative Humidity</span>
        </header>
        <div className="metric-value">
          <span>{fmt(t.humidity, 1)}</span>
          <small>%RH</small>
        </div>
        <footer className="muted small">
          24h: {fmt(st.hum_min)} – {fmt(st.hum_max)} % (avg {fmt(st.hum_avg)})
        </footer>
      </article>

      <article
        className={`card metric ${activeMetric === 'pressure_hpa' ? 'metric-selected' : ''}`}
        onClick={() => onSelectMetric('pressure_hpa')}
      >
        <header>
          <Icon name="gauge-circle-bolt" />
          <span>Barometric Pressure</span>
        </header>
        <div className="metric-value">
          <span>{fmt(t.pressure_hpa, 1)}</span>
          <small>hPa</small>
        </div>
        <footer className="muted small">
          24h: {fmt(st.pres_min)} – {fmt(st.pres_max)} hPa
        </footer>
      </article>

      <article
        className={`card metric ${activeMetric === 'aqi' ? 'metric-selected' : ''}`}
        onClick={() => onSelectMetric('aqi')}
      >
        <header>
          <Icon name="wind" />
          <span>Air Quality Index</span>
        </header>
        <div className="metric-value">
          <span>{fmt(t.aqi, 0)}</span>
          <small>{cat.name}</small>
        </div>
        <footer className="muted small">
          src: {t.aqi_source || 'none'}
          {aqiExtras.length ? ` · ${aqiExtras.join(' · ')}` : ''}
        </footer>
      </article>

      <article className="card metric metric-static">
        <header>
          <Icon name="satellite-dish" />
          <span>GPS Receiver</span>
        </header>
        <div className="metric-value">
          <span>{t.gps_fix ? '3D Fix' : 'No Fix'}</span>
          <small>{t.sats !== null && t.sats !== undefined ? `${t.sats} sats` : ''}</small>
        </div>
        <footer className="muted small mono">
          {t.gps_fix
            ? `${fmt(t.lat, 5)}, ${fmt(t.lon, 5)} · ${fmt(t.alt, 0)}m`
            : `HDOP ${fmt(t.hdop, 1)}`}
        </footer>
      </article>

      <article className="card metric metric-static">
        <header>
          <Icon name="signal-alt-2" />
          <span>Radio &amp; Link</span>
        </header>
        <div className="metric-value">
          <span>{t.rssi ?? '--'}</span>
          <small>dBm</small>
        </div>
        <footer className="muted small">
          <Icon name="clock" /> Last seen: {ago(device?.last_seen)}
        </footer>
      </article>
    </section>
  );
}
