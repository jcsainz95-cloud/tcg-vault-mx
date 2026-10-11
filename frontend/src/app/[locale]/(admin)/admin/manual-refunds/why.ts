import type { useTranslations } from 'next-intl';
import type { ManualRefundDTO } from '@/types/contract';

type Translator = ReturnType<typeof useTranslations>;

/**
 * La columna «Por qué» de una transferencia SPEI (DESIGN_SYSTEM §37.9a · §60.4 c), ramificada por `source`.
 *
 * ⚠️ v1.82 (§PNL.3): `case` es `null` en `withdrawal_delivered`. Antes la lista y el detalle leían `m.case.card`
 * sin guarda (`ManualRefundsView.tsx:155`, `ManualRefundDetailView.tsx:230`) ⇒ una fila así tumbaba la cubeta.
 * `t` = `admin.manualRefunds`; `tsr` = `admin.m3.shippedReason` (los dos motivos de §40.1).
 */
export function manualRefundWhy(m: ManualRefundDTO, t: Translator, tsr: Translator): string {
  if (m.source === 'withdrawal_delivered') {
    const w = m.withdrawal;
    if (!w) return t('source.withdrawal_delivered_unknown');
    return t('source.withdrawal_delivered', { card: w.card.name, folio: w.folio, reason: tsr(w.reason) });
  }
  if (!m.case) return t('source.unknown');
  return t(`source.${m.source}`, { card: m.case.card.name, folio: m.case.folio });
}
