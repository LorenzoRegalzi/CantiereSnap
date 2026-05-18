export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-bg px-4">
      <div className="flex flex-1 items-center justify-center py-12">
        {children}
      </div>
      <footer className="pb-6 text-center">
        <p className="text-xs text-brand-muted">CantiereSnap © 2026</p>
      </footer>
    </div>
  );
}
