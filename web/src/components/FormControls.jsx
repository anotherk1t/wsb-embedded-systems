import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * Custom React Number Input with step - / + controls, flat filled surface, and no border coloring.
 */
export function NumberField({ value, min, max, step = 1, onChange, unit }) {
  const stepNum = Number(step) || 1;
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;

  function adjust(delta) {
    const cur = Number(value);
    const base = Number.isFinite(cur) ? cur : 0;
    let next = Number((base + delta * stepNum).toFixed(decimals));
    if (min !== undefined && next < Number(min)) next = Number(min);
    if (max !== undefined && next > Number(max)) next = Number(max);
    onChange(next);
  }

  return (
    <div className="react-number-field">
      <button
        type="button"
        className="react-step-btn"
        onClick={() => adjust(-1)}
        aria-label="Decrease value"
      >
        -
      </button>
      <input
        type="text"
        inputMode="decimal"
        className="react-number-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {unit && <span className="react-field-unit">{unit}</span>}
      <button
        type="button"
        className="react-step-btn"
        onClick={() => adjust(1)}
        aria-label="Increase value"
      >
        +
      </button>
    </div>
  );
}

/**
 * Custom React Dropdown Select replacing native browser <select>.
 */
export function SelectField({ value, options, onChange, icon, ariaLabel }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value)) || options[0];

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  return (
    <div className="react-select" ref={wrapRef}>
      <button
        type="button"
        className="react-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {icon && <Icon name={icon} className="react-select-icon" />}
        <span className="react-select-label">{selected ? selected.label : value}</span>
        <Icon name={open ? 'angle-small-up' : 'angle-small-down'} className="react-select-caret" />
      </button>
      {open && (
        <ul className="react-select-menu" role="listbox">
          {options.map((opt) => {
            const isSel = String(opt.value) === String(value);
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSel}
                className={`react-select-option ${isSel ? 'selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span>{opt.label}</span>
                {isSel && <Icon name="check" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Custom React Pill Switch replacing native browser <input type="checkbox">.
 */
export function SwitchField({ checked, onChange, label }) {
  return (
    <div
      className="react-switch-row"
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span className={`react-switch-track ${checked ? 'on' : ''}`}>
        <span className="react-switch-thumb" />
      </span>
      <span className="react-switch-label">{label}</span>
    </div>
  );
}
