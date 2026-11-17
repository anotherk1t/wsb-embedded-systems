import React from 'react';

/**
 * Uniwersytet WSB Merito brand mark (using the user-provided images.jpeg logo) + Google Sans wordmark.
 */
export default function WsbLogo({ size = 'md' }) {
  const isLg = size === 'lg';
  const boxSize = isLg ? 48 : 36;

  return (
    <div className={`wsb-brand ${isLg ? 'wsb-brand-lg' : ''}`}>
      <img
        src="/static/images.jpeg"
        alt="Uniwersytet WSB Merito logo"
        width={boxSize}
        height={boxSize}
        className="wsb-logo-img"
      />

      <div className="wsb-brand-text">
        <div className="wsb-brand-title">Uniwersytet WSB Merito</div>
        <p className="wsb-brand-sub">Telemetry Hub</p>
      </div>
    </div>
  );
}
