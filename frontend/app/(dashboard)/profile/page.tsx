'use client';

import { useEffect, useState } from 'react';
import apiClient from '@/lib/api-client';
import { ApiError } from '@/lib/api-client';
import { Profile } from '@/types';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

const REGIME_FISCALE_OPTIONS = [
  { value: 'RF01', label: 'RF01 — Ordinario' },
  { value: 'RF02', label: 'RF02 — Contribuenti minimi' },
  { value: 'RF04', label: 'RF04 — Agricoltura' },
  { value: 'RF19', label: 'RF19 — Regime forfettario' },
];

type FormData = {
  fullName: string;
  businessName: string;
  partitaIva: string;
  codiceFiscale: string;
  regimeFiscale: string;
  phone: string;
  street: string;
  city: string;
  province: string;
  cap: string;
  country: string;
};

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormData, string>>>({});
  const [form, setForm] = useState<FormData>({
    fullName: '',
    businessName: '',
    partitaIva: '',
    codiceFiscale: '',
    regimeFiscale: '',
    phone: '',
    street: '',
    city: '',
    province: '',
    cap: '',
    country: 'IT',
  });

  const fiscalIncomplete = !form.partitaIva || !form.codiceFiscale || !form.regimeFiscale;

  useEffect(() => {
    apiClient.get<Profile>('/profile').then(({ data }) => {
      setForm({
        fullName: data.fullName ?? '',
        businessName: data.businessName ?? '',
        partitaIva: data.partitaIva ?? '',
        codiceFiscale: data.codiceFiscale ?? '',
        regimeFiscale: data.regimeFiscale ?? '',
        phone: data.phone ?? '',
        street: data.address?.street ?? '',
        city: data.address?.city ?? '',
        province: data.address?.province ?? '',
        cap: data.address?.cap ?? '',
        country: data.address?.country ?? 'IT',
      });
    }).finally(() => setLoading(false));
  }, []);

  function set(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    setFieldErrors({});
    try {
      await apiClient.put('/profile', {
        fullName: form.fullName || undefined,
        businessName: form.businessName || undefined,
        partitaIva: form.partitaIva || undefined,
        codiceFiscale: form.codiceFiscale || undefined,
        regimeFiscale: form.regimeFiscale || undefined,
        phone: form.phone || undefined,
        address: (form.street || form.city)
          ? {
              street: form.street,
              city: form.city,
              province: form.province,
              cap: form.cap,
              country: form.country || 'IT',
            }
          : undefined,
      });
      setAlert({ variant: 'success', message: 'Profilo aggiornato.' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && err.field) {
        setFieldErrors({ [err.field]: err.message });
      } else {
        const msg = err instanceof ApiError ? err.message : 'Errore durante il salvataggio.';
        setAlert({ variant: 'error', message: msg });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 max-w-xl">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-stone-200" />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-bold text-brand-primary">Profilo e Dati Fiscali</h1>

      {fiscalIncomplete && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>⚠️</span>
          <span>Completa i dati fiscali per poter emettere fatture elettroniche.</span>
        </div>
      )}

      {alert && <Alert variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nome completo"
          value={form.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          error={fieldErrors.fullName}
        />
        <Input
          label="Ragione sociale"
          value={form.businessName}
          onChange={(e) => set('businessName', e.target.value)}
          error={fieldErrors.businessName}
        />

        <div className="border-t border-brand-border pt-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-muted">
            Dati Fiscali
          </h2>
          <div className="space-y-4">
            <Input
              label="Partita IVA"
              value={form.partitaIva}
              onChange={(e) => set('partitaIva', e.target.value)}
              placeholder="IT12345678901"
              error={fieldErrors.partitaIva}
            />
            <Input
              label="Codice Fiscale"
              value={form.codiceFiscale}
              onChange={(e) => set('codiceFiscale', e.target.value.toUpperCase())}
              maxLength={16}
              error={fieldErrors.codiceFiscale}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-brand-text">Regime Fiscale</label>
              <select
                value={form.regimeFiscale}
                onChange={(e) => set('regimeFiscale', e.target.value)}
                className="rounded-lg border border-brand-border bg-white px-3 py-2.5 text-sm text-brand-text focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
              >
                <option value="">Seleziona regime...</option>
                {REGIME_FISCALE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {fieldErrors.regimeFiscale && (
                <p className="text-xs text-red-600">{fieldErrors.regimeFiscale}</p>
              )}
            </div>
          </div>
        </div>

        <Input
          label="Telefono"
          type="tel"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
          placeholder="+39 333 1234567"
          error={fieldErrors.phone}
        />

        <div className="border-t border-brand-border pt-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand-muted">
            Indirizzo
          </h2>
          <div className="space-y-4">
            <Input
              label="Via"
              value={form.street}
              onChange={(e) => set('street', e.target.value)}
              placeholder="Via Roma 1"
              error={fieldErrors.street}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Città"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
                error={fieldErrors.city}
              />
              <Input
                label="Provincia"
                value={form.province}
                onChange={(e) => set('province', e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="MI"
                error={fieldErrors.province}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="CAP"
                value={form.cap}
                onChange={(e) => set('cap', e.target.value)}
                maxLength={5}
                placeholder="20100"
                error={fieldErrors.cap}
              />
              <Input
                label="Paese"
                value={form.country}
                onChange={(e) => set('country', e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="IT"
                error={fieldErrors.country}
              />
            </div>
          </div>
        </div>

        <Button type="submit" loading={saving}>
          Salva Profilo
        </Button>
      </form>
    </div>
  );
}
