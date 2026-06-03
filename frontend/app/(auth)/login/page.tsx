'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import apiClient, { ApiError } from '@/lib/api-client';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface FieldErrors {
  email?: string;
  password?: string;
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

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const auth = useAuth();

  const justVerified = searchParams.get('verified') === 'true';
  const redirectTo = searchParams.get('redirect') ?? '/jobs';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<{
    variant: 'success' | 'error';
    message: string;
    showVerifyLink?: boolean;
  } | null>(
    justVerified ? { variant: 'success', message: 'Email verificata! Ora puoi accedere.' } : null
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAlert(null);
    setFieldErrors({});
    setLoading(true);

    try {
      const { data } = await apiClient.post<LoginResponse>('/auth/login', { email, password });
      auth.login(data.accessToken, data.refreshToken);
      router.replace(redirectTo);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.code === 'UNAUTHORIZED') {
          setAlert({ variant: 'error', message: 'Email o password non corretti.' });
        } else if (err.status === 403 || err.code === 'FORBIDDEN') {
          setAlert({
            variant: 'error',
            message: 'Email non verificata. Controlla la tua casella di posta.',
            showVerifyLink: true,
          });
        } else if (err.code === 'VALIDATION_ERROR' && err.field) {
          setFieldErrors({ [err.field]: err.message });
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
          <p className="text-sm text-brand-muted">Gestione lavori per artigiani edili</p>
        </div>

        {/* Alert */}
        {alert && (
          <div className="mb-4 flex flex-col gap-2">
            <Alert
              variant={alert.variant}
              message={alert.message}
              onDismiss={() => setAlert(null)}
            />
            {alert.showVerifyLink && (
              <Link
                href={`/verify?email=${encodeURIComponent(email)}`}
                className="text-center text-sm font-medium text-brand-accent hover:underline"
              >
                Inserisci il codice di verifica
              </Link>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
          <Input
            label="Email"
            type="email"
            placeholder="mario.rossi@email.it"
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
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldErrors.password}
            disabled={loading}
            required
            autoComplete="current-password"
          />
          <Button type="submit" loading={loading} className="mt-2">
            Accedi
          </Button>
        </form>

        {/* Footer links */}
        <div className="mt-5 flex flex-col items-center gap-2 text-sm text-brand-muted">
          <p>
            Non hai un account?{' '}
            <Link href="/register" className="font-semibold text-brand-primary hover:underline">
              Registrati
            </Link>
          </p>
          <span className="cursor-default text-xs opacity-60">Password dimenticata?</span>
        </div>

      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
