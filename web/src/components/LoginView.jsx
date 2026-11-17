import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import WsbLogo from './WsbLogo';
import { SelectField } from './FormControls';

const ROLE_OPTIONS = [
  { value: 'Student', label: 'Student' },
  { value: 'Researcher', label: 'Researcher' },
  { value: 'Instructor', label: 'Instructor' },
  { value: 'Engineer', label: 'Engineer' },
];

export default function LoginView({ pairToken, onLoginSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('Student');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [qrDevice, setQrDevice] = useState(null);

  useEffect(() => {
    if (!pairToken) return;
    fetch(`/api/auth/qr-info?p=${encodeURIComponent(pairToken)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setQrDevice(data);
      })
      .catch(() => {});
  }, [pairToken]);

  async function handleQuickQrSignIn() {
    if (!pairToken) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/auth/qr-redeem', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair_token: pairToken }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(typeof body.detail === 'string' ? body.detail : 'QR sign-in failed.');
        return;
      }
      onLoginSuccess(body.user, body.profile, body.device_id);
    } catch {
      setError('Cannot reach the telemetry server.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const u = username.trim();
    if (!u || !password) {
      setError('Please enter your username and password.');
      return;
    }
    if (mode === 'register' && !fullName.trim()) {
      setError('Please enter your full name to create a profile.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'register'
          ? {
              username: u,
              password,
              full_name: fullName.trim(),
              email: email.trim(),
              role,
              pair_token: pairToken || null,
            }
          : {
              username: u,
              password,
              pair_token: pairToken || null,
            };

      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        onLoginSuccess(body.user || u, body.profile, body.claimed_device_id);
        return;
      }
      setError(typeof body.detail === 'string' ? body.detail : 'Authentication failed.');
      if (mode === 'login') setPassword('');
    } catch {
      setError('Cannot reach the telemetry server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-body">
      <main className="login-wrap">
        <section className="login-card" aria-labelledby="login-heading">
          <WsbLogo size="lg" />

          {qrDevice && (
            <div className="qr-pair-banner">
              <div className="qr-pair-info">
                <strong>ESP32 QR Detected: {qrDevice.name} ({qrDevice.device_id})</strong>
                <span className="muted small">
                  Sign in instantly on your phone or sign in below to link this device to your profile.
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-block"
                onClick={handleQuickQrSignIn}
                disabled={loading}
              >
                Instant Phone Sign-In ({qrDevice.device_id})
              </button>
            </div>
          )}

          <div className="seg login-mode-tabs" role="tablist">
            <button
              type="button"
              className={mode === 'login' ? 'active' : ''}
              onClick={() => {
                setMode('login');
                setError('');
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={mode === 'register' ? 'active' : ''}
              onClick={() => {
                setMode('register');
                setError('');
              }}
            >
              Create Profile
            </button>
          </div>

          <form id="login-form" onSubmit={handleSubmit} noValidate>
            {mode === 'register' && (
              <>
                <div className="login-field">
                  <label htmlFor="full-name">Full Name</label>
                  <input
                    id="full-name"
                    type="text"
                    placeholder="Jan Kowalski"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>

                <div className="login-field">
                  <label htmlFor="email">University Email</label>
                  <input
                    id="email"
                    type="email"
                    placeholder="student@merito.pl"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div className="login-field">
                  <label>Academic Role</label>
                  <SelectField
                    value={role}
                    options={ROLE_OPTIONS}
                    onChange={(v) => setRole(v)}
                    ariaLabel="Academic Role"
                  />
                </div>
              </>
            )}

            <div className="login-field">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Password</label>
              <div className="pw-row">
                <input
                  id="password"
                  name="password"
                  className="flex-1"
                  type={showPw ? 'text' : 'password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  placeholder={mode === 'register' ? 'Minimum 6 characters' : 'Enter password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  <Icon name={showPw ? 'eye-crossed' : 'eye'} />
                </button>
              </div>
            </div>

            {error && (
              <p className="form-error" role="alert">
                <Icon name="triangle-warning" />
                <span>{error}</span>
              </p>
            )}

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading
                ? 'Please wait…'
                : mode === 'register'
                  ? 'Create Profile & Sign In'
                  : 'Sign in to Dashboard'}
            </button>
          </form>
        </section>

        <p className="muted small center">
          Embedded Systems Project 2026 · Uniwersytet WSB Merito
        </p>
      </main>
    </div>
  );
}
