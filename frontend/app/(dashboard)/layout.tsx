'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HardHat,
  Briefcase,
  FileText,
  Receipt,
  Camera,
  BarChart3,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/lib/auth';

const navItems = [
  { label: 'Lavori', href: '/jobs', icon: Briefcase },
  { label: 'Preventivi', href: '/quotes', icon: FileText },
  { label: 'Fatture', href: '/invoices', icon: Receipt },
  { label: 'Galleria', href: '/photos', icon: Camera },
  { label: 'Dashboard', href: '/analytics', icon: BarChart3 },
];

function Sidebar({ onClose }: { onClose?: () => void }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <div className="flex h-full w-60 flex-col bg-brand-primary">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-5">
        <HardHat className="h-7 w-7 text-brand-accent" />
        <span className="text-lg font-bold text-white">CantiereSnap</span>
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto text-white/60 hover:text-white md:hidden"
            aria-label="Chiudi menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-3 py-2">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'border-l-4 border-brand-accent bg-white/10 pl-2 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* User + logout */}
      <div className="border-t border-white/10 px-4 py-4">
        <p className="truncate text-xs text-white/50">{user?.email}</p>
        <button
          onClick={logout}
          className="mt-2 flex items-center gap-2 text-sm text-white/70 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Esci
        </button>
      </div>
    </div>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-brand-bg">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out md:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onClose={() => setDrawerOpen(false)} />
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile topbar */}
        <header className="flex h-14 items-center bg-brand-primary px-4 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-white/80 hover:text-white"
            aria-label="Apri menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <span className="mx-auto text-base font-bold text-white">CantiereSnap</span>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardShell>{children}</DashboardShell>
    </ProtectedRoute>
  );
}
