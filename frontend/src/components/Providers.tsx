'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InactivityProvider } from '@/lib/inactivity';

/**
 * Opciones por defecto de las consultas de la app. Exportadas (TL-MKT2-2) para que las pruebas que dependen del
 * `staleTime` —el catálogo y las fichas no repiten la lectura del servidor mientras el dato es fresco— usen ESTAS y no
 * una copia del número.
 */
export const QUERY_DEFAULTS = { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } as const;

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { ...QUERY_DEFAULTS } },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {/* Timer de inactividad global (app-wide): cubre storefront + admin. */}
      <InactivityProvider>{children}</InactivityProvider>
    </QueryClientProvider>
  );
}
