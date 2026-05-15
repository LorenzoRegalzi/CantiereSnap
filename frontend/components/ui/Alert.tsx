'use client';

interface AlertProps {
  variant: 'success' | 'error';
  message: string;
  onDismiss?: () => void;
}

export default function Alert({ variant, message, onDismiss }: AlertProps) {
  const styles = {
    success: 'bg-teal-50 border-teal-300 text-teal-800',
    error:   'bg-red-50 border-red-300 text-red-800',
  };

  return (
    <div
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${styles[variant]}`}
      role="alert"
    >
      <span className="flex-1 leading-snug">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 font-bold leading-none opacity-60 hover:opacity-100"
          aria-label="Chiudi"
        >
          ✕
        </button>
      )}
    </div>
  );
}
