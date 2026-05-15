import ProtectedRoute from '@/components/ProtectedRoute';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-brand-bg">
        <aside className="w-64 border-r border-brand-border bg-brand-primary">
          <div className="p-4 text-sm text-brand-muted">Sidebar — Prossimamente</div>
        </aside>
        <div className="flex flex-1 flex-col">
          <header className="border-b border-brand-border bg-white px-6 py-3">
            <p className="text-sm text-brand-muted">Topbar — Prossimamente</p>
          </header>
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
