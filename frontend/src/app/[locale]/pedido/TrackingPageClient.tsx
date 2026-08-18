'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { trackGuestOrder } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { PublicOrderTracking } from './PublicOrderTracking';
import { TrackingLinkNeutralState } from './TrackingLinkNeutralState';

/**
 * Página pública de seguimiento `/[locale]/pedido` (contrato §4-G.3, DESIGN_SYSTEM §15.6).
 *
 * Manejo del token — reglas del contrato §4-G.7, no preferencias:
 *  1. El correo trae `…/pedido?token=<claro>`; el token se lee UNA vez del query string.
 *  2. Se mueve al **cuerpo** de `POST /orders/guest/track` (jamás a la ruta de la API).
 *  3. Se **borra de la URL** con `history.replaceState` para no dejarlo en el historial ni
 *     en el `Referer` al navegar. Nunca se guarda en localStorage ni se loguea.
 *
 * Estados: skeleton mientras carga · pantalla NEUTRA para cualquier fallo del token
 * (404/410/429 y cualquier otro < 500: un solo mensaje, sin eco del `errorCode`) · reintento
 * genérico solo para fallo de red/servidor.
 */
export function TrackingPageClient() {
  const t = useTranslations('common');
  const [token, setToken] = useState<string | null>(null);
  const [tokenReady, setTokenReady] = useState(false);
  const [resendRequested, setResendRequested] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date>(() => new Date());

  useEffect(() => {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('token');
    if (fromUrl) {
      setToken(fromUrl);
      url.searchParams.delete('token');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    }
    setTokenReady(true);
  }, []);

  const query = useQuery({
    queryKey: ['guest-order-track'],
    queryFn: () => trackGuestOrder(token as string),
    enabled: !!token,
    retry: false,
    gcTime: 0,
    // El pedido puede cambiar (guía capturada por el operador): no se cachea de más.
    staleTime: 0,
  });

  useEffect(() => {
    if (query.data) setUpdatedAt(new Date());
  }, [query.data]);

  if (!tokenReady) {
    return <TrackingSkeleton />;
  }

  // Sin token en la URL, o cualquier rechazo del token: MISMA pantalla neutra (criterio 52).
  const rejected =
    query.isError && (!(query.error instanceof ApiClientError) || query.error.status < 500);
  if (!token || rejected || resendRequested) {
    return <TrackingLinkNeutralState token={token ?? undefined} />;
  }

  if (query.isLoading) return <TrackingSkeleton />;

  if (query.isError) {
    // Solo aquí (5xx / red): error genérico con reintento, SIN eco del código.
    return (
      <div className="gutter max-w-xl py-16">
        <Banner
          variant="danger"
          role="alert"
          title={t('errorTitle')}
          action={
            <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
              {t('retry')}
            </Button>
          }
        >
          {t('errorGeneric')}
        </Banner>
      </div>
    );
  }

  if (!query.data) return <TrackingSkeleton />;

  return (
    <PublicOrderTracking
      data={query.data}
      updatedAt={updatedAt}
      isRefreshing={query.isFetching}
      onRefresh={() => query.refetch()}
      onResendLink={() => setResendRequested(true)}
    />
  );
}

/** Skeleton que respeta el layout (stepper + filas de artículos), §15.6. */
function TrackingSkeleton() {
  return (
    <div className="gutter max-w-3xl py-12" aria-busy="true">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-7 w-48" />
      <Skeleton className="mt-10 h-16 w-full" />
      <div className="mt-10 flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="mt-10 h-32 w-full max-w-[420px]" />
    </div>
  );
}
