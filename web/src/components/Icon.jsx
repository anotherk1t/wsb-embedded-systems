import React from 'react';

/**
 * Renders a Flaticon UIcon (`@flaticon/flaticon-uicons`).
 * Zero emojis are used anywhere in the application.
 */
export default function Icon({ name, variant = 'rr', className = '', title }) {
  return (
    <i
      className={`fi fi-${variant}-${name} ${className}`.trim()}
      aria-hidden={title ? undefined : 'true'}
      title={title}
    />
  );
}
