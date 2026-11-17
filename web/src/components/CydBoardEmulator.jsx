import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import { NumberField, SwitchField } from './FormControls';
import { formatDuration } from './CalibrationPanel';
import { aqiCategory, fmt } from './MetricCards';
import CydThreeView from './CydThreeView';

const PAGE_LABELS = ['Env', 'GPS', 'QR/Wi-Fi', 'System'];
const PAGE_TITLES = ['Environment', 'GPS Fix', 'QR & Wi-Fi', 'System Info'];
const LED_OPTIONS = [
  { key: 'auto', label: 'Auto' },
  { key: 'blue', label: 'Blue' },
  { key: 'green', label: 'Green' },
  { key: 'red', label: 'Red' },
  { key: 'off', label: 'Off' },
];
const SCREEN_OPTIONS = [
  { key: 'wake', label: 'Wake (Active)' },
  { key: 'dim', label: 'Dim (10%)' },
  { key: 'off', label: 'Sleep (Off)' },
];

/**
 * Deterministic visual QR matrix generator (25x25 Version 2 layout with finder patterns,
 * timing lines, and payload-seeded data modules) for the 320x240 TFT canvas.
 */
function buildVisualQrMatrix(text) {
  const size = 25;
  const grid = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array(size).fill(false));

  function placeFinder(r0, c0) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = r0 + r;
        const cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6);
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        grid[rr][cc] = inOuter || inInner;
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    grid[6][i] = i % 2 === 0;
    grid[i][6] = i % 2 === 0;
  }

  // Alignment pattern at (16, 16)
  for (let r = 16; r <= 20; r++) {
    for (let c = 16; c <= 20; c++) {
      reserved[r][c] = true;
      grid[r][c] = r === 16 || r === 20 || c === 16 || c === 20 || (r === 18 && c === 18);
    }
  }

  let hash = 2166136261;
  const s = text || 'https://wsbmerito.telemetry.164-92-227-240.sslip.io/';
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      hash ^= (r * 31 + c * 17 + s.charCodeAt((r * size + c) % s.length)) & 0xff;
      hash = Math.imul(hash, 16777619);
      grid[r][c] = (hash >>> 3) % 2 === 0;
    }
  }
  return grid;
}

