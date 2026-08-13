'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { RoleProvider } from '@/lib/role';
import { AdminSidebar } from './AdminSidebar';
import { AdminTopbar } from './AdminTopbar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);

  return (
    <RoleProvider>
      <div className="flex min-h-dvh bg-bg">
        {/* Sidebar fijo desde lg */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
          <div className="flex h-16 items-center px-4 font-bold">Back-office</div>
          <AdminSidebar />
        </aside>

        {/* Drawer móvil */}
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setDrawer(false)}>
            <div className="absolute inset-0 bg-[rgba(2,6,23,.5)]" />
            <aside
              className="absolute left-0 top-0 h-full w-64 overflow-y-auto bg-surface"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex h-16 items-center justify-between px-4 font-bold">
                Back-office
                <button onClick={() => setDrawer(false)} aria-label="Close" className="p-1">
                  <X size={20} />
                </button>
              </div>
              <AdminSidebar onNavigate={() => setDrawer(false)} />
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar onMenu={() => setDrawer(true)} />
          <main className="flex-1 p-4 sm:p-6">{children}</main>
        </div>
      </div>
    </RoleProvider>
  );
}
