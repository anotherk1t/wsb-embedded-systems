import React, { useState } from 'react';
import { SelectField } from './FormControls';

const ROLE_OPTIONS = [
  { value: 'Student', label: 'Student' },
  { value: 'Researcher', label: 'Researcher' },
  { value: 'Instructor', label: 'Instructor' },
  { value: 'Engineer', label: 'Engineer' },
];

export default function ProfileModal({ profile, onClose, onSaveProfile, onChangePassword }) {
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [role, setRole] = useState(profile?.role || 'Researcher');
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    try {
      await onSaveProfile({ full_name: fullName, email, role });
      setMsg('Profile updated.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePw(e) {
    e.preventDefault();
    setPwMsg('');
    if (!curPw || newPw.length < 6) {
      setPwMsg('New password must be at least 6 characters.');
      return;
    }
    try {
      await onChangePassword({ current_password: curPw, new_password: newPw });
      setCurPw('');
      setNewPw('');
      setPwMsg('Password updated.');
    } catch (err) {
      setPwMsg(err.message);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="User Profile">
        <header className="panel-head">
          <h2>User Profile · {profile?.username}</h2>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </header>

        <form className="modal-form" onSubmit={handleSave}>
          <div className="cfg-field">
            <span className="cfg-label">Full Name</span>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">University Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@merito.pl"
            />
          </div>

          <div className="cfg-field">
            <span className="cfg-label">Academic Role</span>
            <SelectField
              value={role}
              options={ROLE_OPTIONS}
              onChange={(v) => setRole(v)}
              ariaLabel="Academic Role"
            />
          </div>

          <div className="cfg-actions">
            <span className="small muted">{msg}</span>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </form>

        <hr className="modal-divider" />

        <form className="modal-form" onSubmit={handlePw}>
          <h3>Change Password</h3>
          <div className="cfg-grid">
            <div className="cfg-field">
              <span className="cfg-label">Current Password</span>
              <input
                type="password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                placeholder="Current password"
              />
            </div>
            <div className="cfg-field">
              <span className="cfg-label">New Password</span>
              <input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                placeholder="Min 6 characters"
              />
            </div>
          </div>
          <div className="cfg-actions">
            <span className="small muted">{pwMsg}</span>
            <button type="submit" className="btn">
              Update Password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