export default function CydBoardEmulator({
  deviceId,
  device,
  pairing,
  latest,
  seriesPoints,
  config,
  onSendCommand,
  onSimulatePacket,
  onNotify,
}) {
  const [viewStyle, setViewStyle] = useState('3d'); // '3d' | 'flat'
  const [controlTab, setControlTab] = useState('remote'); // 'remote' | 'impersonate'
  const [page, setPage] = useState(0);
  const [apPreview, setApPreview] = useState(false);
  const [screenState, setScreenState] = useState('active'); // 'active' | 'dim' | 'off'
  const [ledMode, setLedMode] = useState('auto'); // 'auto' | 'blue' | 'green' | 'red' | 'off'
  const [ledBlink, setLedBlink] = useState(false);
  const [tftToast, setTftToast] = useState('');
  const [toastInput, setToastInput] = useState('WSB Merito Lab Check');

  // Impersonation state
  const [autoStream, setAutoStream] = useState(false);
  const [sim, setSim] = useState({
    temp_c: 25.4,
    humidity: 45.2,
    pressure_hpa: 988.2,
    aqi: 30,
    lat: 54.3757,
    lon: 18.5987,
    sats: 7,
    hdop: 1.1,
    rssi: -59,
    ldr: 580,
  });

  // WebSerial state
  const [usbConnected, setUsbConnected] = useState(false);
  const [usbLogs, setUsbLogs] = useState([]);
  const portRef = useRef(null);
  const readerRef = useRef(null);

  // Sync virtual page/LED/screen from physical device live_state when reported
  useEffect(() => {
    const ls = device?.live_state;
    if (!ls) return;
    if (Number.isInteger(ls.page) && ls.page >= 0 && ls.page <= 3) {
      setPage(ls.page);
    }
    if (typeof ls.screen_state === 'string') {
      setScreenState(ls.screen_state);
    }
    if (typeof ls.led_mode === 'string') {
      setLedMode(ls.led_mode);
    }
  }, [device?.live_state]);

  // Seed impersonator values from latest real reading once
  const seededRef = useRef(false);
  useEffect(() => {
    if (!latest || seededRef.current) return;
    seededRef.current = true;
    setSim((prev) => ({
      ...prev,
      temp_c: latest.temp_c ?? prev.temp_c,
      humidity: latest.humidity ?? prev.humidity,
      pressure_hpa: latest.pressure_hpa ?? prev.pressure_hpa,
      aqi: latest.aqi ?? prev.aqi,
      lat: latest.lat ?? prev.lat,
      lon: latest.lon ?? prev.lon,
      sats: latest.sats ?? prev.sats,
      hdop: latest.hdop ?? prev.hdop,
      rssi: latest.rssi ?? prev.rssi,
    }));
  }, [latest]);

  // Flash virtual LED when new telemetry arrives
  useEffect(() => {
    if (!latest?.ts) return;
    setLedBlink(true);
    const t = setTimeout(() => setLedBlink(false), 320);
    return () => clearTimeout(t);
  }, [latest?.ts, latest?.seq]);

  // Clear virtual TFT toast after 3.5s
  useEffect(() => {
    if (!tftToast) return;
    const t = setTimeout(() => setTftToast(''), 3500);
    return () => clearTimeout(t);
  }, [tftToast]);

  // Auto-stream impersonated packets every 5s when enabled
  useEffect(() => {
    if (!autoStream || !deviceId) return;
    const id = setInterval(() => {
      handleSendSimPacket();
    }, 5000);
    return () => clearInterval(id);
  }, [autoStream, deviceId, sim, page]);

  // Active data displayed on the virtual 320x240 TFT screen
  const activeData = useMemo(() => {
    const useSim = controlTab === 'impersonate';
    const temp = useSim ? Number(sim.temp_c) : latest?.temp_c;
    const hum = useSim ? Number(sim.humidity) : latest?.humidity;
    const pres = useSim ? Number(sim.pressure_hpa) : latest?.pressure_hpa;
    const aqi = useSim ? Number(sim.aqi) : latest?.aqi;
    const lat = useSim ? Number(sim.lat) : latest?.lat;
    const lon = useSim ? Number(sim.lon) : latest?.lon;
    const sats = useSim ? Number(sim.sats) : (latest?.sats ?? 7);
    const hdop = useSim ? Number(sim.hdop) : (latest?.hdop ?? 1.1);
    const rssi = useSim ? Number(sim.rssi) : (latest?.rssi ?? -60);
    const slp = config?.sea_level_hpa || 1013.25;
    const baroAlt =
      pres && pres > 0 ? 44330.0 * (1.0 - Math.pow(pres / slp, 0.190295)) : null;
    const gpsAlt = latest?.alt ?? baroAlt ?? 35.0;

    return {
      temp,
      hum,
      pres,
      aqi,
      lat,
      lon,
      sats,
      hdop,
      rssi,
      baroAlt,
      gpsAlt,
      fix: lat !== null && lat !== undefined && lon !== null && lon !== undefined,
      uptime_ms: latest?.uptime_ms ?? 120000,
      heap: latest?.heap ?? 199352,
      buffered: latest?.buffered ?? 0,
      ldr: useSim ? Number(sim.ldr) : (device?.live_state?.ldr ?? 580),
      backlight: device?.live_state?.backlight ?? config?.display_brightness ?? 200,
    };
  }, [controlTab, sim, latest, config, device]);

  const qrText = apPreview
    ? 'WIFI:T:WPA;S:WSB-CYD-Setup;P:merito2026;;'
    : pairing?.pair_url || `https://wsbmerito.telemetry.164-92-227-240.sslip.io/?device=${deviceId}`;

  const qrMatrix = useMemo(() => buildVisualQrMatrix(qrText), [qrText]);

  const sparkPoints = useMemo(() => {
    const pts = (seriesPoints || [])
      .map((p) => p.temp_c)
      .filter((v) => v !== null && v !== undefined)
      .slice(-40);
    if (activeData.temp !== null && activeData.temp !== undefined) {
      pts.push(Number(activeData.temp));
    }
    return pts;
  }, [seriesPoints, activeData.temp]);

  const sparkCoords = useMemo(() => {
    const pts = sparkPoints;
    if (pts.length < 2) return { path: 'M 6 22 L 266 22', range: '--' };
    let min = Math.min(...pts);
    let max = Math.max(...pts);
    if (max - min < 0.5) {
      min -= 0.25;
      max += 0.25;
    }
    const coords = pts.map((v, i) => {
      const x = 6 + (i / (pts.length - 1)) * 260;
      const y = 32 - ((v - min) / (max - min)) * 24;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    return {
      path: coords.join(' '),
      range: `${min.toFixed(1)}..${max.toFixed(1)}C`,
    };
  }, [sparkPoints]);

  async function handleSelectTab(nextPage) {
    setPage(nextPage);
    if (screenState !== 'active') setScreenState('active');
    try {
      await onSendCommand({ cmd: 'set_page', page: nextPage });
    } catch {
      // ignore if offline
    }
  }

  async function handleRemoteToast(e) {
    e.preventDefault();
    if (!toastInput.trim()) return;
    setTftToast(toastInput.trim());
    await onSendCommand({ cmd: 'toast', message: toastInput.trim() });
  }

  async function handleLedChange(nextMode) {
    setLedMode(nextMode);
    await onSendCommand({ cmd: 'led', mode: nextMode });
  }

  async function handleScreenChange(nextState) {
    setScreenState(nextState === 'wake' ? 'active' : nextState);
    await onSendCommand({ cmd: 'screen', state: nextState });
  }

  async function handleSendSimPacket() {
    setLedBlink(true);
    setTimeout(() => setLedBlink(false), 320);
    await onSimulatePacket({
      temp_c: Number(sim.temp_c),
      humidity: Number(sim.humidity),
      pressure_hpa: Number(sim.pressure_hpa),
      aqi: Number(sim.aqi),
      lat: Number(sim.lat),
      lon: Number(sim.lon),
      sats: Number(sim.sats),
      hdop: Number(sim.hdop),
      rssi: Number(sim.rssi),
      ldr: Number(sim.ldr),
      page,
    });
  }

  async function handleToggleUsbSerial() {
    if (usbConnected) {
      try {
        if (readerRef.current) await readerRef.current.cancel();
        if (portRef.current) await portRef.current.close();
      } catch {
        // ignore
      }
      setUsbConnected(false);
      setTftToast('USB Serial disconnected');
      onNotify?.('Disconnected USB Serial monitor');
      return;
    }
    if (!('serial' in navigator)) {
      setTftToast('WebSerial requires Chrome or Edge');
      onNotify?.('USB Serial monitor requires Google Chrome or Microsoft Edge', 'warn');
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      portRef.current = port;
      setUsbConnected(true);
      setTftToast('USB Serial connected (115200)');
      onNotify?.('Connected to ESP32 USB Serial port at 115200 baud');

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      readerRef.current = reader;

      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buf += value;
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() || '';
          if (lines.length) {
            setUsbLogs((prev) => [...lines.reverse(), ...prev].slice(0, 40));
          }
        }
      }
    } catch {
      setUsbConnected(false);
    }
  }

  // Compute physical RGB LED color class
  const activeLedClass = useMemo(() => {
    if (ledMode === 'off') return 'led-off';
    if (ledMode === 'red') return 'led-red';
    if (ledMode === 'green') return 'led-green';
    if (ledMode === 'blue' || ledBlink) return 'led-blue';
    if (apPreview) return 'led-blue';
    if (!device?.online && controlTab !== 'impersonate') return 'led-red';
    return 'led-blue';
  }, [ledMode, ledBlink, apPreview, device?.online, controlTab]);

  // Render the 320x240 TFT Screen DOM
  const tftScreen = (
    <div
      className={`cyd-tft ${screenState === 'dim' ? 'tft-dim' : ''} ${screenState === 'off' ? 'tft-off' : ''}`}
      onClick={() => {
        if (screenState !== 'active') handleScreenChange('wake');
      }}
    >
      {/* Top Status Bar (320x24 Solid Merito Blue) */}
      <div className="cyd-tft-topbar">
        <span className="cyd-tft-brand">WSB MERITO</span>
        {apPreview ? (
          <span className="cyd-tft-pill">AP SETUP</span>
        ) : (
          <span className="cyd-tft-stat">{activeData.rssi}dB</span>
        )}
        <span className="cyd-tft-pill">MQTT</span>
        <span className="cyd-tft-stat">
          {activeData.fix ? `GPS:${activeData.sats}` : 'NOGPS'}
        </span>
        <span className="cyd-tft-stat">
          {new Date().toISOString().slice(11, 19)}
        </span>
        <span className="cyd-tft-pill">Q:{activeData.buffered}</span>
      </div>

      {/* Onboard Toast Overlay */}
      {tftToast && <div className="cyd-tft-toast">{tftToast}</div>}

      {/* Content Area (320x188) */}
      <div className="cyd-tft-body">
        {page === 0 && (
          <div className="cyd-page-env">
            <div className="cyd-env-grid">
              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head">
                  <span>TEMPERATURE</span>
                  <span>BME280</span>
                </div>
                <div className="cyd-mini-val">{fmt(activeData.temp, 1)} C</div>
              </div>

              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head">
                  <span>HUMIDITY</span>
                </div>
                <div className="cyd-mini-val cyd-blue-text">
                  {fmt(activeData.hum, 1)} %
                </div>
              </div>

              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head">
                  <span>PRESSURE</span>
                  <span className="cyd-blue-text">
                    Alt:{fmt(activeData.baroAlt, 0)}m
                  </span>
                </div>
                <div className="cyd-mini-val">
                  {fmt(activeData.pres, 1)} <small>hPa</small>
                </div>
              </div>

              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head">
                  <span>AIR QUALITY</span>
                  <span className="cyd-aqi-pill">
                    {aqiCategory(activeData.aqi).name.toUpperCase()}
                  </span>
                </div>
                <div className="cyd-mini-val">{fmt(activeData.aqi, 0)}</div>
              </div>
            </div>

            <div className="cyd-spark-card">
              <div className="cyd-mini-accent" />
              <div className="cyd-mini-head">
                <span>TEMP TREND (60 SAMPLES)</span>
                <span className="cyd-blue-text">{sparkCoords.range}</span>
              </div>
              <svg viewBox="0 0 272 36" className="cyd-spark-svg">
                <line x1="6" y1="18" x2="266" y2="18" stroke="#e4e4e7" strokeWidth="1" />
                <path d={sparkCoords.path} fill="none" stroke="#0066ff" strokeWidth="2" />
              </svg>
            </div>
          </div>
        )}

        {page === 1 && (
          <div className="cyd-page-gps">
            <div className="cyd-gps-bar">
              <div className="cyd-mini-accent" />
              <span className="cyd-blue-text">
                STATUS: {activeData.fix ? '3D FIX' : 'SEARCHING'}
              </span>
              <span className="cyd-muted-text">FixAge: 0.4s (9600b)</span>
            </div>

            <div className="cyd-gps-coords">
              <div className="cyd-mini-accent" />
              <div>
                <span className="cyd-muted-text">LAT</span>
                <strong>{fmt(activeData.lat, 6)}</strong>
              </div>
              <div>
                <span className="cyd-muted-text">LON</span>
                <strong>{fmt(activeData.lon, 6)}</strong>
              </div>
            </div>

            <div className="cyd-env-grid">
              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head"><span>GPS ALTITUDE</span></div>
                <div className="cyd-mini-subval">{fmt(activeData.gpsAlt, 1)} m</div>
              </div>
              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head"><span>BARO ALTITUDE</span></div>
                <div className="cyd-mini-subval cyd-blue-text">{fmt(activeData.baroAlt, 1)} m</div>
              </div>
              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head"><span>SPEED / COURSE</span></div>
                <div className="cyd-mini-subval">0.0 km/h 0d</div>
              </div>
              <div className="cyd-mini-card">
                <div className="cyd-mini-accent" />
                <div className="cyd-mini-head"><span>SATS / HDOP</span></div>
                <div className="cyd-mini-subval cyd-blue-text">
                  {activeData.sats} sats {fmt(activeData.hdop, 2)}
                </div>
              </div>
            </div>
          </div>
        )}

        {page === 2 && (
          <div className="cyd-page-qr">
            <div className="cyd-qr-box">
              <div className="cyd-qr-grid">
                {qrMatrix.map((row, rIdx) =>
                  row.map((cell, cIdx) => (
                    <span
                      key={`${rIdx}-${cIdx}`}
                      className={cell ? 'qr-on' : 'qr-off'}
                    />
                  ))
                )}
              </div>
              <span className="cyd-qr-caption">
                {apPreview ? 'Scan camera to join Wi-Fi' : 'Scan to pair on phone'}
              </span>
            </div>

            <div className="cyd-qr-info">
              <div className="cyd-qr-pill">
                {apPreview ? '1. Scan for Wi-Fi' : 'Phone Sign-In QR'}
              </div>
              {apPreview ? (
                <>
                  <p>AP: WSB-CYD-Setup</p>
                  <p>Pass: merito2026</p>
                  <p className="cyd-blue-text">Portal: 192.168.4.1</p>
                </>
              ) : (
                <>
                  <p>Scan to sign in &amp; link unit</p>
                  <p className="cyd-blue-text">
                    Code: {pairing?.claim_code || device?.claim_code || '------'}
                  </p>
                  <p className="cyd-muted-text">IP: {device?.ip || '--'}</p>
                </>
              )}
              <button
                type="button"
                className="cyd-tft-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  const next = !apPreview;
                  setApPreview(next);
                  onSendCommand({ cmd: next ? 'start_ap' : 'stop_ap' }).catch(() => {});
                }}
              >
                {apPreview ? 'Exit Setup' : 'Wi-Fi Setup'}
              </button>
            </div>
          </div>
        )}

        {page === 3 && (
          <div className="cyd-page-sys">
            <div className="cyd-mini-accent" />
            <div className="cyd-sys-row">
              <span>Device / FW</span>
              <strong className="cyd-blue-text">{deviceId} (FW {device?.fw || '1.0.0'})</strong>
            </div>
            <div className="cyd-sys-row">
              <span>IP Address</span>
              <strong>{device?.ip || '--'}</strong>
            </div>
            <div className="cyd-sys-row">
              <span>Config Ver</span>
              <strong>v{config?.version || 1} ({config?.telemetry_interval_s || 10}s)</strong>
            </div>
            <div className="cyd-sys-row">
              <span>Uptime</span>
              <strong>{formatDuration(activeData.uptime_ms)}</strong>
            </div>
            <div className="cyd-sys-row">
              <span>Free Heap</span>
              <strong>{(activeData.heap / 1024).toFixed(1)} KB (Q:{activeData.buffered})</strong>
            </div>
            <div className="cyd-sys-row">
              <span>Sensors</span>
              <strong className="cyd-blue-text">BME280 | GPS:OK</strong>
            </div>
            <div className="cyd-sys-row">
              <span>Display/LDR</span>
              <strong>BL:{activeData.backlight} LDR:{activeData.ldr}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Bottom 4-Tab Bar (y=212..240) */}
      <div className="cyd-tft-navbar">
        {PAGE_LABELS.map((label, idx) => (
          <button
            key={label}
            type="button"
            className={page === idx ? 'active' : ''}
            onClick={(e) => {
              e.stopPropagation();
              handleSelectTab(idx);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <article className="card panel">
      <header className="panel-head">
        <h2>
          <Icon name="display-code" /> ESP32-2432S028R Visual Digital Twin &amp; Board Controller
        </h2>

        <div className="seg" role="tablist" aria-label="Hardware mockup style">
          <button
            type="button"
            className={viewStyle === '3d' ? 'active' : ''}
            onClick={() => setViewStyle('3d')}
          >
            Interactive 3D (Three.js)
          </button>
          <button
            type="button"
            className={viewStyle === 'flat' ? 'active' : ''}
            onClick={() => setViewStyle('flat')}
          >
            Flat 2D PCB View
          </button>
        </div>

        <div className="seg" role="tablist" aria-label="Control mode">
          <button
            type="button"
            className={controlTab === 'remote' ? 'active' : ''}
            onClick={() => setControlTab('remote')}
          >
            Remote Control Board
          </button>
          <button
            type="button"
            className={controlTab === 'impersonate' ? 'active' : ''}
            onClick={() => setControlTab('impersonate')}
          >
            Impersonate / Simulate
          </button>
        </div>
      </header>

      <div className="cyd-twin-layout">
        {/* Left: Visual CYD Hardware Mockup */}
        <div className="cyd-stage-wrap">
          {viewStyle === 'flat' ? (
            <div className="cyd-pcb-board">
              <span className="cyd-hole hole-tl" />
              <span className="cyd-hole hole-tr" />
              <span className="cyd-hole hole-bl" />
              <span className="cyd-hole hole-br" />
              <div className="cyd-ribbon" title="TFT FPC Ribbon" />
              <div className="cyd-bezel">{tftScreen}</div>
              <div className="cyd-right-rail">
                <div
                  className={`cyd-rgb-led ${activeLedClass}`}
                  title="Onboard RGB LED (GPIO 4/16/17)"
                />
                <div className="cyd-ic-block" />
                <div className="cyd-ldr-sensor" title={`LDR GPIO 34 (${activeData.ldr})`} />
              </div>
            </div>
          ) : (
            <CydThreeView
              page={page}
              apPreview={apPreview}
              screenState={screenState}
              tftToast={tftToast}
              activeData={activeData}
              activeLedClass={activeLedClass}
              ledMode={ledMode}
              deviceId={deviceId}
              device={device}
              pairing={pairing}
              config={config}
              qrMatrix={qrMatrix}
              sparkPoints={sparkPoints}
              onSelectTab={handleSelectTab}
              onToggleAp={() => {
                const next = !apPreview;
                setApPreview(next);
                onSendCommand({ cmd: next ? 'start_ap' : 'stop_ap' }).catch(() => {});
              }}
              onWakeScreen={() => handleScreenChange('wake')}
              onPressBootButton={() => {
                const next = (page + 1) % 4;
                setTftToast(`BOOT: ${PAGE_TITLES[next]} + sensor read`);
                setPage(next);
                if (screenState !== 'active') setScreenState('active');
                onSendCommand(
                  { cmd: 'set_page', page: next },
                  `Pressed BOOT button: switched ${deviceId} to ${PAGE_TITLES[next]} tab & sampled sensors`
                ).catch(() => {});
                onSendCommand({ cmd: 'sample_now' }, null).catch(() => {});
              }}
              onPressResetButton={() => {
                setTftToast('RST: Restarting ESP32 board...');
                onSendCommand({ cmd: 'reboot' }).catch(() => {});
              }}
              onCycleLedMode={(nextMode) => {
                const ledLabel =
                  LED_OPTIONS.find((o) => o.key === nextMode)?.label || nextMode.toUpperCase();
                setTftToast(`RGB LED: ${ledLabel}`);
                handleLedChange(nextMode);
              }}
            />
          )}
          <p className="muted small center">
            Click the bottom tabs (<strong>Env</strong>, <strong>GPS</strong>, <strong>QR/Wi-Fi</strong>, <strong>System</strong>) on the screen above to switch both the mockup and your physical ESP32 screen.
          </p>
        </div>

        {/* Right: Structured Remote Control OR Impersonator Controls */}
        <div className="cyd-control-dock">
          {controlTab === 'remote' ? (
            <div className="cyd-dock-section">
              <div className="cyd-dock-intro">
                <div>
                  <h3>Live Physical Board Remote Control ({deviceId})</h3>
                  <p className="muted small">
                    Commands are dispatched immediately over MQTT (<code>wsb/devices/{deviceId}/cmd</code>) to your connected ESP32 CYD.
                  </p>
                </div>
              </div>

              {/* Section 1: Display & Screen Navigation */}
              <section className="cyd-control-group">
                <div className="cyd-group-head">
                  <h4>
                    <Icon name="display-code" /> Display &amp; Screen Navigation
                  </h4>
                  <span className="mono muted small">320×240 ILI9341 TFT</span>
                </div>

                <div className="cyd-group-grid">
                  <div className="cfg-field">
                    <span className="cfg-label">Onboard Screen Tab</span>
                    <div className="seg seg-grid-4">
                      {PAGE_TITLES.map((title, idx) => (
                        <button
                          key={title}
                          type="button"
                          className={page === idx ? 'active' : ''}
                          onClick={() => handleSelectTab(idx)}
                        >
                          {title}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="cfg-field">
                    <span className="cfg-label">Backlight &amp; Power Mode</span>
                    <div className="seg seg-grid-3">
                      {SCREEN_OPTIONS.map((s) => (
                        <button
                          key={s.key}
                          type="button"
                          className={
                            (s.key === 'wake' && screenState === 'active') || screenState === s.key
                              ? 'active'
                              : ''
                          }
                          onClick={() => handleScreenChange(s.key)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <form className="cfg-field" onSubmit={handleRemoteToast}>
                  <span className="cfg-label">On-Screen Banner Message</span>
                  <div className="pw-row">
                    <input
                      type="text"
                      className="flex-1"
                      maxLength={42}
                      value={toastInput}
                      onChange={(e) => setToastInput(e.target.value)}
                      placeholder="Type a message to display on the ESP32 screen"
                    />
                    <button type="submit" className="btn">
                      Display on Screen
                    </button>
                  </div>
                </form>
              </section>

              {/* Section 2: RGB Status LED & Sensor Sampling */}
              <section className="cyd-control-group">
                <div className="cyd-group-head">
                  <h4>
                    <Icon name="bulb" /> RGB Status LED &amp; Sensor Sampling
                  </h4>
                  <span className="mono muted small">GPIO 4 / 16 / 17 &amp; I2C</span>
                </div>

                <div className="cfg-field">
                  <span className="cfg-label">Onboard 5050 RGB LED Color Mode</span>
                  <div className="seg seg-grid-5">
                    {LED_OPTIONS.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={ledMode === m.key ? 'active' : ''}
                        onClick={() => handleLedChange(m.key)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="cfg-field">
                  <span className="cfg-label">Immediate Sensor &amp; Display Actions</span>
                  <div className="cyd-btn-grid-2">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setTftToast('Reading BME280 + GPS sensors now...');
                        onSendCommand({ cmd: 'sample_now' });
                      }}
                    >
                      Read Sensors Now
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setTftToast('Display color polarity flipped');
                        onSendCommand({ cmd: 'invert' });
                      }}
                    >
                      Flip Screen Polarity
                    </button>
                  </div>
                </div>
              </section>

              {/* Section 3: Connectivity, USB Serial & System Power */}
              <section className="cyd-control-group">
                <div className="cyd-group-head">
                  <h4>
                    <Icon name="settings-sliders" /> Connectivity, USB Serial &amp; System Power
                  </h4>
                  <span className="mono muted small">Wi-Fi SoftAP · CH340C 115200b</span>
                </div>

                <div className="cyd-btn-grid-3">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      const next = !apPreview;
                      setApPreview(next);
                      setPage(2);
                      setTftToast(
                        next
                          ? 'Wi-Fi Setup AP active (192.168.4.1)'
                          : 'Closed Wi-Fi Setup AP'
                      );
                      onSendCommand({ cmd: next ? 'start_ap' : 'stop_ap' });
                    }}
                  >
                    {apPreview ? 'Close Wi-Fi Setup AP' : 'Open Wi-Fi Setup AP'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={handleToggleUsbSerial}
                  >
                    {usbConnected ? 'Disconnect USB Serial' : 'Connect USB Serial'}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setTftToast('Restarting ESP32 firmware...');
                      onSendCommand({ cmd: 'reboot' });
                    }}
                  >
                    Restart ESP32 Board
                  </button>
                </div>

                {usbConnected && (
                  <div className="cyd-usb-console mono small">
                    {usbLogs.length === 0
                      ? 'Listening on USB Serial (115200 baud)...'
                      : usbLogs.map((l, i) => <div key={i}>{l}</div>)}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className="cyd-dock-section">
              <div className="cyd-dock-intro">
                <div>
                  <h3>Impersonate Board &amp; Inject Telemetry ({deviceId})</h3>
                  <p className="muted small">
                    Adjust virtual sensor and GPS readings below to test how both the onboard TFT and the cloud dashboard respond.
                  </p>
                </div>
              </div>

              {/* Section 1: Environmental Sensor Values */}
              <section className="cyd-control-group">
                <div className="cyd-group-head">
                  <h4>
                    <Icon name="temperature-high" /> Environmental Sensor Readings
                  </h4>
                  <span className="mono muted small">BME280 · ENS160</span>
                </div>

                <div className="cfg-grid">
                  <div className="cfg-field">
                    <span className="cfg-label">Simulated Temperature (°C)</span>
                    <NumberField
                      value={sim.temp_c}
                      min={-20}
                      max={60}
                      step={0.5}
                      unit="°C"
                      onChange={(v) => setSim((p) => ({ ...p, temp_c: v }))}
                    />
                  </div>
                  <div className="cfg-field">
                    <span className="cfg-label">Simulated Humidity (%RH)</span>
                    <NumberField
                      value={sim.humidity}
                      min={0}
                      max={100}
                      step={1}
                      unit="%"
                      onChange={(v) => setSim((p) => ({ ...p, humidity: v }))}
                    />
                  </div>
                  <div className="cfg-field">
                    <span className="cfg-label">Simulated Pressure (hPa)</span>
                    <NumberField
                      value={sim.pressure_hpa}
                      min={880}
                      max={1080}
                      step={0.5}
                      unit="hPa"
                      onChange={(v) => setSim((p) => ({ ...p, pressure_hpa: v }))}
                    />
                  </div>
                  <div className="cfg-field">
                    <span className="cfg-label">Simulated Air Quality Index (0–500)</span>
                    <NumberField
                      value={sim.aqi}
                      min={0}
                      max={500}
                      step={5}
                      onChange={(v) => setSim((p) => ({ ...p, aqi: v }))}
                    />
                  </div>
                </div>
              </section>

              {/* Section 2: GPS Coordinates, Radio Link & Light Sensor */}
              <section className="cyd-control-group">
                <div className="cyd-group-head">
                  <h4>
                    <Icon name="marker" /> GPS Coordinates, Radio Link &amp; Ambient Light
                  </h4>
                  <span className="mono muted small">UART2 GPS · Wi-Fi · LDR</span>
                </div>

                <div className="cfg-grid">
                  <div className="cfg-field">
                    <span className="cfg-label">GPS Latitude</span>
                    <NumberField
                      value={sim.lat}
                      min={-90}
                      max={90}
                      step={0.0005}
                      onChange={(v) => setSim((p) => ({ ...p, lat: v }))}
                    />
                  </div>
                  <div className="cfg-field">
                    <span className="cfg-label">GPS Longitude</span>
                    <NumberField
                      value={sim.lon}
                      min={-180}
                      max={180}
                      step={0.0005}
                      onChange={(v) => setSim((p) => ({ ...p, lon: v }))}
                    />
                  </div>
                  <div className="cfg-field">
                    <span className="cfg-label">Wi-Fi Signal RSSI (dBm)</span>
                    <NumberField
                      value={sim.rssi}
                      min={-105}
                      max={-25}
                      step={2}
                      unit="dBm"
                      onChange={(v) => setSim((p) => ({ ...p, rssi: v }))}
                    />
                  </div>
                  <div className="cfg-field">
                    <span className="cfg-label">LDR Ambient Light (0–4095)</span>
                    <NumberField
                      value={sim.ldr}
                      min={0}
                      max={4095}
                      step={100}
                      onChange={(v) => setSim((p) => ({ ...p, ldr: v }))}
                    />
                  </div>
                </div>

                <div className="cyd-sim-footer">
                  <SwitchField
                    checked={autoStream}
                    onChange={(enabled) => {
                      setAutoStream(enabled);
                      onNotify?.(
                        enabled
                          ? `Started streaming simulated readings every 5 seconds for ${deviceId}`
                          : `Stopped automatic simulated stream for ${deviceId}`
                      );
                    }}
                    label="Auto-stream simulated readings every 5 seconds"
                  />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleSendSimPacket}
                  >
                    Publish Simulated Reading
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
