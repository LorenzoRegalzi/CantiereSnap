'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export default function Input({ label, error, id, className = '', ...props }: InputProps) {
  const inputId = id ?? `input-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium text-brand-text">
        {label}
      </label>
      <input
        id={inputId}
        className={`
          rounded-lg border px-3 py-2.5 text-sm text-brand-text placeholder:text-brand-muted
          transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent
          disabled:cursor-not-allowed disabled:bg-stone-100 disabled:opacity-50
          ${error ? 'border-red-400 bg-red-50' : 'border-brand-border bg-white'}
          ${className}
        `}
        {...props}
      />
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
