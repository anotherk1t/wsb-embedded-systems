import React, { useState } from 'react';

export default function RegisterDeviceModal({ onClose, onRegisterDevice, onClaimDevice }) {
  const [tab, setTab] = useState('claim'); // 'claim' | 'create'
  const [claimCode, setClaimCode] = useState('');
  const [name, setName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [createdCreds, setCreatedCreds] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleClaim(e) {
    e.preventDefault();
    setError('');
    if (!claimCode.trim()) {
      setError('Enter the 6-character Claim Code displayed on the ESP32 QR screen.');
      return;
    }
    setBusy(true);
    try {
      await onClaimDevice({
        code: claimCode.trim(),
        name: name.trim() || undefined,
        location_label: locationLabel.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Please enter a name for the new ESP32 unit.');
      return;
    }
    setBusy(true);
    try {
      const res = await onRegisterDevice({
        device_id: deviceId.trim() || undefined,
        name: name.trim(),
        location_label: locationLabel.trim(),
      });
      setCreatedCreds(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Register ESP32 Device">
        <header className="panel-head">
          <h2>Register or Claim ESP32 Unit</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="seg" role="tablist">
          <button
            type="button"
            className={tab === 'claim' ? 'active' : ''}
            onClick={() => {
              setTab('claim');
              setError('');
            }}
          >
            Claim by ESP32 Code
          </button>
          <button
            type="button"
            className={tab === 'create' ? 'active' : ''}
            onClick={() => {
              setTab('create');
              setError('');
            }}
          >
            Register New Device
          </button>
        </div>

        {tab === 'claim' ? (
          <form className="modal-form" onSubmit={handleClaim}>
            <p className="muted small">
              Open the <strong>QR / Wi-Fi</strong> tab on your ESP32 screen to view its 6-character claim code (or scan the QR code with your phone camera).
            </p>
            <div className="cfg-field">
              <span className="cfg-label">ESP32 Claim Code (or Device ID)</span>
              <input
                type="text"
                placeholder="e.g. A1C801 or cyd-01"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
                required
              />
            </div>
            <div className="cfg-field">
              <span className="cfg-label">Station Name (optional)</span>
              <input
                type="text"
                placeholder="Lab Bench CYD"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="cfg-field">
              <span className="cfg-label">Location Label (optional)</span>
              <input
                type="text"
                placeholder="Building A · Room 204"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="cfg-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Linking…' : 'Claim & Link to Profile'}
              </button>
            </div>
          </form>
        ) : createdCreds ? (
          <div className="modal-form">
            <p className="small">
              Device registered and provisioned in Mosquitto &amp; SQLite. Copy these credentials for <code>secrets.h</code> or the ESP32 Wi-Fi portal:
            </p>
            <dl className="kv cred-box">
              <dt>DEVICE_ID</dt>
              <dd className="mono">{createdCreds.device?.id}</dd>
              <dt>DEVICE_KEY</dt>
              <dd className="mono">{createdCreds.device_key}</dd>
              <dt>CLAIM_CODE</dt>
              <dd className="mono">{createdCreds.claim_code}</dd>
            </dl>
            <div className="cfg-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form className="modal-form" onSubmit={handleCreate}>
            <div className="cfg-field">
              <span className="cfg-label">Station Name</span>
              <input
                type="text"
                placeholder="Field Sensor Node 2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="cfg-field">
              <span className="cfg-label">Custom Device ID (optional, e.g. cyd-02)</span>
              <input
                type="text"
                placeholder="Auto-generated if left blank"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              />
            </div>
            <div className="cfg-field">
              <span className="cfg-label">Location Label (optional)</span>
              <input
                type="text"
                placeholder="Roof Weather Mast"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
              />
            </div>

            {error && <p className="form-error">{error}</p>}

            <div className="cfg-actions">
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create & Generate Key'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
