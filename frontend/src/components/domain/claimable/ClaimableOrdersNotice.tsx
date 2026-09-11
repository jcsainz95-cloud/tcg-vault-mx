'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { claimGuestOrders, getClaimableOrders } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useSession } from '@/lib/session';
import { formatDate, formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useErrorMessage } from '@/components/ui/QueryState';
import { EmailNotVerifiedNotice } from '@/components/domain/EmailNotVerifiedNotice';
import { SUPPORT_CONTACT_FALLBACK } from '@/app/[locale]/(storefront)/checkout/support-contact';
import type { ClaimOrdersResponse } from '@/types/contract';

/** «Ahora no» dura la sesión del navegador (DESIGN_SYSTEM §33.9a): vuelve en la siguiente. */
export const CLAIMABLE_DISMISSED_KEY = 'tcg.claimable.dismissed';
/** Filas visibles; el resto se resume en «y {n} más» (el reclamo es de TODOS igual). */
const MAX_ROWS = 5;

export interface ClaimableOrdersNoticeProps {
  /** Solo cambia el CUERPO (§33.9b) y el enlace de éxito (solo `vault`). */
  surface: 'vault' | 'orders';
  className?: string;
}

function readDismissed(): boolean {
  try {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(CLAIMABLE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Aviso de pedidos de invitado reclamables (DESIGN_SYSTEM §33.9, contrato `GET /orders/claimable`
 * v1.67 nota de consumo). Regla 4 de §33.0: **nunca se pinta vacío ni en error** — mientras carga,
 * con `[]`, con cualquier error (incluido el `403 EMAIL_NOT_VERIFIED`: el banner de verificación ya
 * está en pantalla) o tras «Ahora no», el componente devuelve `null` y NO hay nodo en el DOM. Es la
 * excepción documentada a §8.1: el aviso es una oferta, no el contenido de la página, y el endpoint
 * es no-oráculo (§4-G.9). Reutiliza el reclamo de `GuestOrderConfirmation` (`POST /orders/claim`).
 */
export function ClaimableOrdersNotice({ surface, className }: ClaimableOrdersNoticeProps) {
  const t = useTranslations('orders.claimable');
  const tv = useTranslations('vault.claimable');
  const locale = useLocale() as AppLocale;
  const { user, isAuthenticated, ready } = useSession();
  const queryClient = useQueryClient();
  const getMessage = useErrorMessage();

  // `false` en SSR y primer render (evita mismatch); se lee sessionStorage al montar.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  // No se llama sin sesión ni con correo sin verificar (el 403 no es dato: no se provoca).
  const enabled = ready && isAuthenticated && user?.emailVerified !== false && !dismissed;
  const query = useQuery({
    queryKey: ['claimable-orders'],
    queryFn: getClaimableOrders,
    enabled,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const [result, setResult] = useState<ClaimOrdersResponse | null>(null);
  const [emailNotVerified, setEmailNotVerified] = useState(false);

  const claim = useMutation({
    mutationFn: (orderIds: string[]) => claimGuestOrders(orderIds),
    onSuccess: (res) => {
      // El bloque de éxito persiste hasta salir de la página; la siguiente consulta viene vacía.
      setResult(res);
      void queryClient.invalidateQueries({ queryKey: ['claimable-orders'] });
      if (res.claimed.length > 0) void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'EMAIL_NOT_VERIFIED') setEmailNotVerified(true);
    },
  });

  // Carrera: verificó en otra pestaña o al revés → el aviso se sustituye por el de verificación.
  if (emailNotVerified) {
    return (
      <div className={className}>
        <EmailNotVerifiedNotice />
      </div>
    );
  }

  // Tras reclamar: éxito (mono verde) y/o fallo parcial NEUTRO (criterio 55).
  if (result) {
    const okCount = result.claimed.length;
    const failCount = result.failed.length;
    if (okCount === 0 && failCount === 0) return null;
    return (
      <div className={className} aria-live="polite">
        {okCount > 0 && (
          <p className="font-mono text-[11px] uppercase tracking-label text-success">
            {t('success', { count: okCount })}
            {surface === 'vault' && (
              <>
                {' '}
                <Link href="/orders" className="normal-case tracking-normal text-accent hover:text-text">
                  {t('successLink')}
                </Link>
              </>
            )}
          </p>
        )}
        {failCount > 0 && (
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {t('partialFail', { count: failCount, contact: SUPPORT_CONTACT_FALLBACK })}
          </p>
        )}
      </div>
    );
  }

  // Cargando, error, vacío o descartado: NADA (sin skeleton, sin «Reintentar»).
  const orders = query.data;
  if (!enabled || !orders || orders.length === 0) return null;

  const visible = orders.slice(0, MAX_ROWS);
  const hidden = orders.length - visible.length;

  function dismiss() {
    try {
      window.sessionStorage.setItem(CLAIMABLE_DISMISSED_KEY, '1');
    } catch {
      /* sin sessionStorage: solo desaparece en este render */
    }
    setDismissed(true);
  }

  return (
    <div className={className} data-testid="claimable-orders-notice">
      <Banner
        variant="info"
        role="status"
        title={t('title', { count: orders.length })}
        action={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button
              size="sm"
              variant="primary"
              className="w-full sm:w-auto"
              loading={claim.isPending}
              onClick={() => claim.mutate(orders.map((o) => o.orderId))}
            >
              {claim.isPending ? t('claiming') : t('cta')}
            </Button>
            <Button size="sm" variant="ghost" className="w-full sm:w-auto" onClick={dismiss}>
              {t('later')}
            </Button>
          </div>
        }
      >
        <p className="text-[15px] leading-relaxed sm:text-sm">{surface === 'vault' ? tv('body') : t('body')}</p>
        <ul className="mt-3 flex flex-col gap-1.5">
          {visible.map((o) => (
            <li
              key={o.orderId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[13px] tabular-nums text-text"
            >
              <span>{o.orderNumber}</span>
              <span className="text-muted">{formatDate(o.createdAt, locale)}</span>
              <span>{formatMoneyCents(o.totalCents, locale)}</span>
              <StatusBadge domain="order" value={o.status} />
            </li>
          ))}
        </ul>
        {hidden > 0 && <p className="mt-2 font-mono text-[11px] text-muted">{t('more', { count: hidden })}</p>}
        {claim.isError && !emailNotVerified && (
          <div className="mt-3">
            <Banner variant="danger" role="alert" title={t('errorTitle')}>
              {getMessage(claim.error)}
            </Banner>
          </div>
        )}
      </Banner>
    </div>
  );
}
