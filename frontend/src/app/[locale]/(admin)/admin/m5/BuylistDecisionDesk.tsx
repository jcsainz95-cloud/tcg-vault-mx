'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { emitBuylistOffer, getBuylistDecisionTable } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import type { BuylistDecisionLineDTO, BuylistOfferLineInput } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { PriceBasisTag } from '@/components/domain/PriceBasisTag';
import {
  defaultSelection,
  emitBlocker,
  isOverride,
  isValidOverrideReason,
  lineAmountCents,
  selectionTotals,
  type LineOverride,
} from './decision-desk';

/**
 * **LA TIRA DE POSICIÓN — cinco cifras leídas en DOS TIEMPOS** (DESIGN_SYSTEM §23.6a-c).
 *
 * *Primer tiempo:* **una** fracción, `POSICIÓN 9/10`, con la versalita de qué regla manda. El
 * operador lee un número y sabe dónde está; el quebrado es honesto también al pasarse (`3/2` dice
 * «ya te pasaste» sin explicarlo).
 * *Segundo tiempo:* los **cuatro sumandos**, siempre los cuatro, siempre en el mismo orden y en las
 * mismas posiciones de la retícula.
 *
 * **Se llama POSICIÓN y no «inventario»**: contesta *«¿de cuántas copias ya soy responsable?»*, que
 * incluye dinero comprometido. Llamarla «tengo» sería mentir.
 *
 * **Cómo se impide que el ojo sume «en camino» + «comprometido» (R6), que es el punto de la
 * pantalla:**
 * - Una **regla vertical de 1px** entre `VERIFICANDO` y `EN CAMINO`: es la frontera *está en la
 *   casa / todavía no está*, y es el único separador del sistema que aquí carga significado.
 * - **Encabezados de grupo reales** (`<th colspan={2} scope="colgroup">`): el lector de pantalla
 *   anuncia **el grupo antes de la cifra**, que es justo la distinción que R6 protege.
 * - **Gradiente de confianza por PESO, no por contraste**: las cuatro cifras van en
 *   `--color-text`; la confianza no se codifica bajando el contraste (§10 prohíbe el muted para
 *   información esencial, y esto decide una compra).
 * - **Prohibido**: subtotal, `+`, paréntesis «(3 por llegar)», barra apilada o cualquier etiqueta
 *   que agrupe las dos. El **único** sitio donde los cuatro se suman es `POSICIÓN`.
 *
 * Y es **una tabla real** con `tabular-nums` y anchos fijos: las cuatro cifras forman **cuatro
 * columnas verticales** a lo largo de las 40 líneas, y el operador escanea *hacia abajo* una
 * columna en vez de leer 40 renglones.
 */
