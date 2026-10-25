'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';
import type { DiscountAppliedDTO, DiscountProductScope, DiscountQuoteDTO } from '@/types/contract';
import { MINUS } from '@/components/ui/AmountBreakdown';
import type { CodeRowApplied, CodeRowProps } from './CodeRow';

/**
 * Vida en caché de la cotización CON el candidato (`fetchQuery` de `evaluate`). La query principal se suscribe a esa
 * clave un render después de confirmar el código; si la entrada ya se hubiera recogido (un `gcTime` corto, como el de
 * las pruebas), la pantalla volvería un instante al desglose SIN código con la fila «aplicado» ya pintada. Medido en
 * `CheckoutDiscount.test.tsx` con `gcTime: 0`: 3/6 corridas rojas sin esto (2026-10-25). 60 s cubren de sobra el salto.
 */
export const DISCOUNT_QUOTE_GC_MS = 60_000;

/** Dónde se usa el código: decide el texto de `DESTINATION` (C7) y nada más. */
export type DiscountScreen = 'direct_ship' | 'vault' | 'withdrawal';

type NotApplied = Exclude<DiscountQuoteDTO, { outcome: 'applied' }>;

const SCOPES: readonly DiscountProductScope[] = ['raw', 'graded', 'sealed', 'accessory'];

/**
 * §DSC-UX.4 — el texto de un resultado que NO aplicó. C5 es UNO para los seis genéricos (DL2): el `invalid` del contrato
 * no trae nada que distinguir, y esta función no recibe nada más. C6/C7/C13 solo para un código vigente (`not_applicable`).
 */
export function useDiscountMessage() {
  const t = useTranslations('checkout.discount');
  const locale = useLocale() as AppLocale;
  return useCallback(
    (dto: NotApplied, screen: DiscountScreen): string => {
      if (dto.outcome === 'invalid') return t('invalid');
      if (dto.outcome === 'rate_limited') return t('rateLimited');
      const d = dto.details ?? {};
      const cents = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
      switch (dto.reason) {
        case 'MIN_SUBTOTAL':
          return t('minSubtotal', { amount: formatMoneyCents(cents('missingCents'), locale) });
        case 'NO_ELIGIBLE_ITEMS': {
          const listed = Array.isArray(d.productScopes) ? (d.productScopes as string[]).filter((s): s is DiscountProductScope => (SCOPES as string[]).includes(s)) : [];
          const words = (listed.length ? listed : SCOPES).map((s) => t(`scope.${s}`));
          const scopes = new Intl.ListFormat(locale === 'en' ? 'en' : 'es', { type: 'disjunction' }).format(words);
          return t('onlyScopes', { scopes });
        }
        case 'DESTINATION':
          return screen === 'vault' ? t('notVault') : t('notHome');
        case 'NO_SHIPPING':
          return t('noShipping');
        case 'ALREADY_FREE_SHIPPING':
          return t('alreadyFree');
        case 'LARGE_BOX':
          return t('largeBox');
        case 'TOTAL_BELOW_MINIMUM':
          return t('totalBelowMinimum', { amount: formatMoneyCents(cents('minTotalCents'), locale) });
        case 'WITHDRAWAL_ONLY_FREE_SHIPPING':
          return t('withdrawalOnlyFreeShipping');
        case 'WITHDRAWAL_FILTERED':
          return t('withdrawalFiltered');
        case 'NOT_COMBINABLE':
          return t('notCombinable');
        default:
          // Un motivo que este front no conoce (servidor más nuevo): el genérico, nunca un texto inventado.
          return t('invalid');
      }
    },
    [t, locale],
  );
}

/** Lo que una sesión (`/checkout[/guest]/session`, `POST /shipments`) puede responder sobre el código (§0, §DSC.6). */
export function isDiscountSessionError(e: unknown): e is ApiClientError {
  return (
    e instanceof ApiClientError &&
    (e.code === 'DISCOUNT_CODE_INVALID' || e.code === 'DISCOUNT_CODE_NOT_APPLICABLE' || e.code === 'DISCOUNT_CODE_RATE_LIMITED')
  );
}

export interface UseDiscountCodeOptions {
  screen: DiscountScreen;
  /**
   * Cotiza CON ese código y devuelve el `discount` del servidor (siempre presente si el request trajo código).
   * El padre lo cablea a `queryClient.fetchQuery` con la MISMA clave que su query principal: al confirmar el código,
   * la query principal ya tiene la respuesta en caché y no hay segundo viaje ni parpadeo.
   */
  evaluate: (code: string) => Promise<DiscountQuoteDTO | undefined>;
  /** El `discount` de la cotización VIGENTE (la que pinta la pantalla), para detectar C12 y pintar «Ahorras». */
  current: DiscountQuoteDTO | undefined;
}

