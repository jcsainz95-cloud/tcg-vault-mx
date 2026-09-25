'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  confirmVaultPlacement,
  getLocations,
  prepareVaultPlacement,
  setVaultPrepItem,
  unprepareVaultPlacement,
} from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { useErrorMessage } from '@/components/ui/QueryState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateTimeMx } from '@/lib/format';
import { sortPreparationItems } from '@/lib/preparation-order';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type {
  ConfirmVaultPlacementResponse,
  CustomerDrawerRef,
  LocationNotAvailableDetails,
  PlacementNotPendingDetails,
  PreparationItemStatus,
  PreparationOrderDTO,
  VaultPreparationItemDTO,
  VaultPreparationOrderDTO,
} from '@/types/contract';
import { CustomerNameBlock } from '../vaults/CustomerNameBlock';
import { AgeStamp, CardInfo, LABEL, TAG, useZoneName, useZonedLabel } from './prep-shared';

/**
 * **La tarjeta «Para bóveda»** (`DESIGN_SYSTEM §36` v4.7 · contrato `§M4-VAULT` v1.79.3).
 *
 * Un pedido que el cliente dejó en su bóveda, ya pagado: el operador **junta** las cartas del
 * estante, las **palomea** (paso 1), da el pedido **por preparado** y lo **lleva a su cajón**
 * (paso 2). ⛔ Nunca guía, dirección ni transportista (CA #21, V5). ⛔ Cero dinero.
 *
 * **Estado optimista: no** (§36.5). Cada marca se pinta cuando el servidor responde: los `200` traen
 * `item`/`preparation`, y con ellos se parchea la caché de la cola. Un operador de pie que pulsa y se
 * va tiene que ver lo que el sistema guardó, no lo que él quiso.
 */

type Translator = ReturnType<typeof useTranslations>;

/** Aviso que queda ENCIMA de la lista cuando la tarjeta sale de ella (§36.8 · §36.12). */
export interface QueueNotice {
  role: 'status' | 'alert';
  folio: string;
  lines: string[];
}

const QUEUE_KEY = ['admin-preparation-queue'] as const;

function asApiError(e: unknown): ApiClientError | null {
  return e instanceof ApiClientError ? e : null;
}

function patchOrder(
  qc: QueryClient,
  placementId: string,
  patch: (o: VaultPreparationOrderDTO) => VaultPreparationOrderDTO,
) {
  qc.setQueriesData<PreparationOrderDTO[]>({ queryKey: QUEUE_KEY }, (old) =>
    old?.map((o) => (o.destination === 'vault' && o.placementId === placementId ? patch(o) : o)),
  );
}

function removeOrder(qc: QueryClient, placementId: string) {
  qc.setQueriesData<PreparationOrderDTO[]>({ queryKey: QUEUE_KEY }, (old) =>
    old?.filter((o) => !(o.destination === 'vault' && o.placementId === placementId)),
  );
}

/** Error de fila (§36.5) o de pie (§36.6–§36.8). `retry` solo en los genéricos (§36.9, último párrafo). */
interface ShownError {
  text: string;
  offerUnprepare?: boolean;
  retry?: () => void;
}