function PositionStrip({ line }: { line: BuylistDecisionLineDTO }) {
  const t = useTranslations('admin.m5.desk');
  const position = line.position;
  const suggestion = line.suggestion;

  /*
   * §23.7 — EL CONTEO QUE NO SE PUDO HACER. **La tira desaparece COMPLETA** —los cuatro sumandos
   * y también el titular— y en su lugar va una frase. Ni siquiera el denominador se pinta: un
   * `—/10` invita a leerlo como `0/10`.
   *
   * La distinción con un cero REAL no es un matiz de glifo ni de tono: es **presencia de
   * estructura numérica frente a ausencia total de ella**. Un `EN INVENTARIO 0` con su retícula
   * es un dato; esto es una oración. Se reconoce a un metro y sobrevive a una captura en gris.
   */
  if (line.positionUnavailable || !position) {
    return (
      <div className="flex flex-col gap-1" data-testid="position-unavailable">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
            {t('position.unavailable.tag')}
          </span>
          {/* Tinta, no muted: es información esencial para una decisión de dinero. */}
          <span className="text-xs leading-[1.6] text-text">{t('position.unavailable.text')}</span>
        </span>
        <span className="text-xs leading-[1.6] text-muted">
          {t('position.unavailable.noSuggestion')}
        </span>
      </div>
    );
  }

  const threshold = suggestion?.thresholdQty ?? null;
  const ruleLabel =
    suggestion?.rule === 'bounty_target' ? t('position.rule.bounty') : t('position.rule.cap');

  return (
    <div className="flex flex-col gap-1.5" data-testid="position-strip">
      <span className="flex items-baseline gap-2">
        <span className="tabular font-mono text-[15px] text-text">
          {t('position.title', { total: position.total, threshold: threshold ?? '—' })}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
          {ruleLabel}
        </span>
      </span>

      <table
        className="w-fit border-collapse text-left"
        aria-label={t('position.aria', {
          total: position.total,
          threshold: threshold ?? '—',
          stock: position.stock,
          verifying: position.verifying,
          inTransit: position.inTransit,
          committed: position.committed,
          rule: ruleLabel,
        })}
      >
        <thead>
          <tr>
            <th colSpan={2} scope="colgroup" className="eyebrow pb-1 pr-5 text-left font-normal">
              {t('position.groupInHouse')}
            </th>
            <th
              colSpan={2}
              scope="colgroup"
              className="eyebrow border-l border-border-strong pb-1 pl-5 text-left font-normal"
            >
              {t('position.groupNotYet')}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* Peso 500 en lo que está en la casa; 400 en lo que todavía no. MISMO color. */}
            <Cell label={t('position.stock')} value={position.stock} strong />
            <Cell label={t('position.verifying')} value={position.verifying} strong className="pr-5" />
            <Cell
              label={t('position.inTransit')}
              value={position.inTransit}
              className="border-l border-border-strong pl-5"
            />
            <Cell label={t('position.committed')} value={position.committed} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  label,
  value,
  strong,
  className,
}: {
  label: string;
  value: number;
  strong?: boolean;
  className?: string;
}) {
  return (
    <td className={`min-w-[104px] pr-4 align-baseline ${className ?? ''}`}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="eyebrow">{label}</span>
        <span
          className={`tabular font-mono text-[13px] text-text ${strong ? 'font-medium' : 'font-normal'}`}
        >
          {value}
        </span>
      </span>
    </td>
  );
}

/**
 * **La sugerencia que informa sin imponer** (§23.6f).
 *
 * - **Es una frase en prosa, no un semáforo.** Una pastilla verde/roja a la izquierda de la fila se
 *   lee como **permiso**; una frase se lee como **opinión**. Esa diferencia es exactamente D6.
 * - **Asimétrica a propósito:** `do_not_buy` pinta **«no comprar»** en `accent` peso 500 y el resto
 *   en muted; `buy` va **todo muted, sin color y sin negrita**. Un consejo que dice «adelante» no
 *   necesita interrumpir; uno que dice «para», sí.
 * - **Siempre explica con cifras**: qué regla se disparó y contra qué número. *Una sugerencia sin
 *   su porqué no es revisable.*
 * - **Ocupa el mismo alto en los tres veredictos.** Si la fila saltara al cambiar el veredicto, el
 *   operador aprendería a temerle.
 */
