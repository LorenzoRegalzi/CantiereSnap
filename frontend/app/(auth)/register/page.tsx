'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import apiClient, { ApiError } from '@/lib/api-client';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

interface FieldErrors {
  fullName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
}

function HardHatIcon() {
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
      <path d="M2 18h20" />
      <path d="M6 18v-2a6 6 0 0112 0v2" />
      <path d="M12 10V6" />
      <path d="M4 10a8 8 0 0116 0" />
    </svg>
  );
}

export default function RegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (fullName.trim().length < 2) {
      errors.fullName = 'Il nome deve avere almeno 2 caratteri.';
    }
    if (password.length < 8) {
      errors.password = 'La password deve avere almeno 8 caratteri.';
    }
    if (password !== confirmPassword) {
      errors.confirmPassword = 'Le password non coincidono.';
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAlert(null);
    if (!validate()) return;

    setLoading(true);
    try {
      await apiClient.post('/auth/register', { email, password, fullName: fullName.trim() });
      router.push(`/verify?email=${encodeURIComponent(email)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === 'CONFLICT') {
          setAlert({ variant: 'error', message: 'Esiste già un account con questa email.' });
        } else if (err.code === 'VALIDATION_ERROR' && err.field) {
          setFieldErrors((prev) => ({ ...prev, [err.field!]: err.message }));
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
            <HardHatIcon />
          </div>
          <h1 className="text-2xl font-bold text-brand-primary">CantiereSnap</h1>
          <p className="text-sm text-brand-muted">Gestione lavori per artigiani</p>
        </div>

        {alert && (
          <div className="mb-4">
            <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Nome completo"
            type="text"
            placeholder="Marco Rossi"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            error={fieldErrors.fullName}
            disabled={loading}
            required
            autoComplete="name"
          />
          <Input
            label="Email"
            type="email"
            placeholder="marco.rossi@email.it"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldErrors.email}
            disabled={loading}
            required
            autoComplete="email"
          />
          <Input
            label="Password"
            type="password"
            placeholder="Minimo 8 caratteri"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            disabled={loading}
            required
            autoComplete="new-password"
          />
          <Input
            label="Conferma password"
            type="password"
            placeholder="Ripeti la password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            error={fieldErrors.confirmPassword}
            disabled={loading}
            required
            autoComplete="new-password"
          />
          <Button type="submit" loading={loading} className="mt-2">
            Crea account
          </Button>
        </form>

        <div className="mt-5 text-center text-sm text-brand-muted">
          Hai già un account?{' '}
          <Link href="/login" className="font-semibold text-brand-primary hover:underline">
            Accedi
          </Link>
        </div>

      </div>
    </div>
  );
}
