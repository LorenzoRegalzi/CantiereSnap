'use client';

import Link from 'next/link';
import { Camera } from 'lucide-react';

export default function PhotosPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-brand-primary">Galleria</h1>
      <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-brand-border bg-white p-16 text-center">
        <Camera className="h-10 w-10 text-brand-muted opacity-40" />
        <p className="text-brand-muted">
          Seleziona un lavoro dalla pipeline per vedere le foto del cantiere.
        </p>
        <Link
          href="/jobs"
          className="rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Vai ai lavori
        </Link>
      </div>
    </div>
  );
}
