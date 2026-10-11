'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { reportClientError } from '../report-client-error';

/**
 * Límite de error de las páginas con idioma (LIVE-7, API_CONTRACT §14.7). Vive dentro del layout
 * de `[locale]`, así que tiene textos traducidos (reutiliza `common.errorTitle`/`errorGeneric`/
 * `retry`: sin claves nuevas). ⛔ No pinta `error.message`: en producción Next lo oculta para los
 * errores del servidor y en el cliente puede traer datos internos.
 *
 * Reporta UNA vez por error mostrado (el `ref` evita el doble efecto de StrictMode y los re-render).
 */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');
  const reported = useRef<Error | null>(null);

  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;
    void reportClientError(error, window.location.pathname + window.location.search);
  }, [error]);

  return (
    <main
      id="main"
      role="alert"
      className="mx-auto flex min-h-[50vh] max-w-xl flex-col items-start justify-center gap-4 px-4 py-16"
    >
      <AlertTriangle size={28} className="text-accent" aria-hidden />
      <h1 className="font-serif text-h2 font-semibold">{t('errorTitle')}</h1>
      <p className="text-muted">{t('errorGeneric')}</p>
      <Button variant="secondary" onClick={() => reset()}>
        {t('retry')}
      </Button>
    </main>
  );
}