export interface UseDiscountCode {
  /** El código que viaja en quote y sesión (`null` = sin código: el request es el de hoy, I-1). */
  code: string | null;
  /** El `discount` aplicado de la cotización vigente, para el desglose y la barra. */
  applied: DiscountAppliedDTO | null;
  rowProps: Omit<CodeRowProps, 'variant'>;
  /** Para el `catch` del pago: `true` si era del código (C12/C9 pintado, código quitado ⇒ la clave re-cotiza sola). */
  handleSessionError: (e: unknown) => boolean;
}

/**
 * El estado del renglón «¿Tienes un código?» (§DSC-UX.1-4) sobre lo que dice el SERVIDOR:
 *  - aplicar: cotiza con el candidato; `applied` ⇒ se confirma (C3; C8 si reemplaza a otro); si no ⇒ error con su texto
 *    y el anterior SE MANTIENE (C5+); `rate_limited` ⇒ bloqueo (C9) hasta `retryAfterSeconds`, sin cuenta regresiva;
 *    red ⇒ C10 conservando lo escrito; el mismo código ⇒ C14;
 *  - si la cotización vigente deja de aplicar (carrito cambió, código pausado) ⇒ C12 y se quita (el total se actualiza
 *    ANTES de que pueda pagar);
 *  - si la SESIÓN responde `422/429` del código ⇒ no se cobró: C12 (o C9), se quita y la clave nueva re-cotiza.
 * ⛔ Ninguna cuenta de dinero aquí: los importes son `discountCents` / `shippingWaivedCents` del servidor.
 */
export function useDiscountCode({ screen, evaluate, current }: UseDiscountCodeOptions): UseDiscountCode {
  const t = useTranslations('checkout.discount');
  const locale = useLocale() as AppLocale;
  const message = useDiscountMessage();
  const [code, setCode] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const unblockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => () => {
    if (unblockTimer.current) clearTimeout(unblockTimer.current);
  }, []);

  const block = useCallback((seconds: number) => {
    setBlocked(true);
    if (unblockTimer.current) clearTimeout(unblockTimer.current);
    unblockTimer.current = setTimeout(() => {
      setBlocked(false);
      setError(null);
    }, Math.max(1, seconds) * 1000);
  }, []);

  const applied: DiscountAppliedDTO | null = code && current?.outcome === 'applied' && current.code === code ? current : null;
  const savedOf = (d: DiscountAppliedDTO) => (d.kind === 'free_shipping' ? d.shippingWaivedCents : d.discountCents);

  // C12: la cotización vigente ya no aplica el código (cambió el carrito, se pausó…) ⇒ se quita con aviso.
  useEffect(() => {
    if (!code || !current || current.outcome === 'applied') return;
    if (current.outcome === 'rate_limited') {
      setError(t('rateLimited'));
      block(current.retryAfterSeconds);
    }
    setNotice(t('removedNotice', { code }));
    setCode(null);
  }, [code, current, t, block]);

  const apply = useCallback(
    async (candidate: string) => {
      if (inFlight.current) return;
      if (code && candidate === code) {
        setError(t('alreadyApplied'));
        return;
      }
      inFlight.current = true;
      setPending(true);
      setError(null);
      setNotice(null);
      const previous = applied;
      try {
        const dto = await evaluate(candidate);
        if (!dto) {
          // Servidor anterior a v1.110 (no conoce el campo): no se afirma que aplicó.
          setError(t('network'));
        } else if (dto.outcome === 'applied') {
          setCode(dto.code);
          if (previous) {
            setNotice(
              t('replaced', {
                from: previous.code,
                fromAmount: `${MINUS}${formatMoneyCents(savedOf(previous), locale)}`,
                to: dto.code,
                toAmount: `${MINUS}${formatMoneyCents(savedOf(dto), locale)}`,
              }),
            );
          }
        } else {
          if (dto.outcome === 'rate_limited') block(dto.retryAfterSeconds);
          const text = message(dto, screen);
          setError(code ? `${text} ${t('kept', { code })}` : text);
        }
      } catch {
        setError(code ? `${t('network')} ${t('kept', { code })}` : t('network'));
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [code, applied, evaluate, message, screen, t, locale, block],
  );

  const remove = useCallback(() => {
    setCode(null);
    setError(null);
    setNotice(null);
  }, []);

  const handleSessionError = useCallback(
    (e: unknown): boolean => {
      if (!isDiscountSessionError(e)) return false;
      const removed = code;
      if (e.code === 'DISCOUNT_CODE_RATE_LIMITED') {
        const s = typeof e.details?.retryAfterSeconds === 'number' ? (e.details.retryAfterSeconds as number) : 60;
        setError(t('rateLimited'));
        block(s);
      }
      setNotice(removed ? t('removedNotice', { code: removed }) : null);
      setCode(null);
      return true;
    },
    [code, t, block],
  );

  const appliedRow: CodeRowApplied | null = applied
    ? { code: applied.code, shipping: applied.kind === 'free_shipping', savedLabel: formatMoneyCents(savedOf(applied), locale) }
    : null;

  return {
    code,
    applied,
    handleSessionError,
    rowProps: { applied: appliedRow, pending, error, blocked, notice, onApply: apply, onRemove: remove },
  };
}
