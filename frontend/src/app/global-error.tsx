'use client';

import { useEffect, useRef } from 'react';
import { reportClientError } from './report-client-error';

/**
 * Último recurso (LIVE-7, API_CONTRACT §14.7): cuando falla el propio layout raíz
 * (`app/[locale]/layout.tsx`). Sustituye a ese layout, así que trae su `<html>`/`<body>` y NO tiene
 * proveedor de traducciones, ni fuentes, ni hoja de estilos garantizada: texto en los dos idiomas y
 * estilos en línea mínimos (permitidos por `style-src 'unsafe-inline'`, §14.3).
 * ⛔ No pinta `error.message`. Reporta UNA vez por error mostrado.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const reported = useRef<Error | null>(null);

  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;
    void reportClientError(error, window.location.pathname + window.location.search);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f4f1ea',
          color: '#1a1a18',
        }}
      >
        <main role="alert" style={{ maxWidth: 480, padding: 24 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Algo salió mal</h1>
          <p style={{ margin: '0 0 4px' }}>No se pudo cargar la página. Intenta de nuevo en un momento.</p>
          <p lang="en" style={{ margin: '0 0 16px', color: '#6e695e' }}>
            Something went wrong. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              border: '1px solid #1a1a18',
              background: 'transparent',
              padding: '12px 20px',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            Reintentar · Retry
          </button>
        </main>
      </body>
    </html>
  );
}
