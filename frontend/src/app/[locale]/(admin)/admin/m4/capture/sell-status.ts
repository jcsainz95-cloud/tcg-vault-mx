import { useTranslations } from 'next-intl';

/**
 * 💰 rev BSD-1 — el rótulo del estado de una SOLICITUD DE VENTA en los `409` del modo entrada (`GUIDE_NOT_ALLOWED {status}`,
 * `DECLINE_NOT_ALLOWED {status}`, `LABEL_NOT_CANCELLABLE {reason:'sell_request_status', status}`). `expirada` no tiene rótulo
 * en `status.sellRequest` (se pinta por su motivo, §23.1d): aquí, sin motivo a mano, va el neutro «Expirada» — es pantalla del
 * OPERADOR (BX2 rige las del vendedor). ⛔ Nunca el valor crudo del enum si hay rótulo.
 */
export function useSellStatusLabel(): (s: unknown) => string {
  const tSell = useTranslations('status.sellRequest');
  const tExpiry = useTranslations('status.sellRequestExpiry');
  return (s) => {
    if (typeof s !== 'string') return '—';
    if (tSell.has(s)) return tSell(s);
    if (s === 'expirada') return tExpiry('unknown');
    return s;
  };
}
