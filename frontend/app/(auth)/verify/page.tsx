'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import apiClient, { ApiError } from '@/lib/api-client';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

function MailIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7 text-white"
      aria-hidden="true"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" />
    </svg>
  );
}

function VerifyForm() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const email = searchParams.get('email') ?? '';
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [codeError, setCodeError] = useState<string | undefined>();
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAlert(null);
    setCodeError(undefined);
    setLoading(true);

    try {
      await apiClient.post('/auth/verify', { email, confirmationCode: code });
      router.replace('/login?verified=true');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'VALIDATION_ERROR' || err.code === 'INVALID_CODE' || err.code === 'EXPIRED_CODE') {
          setCodeError('Codice non valido o scaduto. Riprova.');
        } else if (err.code === 'NOT_FOUND' || err.status === 404) {
          setAlert({ variant: 'error', message: 'Nessun account trovato con questa email.' });
        } else {
          setAlert({ variant: 'error', message: err.message });
        }
      } else {
        setAlert({ variant: 'error', message: 'Impossibile connettersi al server. Riprova.' });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm animate-fade-in">
      <div className="rounded-2xl border border-brand-border bg-white p-8 shadow-sm">

        {/* Header */}
        <div className="mb-7 flex flex-col items-center gap-2 text-center">
          <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-brand-primary">
            <MailIcon />
          </div>
          <h1 className="text-xl font-bold text-brand-primary">Verifica la tua email</h1>
          <p className="text-sm text-brand-muted">
            Abbiamo inviato un codice di verifica a{' '}
            {email
              ? <strong className="text-brand-text">{email}</strong>
              : 'la tua email'
            }
            . Inseriscilo qui sotto.
          </p>
        </div>

        {alert && (
          <div className="mb-4">
            <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          {/* Oversized code input — styled directly, not via Input component */}
          <div className="flex flex-col gap-1">
            <label htmlFor="code" className="text-sm font-medium text-brand-text">
              Codice di verifica
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={loading}
              className={`
                rounded-lg border px-3 py-3 text-center text-2xl font-mono tracking-widest text-brand-text
                placeholder:text-brand-muted focus:outline-none focus:ring-2 focus:ring-brand-accent
                focus:border-transparent transition-shadow
                disabled:cursor-not-allowed disabled:bg-stone-100 disabled:opacity-50
                ${codeError ? 'border-red-400 bg-red-50' : 'border-brand-border bg-white'}
              `}
            />
            {codeError && (
              <p className="text-xs text-red-600" role="alert">
                {codeError}
              </p>
            )}
          </div>

          <Button type="submit" loading={loading} className="mt-2">
            Verifica
          </Button>
        </form>

        <div className="mt-5 flex flex-col items-center gap-2 text-sm">
          <span className="cursor-default text-brand-muted opacity-60">
            Non hai ricevuto il codice? Invia di nuovo
          </span>
          <Link href="/login" className="text-brand-muted hover:text-brand-primary hover:underline">
            ← Torna al login
          </Link>
        </div>

      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
