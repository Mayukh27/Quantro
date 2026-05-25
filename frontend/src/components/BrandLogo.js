import React from 'react';
import logo_text from '../assets/logo+text.png';
import logo from '../assets/logo.png';

export default function BrandLogo({
  variant = 'text' | 'icon',
  width = 220,
  className,
  style,
  alt = 'QUANTRO'
}) {
  const src = variant === 'icon' ? logo : logo_text;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={width}
      style={{
        display: 'block',
        maxWidth: '100%',
        height: 'auto',
        ...style
      }}
    />
  );
}