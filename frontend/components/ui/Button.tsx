'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline';
  loading?: boolean;
}

export default function Button({
  variant = 'primary',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base =
    'w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold ' +
    'transition-opacity focus:outline-none focus:ring-2 focus:ring-brand-accent focus:ring-offset-2 ' +
    'disabled:cursor-not-allowed disabled:opacity-50';

  const variants = {
    primary: 'bg-brand-primary text-white hover:opacity-90',
    outline: 'border border-brand-primary text-brand-primary bg-transparent hover:bg-stone-50',
  };

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