function SuggestionLine({ line }: { line: BuylistDecisionLineDTO }) {
  const t = useTranslations('admin.m5.desk');
  const s = line.suggestion;
  const total = line.position?.total ?? 0;
  const threshold = s?.thresholdQty ?? 0;

  if (line.positionUnavailable || !s || s.verdict === 'none') {
    // El «sin conteo» ya lo dijo la tira; aquí se reserva el alto para que la fila no salte.
    return <p className="min-h-[20px] text-xs leading-[1.6] text-muted" />;
  }

  const isBounty = s.rule === 'bounty_target';
  const reason =
    s.verdict === 'do_not_buy'
      ? isBounty
        ? t('suggestion.reasonBounty', { total, threshold })
        : t('suggestion.reasonCap', { threshold })
      : isBounty
        ? t('suggestion.reasonBountyOk', { total, threshold })
        : t('suggestion.reasonCapOk', { total, threshold });

  return (
    <p className="min-h-[20px] text-xs leading-[1.6] text-muted" data-testid="suggestion">
      {t('suggestion.label')}:{' '}
      {s.verdict === 'do_not_buy' ? (
        <span className="font-medium text-accent">{t('suggestion.doNotBuy')}</span>
      ) : (
        <span>{t('suggestion.buy')}</span>
      )}{' '}
      — {reason}
      {/* Caso legacy legible: bounty vivo SIN objetivo ⇒ se mide con el tope, y se dice. */}
      {s.bountyActive && s.rule === 'variant_cap' && ` ${t('suggestion.legacyBountyNote')}`}
    </p>
  );
}

export interface BuylistDecisionDeskProps {
  sellRequestId: string;
  /** El dueño cierra la mesa (M5 la abre por solicitud). */
  onClose: () => void;
}

/**
 * **LA MESA DE DECISIÓN** (contrato §M5 · DESIGN_SYSTEM §23.6/§23.7).
 *
 * > *«El admin no debería decidir una compra sin saber cuánto de eso ya tiene. Ocho copias en la
 * > caja y tres más en camino es una razón perfectamente buena para no comprar la novena — y hoy
 * > esa información no está en la pantalla donde se decide.»* (§P.2)
 *
 * Es la petición original del humano, y todo lo demás de esta pantalla existe para que esas cifras
 * se puedan leer sin marearse y sin que el sistema decida por el operador.
 */
