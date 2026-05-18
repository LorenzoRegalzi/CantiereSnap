'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Props {
  count: number;
  onDismiss: () => void;
}

export default function OverdueWidget({ count, onDismiss }: Props) {
  const router = useRouter();

  if (count === 0) return null;

  const label = count === 1 ? 'fattura scaduta' : 'fatture scadute';

  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />

      <div className="flex-1">
        <p className="font-semibold text-red-800">
          Attenzione: {count} {label}
        </p>
        <p className="mt-0.5 text-sm text-red-700">
          Hai fatture con pagamento in ritardo. Controlla la sezione fatture.
        </p>
        <button
          onClick={() => router.push('/invoices?status=Overdue')}
          className="mt-2 text-sm font-medium text-red-700 underline hover:text-red-900"
        >
          Vedi Fatture Scadute →
        </button>
      </div>

      <button
        onClick={onDismiss}
        className="text-red-400 hover:text-red-600"
        aria-label="Chiudi"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
