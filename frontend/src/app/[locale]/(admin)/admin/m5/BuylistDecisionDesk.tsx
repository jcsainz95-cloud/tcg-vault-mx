'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { emitBuylistOffer, getBuylistDecisionTable } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { BuylistDecisionLineDTO, BuylistOfferLineInput, SellRequestStatus } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { CardPhotoLightbox } from './CardPhotoLightbox';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { PriceBasisTag } from '@/components/domain/PriceBasisTag';
import { BuylistBreakdown } from '@/components/domain/BuylistBreakdown';
import { LanguageChip } from '@/components/domain/VersionChip';
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
        <span className="text-xs leading-[1.6] text-muted">{t('position.unavailable.noSuggestion')}</span>
      </div>
    );
  }

  const threshold = suggestion?.thresholdQty ?? null;
  const ruleLabel = suggestion?.rule === 'bounty_target' ? t('position.rule.bounty') : t('position.rule.cap');

  return (
    <div className="flex flex-col gap-1.5" data-testid="position-strip">
      <span className="flex items-baseline gap-2">
        <span className="tabular font-mono text-[15px] text-text">
          {t('position.title', {
            total: position.total,
            threshold: threshold ?? '—',
          })}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{ruleLabel}</span>
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
        <span className={`tabular font-mono text-[13px] text-text ${strong ? 'font-medium' : 'font-normal'}`}>
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

type MesaChip = 'standard' | 'up' | 'down' | 'noPrice';

/**
 * Chip de la mesa (contrato BUYLIST-MESA): se DERIVA de campos del servidor, sin aritmética de dinero.
 * `adjustment === undefined` = servidor anterior al anexo ⇒ sin chip (no se afirma «Estándar» sin saberlo).
 */
function mesaChip(line: BuylistDecisionLineDTO): MesaChip | null {
  if (line.derivedPriceCents == null || line.priceBasis === 'pending') return 'noPrice';
  if (line.adjustment === undefined) return null;
  if (line.adjustment === null) return 'standard';
  return line.adjustment.deltaCents > 0 ? 'up' : 'down';
}

/** «Tenemos N · aceptamos hasta M» / «ya no necesitamos» — en llano, del conteo y la regla del servidor. */
function StockPhrase({ line }: { line: BuylistDecisionLineDTO }) {
  const t = useTranslations('admin.m5.desk.mesa.stock');
  if (line.positionUnavailable || !line.position) return <span className="text-muted">{t('unknown')}</span>;
  const total = line.position.total;
  const threshold = line.suggestion?.thresholdQty ?? null;
  if (threshold == null) return <span>{t('haveOnly', { total })}</span>;
  if (line.suggestion?.verdict === 'do_not_buy') {
    return <span className="font-medium text-accent">{t('full', { total, threshold })}</span>;
  }
  return <span>{t('have', { total, threshold })}</span>;
}

/** `details.lines[]` del 409 `OFFER_PRICE_CHANGED` (`lineId` = itemId). */
interface PriceChangedDetail {
  lineId: string;
  expectedCents: number;
  currentCents: number | null;
}

export interface BuylistDecisionDeskProps {
  sellRequestId: string;
  /** El dueño cierra la mesa (M5 la abre por solicitud). */
  onClose: () => void;
  /**
   * §60.5 d · contrato v1.82 §PNL.4: «Declinar» DENTRO de la mesa en `cotizada`. Abre el MISMO diálogo y verbo que
   * la fila (`openCloseAction('decline', id)` de M5) — ⛔ no se duplica el diálogo. Ausente ⇒ sin botón.
   */
  onDecline?: () => void;
  /** Avisa si la mesa cargó bien (`true`) o no / se desmontó (`false`): M5 oculta su lista de cartas solo con `true`. */
  onReady?: (ready: boolean) => void;
}

/** §60.5 d — qué dice la mesa FUERA de `cotizada`: dónde está la acción, por estado (⛔ un único texto genérico). */
function readOnlyKey(status: SellRequestStatus): string {
  if (status === 'ofertada') return 'readOnlyByStatus.ofertada';
  if (status === 'aceptada') return 'readOnlyByStatus.aceptada';
  if (status === 'en_transito') return 'readOnlyByStatus.en_transito';
  if (status === 'recibida' || status === 'verificacion') return 'readOnlyByStatus.review';
  return 'readOnlyByStatus.done';
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
export function BuylistDecisionDesk({ sellRequestId, onClose, onDecline, onReady }: BuylistDecisionDeskProps) {
  const t = useTranslations('admin.m5.desk');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const queryClient = useQueryClient();
  // ⚠️ **`'operator'` NO es decoración.** Esta es la pantalla donde v1.58 hizo alcanzables
  // `INE_REQUIRED` y `BUYLIST_LIMIT_EXCEEDED` (§M5-A), y sin declarar la audiencia el banner le
  // diría al operador que suba **su** INE. El destinatario se resuelve con `details` del servidor
  // primero y con esto después (DESIGN_SYSTEM §26.2 · `lib/error-audience.ts`).
  const getErrorMessage = useErrorMessage('operator');

  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [overrides, setOverrides] = useState<Record<string, LineOverride>>({});
  const [confirming, setConfirming] = useState(false);
  const [outcome, setOutcome] = useState<'sent' | 'pending_authorization' | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);
  const [cursor, setCursor] = useState(0);
  // Filas con el campo de precio abierto (E o «Editar oferta»): en reposo la fila es compacta y no lo muestra.
  const [priceChanged, setPriceChanged] = useState<Record<string, PriceChangedDetail>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);

  const query = useQuery({
    queryKey: ['buylist-decision-table', sellRequestId],
    queryFn: () => getBuylistDecisionTable(sellRequestId),
  });

  const emit = useMutation({
    mutationFn: (lines: BuylistOfferLineInput[]) => emitBuylistOffer(sellRequestId, lines),
    onMutate: () => setPriceChanged({}),
    onError: (err) => {
      // MESA-1: el mercado se movió entre que se mostró la mesa y se pulsó «Emitir». NO hubo efectos:
      // se refresca la mesa y se resaltan las líneas que difieren (sin éxito, sin correo).
      if (err instanceof ApiClientError && err.code === 'OFFER_PRICE_CHANGED') {
        const raw = (err.details as { lines?: PriceChangedDetail[] } | undefined)?.lines ?? [];
        setPriceChanged(Object.fromEntries(raw.map((l) => [l.lineId, l])));
        setConfirming(false);
        void queryClient.invalidateQueries({ queryKey: ['buylist-decision-table', sellRequestId] });
      }
    },
    onSuccess: (res) => {
      setConfirming(false);
      // ⚠️ El desenlace lo dice `offerState`, NO el código HTTP: `sent` = el correo salió y hay
      // una oferta vinculante; `pending_authorization` = no existe nada para el vendedor todavía.
      setOutcome(res.offerState === 'sent' ? 'sent' : 'pending_authorization');
      void queryClient.invalidateQueries({
        queryKey: ['buylist-decision-table', sellRequestId],
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-buylist'] });
    },
  });

  const data = query.data;
  const loadedOk = query.isSuccess && !!data;
  useEffect(() => {
    onReady?.(loadedOk);
    return () => onReady?.(false);
  }, [loadedOk, onReady]);
  const lines = useMemo(() => data?.lines ?? [], [data]);
  // El default se calcula UNA vez, del servidor; después manda el operador.
  const selection = selected ?? defaultSelection(lines);

  const totals = data ? selectionTotals(lines, selection, overrides, data.totals) : null;
  const blocker = data && totals ? emitBlocker(totals, data.pickupAddressMissing) : null;
  const unavailableCount = lines.filter((l) => l.positionUnavailable || !l.position).length;
  const readOnly = data ? data.status !== 'cotizada' : false;

  // «Solo las que cambian»: se apartan del estándar, no tienen precio, el operador las editó, o la oferta
  // difiere de lo cotizado (`sinceQuote.deltaCents ≠ 0`, contrato BUYLIST_MESA).
  const lineChanges = (l: BuylistDecisionLineDTO) => {
    const chip = mesaChip(l);
    return (
      chip === 'up' ||
      chip === 'down' ||
      chip === 'noPrice' ||
      isOverride(l, overrides[l.itemId]) ||
      (l.sinceQuote != null && l.sinceQuote.deltaCents !== 0)
    );
  };
  const changingCount = lines.filter(lineChanges).length;
  const visibleLines = onlyChanges ? lines.filter(lineChanges) : lines;

  // Tras un 409: llevar la vista a la primera línea resaltada (en el orden de la mesa).
  useEffect(() => {
    const first = lines.find((l) => priceChanged[l.itemId]);
    if (!first) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-item="${first.itemId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
  }, [priceChanged, lines]);
  const cursorIdx = Math.min(cursor, Math.max(visibleLines.length - 1, 0));
  const cursorLine = visibleLines[cursorIdx];

  /** Atajos (solo con el foco en la lista, nunca dentro de un campo): ↑↓ mover · Espacio marcar · E editar precio. */
  function onListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    if (e.target !== e.currentTarget || visibleLines.length === 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(
        0,
        Math.min(visibleLines.length - 1, cursorIdx + (e.key === 'ArrowDown' ? 1 : -1)),
      );
      setCursor(next);
      const el = listRef.current?.querySelector<HTMLElement>(`[data-item="${visibleLines[next].itemId}"]`);
      if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
    } else if (e.key === ' ' && cursorLine && !readOnly) {
      e.preventDefault();
      if (lineAmountCents(cursorLine, overrides[cursorLine.itemId]) != null) toggle(cursorLine.itemId);
    } else if ((e.key === 'e' || e.key === 'E') && cursorLine && !readOnly) {
      e.preventDefault();
      startEditing(cursorLine.itemId);
    }
  }

  function startEditing(itemId: string) {
    setEditing((prev) => new Set(prev).add(itemId));
    // El campo se monta en el siguiente render: se enfoca después.
    setTimeout(() => {
      listRef.current
        ?.querySelector<HTMLInputElement>(`[data-item="${itemId}"] input[type="number"]`)
        ?.focus();
    }, 0);
  }

  function stopEditing(itemId: string) {
    setEditing((prev) => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }

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
        // MESA-1: el precio que la mesa MOSTRÓ (derivado). Si el mercado se movió, el servidor responde
        // 409 OFFER_PRICE_CHANGED sin emitir nada. (Se manda el derivado aunque haya override: el servidor
        // lo compara contra su derivado vigente, no contra el monto tecleado.)
        ...(line.derivedPriceCents != null ? { expectedDerivedCents: line.derivedPriceCents } : {}),
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
                  ? t('sent', {
                      netAmount: formatMoneyCents(totals.netCents, locale),
                    })
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
                <Button size="sm" variant="ghost" onClick={() => setSelected(defaultSelection(lines))}>
                  {t('selectAll')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t('clearAll')}
                </Button>
              </div>
            )}

            {/* CABECERA DE LA MESA: líneas · bruto · envío · se deposita (suma de lo marcado; la previsualización
                vive en la nota de abajo) + la línea que explica cómo leer las columnas. */}
            <div
              className="flex flex-col gap-2 border border-border-strong px-4 py-3"
              data-testid="desk-totals"
            >
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2" aria-live="polite">
                <span className="tabular text-xs text-muted">
                  {t('totals.lines', {
                    selected: totals.selectedCount,
                    total: lines.length,
                  })}
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
              <p className="text-xs leading-[1.6] text-muted" data-testid="desk-summary-hint">
                {t('mesa.summaryHint')} {t('mesa.chipHint')}
              </p>
            </div>

            <div data-testid="desk-filter" className="flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant={onlyChanges ? 'ghost' : 'secondary'}
                aria-pressed={!onlyChanges}
                onClick={() => setOnlyChanges(false)}
              >
                {t('mesa.filterAll', { count: lines.length })}
              </Button>
              <Button
                size="sm"
                variant={onlyChanges ? 'secondary' : 'ghost'}
                aria-pressed={onlyChanges}
                onClick={() => setOnlyChanges(true)}
              >
                {t('mesa.filterChanges', { count: changingCount })}
              </Button>
              {!readOnly && (
                <span className="ml-auto font-mono text-[11px] text-muted">{t('mesa.shortcuts')}</span>
              )}
            </div>

            {/* Cabecera de columnas (solo escritorio; en móvil cada celda lleva su etiqueta). */}
            <div
              aria-hidden="true"
              className="hidden gap-3 border-b border-border-strong pb-2 lg:grid lg:grid-cols-[28px_72px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)]"
            >
              <span />
              <span />
              {(['colCard', 'colMarket', 'colStandard', 'colOffer', 'colStock'] as const).map((k) => (
                <span key={k} className="eyebrow">
                  {t(`mesa.${k}`)}
                </span>
              ))}
            </div>

            {visibleLines.length === 0 && (
              <p className="text-sm text-muted" data-testid="desk-filter-empty">
                {t('mesa.filterEmpty')}
              </p>
            )}

            <ul
              ref={listRef}
              tabIndex={0}
              aria-label={t('mesa.listLabel')}
              role="group"
              aria-activedescendant={cursorLine ? `desk-line-${cursorLine.itemId}` : undefined}
              onKeyDown={onListKeyDown}
              className="-mt-2 flex flex-col divide-y divide-border border-b border-border focus-visible:shadow-focus focus-visible:outline-none"
            >
              {visibleLines.map((line) => {
                const override = overrides[line.itemId];
                const amount = lineAmountCents(line, override);
                const changed = isOverride(line, override);
                const reasonInvalid = changed && !isValidOverrideReason(override?.reason);
                const checked = selection.has(line.itemId);
                const baseChip = mesaChip(line);
                // IMP-2: con precio editado, el chip compara la oferta EDITADA con el estándar.
                let editedDelta: number | null = null;
                let chip = baseChip;
                if (changed && amount != null) {
                  if (line.standardOfferCents != null) {
                    editedDelta = amount - line.standardOfferCents;
                    chip = editedDelta > 0 ? 'up' : editedDelta < 0 ? 'down' : 'standard';
                  } else {
                    chip = 'standard';
                  }
                }
                const isCursor = cursorLine?.itemId === line.itemId;
                const adj = line.adjustment ?? null;
                const sq = line.sinceQuote ?? null;
                return (
                  <li
                    key={line.itemId}
                    id={`desk-line-${line.itemId}`}
                    data-item={line.itemId}
                    data-testid="desk-line"
                    aria-current={isCursor ? 'true' : undefined}
                    className={`flex flex-col gap-2 py-4 pl-2 ${
                      isCursor
                        ? 'border-l-[3px] border-accent bg-surface-2'
                        : 'border-l-[3px] border-transparent'
                    } ${chip === 'down' ? 'bg-[rgba(179,18,23,.06)]' : ''} ${
                      priceChanged[line.itemId] ? 'outline outline-2 -outline-offset-2 outline-accent' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[28px_72px_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.1fr)] lg:items-start">
                      <input
                        type="checkbox"
                        checked={checked}
                        // Una línea sin monto no se puede ofertar: la casilla queda bloqueada
                        // hasta que un override le ponga precio.
                        disabled={readOnly || amount == null}
                        onChange={() => toggle(line.itemId)}
                        aria-label={t('buyLine', { name: line.card.name })}
                        className="mt-1 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
                      />
                      <CardPhotoLightbox card={line.card} />
                      <span className="flex min-w-0 flex-col">
                        <span lang="en" className="text-[15px] text-text">
                          {line.card.name}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                          {line.card.setName} · {line.card.number} · {line.finish}
                        </span>
                        {line.language === 'es' && (
                          <span className="mt-1">
                            <LanguageChip language="es" size="tile" />
                            {line.languagePenaltyPct != null && (
                              <span
                                data-testid="line-language-penalty"
                                className="ml-2 whitespace-nowrap font-mono text-[10px] text-muted"
                              >
                                {t('mesa.languagePenaltyChip', { pct: line.languagePenaltyPct })}
                              </span>
                            )}
                          </span>
                        )}
                      </span>

                      <div className="flex flex-col gap-0.5">
                        <span className="eyebrow lg:hidden">{t('mesa.colMarket')}</span>
                        <span className="tabular font-mono text-sm text-text" data-testid="line-market">
                          {line.marketMxnCents != null ? formatMoneyCents(line.marketMxnCents, locale) : '—'}
                        </span>
                        <span className="text-xs text-muted">
                          {t('quoted')}{' '}
                          <span className="tabular font-mono">
                            {line.quotedPriceCents != null
                              ? formatMoneyCents(line.quotedPriceCents, locale)
                              : '—'}
                          </span>
                        </span>
                        {/* §BUYLIST-ES: mercado → −idioma → ajustado → % de la curva → oferta, en ese orden. */}
                        <BuylistBreakdown breakdown={line.breakdown} offerLabel="offerAdmin" />
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <span className="eyebrow lg:hidden">{t('mesa.colStandard')}</span>
                        <span className="tabular font-mono text-sm text-text" data-testid="line-standard">
                          {line.standardOfferCents != null && line.standardPctBp != null
                            ? t('mesa.standardCell', {
                                // Presentación del % (puntos base del servidor → %); no es dinero.
                                pct: (line.standardPctBp / 100).toLocaleString(
                                  locale === 'es' ? 'es-MX' : 'en-US',
                                  {
                                    maximumFractionDigits: 1,
                                  },
                                ),
                                amount: formatMoneyCents(line.standardOfferCents, locale),
                              })
                            : t('mesa.standardNone')}
                        </span>
                      </div>

                      <div className="flex flex-col items-start gap-1">
                        <span className="eyebrow lg:hidden">{t('weOffer')}</span>
                        {amount != null ? (
                          <span
                            data-testid="line-offer"
                            className="tabular font-serif text-[20px] font-medium leading-none text-text"
                          >
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
                        {chip && (
                          <span
                            data-testid="line-chip"
                            data-chip={chip}
                            className={`inline-block rounded-none border px-2 py-0.5 text-xs font-medium ${
                              chip === 'down'
                                ? 'border-accent bg-accent text-bg'
                                : chip === 'up'
                                  ? 'border-text text-text'
                                  : chip === 'noPrice'
                                    ? 'border-dashed border-border-strong text-muted'
                                    : 'border-border-strong text-text'
                            }`}
                          >
                            {(() => {
                              const d = changed ? editedDelta : (adj?.deltaCents ?? null);
                              if (chip === 'up' && d != null)
                                return `▲ ${t('mesa.chip.up', { amount: formatMoneyCents(d, locale) })}`;
                              if (chip === 'down' && d != null)
                                return `▼ ${t('mesa.chip.down', { amount: formatMoneyCents(Math.abs(d), locale) })}`;
                              return t(`mesa.chip.${chip}`);
                            })()}
                          </span>
                        )}
                        {changed && (
                          <span className="text-xs leading-[1.5] text-text" data-testid="line-reason-edited">
                            {t('mesa.editedByYou')}
                          </span>
                        )}
                        {!changed && adj && (
                          <span className="text-xs leading-[1.5] text-text" data-testid="line-reason">
                            {locale === 'es' && adj.reasonText
                              ? adj.reasonText
                              : t(`mesa.reason.${adj.reasonCode}`)}
                          </span>
                        )}
                        {/* Nota APARTE del chip: el mercado se movió desde la cotización. No cambia el chip. */}
                        {sq && !changed && (
                          <span className="text-xs leading-[1.5] text-muted" data-testid="line-since-quote">
                            {t(`mesa.sinceQuote.${sq.reasonCode}`, {
                              quoted: formatMoneyCents(sq.quotedCents, locale),
                              offer:
                                line.derivedPriceCents != null
                                  ? formatMoneyCents(line.derivedPriceCents, locale)
                                  : '—',
                              // Delta del servidor (derivado − cotizado); aquí solo se formatea su valor absoluto.
                              delta: formatMoneyCents(Math.abs(sq.deltaCents), locale),
                            })}
                          </span>
                        )}
                        {changed && <PriceBasisTag basis="override" />}
                        {!readOnly && !editing.has(line.itemId) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => startEditing(line.itemId)}
                            aria-label={`${t('mesa.edit')}: ${line.card.name}`}
                            data-testid="line-edit"
                          >
                            {t('mesa.edit')}
                          </Button>
                        )}
                      </div>

                      <div
                        className="flex flex-col gap-0.5 text-xs leading-[1.5] text-text"
                        data-testid="line-stock"
                      >
                        <span className="eyebrow lg:hidden">{t('mesa.colStock')}</span>
                        <StockPhrase line={line} />
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

                    {priceChanged[line.itemId] && (
                      <p
                        className="text-sm font-medium text-accent"
                        role="alert"
                        data-testid="line-price-changed"
                      >
                        {t(changed ? 'mesa.priceChangedEdited' : 'mesa.priceChanged', {
                          edited: amount != null ? formatMoneyCents(amount, locale) : '—',
                          from: formatMoneyCents(priceChanged[line.itemId].expectedCents, locale),
                          to:
                            priceChanged[line.itemId].currentCents != null
                              ? formatMoneyCents(priceChanged[line.itemId].currentCents as number, locale)
                              : '—',
                        })}
                      </p>
                    )}

                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted focus-visible:shadow-focus focus-visible:outline-none">
                        {t('mesa.details')}
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                        <PositionStrip line={line} />
                        <SuggestionLine line={line} />
                      </div>
                    </details>

                    {!readOnly && (editing.has(line.itemId) || changed) && (
                      <div className="flex flex-col gap-2" data-testid="line-edit-panel">
                        <div className="flex flex-wrap items-end gap-3">
                          <Input
                            label={t('override.amountLabel', {
                              name: line.card.name,
                            })}
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min={0}
                            // ⚠️ PRE-LLENADO QUE NO ES OVERRIDE. Sin override el campo MUESTRA el
                            // precio con que se cotizó (`derivedPriceCents`), para que el operador
                            // CONFIRME/ajuste en vez de teclear en blanco (un campo vacío invita al
                            // `0.01` fantasma). Es SOLO display: no se siembra un override — mientras
                            // no toque, `overrides[itemId]` sigue sin existir, así que `isOverride`
                            // da false, `lineAmountCents` resuelve al derivado y `buildPayload` NO
                            // manda `overridePriceCents`. El pre-llenado se vuelve override únicamente
                            // cuando el `onChange` de abajo escribe un monto DISTINTO al derivado.
                            // Carta sin derivado (null / PRICE_PENDING) ⇒ vacío: no se inventa precio.
                            value={
                              override?.amountCents != null
                                ? String(override.amountCents / 100)
                                : line.derivedPriceCents != null
                                  ? String(line.derivedPriceCents / 100)
                                  : ''
                            }
                            onChange={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === '') {
                                setOverride(line.itemId, null);
                                return;
                              }
                              const pesos = Number.parseFloat(raw);
                              setOverride(line.itemId, {
                                amountCents: Number.isFinite(pesos) ? Math.round(pesos * 100) : undefined,
                              });
                            }}
                            className="w-40"
                          />
                          {!changed && (
                            <Button size="sm" variant="ghost" onClick={() => stopEditing(line.itemId)}>
                              {t('mesa.editDone')}
                            </Button>
                          )}
                        </div>
                        {/* Motivo OBLIGATORIO ⇔ el monto DIFIERE del derivado. Sin motivo, no hay
                            override: es lo que convierte un número a mano en una decisión
                            revisable en vez de una cifra huérfana. */}
                        {changed && (
                          <div className="flex flex-col gap-1">
                            <label htmlFor={`override-reason-${line.itemId}`} className="eyebrow">
                              {t('override.reasonLabel')}
                            </label>
                            <textarea
                              id={`override-reason-${line.itemId}`}
                              rows={2}
                              maxLength={500}
                              value={override?.reason ?? ''}
                              onChange={(e) =>
                                setOverride(line.itemId, {
                                  reason: e.target.value,
                                })
                              }
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
              data-testid="desk-actions"
            >
              {Object.keys(priceChanged).length > 0 && (
                <div data-testid="price-changed-banner">
                  <Banner variant="warning" role="alert">
                    {t('mesa.priceChangedBanner', { count: Object.keys(priceChanged).length })}
                  </Banner>
                </div>
              )}
              {emit.isError && Object.keys(priceChanged).length === 0 && (
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
                  {/* §60.5 d: «Declinar» a la derecha de «Emitir». ⛔ No se apaga con los bloqueos de emisión:
                      declinar es justo la salida cuando no se puede ofertar. */}
                  {onDecline && (
                    <Button size="sm" variant="secondary" onClick={onDecline} data-testid="desk-decline">
                      {t('decline.action')}
                    </Button>
                  )}
                  {data.requiresAuthorization && <p className="text-xs text-muted">{t('totals.authNote')}</p>}
                </div>
              )}
              {readOnly && (
                <p className="text-sm text-text" data-testid="desk-readonly">
                  {t(readOnlyKey(data.status))}
                </p>
              )}

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
                  <Button loading={emit.isPending} onClick={() => emit.mutate(buildPayload())}>
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
              {/*
                ⚠️ **R4 — esta nota NO nombra cuántos días son, y es deliberado.** El plazo de
                aceptación es un **dial de M10** (D3/D8, criterio 154) y el DTO de la mesa **no lo
                trae**; escribirlo a mano sería la constante que R4 describe: se desincroniza **en
                silencio** la primera vez que alguien mueva el dial. Y dolería el doble aquí —el
                operador leería un plazo en el diálogo donde compromete dinero **mientras el correo
                sale con el real**—. Lo que necesita saber es **que se congela al emitir**, no
                cuántos días son; eso sí es cierto siempre. Si el DTO gana el dial, se interpola.
              */}
              <p className="mt-3 text-xs leading-[1.6] text-muted">{t('confirm.deadlineNote')}</p>
            </Modal>
          </div>
        )}
      </QueryState>
    </section>
  );
}