export function VaultPlacementCard({
  order,
  locale,
  onNotice,
}: {
  order: VaultPreparationOrderDTO;
  locale: AppLocale;
  onNotice: (notice: QueueNotice) => void;
}) {
  const t = useTranslations('admin.m4.prep');
  const tv = useTranslations('admin.m4.prep.vault');
  const tm1 = useTranslations('admin.m1');
  const tc = useTranslations('common');
  const zoned = useZonedLabel();
  const getMessage = useErrorMessage('operator');
  const qc = useQueryClient();
  const uid = useId();

  const { placementId, preparation, suggestedLocation } = order;
  const folio = order.orderNumber ?? order.orderId;
  const refId = `prep-ref-${placementId}`;
  const step: 'collect' | 'place' = preparation.status === 'prepared' ? 'place' : 'collect';

  // ⭐ H-4 (v1.79.3): «¿hay algo que guardar?» se cuenta sobre `items[]`, ⛔ no sobre
  // `preparation.picked` — es el MISMO conteo que hace el servidor en el paso 6-bis.
  const pickedCount = order.items.filter((i) => i.prepStatus === 'picked').length;
  const hasPicked = pickedCount > 0;
  const missingCount = order.items.filter((i) => i.prepStatus === 'missing').length;

  const [busy, setBusy] = useState<{ itemId: string; action: PreparationItemStatus } | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, ShownError>>({});
  const [footerError, setFooterError] = useState<ShownError | null>(null);
  const [cardNotice, setCardNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  const refetchQueue = () => qc.invalidateQueries({ queryKey: QUEUE_KEY });

  /**
   * §36.12: tras una acción que CAMBIA DE PASO, el foco va a la línea de paso de esta tarjeta (no al
   * inicio de la página). Se salta el primer render: montar la tarjeta no es una acción.
   */
  const stepRef = useRef<HTMLParagraphElement>(null);
  const prevStep = useRef(step);
  useEffect(() => {
    if (prevStep.current !== step) stepRef.current?.focus();
    prevStep.current = step;
  }, [step]);

  /**
   * §36.9 — **el pedido ya no está pendiente**: la tarjeta SALE de la lista, así que el aviso no
   * puede vivir en ella (se iría con la tarjeta antes de leerse). Sube al aviso de la cola.
   * H-2 (v1.79.3): `details.location` permite nombrar el cajón donde quedó.
   */
  function goneFromQueue(err: ApiClientError, verb: 'undo' | 'other') {
    const d = (err.details ?? {}) as Partial<PlacementNotPendingDetails> & Record<string, unknown>;
    const lines: string[] = [];
    if (d.status === 'placed') {
      lines.push(verb === 'undo' ? tv('error.placedUndo') : tv('error.placed'));
      const loc = (d as { location?: { label?: unknown; zone?: unknown } }).location;
      if (loc && typeof loc.label === 'string' && loc.zone === 'customer_custody') {
        lines.push(tv('error.placedIn', { drawer: zoned('customer_custody', loc.label) }));
      }
    } else if (d.status === 'cancelled' && d.cancelReason === 'chargeback') {
      lines.push(tv('error.chargeback'));
    } else {
      lines.push(tv('error.nothingToPlace'));
    }
    removeOrder(qc, placementId);
    onNotice({ role: 'alert', folio, lines });
    void refetchQueue();
  }

  /** Errores comunes a los cuatro verbos. Devuelve `null` si ya lo resolvió (la tarjeta se fue). */
  function commonError(e: unknown, verb: 'undo' | 'other', retry: () => void): ShownError | null {
    const err = asApiError(e);
    if (err?.status === 409 && err.code === 'PLACEMENT_NOT_PENDING') {
      goneFromQueue(err, verb);
      return null;
    }
    if (err?.status === 409 && err.code === 'CONFLICT') {
      // §36.9: copy PROPIO de esta tarjeta, ⛔ no `error.CONFLICT*` (§35.15.3). Sin «Reintentar».
      return { text: tv('error.conflict') };
    }
    if (err?.status === 404) {
      void refetchQueue();
      return { text: tv('error.notFound') };
    }
    // Genéricos (red, 500, 403): el mensaje del catálogo con audiencia operador + «Reintentar».
    return { text: getMessage(e), retry };
  }

  // ---------- Palomear (§36.5) ----------
  const mark = useMutation({
    mutationFn: (v: { itemId: string; status: PreparationItemStatus }) =>
      setVaultPrepItem(placementId, v.itemId, v.status),
    onMutate: (v) => {
      setBusy({ itemId: v.itemId, action: v.status });
      setRowErrors((r) => {
        const next = { ...r };
        delete next[v.itemId];
        return next;
      });
      setCardNotice(null);
    },
    onSuccess: (res) => {
      // `200 changed:false` (doble toque): silencioso — igual se pinta lo que el servidor tiene.
      patchOrder(qc, placementId, (o) => ({
        ...o,
        preparation: res.preparation,
        items: o.items.map((i) => (i.placementItemId === res.item.placementItemId ? res.item : i)),
      }));
    },
    onError: (e, v) => {
      const err = asApiError(e);
      let shown: ShownError | null;
      if (err?.status === 409 && err.code === 'PREP_ITEM_BLOCKED') {
        const reason = err.details?.reason;
        const why =
          reason === 'in_withdrawal' || reason === 'not_in_custody' ? ` ${tv(`blockedReason.${reason}`)}` : '';
        shown = { text: `${tv('error.itemBlocked')}${why}` };
        void refetchQueue();
      } else if (err?.status === 409 && err.code === 'PREPARATION_CLOSED') {
        // El remedio que fija el contrato, ofrecido AHÍ MISMO (§36.5, PV-9).
        shown = { text: tv('error.closed'), offerUnprepare: true };
        void refetchQueue();
      } else {
        shown = commonError(e, 'other', () => mark.mutate(v));
      }
      if (shown) setRowErrors((r) => ({ ...r, [v.itemId]: shown }));
    },
    onSettled: () => setBusy(null),
  });

  // ---------- Pedido preparado (§36.6) ----------
  const prepare = useMutation({
    mutationFn: () => prepareVaultPlacement(placementId),
    onMutate: () => {
      setFooterError(null);
      setCardNotice(null);
    },
    onSuccess: (res) => {
      // `200 already_prepared`: igual, sin aviso extra — quien pulsó a la vez quería lo mismo.
      setRowErrors({});
      patchOrder(qc, placementId, (o) => ({ ...o, preparation: res.preparation }));
    },
    onError: (e) => {
      const err = asApiError(e);
      if (err?.status === 409 && err.code === 'PREPARATION_INCOMPLETE') {
        const pendingCount = Number(err.details?.pendingCount ?? 0);
        setFooterError({ text: tv('error.incomplete', { pendingCount }) });
        void refetchQueue();
        return;
      }
      const shown = commonError(e, 'other', () => prepare.mutate());
      if (shown) setFooterError(shown);
    },
  });

  // ---------- Deshacer preparado (§36.7) ----------
  const unprepare = useMutation({
    mutationFn: () => unprepareVaultPlacement(placementId),
    onMutate: () => {
      setFooterError(null);
      setCardNotice(null);
    },
    onSuccess: (res) => {
      setDialogOpen(false);
      setRowErrors({});
      setChosen('');
      // Las marcas por carta SE CONSERVAN (contrato v1.79.2 paso 5): solo cambia `preparation`.
      patchOrder(qc, placementId, (o) => ({ ...o, preparation: res.preparation }));
      setCardNotice(res.outcome === 'unprepared' ? tv('unprepare.done') : tv('unprepare.alreadyUndone'));
    },
    onError: (e) => {
      setDialogOpen(false);
      const shown = commonError(e, 'undo', () => unprepare.mutate());
      if (shown) setFooterError(shown);
    },
  });

  // ---------- Confirmar colocación (§36.8) ----------
  const confirm = useMutation({
    mutationFn: (locationId: string | undefined) =>
      // ⭐ H-4: sin cartas tomadas NO se manda `locationId` (el servidor lo ignoraría; mandarlo
      // sugeriría una elección que no tiene efecto).
      confirmVaultPlacement(placementId, locationId ? { locationId } : {}),
    onMutate: () => {
      setFooterError(null);
      setCardNotice(null);
    },
    onSuccess: (res) => {
      removeOrder(qc, placementId);
      onNotice({ role: 'status', folio, lines: resultLines(res, folio, tv, zoned) });
      void refetchQueue();
    },
    onError: (e, locationId) => {
      const err = asApiError(e);
      if (err?.status === 422 && err.code === 'LOCATION_NOT_AVAILABLE') {
        const reason = (err.details as Partial<LocationNotAvailableDetails> | undefined)?.reason;
        if (reason === 'not_customer_drawer') {
          setFooterError({ text: tv('error.notCustomerDrawer') });
          setChosen('');
          void refetchQueue();
        } else if (reason === 'location_required') {
          setFooterError({ text: tv('error.locationRequired') });
          void refetchQueue();
        } else {
          setFooterError({ text: tv('error.drawerUnavailable') });
          setChosen('');
        }
        return;
      }
      if (err?.status === 409 && err.code === 'PLACEMENT_NOT_PREPARED') {
        setFooterError({ text: tv('error.notPrepared') });
        void refetchQueue();
        return;
      }
      const shown = commonError(e, 'other', () => confirm.mutate(locationId));
      if (shown) setFooterError(shown);
    },
  });

  // ---------- Cajón (V4) ----------
  const needsDrawerChoice = step === 'place' && hasPicked && suggestedLocation.source !== 'existing_customer_vault';
  const locations = useQuery({
    queryKey: ['locations'],
    queryFn: getLocations,
    enabled: needsDrawerChoice && suggestedLocation.source === 'none',
  });
  // §M4-VAULT.4: la lista del cliente nuevo = cajones ACTIVOS de «Custodia de clientes». Filtrar aquí
  // es presentación; la guarda real es el `confirm` (`422`). ⛔ Nada de «vacío/ocupado/compartido» (V6).
  const customerDrawers = (locations.data ?? []).filter(
    (l) => l.zone === 'customer_custody' && l.isActive !== false,
  );

  let targetDrawer: { id: string; name: string } | null = null;
  if (suggestedLocation.source === 'existing_customer_vault') {
    const l = suggestedLocation.location;
    targetDrawer = { id: l.id, name: zoned(l.zone, l.label) };
  } else if (chosen) {
    const pool: { id: string; label: string }[] =
      suggestedLocation.source === 'multiple_drawers' ? suggestedLocation.locations : customerDrawers;
    const l = pool.find((x) => x.id === chosen);
    if (l) targetDrawer = { id: l.id, name: zoned('customer_custody', l.label) };
  }

  const cardNameId = (itemId: string) => `${uid}-card-${itemId}`;
  const summaryId = `${uid}-summary`;
  const prepareReasonId = `${uid}-prepare-reason`;

  return (
    <article
      data-testid={`prep-order-${placementId}`}
      aria-labelledby={refId}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      {/* Cabecera: destino · folio · antigüedad (§36.2, igual que §35.3). */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-1.5">
          <Badge tone="primary" shape="outline">
            {t('destination.vault')}
          </Badge>
          <span id={refId} className="tabular text-lg font-semibold text-text">
            {folio}
          </span>
        </div>
        <AgeStamp iso={order.requestedAt} locale={locale} t={t} />
      </header>

      {/* Plano 1 · De quién (V1/V2, §36.4). ⛔ Sin bloque de dirección (§35.5). */}
      <div className="flex flex-col gap-1">
        <CustomerNameBlock
          name={order.customer.fullName}
          email={order.customer.email}
          testId={`prep-customer-${placementId}`}
        />
        {/* H-6: el detalle del cliente ya tiene URL propia ⇒ el enlace lleva a SU pestaña, no a la
            lista general (§36.1). */}
        <Link
          href={`/admin/vaults/${order.customer.userId}?tab=physical`}
          className="self-start text-sm text-text underline underline-offset-4 hover:text-accent focus-visible:shadow-focus focus-visible:outline-none"
        >
          {tv('seeWhatShouldBe')}
        </Link>
      </div>

      {/* Plano 2 · A dónde va (§36.3). La rama la decide `suggestedLocation.source` y nada más. */}
      <div data-testid={`vault-drawer-${placementId}`} className="flex flex-col gap-1">
        {suggestedLocation.source === 'existing_customer_vault' && (
          <>
            <span className={LABEL}>{tv('drawer.own')}</span>
            <span className="tabular font-mono text-sm text-text">
              {zoned(suggestedLocation.location.zone, suggestedLocation.location.label)}
            </span>
            <p className="text-sm text-text">
              {tv('drawer.ownBody', { count: suggestedLocation.location.customerPieceCount })}
            </p>
          </>
        )}
        {suggestedLocation.source === 'multiple_drawers' && (
          <>
            <p className={cn(TAG, 'text-accent')}>{tv('drawer.multipleTag')}</p>{' '}
            <p className="text-sm text-text">
              {tv('drawer.multipleBody', { count: suggestedLocation.locations.length })}
            </p>
            {/* Paso 1 (o sin nada que guardar): solo lectura. Paso 2: se vuelve el selector del pie. */}
            {!needsDrawerChoice && (
              <ul className="flex flex-col gap-0.5">
                {suggestedLocation.locations.map((l) => (
                  <DrawerLine key={l.id} drawer={l} zoned={zoned} tv={tv} />
                ))}
              </ul>
            )}
          </>
        )}
        {suggestedLocation.source === 'none' && (
          <>
            <span className={LABEL}>{tv('drawer.newLabel')}</span>
            <p className="text-sm text-text">{tv('drawer.newBody')}</p>
          </>
        )}
      </div>

      {/* Plano 3 · Paso actual y conteo (§36.2, §36.5). */}
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <p
          ref={stepRef}
          tabIndex={-1}
          data-testid={`vault-step-${placementId}`}
          className={cn(TAG, 'text-muted outline-none focus-visible:shadow-focus')}
        >
          {tv(`step.${step}`)}
        </p>
        {/* Región viva de la tarjeta, SIEMPRE montada (§36.12): conteo + avisos de éxito. */}
        <div role="status" aria-live="polite" data-testid={`vault-live-${placementId}`} className="flex flex-col gap-1">
          <p className="tabular text-sm text-text">
            {tv('count', { picked: preparation.picked, missing: preparation.missing, pending: preparation.pending })}
            {preparation.blocked > 0 && <> · {tv('countBlocked', { blocked: preparation.blocked })}</>}
          </p>
          {preparation.status === 'prepared' && (
            <p className="text-sm text-text">
              {preparation.preparedBy.name?.trim()
                ? tv('prepared.by', {
                    name: preparation.preparedBy.name.trim(),
                    date: formatDateTimeMx(preparation.preparedAt, locale),
                  })
                : tv('prepared.byNoName', { date: formatDateTimeMx(preparation.preparedAt, locale) })}
            </p>
          )}
          {cardNotice && <p className="text-sm text-text">{cardNotice}</p>}
        </div>
      </div>

      {/* Plano 4 · Qué saco: las cartas por ubicación (§35.4). */}
      <ul className="flex flex-col gap-3">
        {sortPreparationItems(order.items).map((item) => (
          <VaultItemRow
            key={item.placementItemId}
            item={item}
            editable={step === 'collect'}
            busy={busy?.itemId === item.placementItemId ? busy.action : null}
            error={rowErrors[item.placementItemId] ?? null}
            nameId={cardNameId(item.placementItemId)}
            onMark={(status) => mark.mutate({ itemId: item.placementItemId, status })}
            onUnprepare={() => setDialogOpen(true)}
            t={t}
            tv={tv}
            tc={tc}
          />
        ))}
      </ul>

      {/* Plano 5 · Pie de acción (V5: una acción principal por paso). */}
      <div data-testid={`vault-footer-${placementId}`} className="flex flex-col gap-3 border-t border-border pt-3">
        {step === 'collect' ? (
          <>
            {preparation.picked === 0 && preparation.pending === 0 && (
              <p className="text-sm text-text">{tv('prepare.nothingPicked')}</p>
            )}
            <Button
              variant="primary"
              className="self-start sm:min-h-[44px]"
              disabled={preparation.pending > 0}
              loading={prepare.isPending}
              aria-describedby={preparation.pending > 0 ? prepareReasonId : undefined}
              onClick={() => prepare.mutate()}
            >
              {prepare.isPending ? tv('prepare.saving') : tv('prepare.cta')}
            </Button>
            {preparation.pending > 0 && (
              <p id={prepareReasonId} className="text-sm text-text">
                {tv('prepare.pending', { pending: preparation.pending })}
              </p>
            )}
          </>
        ) : (
          <>
            {needsDrawerChoice && suggestedLocation.source === 'multiple_drawers' && (
              <fieldset className="flex flex-col gap-2">
                <legend className={cn(LABEL, 'mb-1')}>{tv('drawer.multipleLegend')}</legend>
                {suggestedLocation.locations.map((l) => (
                  <label key={l.id} className="flex min-h-[44px] items-center gap-3 text-sm text-text">
                    <input
                      type="radio"
                      name={`${uid}-drawer`}
                      value={l.id}
                      checked={chosen === l.id}
                      onChange={() => setChosen(l.id)}
                      className="h-5 w-5 accent-text"
                    />
                    <span>
                      <span className="tabular font-mono">{zoned(l.zone, l.label)}</span> —{' '}
                      {tv('drawer.piecesThere', { count: l.customerPieceCount })}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {needsDrawerChoice && suggestedLocation.source === 'none' && (
              <div data-testid={`vault-choose-${placementId}`}>
                {locations.isLoading ? (
                  <Skeleton className="h-10 w-64" />
                ) : locations.isError ? (
                  <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-text">
                    <span>{getMessage(locations.error)}</span>
                    <Button size="sm" variant="secondary" className="sm:min-h-[44px]" onClick={() => locations.refetch()}>
                      {tc('retry')}
                    </Button>
                  </div>
                ) : customerDrawers.length === 0 ? (
                  <p className="text-sm text-text">
                    {tv('drawer.noneAvailable', {
                      locations: tm1('locations.button'),
                      zone: tm1('zone.customer_custody'),
                    })}
                  </p>
                ) : (
                  <Select
                    label={tv('drawer.chooseLabel')}
                    placeholder={tv('drawer.choosePlaceholder')}
                    className="max-w-sm"
                    value={chosen}
                    onChange={(e) => setChosen(e.target.value)}
                    options={customerDrawers.map((l) => ({ value: l.id, label: zoned(l.zone, l.label) }))}
                  />
                )}
              </div>
            )}

            {/* El resumen ES la confirmación (§36.8: ⛔ sin diálogo). */}
            <div id={summaryId} data-testid={`vault-summary-${placementId}`} className="flex flex-col gap-0.5 text-sm text-text">
              {!hasPicked ? (
                <p>{tv('place.summaryEmpty')}</p>
              ) : targetDrawer ? (
                <>
                  <p>{tv('place.summary', { picked: pickedCount, drawer: targetDrawer.name })}</p>
                  {missingCount > 0 && <p>{tv('place.summaryMissing', { missing: missingCount })}</p>}
                </>
              ) : (
                <p>{tv('place.chooseFirst')}</p>
              )}
            </div>

            {/* En `< sm`: «Confirmar» arriba y «Deshacer» abajo, con `gap-4`; en `sm+`, «Deshacer» a
                la izquierda y separado (§36.7, §36.12). */}
            <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="ghost"
                className="self-start sm:min-h-[44px]"
                disabled={confirm.isPending}
                onClick={() => setDialogOpen(true)}
              >
                {tv('unprepare.cta')}
              </Button>
              <Button
                variant="primary"
                className="self-start sm:min-h-[44px]"
                disabled={hasPicked && !targetDrawer}
                loading={confirm.isPending}
                aria-describedby={summaryId}
                onClick={() => confirm.mutate(hasPicked ? targetDrawer?.id : undefined)}
              >
                {hasPicked ? tv('place.cta') : tv('place.ctaEmpty')}
              </Button>
            </div>
          </>
        )}
        {footerError && <ErrorLine error={footerError} tc={tc} />}
      </div>

      <UnprepareDialog
        open={dialogOpen}
        pending={unprepare.isPending}
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => unprepare.mutate()}
        tv={tv}
      />
    </article>
  );
}

function DrawerLine({
  drawer,
  zoned,
  tv,
}: {
  drawer: CustomerDrawerRef;
  zoned: ReturnType<typeof useZonedLabel>;
  tv: Translator;
}) {
  // ⛔ Ninguno resaltado ni «recomendado»; el orden es el del servidor (por etiqueta), §36.3b.
  return (
    <li className="text-sm text-text">
      <span className="tabular font-mono">{zoned(drawer.zone, drawer.label)}</span> —{' '}
      {tv('drawer.piecesThere', { count: drawer.customerPieceCount })}
    </li>
  );
}

function ErrorLine({ error, tc }: { error: ShownError; tc: Translator }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text">
      <p>{error.text}</p>
      {error.retry && (
        <Button size="sm" variant="secondary" className="sm:min-h-[44px]" onClick={error.retry}>
          {tc('retry')}
        </Button>
      )}
    </div>
  );
}

function VaultItemRow({
  item,
  editable,
  busy,
  error,
  nameId,
  onMark,
  onUnprepare,
  t,
  tv,
  tc,
}: {
  item: VaultPreparationItemDTO;
  editable: boolean;
  busy: PreparationItemStatus | null;
  error: ShownError | null;
  nameId: string;
  onMark: (status: PreparationItemStatus) => void;
  onUnprepare: () => void;
  t: Translator;
  tv: Translator;
  tc: Translator;
}) {
  const zoneName = useZoneName();
  const blocked = item.placeability.kind === 'blocked';
  const located = item.currentLocation.kind === 'assigned';
  const aria = (action: string) => tv('item.actionAria', { action, card: item.card.name, folio: item.folio });
  const anyBusy = busy !== null;

  return (
    <li
      data-testid={`prep-item-${item.placementItemId}`}
      data-prep-status={blocked ? 'blocked' : item.prepStatus}
      className={cn(
        'flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0',
        // La regla de 2px ayuda a barrer la columna; ⛔ la palabra es el portador (§36.5). ⛔ Nunca verde.
        !blocked && item.prepStatus === 'picked' && 'border-l-2 border-l-text pl-3',
        !blocked && item.prepStatus === 'missing' && 'border-l-2 border-l-accent pl-3',
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
        {/* Ubicación PRIMERO y en columna (§35.4), CON su zona (V3). */}
        <div data-testid={`prep-location-${item.placementItemId}`} className="flex shrink-0 flex-col gap-0.5 sm:w-40">
          {located ? (
            <>
              <span className={LABEL}>
                {item.currentZone ? tv('item.locationLabel', { zone: zoneName(item.currentZone) }) : t('location')}
              </span>
              <span className="tabular text-sm text-text">
                {item.currentLocation.kind === 'assigned' ? item.currentLocation.label : null}
              </span>
            </>
          ) : (
            <>
              <span className={LABEL}>{t('location')}</span>
              <span className="text-sm text-accent">{t('unassigned')}</span>
            </>
          )}
        </div>

        {/* Controles a la izquierda de la miniatura (§36.5); en `< sm` bajan debajo de la carta. */}
        {editable && !blocked && (
          <div
            role="group"
            aria-labelledby={nameId}
            className="order-last flex gap-2 sm:order-none sm:w-44 sm:shrink-0 sm:flex-col"
          >
            {item.prepStatus === 'pending' ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  className="min-h-[44px] flex-1 sm:min-h-[44px] sm:flex-none"
                  aria-label={aria(tv('item.pick'))}
                  loading={busy === 'picked'}
                  disabled={anyBusy && busy !== 'picked'}
                  onClick={() => onMark('picked')}
                >
                  {tv('item.pick')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-[44px] flex-1 sm:min-h-[44px] sm:flex-none"
                  aria-label={aria(tv('item.miss'))}
                  loading={busy === 'missing'}
                  disabled={anyBusy && busy !== 'missing'}
                  onClick={() => onMark('missing')}
                >
                  {tv('item.miss')}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="min-h-[44px] sm:min-h-[44px]"
                aria-label={aria(tv('item.undo'))}
                loading={busy === 'pending'}
                onClick={() => onMark('pending')}
              >
                {tv('item.undo')}
              </Button>
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1 gap-3">
          <CardInfo card={item.card} folio={item.folio} quantity={item.quantity} nameId={nameId} t={t} />
        </div>
      </div>

      {/* Estado de la carta, en palabras (§36.5). */}
      {blocked ? (
        <div className="flex flex-col gap-0.5">
          <p className={cn(TAG, 'text-muted')}>{tv('item.blocked')}</p>{' '}
          <p className="text-sm text-text">
            {item.placeability.kind === 'blocked' && tv(`blockedReason.${item.placeability.reason}`)}
          </p>
        </div>
      ) : item.prepStatus === 'picked' ? (
        <p className={cn(TAG, 'text-text')}>{tv('item.picked')}</p>
      ) : item.prepStatus === 'missing' ? (
        <div className="flex flex-col gap-0.5">
          <p className={cn(TAG, 'text-accent')}>{tv('item.missing')}</p>{' '}
          <p className="text-sm text-text">{tv('item.missingBody')}</p>
        </div>
      ) : null}

      {error && (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text">
          <p>{error.text}</p>
          {error.offerUnprepare && (
            <Button size="sm" variant="ghost" className="min-h-[44px] sm:min-h-[44px]" onClick={onUnprepare}>
              {tv('unprepare.cta')}
            </Button>
          )}
          {error.retry && (
            <Button size="sm" variant="secondary" className="min-h-[44px] sm:min-h-[44px]" onClick={error.retry}>
              {tc('retry')}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * §36.7 — «¿Deshacer «preparado»?». No es destructivo ⇒ botones NEUTROS (⛔ `danger`). Foco inicial en
 * «Cancelar»: este efecto corre DESPUÉS del de `Modal` (que enfoca su contenedor), porque los efectos
 * del hijo corren antes que los del padre.
 */
function UnprepareDialog({
  open,
  pending,
  onCancel,
  onConfirm,
  tv,
}: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  tv: Translator;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={tv('unprepare.title')}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" className="sm:min-h-[44px]" onClick={onCancel}>
            {tv('unprepare.cancel')}
          </Button>
          <Button variant="secondary" className="sm:min-h-[44px]" loading={pending} onClick={onConfirm}>
            {tv('unprepare.confirm')}
          </Button>
        </>
      }
    >
      <p>{tv('unprepare.body')}</p>
    </Modal>
  );
}

/**
 * Líneas del aviso de resultado (§36.8). `n` = `moved` + `already_there` («está en el cajón» para el
 * operador); `m` = faltantes; `k` = las que ya no se podían colocar.
 */
function resultLines(
  res: ConfirmVaultPlacementResponse,
  fallbackFolio: string,
  tv: Translator,
  zoned: ReturnType<typeof useZonedLabel>,
): string[] {
  const folio = res.placement.orderNumber ?? fallbackFolio;
  if (res.outcome === 'already_placed') return [tv('result.alreadyPlaced', { folio })];
  if (res.outcome === 'nothing_to_place') return [tv('result.nothingToPlace', { folio })];
  const n = res.items.filter((i) => i.result === 'moved' || i.result === 'already_there').length;
  const m = res.items.filter((i) => i.result === 'missing').length;
  const k = res.items.filter((i) => i.result === 'skipped').length;
  const loc = res.placement.location;
  const drawer = loc ? zoned(loc.zone, loc.label) : '';
  const lines = [tv('result.placed', { folio, n, drawer })];
  if (m > 0) lines.push(tv('result.placedMissing', { m }));
  if (k > 0) lines.push(tv('result.placedSkipped', { k }));
  return lines;
}
