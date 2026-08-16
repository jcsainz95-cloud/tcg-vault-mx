'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InactivityProvider } from '@/lib/inactivity';

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {/* Timer de inactividad global (app-wide): cubre storefront + admin. */}
      <InactivityProvider>{children}</InactivityProvider>
    </QueryClientProvider>
  );
}