export function BuylistDecisionDesk({ sellRequestId, onClose }: BuylistDecisionDeskProps) {
  const t = useTranslations('admin.m5.desk');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  const getErrorMessage = useErrorMessage();

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [overrides, setOverrides] = useState<Record<string, LineOverride>>({});
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'pending_authorization' | null>(null);

  const query = useQuery({
    queryKey: ['buylist-decision-table', sellRequestId],
    queryFn: () => getBuylistDecisionTable(sellRequestId),
  });

  const emit = useMutation({
    mutationFn: (lines: BuylistOfferLineInput[]) => emitBuylistOffer(sellRequestId, lines),
    onSuccess: (res) => {
      setConfirming(false);
      // ⚠️ El desenlace lo dice `offerState`, NO el código HTTP: `sent` = el correo salió y hay
      // una oferta vinculante; `pending_authorization` = no existe nada para el vendedor todavía.
      setOutcome(res.offerState === 'sent' ? 'sent' : 'pending_authorization');
      void queryClient.invalidateQueries({ queryKey: ['buylist-decision-table', sellRequestId] });
      void queryClient.invalidateQueries({ queryKey: ['admin-buylist'] });
    },
  });

  const data = query.data;
  const lines = useMemo(() => data?.lines ?? [], [data]);
  // El default se calcula UNA vez, del servidor; después manda el operador.
  const selection = selected ?? defaultSelection(lines);

  const totals = data
    ? selectionTotals(lines, selection, overrides, data.totals)
    : null;
  const blocker = data && totals ? emitBlocker(totals, data.pickupAddressMissing) : null;
  const unavailableCount = lines.filter((l) => l.positionUnavailable || !l.position).length;
  const readOnly = data ? data.status !== 'cotizada' : false;

  function toggle(itemId: string) {
    const next = new Set(selection);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setSelected(next);
  }

  function setOverride(itemId: string, patch: LineOverride | null) {
    setOverrides((prev) => {
      const next = { ...prev };
      if (patch === null) delete next[itemId];
      else next[itemId] = { ...next[itemId], ...patch };
      return next;
    });
  }

  function buildPayload(): BuylistOfferLineInput[] {
    // ⚠️ `lines` cubre EXACTAMENTE los ítems: las no marcadas viajan como `skip`, nunca se omiten.
    // Una línea olvidada saldría del correo sin que nadie hubiera decidido nada sobre ella.
    return lines.map((line) => {
      if (!selection.has(line.itemId)) return { itemId: line.itemId, decision: 'skip' as const };
      const override = overrides[line.itemId];
      const changed = isOverride(line, override);
      return {
        itemId: line.itemId,
        decision: 'buy' as const,
        ...(override?.amountCents != null ? { overridePriceCents: override.amountCents } : {}),
        // Solo se manda motivo cuando de verdad hay desviación (v1.51.12).
        ...(changed && override?.reason ? { overrideReason: override.reason.trim() } : {}),
      };
    });
  }

  const blockerMessage =
    blocker === 'pickupAddressMissing'
      ? `${t('pickupAddressMissing.text')} ${t('pickupAddressMissing.remedy')}`
      : blocker === 'noLines'
        ? t('totals.noLines')
        : blocker === 'belowMinimum' && data && totals
          ? t('totals.belowMinimum', {
              netAmount: formatMoneyCents(totals.netCents, locale),
              minimumAmount: formatMoneyCents(data.totals.minimumOfferNetCents, locale),
              shortfallAmount: formatMoneyCents(totals.grossShortfallCents, locale),
            })
          : blocker === 'missingReason'
            ? t('override.reasonHint')
            : blocker === 'unpriceableLine'
              ? t('override.noDerived')
              : null;

  return (
    <section className="border-t border-border-strong pt-5" data-testid="decision-desk">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="font-serif text-lg text-text">{t('title')}</h3>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
      </div>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {data && totals && (
          <div className="mt-4 flex flex-col gap-4">
            {outcome && (
              <Banner variant={outcome === 'sent' ? 'info' : 'warning'} role="status">
                {outcome === 'sent'
                  ? t('sent', { netAmount: formatMoneyCents(totals.netCents, locale) })
                  : t('pendingAuthorization')}
              </Banner>
            )}

            {/* §23.7d — aviso de PANTALLA cuando alguna línea llegó sin conteo. No bloquea nada. */}
            {unavailableCount > 0 && (
              <Banner
                variant="warning"
                role="status"
                action={
                  <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
                    {t('position.unavailable.retry')}
                  </Button>
                }
              >
                {t('position.unavailable.banner', {
                  count: unavailableCount,
                  total: lines.length,
                })}
              </Banner>
            )}

            {data.pickupAddressMissing && (
              <Banner variant="danger" role="status" title={t('pickupAddressMissing.text')}>
                {t('pickupAddressMissing.remedy')}
              </Banner>
            )}

            {!readOnly && (
              <div className="flex flex-wrap gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(defaultSelection(lines))}
                >
                  {t('selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t('clearAll')}
                </Button>
              </div>
            )}

            <ul className="flex flex-col divide-y divide-border border-y border-border">
              {lines.map((line) => {
                const override = overrides[line.itemId];
                const amount = lineAmountCents(line, override);
                const changed = isOverride(line, override);
                const reasonInvalid = changed && !isValidOverrideReason(override?.reason);
                const checked = selection.has(line.itemId);
                return (
                  <li key={line.itemId} className="flex flex-col gap-2 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                      <label className="flex min-h-[44px] flex-1 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          // Una línea sin monto no se puede ofertar: la casilla queda bloqueada
                          // hasta que un override le ponga precio.
                          disabled={readOnly || amount == null}
                          onChange={() => toggle(line.itemId)}
                          aria-label={t('buyLine', { name: line.card.name })}
                          className="h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span lang="en" className="text-[15px] text-text">
                            {line.card.name}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                            {line.card.setName} · {line.card.number} · {line.finish}
                          </span>
                        </span>
                      </label>

                      <div className="flex shrink-0 flex-col items-end gap-0.5">
                        {/* Dos montos CON etiqueta, nunca uno solo: cuando el derivado difiere del
                            cotizado, esa diferencia es justo lo que el operador necesita ver. */}
                        <span className="flex items-baseline gap-3 text-xs text-muted">
                          <span>{t('quoted')}</span>
                          <span className="tabular font-mono text-text">
                            {line.quotedPriceCents != null
                              ? formatMoneyCents(line.quotedPriceCents, locale)
                              : '—'}
                          </span>
                        </span>
                        <span className="flex items-baseline gap-3 text-xs text-muted">
                          <span>{t('weOffer')}</span>
                          {amount != null ? (
                            <span className="tabular font-mono text-[15px] font-medium text-text">
                              {formatMoneyCents(amount, locale)}
                            </span>
                          ) : (
                            /* ⛔ Nunca MX$ 0.00: cero es un precio y aquí no hay precio. */
                            <span
                              data-testid="line-no-price"
                              className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent"
                            >
                              {t('noPrice')}
                            </span>
                          )}
                        </span>
                        <PriceBasisTag basis={changed ? 'override' : line.priceBasis} />
                      </div>
                    </div>

                    {/* El PAR (derivedPriceCents, pendingReason) discrimina TRES casos, y el
                        tercero —los dos `null`— es deriva de identidad: el mercado ni se consultó,
                        así que lleva copy propio en vez del motivo de mercado. */}
                    {line.derivedPriceCents == null && (
                      <p className="text-xs leading-[1.6] text-muted">
                        {line.pendingReason
                          ? t(`noPriceReason.${line.pendingReason}`)
                          : t('noPriceReason.identity_drift')}
                      </p>
                    )}

                    <PositionStrip line={line} />
                    <SuggestionLine line={line} />

                    {!readOnly && (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-end gap-3">
                          <Input
                            label={t('override.amountLabel', { name: line.card.name })}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min={0}
                            value={
                              override?.amountCents != null ? String(override.amountCents / 100) : ''
                            }
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === '') {
                                setOverride(line.itemId, null);
                                return;
                              }
                              const pesos = Number.parseFloat(raw);
                              setOverride(line.itemId, {
                                amountCents: Number.isFinite(pesos)
                                  ? Math.round(pesos * 100)
                                  : undefined,
                              });
                            }}
                            className="w-40"
                          />
                          {line.derivedPriceCents != null && (
                            /* La cifra que se pisó SE SIGUE VIENDO. */
                            <p className="pb-3 text-xs text-muted">
                              {t('override.derived', {
                                amount: formatMoneyCents(line.derivedPriceCents, locale),
                              })}
                            </p>
                          )}
                        </div>
                        {/* Motivo OBLIGATORIO ⇔ el monto DIFIERE del derivado. Sin motivo, no hay
                            override: es lo que convierte un número a mano en una decisión
                            revisable en vez de una cifra huérfana. */}
                        {changed && (
                          <div className="flex flex-col gap-1">
                            <label
                              htmlFor={`override-reason-${line.itemId}`}
                              className="eyebrow"
                            >
                              {t('override.reasonLabel')}
                            </label>
                            <textarea
                              id={`override-reason-${line.itemId}`}
                              rows={2}
                              maxLength={500}
                              value={override?.reason ?? ''}
                              onChange={(e) => setOverride(line.itemId, { reason: e.target.value })}
                              aria-describedby={`override-hint-${line.itemId}`}
                              className="w-full border border-border-strong bg-transparent p-2 text-sm text-text focus-visible:shadow-focus focus-visible:outline-none"
                            />
                            <p
                              id={`override-hint-${line.itemId}`}
                              className={`text-xs ${reasonInvalid ? 'text-accent' : 'text-muted'}`}
                            >
                              {t('override.reasonHint')}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* §23.6i — BARRA DE TOTALES. `aria-live="polite"`: cambian con cada casilla. */}
            <div
              className="sticky bottom-0 flex flex-col gap-2 border-t border-border-strong bg-bg py-4"
              data-testid="desk-totals"
            >
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2" aria-live="polite">
                <span className="tabular text-xs text-muted">
                  {t('totals.lines', { selected: totals.selectedCount, total: lines.length })}
                </span>
                <span className="flex items-baseline gap-2 text-xs text-muted">
                  {t('totals.gross')}
                  <span className="tabular font-mono text-sm text-text">
                    {formatMoneyCents(totals.grossCents, locale)}
                  </span>
                </span>
                <span className="flex items-baseline gap-2 text-xs text-muted">
                  {t('totals.shipping')}
                  <span className="tabular font-mono text-sm text-text">
                    {`− ${formatMoneyCents(data.totals.shippingFeeCents, locale)}`}
                  </span>
                </span>
                {/* `SE DEPOSITA` es el MISMO nombre del correo: el operador ve la cifra con la
                    etiqueta con la que la va a leer el vendedor. */}
                <span className="flex items-baseline gap-2 text-xs text-muted">
                  {t('totals.net')}
                  <span
                    data-testid="desk-net"
                    className="tabular font-mono text-[18px] font-medium text-text"
                  >
                    {formatMoneyCents(totals.netCents, locale)}
                  </span>
                </span>
              </div>

              {emit.isError && (
                <Banner variant="danger" role="alert">
                  {getErrorMessage(emit.error)}
                </Banner>
              )}

              {!readOnly && (
                <div className="flex flex-wrap items-center gap-4">
                  <Button
                    size="sm"
                    disabled={blocker !== null}
                    // §15.9: apagado pero NUNCA mudo — el motivo y su remedio van enlazados.
                    aria-describedby={blocker ? 'desk-blocker' : undefined}
                    onClick={() => setConfirming(true)}
                  >
                    {/* Un botón que dice «Emitir» y en realidad encola MIENTE sobre lo que va a
                        pasar. El verbo lo decide `requiresAuthorization` DEL SERVIDOR. */}
                    {data.requiresAuthorization ? t('totals.emitForApproval') : t('totals.emit')}
                  </Button>
                  {data.requiresAuthorization && (
                    <p className="text-xs text-muted">{t('totals.authNote')}</p>
                  )}
                </div>
              )}
              {readOnly && <p className="text-xs text-muted">{t('readOnly')}</p>}

              {blockerMessage && (
                <p id="desk-blocker" className="text-xs leading-[1.6] text-accent">
                  {blockerMessage}
                </p>
              )}

              {/* §23.6j — aviso permanente de previsualización. */}
              <p className="text-xs leading-[1.6] text-muted">{t('totals.previewNote')}</p>
            </div>

            <Modal
              open={confirming}
              onClose={() => setConfirming(false)}
              title={t('confirm.title')}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    {tc('cancel')}
                  </Button>
                  <Button
                    loading={emit.isPending}
                    onClick={() => emit.mutate(buildPayload())}
                  >
                    {data.requiresAuthorization ? t('confirm.ctaForApproval') : t('confirm.cta')}
                  </Button>
                </>
              }
            >
              {/* Repite líneas, los tres montos y el plazo. ⛔ NO se señala cuántas líneas iban
                  contra la sugerencia: eso sería la fricción que D6 prohíbe, colada por detrás. */}
              <p className="leading-[1.7]">
                {t('confirm.body', {
                  count: totals.selectedCount,
                  grossAmount: formatMoneyCents(totals.grossCents, locale),
                  shippingAmount: formatMoneyCents(data.totals.shippingFeeCents, locale),
                  netAmount: formatMoneyCents(totals.netCents, locale),
                })}
              </p>
              <p className="mt-3 text-xs leading-[1.6] text-muted">{t('confirm.deadlineNote')}</p>
            </Modal>
          </div>
        )}
      </QueryState>
    </section>
  );
}
