import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { aqiCategory, fmt } from './MetricCards';
import { formatDuration } from './CalibrationPanel';

const PAGE_LABELS = ['Env', 'GPS', 'QR/Wi-Fi', 'System'];
const LED_CYCLE = ['auto', 'blue', 'green', 'red', 'off'];

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Generates a realistic back-side PCB copper-trace & silkscreen texture matching the
 * physical ESP32-2432S028R (2-USB revision) photo.
 */
function createBackPcbTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');

  // Base amber-yellow solder mask
  ctx.fillStyle = '#d99b16';
  ctx.fillRect(0, 0, 1024, 600);

  // Diagonal gold/copper signal traces in the center of the back PCB (matching photo)
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 4;
  const tracePaths = [
    [[340, 290], [450, 170], [540, 170]],
    [[355, 310], [465, 190], [555, 190]],
    [[370, 330], [480, 210], [570, 210]],
    [[420, 430], [420, 340], [460, 300], [530, 300]],
    [[436, 430], [436, 348], [472, 312], [530, 312]],
    [[452, 430], [452, 356], [484, 324], [530, 324]],
    [[468, 430], [468, 364], [496, 336], [530, 336]],
    [[484, 430], [484, 372], [508, 348], [530, 348]],
  ];
  tracePaths.forEach((pts) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  });

  // ESD triangle emblem in the middle of the PCB
  ctx.strokeStyle = 'rgba(254, 240, 138, 0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(500, 225);
  ctx.lineTo(545, 295);
  ctx.lineTo(455, 295);
  ctx.closePath();
  ctx.stroke();

  // White silkscreen component labels
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = 'bold 16px "Roboto Mono", monospace';
  ctx.fillText('P1 (UART)', 95, 185);
  ctx.fillText('TYPE-C', 95, 315);
  ctx.fillText('MICRO-USB', 95, 425);
  ctx.fillText('RST', 290, 225);
  ctx.fillText('BOOT', 290, 308);
  ctx.fillText('U2 CH340C', 240, 500);
  ctx.fillText('P4 SPK', 345, 92);
  ctx.fillText('TF / SD CARD', 415, 565);
  ctx.fillText('RGB LED', 595, 488);
  ctx.fillText('CN1 (I2C)', 740, 565);
  ctx.fillText('ESP32-2432S028R', 435, 135);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Generates a radial optical bloom/flare sprite texture for the glowing back-side RGB LED.
 */
function createGlowSpriteTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 124);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  grad.addColorStop(0.18, 'rgba(120, 200, 255, 0.92)');
  grad.addColorStop(0.45, 'rgba(0, 102, 255, 0.42)');
  grad.addColorStop(1.0, 'rgba(0, 102, 255, 0.0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Paint the exact 320x240 CYD TFT UI onto a 640x480 (2x HiDPI) HTML5 Canvas.
 */
function paintTftCanvas(
  ctx,
  {
    page,
    apPreview,
    screenState,
    tftToast,
    activeData,
    deviceId,
    device,
    pairing,
    config,
    qrMatrix,
    sparkPoints,
  }
) {
  ctx.save();
  ctx.scale(2, 2);

  if (screenState === 'off') {
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, 320, 240);
    ctx.fillStyle = '#a1a1aa';
    ctx.font = 'bold 12px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SCREEN SLEEP (CLICK TO WAKE)', 160, 120);
    ctx.restore();
    return;
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 320, 240);

  // Top Status Bar (0..24, Solid Merito Blue #0066FF)
  ctx.fillStyle = '#0066ff';
  ctx.fillRect(0, 0, 320, 24);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 10px "Google Sans", Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('WSB MERITO', 6, 12);

  if (apPreview) {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, 74, 4, 52, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#0066ff';
    ctx.font = 'bold 8.5px "Roboto Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('AP SETUP', 100, 12);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9.5px "Roboto Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${activeData.rssi}dB`, 78, 12);
  }

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 130, 4, 34, 16, 3);
  ctx.fill();
  ctx.fillStyle = '#0066ff';
  ctx.font = 'bold 8.5px "Roboto Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('MQTT', 147, 12);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 9.5px "Roboto Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(activeData.fix ? `GPS:${activeData.sats}` : 'NOGPS', 170, 12);
  ctx.fillText(new Date().toISOString().slice(11, 19), 216, 12);

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 274, 4, 40, 16, 3);
  ctx.fill();
  ctx.fillStyle = '#0066ff';
  ctx.textAlign = 'center';
  ctx.fillText(`Q:${activeData.buffered}`, 294, 12);

  function drawCard(x, y, w, h, accentH = 3) {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = '#e4e4e7';
    ctx.lineWidth = 1;
    ctx.stroke();

    if (accentH > 0) {
      ctx.fillStyle = '#0066ff';
      ctx.fillRect(x + 1, y + 1, w - 2, accentH);
    }
  }

  if (page === 0) {
    drawCard(6, 28, 151, 56);
    drawCard(163, 28, 151, 56);
    drawCard(6, 88, 151, 56);
    drawCard(163, 88, 151, 56);

    ctx.font = 'bold 8.5px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'left';
    ctx.fillText('TEMPERATURE', 14, 39);
    ctx.fillText('HUMIDITY', 171, 39);
    ctx.fillText('PRESSURE', 14, 99);
    ctx.fillText('AIR QUALITY', 171, 99);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#0066ff';
    ctx.fillText('BME280', 149, 39);
    ctx.fillText(`Alt:${fmt(activeData.baroAlt, 0)}m`, 149, 99);

    const catName = aqiCategory(activeData.aqi).name.toUpperCase();
    ctx.fillStyle = '#0066ff';
    roundRect(ctx, 248, 93, 59, 13, 3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 7.5px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(catName, 277.5, 99.5);

    ctx.textAlign = 'left';
    ctx.font = 'bold 20px "Google Sans", Roboto, sans-serif';
    ctx.fillStyle = '#09090b';
    ctx.fillText(`${fmt(activeData.temp, 1)} C`, 14, 63);

    ctx.fillStyle = '#0066ff';
    ctx.fillText(`${fmt(activeData.hum, 1)} %`, 171, 63);

    ctx.fillStyle = '#09090b';
    ctx.fillText(`${fmt(activeData.pres, 1)}`, 14, 123);
    ctx.font = 'bold 9px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.fillText('hPa', 124, 125);

    ctx.font = 'bold 20px "Google Sans", Roboto, sans-serif';
    ctx.fillStyle = '#09090b';
    ctx.fillText(`${fmt(activeData.aqi, 0)}`, 171, 121);
    ctx.font = '9px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.fillText('Src: bme280_iaq', 171, 136);

    drawCard(6, 148, 308, 58);
    ctx.font = 'bold 8.5px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'left';
    ctx.fillText('TEMP TREND (60 SAMPLES)', 14, 159);

    const pts = sparkPoints.length >= 2 ? sparkPoints : [25.2, 25.3, 25.4, 25.4];
    let min = Math.min(...pts);
    let max = Math.max(...pts);
    if (max - min < 0.5) {
      min -= 0.25;
      max += 0.25;
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#0066ff';
    ctx.fillText(`${min.toFixed(1)}..${max.toFixed(1)}C`, 306, 159);

    ctx.strokeStyle = '#e4e4e7';
    ctx.beginPath();
    ctx.moveTo(14, 184);
    ctx.lineTo(306, 184);
    ctx.stroke();

    ctx.strokeStyle = '#0066ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((v, idx) => {
      const px = 14 + (idx / (pts.length - 1)) * 292;
      const py = 198 - ((v - min) / (max - min)) * 28;
      if (idx === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  } else if (page === 1) {
    drawCard(6, 28, 308, 26);
    ctx.font = 'bold 11px "Google Sans", Roboto, sans-serif';
    ctx.fillStyle = '#0066ff';
    ctx.textAlign = 'left';
    ctx.fillText(activeData.fix ? 'STATUS: 3D FIX' : 'STATUS: SEARCHING', 14, 42);
    ctx.font = '9px "Roboto Mono", monospace';
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'right';
    ctx.fillText('FixAge: 0.4s (9600b)', 306, 42);

    drawCard(6, 58, 308, 54);
    ctx.font = 'bold 9px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'left';
    ctx.fillText('LAT', 14, 76);
    ctx.fillText('LON', 14, 98);

    ctx.font = 'bold 17px "Roboto Mono", monospace';
    ctx.fillStyle = '#09090b';
    ctx.fillText(fmt(activeData.lat, 6), 54, 76);
    ctx.fillText(fmt(activeData.lon, 6), 54, 98);

    drawCard(6, 116, 151, 43);
    drawCard(163, 116, 151, 43);
    drawCard(6, 163, 151, 43);
    drawCard(163, 163, 151, 43);

    ctx.font = 'bold 8.5px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.fillText('GPS ALTITUDE', 14, 127);
    ctx.fillText('BARO ALTITUDE', 171, 127);
    ctx.fillText('SPEED / COURSE', 14, 174);
    ctx.fillText('SATS / HDOP', 171, 174);

    ctx.font = 'bold 13px "Google Sans", Roboto, sans-serif';
    ctx.fillStyle = '#09090b';
    ctx.fillText(`${fmt(activeData.gpsAlt, 1)} m`, 14, 145);
    ctx.fillStyle = '#0066ff';
    ctx.fillText(`${fmt(activeData.baroAlt, 1)} m`, 171, 145);
    ctx.fillStyle = '#09090b';
    ctx.fillText('0.0 km/h  0d', 14, 192);
    ctx.fillStyle = '#0066ff';
    ctx.fillText(`${activeData.sats} sats  ${fmt(activeData.hdop, 2)}`, 171, 192);
  } else if (page === 2) {
    drawCard(10, 30, 144, 144, 0);
    const cellPx = 5;
    const startX = 10 + (144 - 25 * cellPx) / 2;
    const startY = 30 + (144 - 25 * cellPx) / 2;
    ctx.fillStyle = '#000000';
    for (let r = 0; r < qrMatrix.length; r++) {
      for (let c = 0; c < qrMatrix[r].length; c++) {
        if (qrMatrix[r][c]) {
          ctx.fillRect(startX + c * cellPx, startY + r * cellPx, cellPx, cellPx);
        }
      }
    }
    ctx.font = '9px Roboto, sans-serif';
    ctx.fillStyle = '#52525b';
    ctx.textAlign = 'center';
    ctx.fillText(
      apPreview ? 'Scan camera to join Wi-Fi' : 'Scan to pair on phone',
      82,
      186
    );

    ctx.fillStyle = '#0066ff';
    roundRect(ctx, 160, 32, 148, 22, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px "Google Sans", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(apPreview ? '1. Scan for Wi-Fi' : 'Phone Sign-In QR', 234, 43);

    ctx.textAlign = 'left';
    ctx.font = 'bold 11px Roboto, sans-serif';
    ctx.fillStyle = '#09090b';
    if (apPreview) {
      ctx.fillText('AP: WSB-CYD-Setup', 160, 70);
      ctx.fillText('Pass: merito2026', 160, 90);
      ctx.fillStyle = '#0066ff';
      ctx.fillText('Portal: 192.168.4.1', 160, 110);
    } else {
      ctx.fillText('Scan to sign in &', 160, 68);
      ctx.fillText('link unit on phone', 160, 84);
      ctx.fillStyle = '#0066ff';
      ctx.fillText(
        `Code: ${pairing?.claim_code || device?.claim_code || '------'}`,
        160,
        108
      );
      ctx.fillStyle = '#52525b';
      ctx.font = '10px "Roboto Mono", monospace';
      ctx.fillText(`IP: ${device?.ip || '--'}`, 160, 128);
    }

    ctx.fillStyle = '#0066ff';
    roundRect(ctx, 160, 174, 148, 28, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11.5px "Google Sans", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(apPreview ? 'Exit Setup' : 'Wi-Fi Setup', 234, 188);
  } else if (page === 3) {
    drawCard(6, 28, 308, 178);
    const rows = [
      ['Device / FW', `${deviceId} (FW ${device?.fw || '1.0.0'})`, '#0066ff'],
      ['IP Address', device?.ip || '--', '#09090b'],
      ['Config Ver', `v${config?.version || 1} (intv ${config?.telemetry_interval_s || 10}s)`, '#09090b'],
      ['Uptime', formatDuration(activeData.uptime_ms), '#09090b'],
      ['Free Heap', `${(activeData.heap / 1024).toFixed(1)} KB (Q:${activeData.buffered})`, '#09090b'],
      ['Sensors', 'BME280 | GPS:OK', '#0066ff'],
      ['Display / LDR', `BL:${activeData.backlight}  LDR:${activeData.ldr}`, '#52525b'],
    ];
    rows.forEach(([k, v, col], idx) => {
      const ry = 46 + idx * 22;
      ctx.font = '10.5px Roboto, sans-serif';
      ctx.fillStyle = '#52525b';
      ctx.textAlign = 'left';
      ctx.fillText(k, 16, ry);

      ctx.font = 'bold 10.5px "Roboto Mono", monospace';
      ctx.fillStyle = col;
      ctx.textAlign = 'right';
      ctx.fillText(v, 304, ry);
    });
  }

  if (tftToast) {
    ctx.fillStyle = '#0066ff';
    roundRect(ctx, 16, 28, 288, 26, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11.5px "Google Sans", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(tftToast, 160, 41);
  }

  ctx.fillStyle = '#f4f4f5';
  ctx.fillRect(0, 212, 320, 28);
  ctx.strokeStyle = '#e4e4e7';
  ctx.beginPath();
  ctx.moveTo(0, 212);
  ctx.lineTo(320, 212);
  ctx.stroke();

  PAGE_LABELS.forEach((label, idx) => {
    const bx = idx * 80;
    const isAct = page === idx;
    if (isAct) {
      ctx.fillStyle = '#0066ff';
      ctx.fillRect(bx, 213, 80, 27);
    }
    ctx.fillStyle = isAct ? '#ffffff' : '#52525b';
    ctx.font = `${isAct ? 'bold' : '500'} 11px "Google Sans", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + 40, 226.5);
  });

  if (screenState === 'dim') {
    ctx.fillStyle = 'rgba(9, 9, 11, 0.5)';
    ctx.fillRect(0, 0, 320, 240);
  }

  ctx.restore();
}

/**
 * Interactive Three.js 3D ESP32-2432S028R ("Cheap Yellow Display") Hardware Model
 * with accurate front & back components, working clickable RST / BOOT buttons,
 * working glowing RGB LEDs (front & back), and interactive 320x240 TFT screen.
 */
export default function CydThreeView({
  page,
  apPreview,
  screenState,
  tftToast,
  activeData,
  activeLedClass,
  ledMode,
  deviceId,
  device,
  pairing,
  config,
  qrMatrix,
  sparkPoints,
  onSelectTab,
  onToggleAp,
  onWakeScreen,
  onPressBootButton,
  onPressResetButton,
  onCycleLedMode,
}) {
  const mountRef = useRef(null);
  const screenCanvasRef = useRef(null);
  const screenTexRef = useRef(null);
  const frontLedMatRef = useRef(null);
  const backLedMatRef = useRef(null);
  const backGlowSpriteRef = useRef(null);
  const backPointLightRef = useRef(null);
  const rstCapRef = useRef(null);
  const bootCapRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const [camPreset, setCamPreset] = useState('angled');
  const [hoverHint, setHoverHint] = useState('');

  const callbacksRef = useRef({
    onSelectTab,
    onToggleAp,
    onWakeScreen,
    onPressBootButton,
    onPressResetButton,
    onCycleLedMode,
    page,
    screenState,
    ledMode,
  });
  callbacksRef.current = {
    onSelectTab,
    onToggleAp,
    onWakeScreen,
    onPressBootButton,
    onPressResetButton,
    onCycleLedMode,
    page,
    screenState,
    ledMode,
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 460;
    const height = 355;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f4f4f5');

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 100);
    camera.position.set(1.8, -2.5, 8.2);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4.2;
    controls.maxDistance = 16;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight('#ffffff', 1.35));
    const dirLight1 = new THREE.DirectionalLight('#ffffff', 1.45);
    dirLight1.position.set(5, 6, 9);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight('#ffffff', 1.25);
    dirLight2.position.set(-5, 4, -9);
    scene.add(dirLight2);

    const boardGroup = new THREE.Group();
    scene.add(boardGroup);

    // 1. Yellow Rounded PCB (8.6 x 5.0 x 0.16)
    const pcbShape = new THREE.Shape();
    const pw = 8.6, ph = 5.0, pr = 0.32;
    pcbShape.moveTo(-pw / 2 + pr, -ph / 2);
    pcbShape.lineTo(pw / 2 - pr, -ph / 2);
    pcbShape.quadraticCurveTo(pw / 2, -ph / 2, pw / 2, -ph / 2 + pr);
    pcbShape.lineTo(pw / 2, ph / 2 - pr);
    pcbShape.quadraticCurveTo(pw / 2, ph / 2, pw / 2 - pr, ph / 2);
    pcbShape.lineTo(-pw / 2 + pr, ph / 2);
    pcbShape.quadraticCurveTo(-pw / 2, ph / 2, -pw / 2, ph / 2 - pr);
    pcbShape.lineTo(-pw / 2, -ph / 2 + pr);
    pcbShape.quadraticCurveTo(-pw / 2, -ph / 2, -pw / 2 + pr, -ph / 2);

    const holePositions = [
      [-3.9, 2.1],
      [3.9, 2.1],
      [-3.9, -2.1],
      [3.9, -2.1],
    ];
    holePositions.forEach(([hx, hy]) => {
      const hole = new THREE.Path();
      hole.absarc(hx, hy, 0.16, 0, Math.PI * 2, false);
      pcbShape.holes.push(hole);
    });

    const pcbGeo = new THREE.ExtrudeGeometry(pcbShape, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.02,
      bevelSegments: 2,
    });
    pcbGeo.center();
    const pcbMat = new THREE.MeshStandardMaterial({
      color: '#eab308',
      roughness: 0.42,
      metalness: 0.08,
    });
    const pcbMesh = new THREE.Mesh(pcbGeo, pcbMat);
    boardGroup.add(pcbMesh);

    // Back-side PCB silkscreen & diagonal copper trace plane
    const backPcbTex = createBackPcbTexture();
    const backPlaneGeo = new THREE.PlaneGeometry(8.3, 4.75);
    backPlaneGeo.rotateY(Math.PI); // face -Z (back of the board)
    const backPlaneMat = new THREE.MeshStandardMaterial({
      map: backPcbTex,
      roughness: 0.45,
      metalness: 0.15,
    });
    const backPlane = new THREE.Mesh(backPlaneGeo, backPlaneMat);
    backPlane.position.set(0, 0, -0.102);
    boardGroup.add(backPlane);

    // Plated M3 mounting rings (front and back)
    const padGeo = new THREE.RingGeometry(0.16, 0.28, 24);
    const padMat = new THREE.MeshStandardMaterial({
      color: '#e4e4e7',
      metalness: 0.75,
      roughness: 0.25,
      side: THREE.DoubleSide,
    });
    holePositions.forEach(([hx, hy]) => {
      const topPad = new THREE.Mesh(padGeo, padMat);
      topPad.position.set(hx, hy, 0.105);
      boardGroup.add(topPad);
      const botPad = new THREE.Mesh(padGeo, padMat);
      botPad.position.set(hx, hy, -0.105);
      boardGroup.add(botPad);
    });

    // =========================================================================
    // FRONT SIDE: Black TFT Bezel, 320x240 Screen, Ribbon, Front RGB LED & LDR
    // =========================================================================
    const darkIcMat = new THREE.MeshStandardMaterial({
      color: '#18181b',
      roughness: 0.45,
      metalness: 0.15,
    });
    const silverMat = new THREE.MeshStandardMaterial({
      color: '#d4d4d8',
      metalness: 0.82,
      roughness: 0.22,
    });
    const whiteJstMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      roughness: 0.35,
    });

    const bezelMesh = new THREE.Mesh(new THREE.BoxGeometry(6.85, 4.86, 0.28), darkIcMat);
    bezelMesh.position.set(-0.2, 0, 0.22);
    boardGroup.add(bezelMesh);

    const ribbonMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 3.2, 0.08),
      new THREE.MeshStandardMaterial({ color: '#d97706', roughness: 0.4 })
    );
    ribbonMesh.position.set(-3.75, 0, 0.14);
    boardGroup.add(ribbonMesh);

    const offscreen = document.createElement('canvas');
    offscreen.width = 640;
    offscreen.height = 480;
    screenCanvasRef.current = offscreen;

    const screenTex = new THREE.CanvasTexture(offscreen);
    screenTex.colorSpace = THREE.SRGBColorSpace;
    screenTex.minFilter = THREE.LinearFilter;
    screenTex.magFilter = THREE.LinearFilter;
    screenTexRef.current = screenTex;

    const screenMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5.96, 4.47),
      new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false })
    );
    screenMesh.position.set(-0.18, 0, 0.365);
    screenMesh.name = 'cyd_tft_screen';
    boardGroup.add(screenMesh);

    // Front SMD 5050 RGB LED
    const frontLedBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.16),
      whiteJstMat
    );
    frontLedBase.position.set(3.82, 1.32, 0.16);
    boardGroup.add(frontLedBase);

    const frontLedGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.18, 20);
    frontLedGeo.rotateX(Math.PI / 2);
    const frontLedMat = new THREE.MeshStandardMaterial({
      color: '#0066ff',
      emissive: '#0066ff',
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    frontLedMatRef.current = frontLedMat;
    const frontLedMesh = new THREE.Mesh(frontLedGeo, frontLedMat);
    frontLedMesh.position.set(3.82, 1.32, 0.18);
    frontLedMesh.name = 'cyd_rgb_led';
    boardGroup.add(frontLedMesh);

    const railMesh = new THREE.Mesh(new THREE.BoxGeometry(0.52, 2.2, 0.12), darkIcMat);
    railMesh.position.set(3.82, -0.05, 0.14);
    boardGroup.add(railMesh);

    const ldrMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.42, 0.12),
      new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.35 })
    );
    ldrMesh.position.set(3.82, -1.48, 0.14);
    boardGroup.add(ldrMesh);

    // =========================================================================
    // BACK SIDE (Matching user's physical photo media_1794943513675_6946669d.jpg)
    // Note: When viewing the back of the board (camera at -Z looking toward +Z),
    // screen-left is +X and screen-right is -X!
    // =========================================================================

    // A. Left side of Back View (+X edge: x ≈ +3.85):
    // 1) Top-left White 4-pin JST Connector (P1)
    const p1Jst = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.85, 0.32), whiteJstMat);
    p1Jst.position.set(3.92, 0.95, -0.26);
    boardGroup.add(p1Jst);

    // 2) Middle-left USB-C Port
    const usbC = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.88, 0.32), silverMat);
    usbC.position.set(4.02, -0.1, -0.26);
    boardGroup.add(usbC);

    // 3) Bottom-left Micro-USB Port + plugged-in black USB cable head
    const microUsb = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.76, 0.28), silverMat);
    microUsb.position.set(4.02, -1.15, -0.24);
    boardGroup.add(microUsb);

    const usbPlug = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.86, 0.44), darkIcMat);
    usbPlug.position.set(4.75, -1.15, -0.24);
    boardGroup.add(usbPlug);

    // 4) Interactive RST & BOOT Tactile Buttons (stacked vertically right next to P1/USB-C)
    function createTactileButton(x, y, name) {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.16), silverMat);
      body.position.set(x, y, -0.18);
      boardGroup.add(body);

      const capGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.18, 20);
      capGeo.rotateX(Math.PI / 2);
      const capMat = new THREE.MeshStandardMaterial({
        color: '#09090b',
        roughness: 0.3,
      });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, y, -0.26);
      cap.name = name;
      boardGroup.add(cap);
      return cap;
    }

    const rstCap = createTactileButton(2.65, 0.62, 'cyd_btn_rst');
    rstCapRef.current = rstCap;

    const bootCap = createTactileButton(2.65, -0.12, 'cyd_btn_boot');
    bootCapRef.current = bootCap;

    // 5) Small blue/red Power/UART indicator LED below BOOT button
    const pwrLedMat = new THREE.MeshStandardMaterial({
      color: '#3b82f6',
      emissive: '#3b82f6',
      emissiveIntensity: 1.1,
    });
    const pwrLed = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.1), pwrLedMat);
    pwrLed.position.set(2.65, -0.62, -0.15);
    boardGroup.add(pwrLed);

    // 6) CH340C 16-pin SOIC IC (bottom-left of back view)
    const ch340 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.98, 0.18), darkIcMat);
    ch340.position.set(2.55, -1.45, -0.19);
    boardGroup.add(ch340);

    // B. Top edge of Back View:
    // 1) White 2-pin Speaker JST (P4)
    const spkJst = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.3), whiteJstMat);
    spkJst.position.set(1.65, 2.02, -0.25);
    boardGroup.add(spkJst);

    // 2) Audio Amplifier 8-pin IC
    const ampIc = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.16), darkIcMat);
    ampIc.position.set(-0.25, 1.82, -0.18);
    boardGroup.add(ampIc);

    // 3) Two grey power inductors/resistors near top-right of back view
    [-2.45, -2.95].forEach((ix) => {
      const ind = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.62, 0.18), silverMat);
      ind.position.set(ix, 1.82, -0.19);
      boardGroup.add(ind);
    });

    // C. Right side of Back View (-X edge): ESP32-WROOM-32 Module + PCB Antenna
    const wroomShield = new THREE.Mesh(new THREE.BoxGeometry(1.95, 1.85, 0.32), darkIcMat);
    wroomShield.position.set(-2.35, -0.15, -0.26);
    boardGroup.add(wroomShield);

    const wroomAnt = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 1.85, 0.12),
      new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.5 })
    );
    wroomAnt.position.set(-3.72, -0.15, -0.16);
    boardGroup.add(wroomAnt);

    // D. Bottom-Center & Lower-Right of Back View:
    // 1) MicroSD Card Slot + Plugged-in Sensor Cable Header
    const sdSlot = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.35, 0.28), darkIcMat);
    sdSlot.position.set(0.55, -1.65, -0.24);
    boardGroup.add(sdSlot);

    // 2) THE BRIGHT BACK-SIDE 5050 SMD RGB LED (in exact position from user's photo!)
    const backLedBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.46, 0.16),
      whiteJstMat
    );
    backLedBase.position.set(-0.92, -1.22, -0.18);
    backLedBase.name = 'cyd_rgb_led';
    boardGroup.add(backLedBase);

    const backLedGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.2, 24);
    backLedGeo.rotateX(Math.PI / 2);
    const backLedMat = new THREE.MeshStandardMaterial({
      color: '#0066ff',
      emissive: '#38bdf8',
      emissiveIntensity: 2.5,
      roughness: 0.1,
    });
    backLedMatRef.current = backLedMat;
    const backLedLens = new THREE.Mesh(backLedGeo, backLedMat);
    backLedLens.position.set(-0.92, -1.22, -0.22);
    backLedLens.name = 'cyd_rgb_led';
    boardGroup.add(backLedLens);

    // Optical bloom halo sprite matching the bright blue flare in the user's photo
    const glowTex = createGlowSpriteTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: '#0066ff',
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glowSprite = new THREE.Sprite(glowMat);
    glowSprite.scale.set(2.4, 2.4, 1);
    glowSprite.position.set(-0.92, -1.22, -0.35);
    backGlowSpriteRef.current = glowSprite;
    boardGroup.add(glowSprite);

    const backPointLight = new THREE.PointLight('#0066ff', 3.2, 5.5);
    backPointLight.position.set(-0.92, -1.22, -0.55);
    backPointLightRef.current = backPointLight;
    boardGroup.add(backPointLight);

    // 3) Bottom-right 4-pin JST connectors (CN1 I2C / P3)
    const cn1Jst = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.44, 0.3), whiteJstMat);
    cn1Jst.position.set(-2.25, -2.05, -0.25);
    boardGroup.add(cn1Jst);

    // =========================================================================
    // Raycaster for clicking Screen, RST button, BOOT button, and RGB LED
    // =========================================================================
    const interactiveMeshes = [
      screenMesh,
      rstCap,
      bootCap,
      backLedLens,
      backLedBase,
      frontLedMesh,
    ];
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    function animateButtonPress(mesh) {
      if (!mesh) return;
      const origZ = mesh.position.z;
      mesh.position.z = origZ + 0.08;
      setTimeout(() => {
        mesh.position.z = origZ;
      }, 180);
    }

    function onPointerMove(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveMeshes, false);
      if (!hits.length) {
        setHoverHint('');
        renderer.domElement.style.cursor = 'grab';
        return;
      }
      renderer.domElement.style.cursor = 'pointer';
      const name = hits[0].object.name;
      if (name === 'cyd_btn_rst') {
        setHoverHint('RST Button — Click to Reboot ESP32');
      } else if (name === 'cyd_btn_boot') {
        setHoverHint('BOOT (IO0) Button — Click to Force Sensor Sample & Switch Tab');
      } else if (name === 'cyd_rgb_led') {
        setHoverHint('Onboard RGB LED — Click to Cycle LED Color');
      } else {
        setHoverHint('320×240 Touchscreen — Click Tabs or Buttons');
      }
    }

    function onPointerDown(e) {
      downX = e.clientX;
      downY = e.clientY;
    }

    function onPointerUp(e) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(interactiveMeshes, false);
      if (!hits.length) return;

      const hit = hits[0];
      const name = hit.object.name;
      const cb = callbacksRef.current;

      if (name === 'cyd_btn_rst') {
        animateButtonPress(rstCapRef.current);
        cb.onPressResetButton && cb.onPressResetButton();
        return;
      }

      if (name === 'cyd_btn_boot') {
        animateButtonPress(bootCapRef.current);
        cb.onPressBootButton && cb.onPressBootButton();
        return;
      }

      if (name === 'cyd_rgb_led') {
        const curIdx = LED_CYCLE.indexOf(cb.ledMode || 'auto');
        const nextMode = LED_CYCLE[(curIdx + 1) % LED_CYCLE.length];
        cb.onCycleLedMode && cb.onCycleLedMode(nextMode);
        return;
      }

      if (name === 'cyd_tft_screen' && hit.uv) {
        if (cb.screenState !== 'active') {
          cb.onWakeScreen && cb.onWakeScreen();
          return;
        }
        const tx = hit.uv.x * 320;
        const ty = (1 - hit.uv.y) * 240;

        if (ty >= 208) {
          const tabIdx = Math.max(0, Math.min(3, Math.floor(tx / 80)));
          cb.onSelectTab && cb.onSelectTab(tabIdx);
          return;
        }
        if (cb.page === 2 && tx >= 158 && tx <= 312 && ty >= 170 && ty <= 205) {
          cb.onToggleAp && cb.onToggleAp();
          return;
        }
        if (ty < 170) {
          const next = tx < 160 ? (cb.page + 3) % 4 : (cb.page + 1) % 4;
          cb.onSelectTab && cb.onSelectTab(next);
        }
      }
    }

    const domEl = renderer.domElement;
    domEl.addEventListener('pointermove', onPointerMove);
    domEl.addEventListener('pointerdown', onPointerDown);
    domEl.addEventListener('pointerup', onPointerUp);

    let animId = 0;
    function animate() {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function handleResize() {
      if (!container) return;
      const w = container.clientWidth || 460;
      camera.aspect = w / height;
      camera.updateProjectionMatrix();
      renderer.setSize(w, height);
    }
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      domEl.removeEventListener('pointermove', onPointerMove);
      domEl.removeEventListener('pointerdown', onPointerDown);
      domEl.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Update 2D Screen CanvasTexture & Front/Back RGB LEDs
  useEffect(() => {
    const canvas = screenCanvasRef.current;
    const tex = screenTexRef.current;
    if (canvas && tex) {
      const ctx = canvas.getContext('2d');
      paintTftCanvas(ctx, {
        page,
        apPreview,
        screenState,
        tftToast,
        activeData,
        deviceId,
        device,
        pairing,
        config,
        qrMatrix,
        sparkPoints,
      });
      tex.needsUpdate = true;
    }

    let hex = '#0066ff';
    let emissiveHex = '#38bdf8';
    let intensity = 2.6;
    if (activeLedClass === 'led-off') {
      hex = '#71717a';
      emissiveHex = '#000000';
      intensity = 0;
    } else if (activeLedClass === 'led-red') {
      hex = '#dc2626';
      emissiveHex = '#f87171';
    } else if (activeLedClass === 'led-green') {
      hex = '#16a34a';
      emissiveHex = '#4ade80';
    }

    if (frontLedMatRef.current) {
      frontLedMatRef.current.color.set(hex);
      frontLedMatRef.current.emissive.set(emissiveHex);
      frontLedMatRef.current.emissiveIntensity = intensity > 0 ? 1.5 : 0;
    }
    if (backLedMatRef.current) {
      backLedMatRef.current.color.set(hex);
      backLedMatRef.current.emissive.set(emissiveHex);
      backLedMatRef.current.emissiveIntensity = intensity;
    }
    if (backGlowSpriteRef.current) {
      backGlowSpriteRef.current.material.color.set(hex);
      backGlowSpriteRef.current.material.opacity = intensity > 0 ? 0.92 : 0.0;
    }
    if (backPointLightRef.current) {
      backPointLightRef.current.color.set(hex);
      backPointLightRef.current.intensity = intensity > 0 ? 3.2 : 0;
    }
  }, [
    page,
    apPreview,
    screenState,
    tftToast,
    activeData,
    activeLedClass,
    deviceId,
    device,
    pairing,
    config,
    qrMatrix,
    sparkPoints,
  ]);

  function applyCameraPreset(preset) {
    setCamPreset(preset);
    const cam = cameraRef.current;
    const ctrls = controlsRef.current;
    if (!cam || !ctrls) return;
    ctrls.target.set(0, 0, 0);
    if (preset === 'front') {
      cam.position.set(0, 0, 8.3);
    } else if (preset === 'back') {
      cam.position.set(0, -0.4, -8.3);
    } else {
      cam.position.set(1.8, -2.5, 8.2);
    }
    ctrls.update();
  }

  return (
    <div className="cyd-three-wrap">
      <div className="cyd-three-toolbar">
        <div className="seg">
          <button
            type="button"
            className={camPreset === 'angled' ? 'active' : ''}
            onClick={() => applyCameraPreset('angled')}
          >
            3D Front
          </button>
          <button
            type="button"
            className={camPreset === 'front' ? 'active' : ''}
            onClick={() => applyCameraPreset('front')}
          >
            Front 1:1
          </button>
          <button
            type="button"
            className={camPreset === 'back' ? 'active' : ''}
            onClick={() => applyCameraPreset('back')}
          >
            Back PCB (Ports, LED &amp; Buttons)
          </button>
        </div>
        <span className="muted small">
          {hoverHint || 'Drag to rotate 360° · Click Screen, Back RGB LED, RST or BOOT buttons'}
        </span>
      </div>
      <div ref={mountRef} className="cyd-three-canvas" />
    </div>
  );
}
