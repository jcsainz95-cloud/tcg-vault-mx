'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, X } from 'lucide-react';
import { listSealedProducts, listBuylistSets, syncSealedProducts } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  SealedCondition,
  SealedProductDTO,
  SealedSubtype,
  SealedSyncResultDTO,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRole } from '@/lib/role';
import { QuickAddSection } from './QuickAdd';
import {
  SealedProductPicker,
  SealedProductPickerSkeleton,
} from './SealedProductPicker';
import { SealedManualMarketField } from './SealedManualMarketField';
import { SealedGroupLinker } from './SealedGroupLinker';

/**
 * Alta de producto SELLADO — flujo dedicado de 2 pasos (DESIGN_SYSTEM §16.8a, P-38). Evoluciona el flujo
 * de P-35: la fuente ya no es una descarga en vivo anclada a un single, sino la entidad PERSISTIDA
 * `SealedProduct` (`GET /admin/inventory/sealed-products`). Cambian cuatro cosas: (1) el paso 1 se parte
 * en DOS SECCIONES por `origin`; (2) la teja gana subtipos UPC/collection + badge «Principal»; (3)
 * aparece el estado «Sincronizar» (`super_admin`) + curación de grupos promo (`SealedGroupLinker`); (4)
 * el fallback money-safe pasa a ser un input de precio MANUAL auditado (`vault_operator+`, solo si el
 * mercado es null). El alta reusa `POST /admin/inventory/items/batch` con `sealedProductId` (el backend
 * deriva identidad y congela el snapshot ⇒ la pieza nace «ETB …», no la Tropius). Se RETIRA el camino
 * money-unsafe «capturar sin catálogo» de P-35.
 */

const SEALED_SUBTYPES: SealedSubtype[] = [
  'upc',
  'etb',
  'box',
  'bundle',
  'tin',
  'blister',
  'collection',
];
const SEALED_CONDITIONS: SealedCondition[] = ['mint', 'minor_box_damage'];

function parsePesos(v: string): number | null {
  const s = v.trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export interface SealedAddFlowProps {
  open: boolean;
  onClose: () => void;
  /** Set precargado (disparador «Agregar otra presentación» del detalle) — salta el selector. */
  presetSet?: { id: string; name: string } | null;
  onToast?: (msg: string) => void;
  /** Se dispara tras cada alta exitosa (refresca el detalle del set). */
  onCreated?: (folios: string[]) => void;
}

export function SealedAddFlow(props: SealedAddFlowProps) {
  if (!props.open) return null;
  return <SealedAddFlowInner {...props} />;
}

function SealedAddFlowInner({ onClose, presetSet, onToast, onCreated }: SealedAddFlowProps) {
  const t = useTranslations('admin.sealedAdd');
  const tSub = useTranslations('status.sealedSubtype');
  const tCond = useTranslations('status.sealedCondition');
  const locale = useLocale() as AppLocale;
  const { role, isSuperAdmin } = useRole();
  // Permiso del precio manual = vault_operator+ (decisión del humano v1.39.1).
  const canManualMarket = role === 'super_admin' || role === 'vault_operator';
  const dialogRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<'pick' | 'quantity'>('pick');
  const [setId, setSetId] = useState(presetSet?.id ?? '');
  const [q, setQ] = useState('');
  const [principalOnly, setPrincipalOnly] = useState(false);
  const [selected, setSelected] = useState<SealedProductDTO | null>(null);
  // Paso 2 — subtipo/condición (subtipo prellenado con el del producto; editable si venía inferido).
  const [subtype, setSubtype] = useState<SealedSubtype>('box');
  const [condition, setCondition] = useState<SealedCondition>('mint');
  // Paso 2 — precio de mercado MANUAL (solo si marketRef null). Abierto vacío, jamás 0.
  const [manualPrice, setManualPrice] = useState('');
  const [createdOnce, setCreatedOnce] = useState(false);
  // Curación de grupos promo/colección (super_admin).
  const [linkerOpen, setLinkerOpen] = useState(false);
  const [syncResult, setSyncResult] = useState<SealedSyncResultDTO | null>(null);

  // Foco inicial + Esc cierra (§7.6). Modal ancho local (el Modal compartido es max-w-md).
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sets = useQuery({
    queryKey: ['buylist-sets'],
    queryFn: listBuylistSets,
    enabled: !presetSet,
  });

  const list = useQuery({
    queryKey: ['sealed-products', setId, q, principalOnly],
    queryFn: () => listSealedProducts({ setId, q: q || undefined, principalOnly }),
    enabled: setId !== '',
  });

  const sync = useMutation({
    mutationFn: () => syncSealedProducts({ setId }),
    onSuccess: (res) => {
      setSyncResult(res);
      list.refetch();
    },
  });

  const data = list.data?.data ?? [];
  const needsSync = list.data?.needsSync ?? false;
  const noFilters = q.trim() === '' && !principalOnly;
  // Vacío LEGÍTIMO tras sync: el set fue sincronizado pero no trae sellado en la fuente (no es error).
  const legitEmpty = !!list.data && !needsSync && data.length === 0 && noFilters;
  const listUpstreamDown =
    list.isError &&
    list.error instanceof ApiClientError &&
    list.error.code === 'UPSTREAM_ERROR';
  const syncUpstreamDown =
    sync.isError &&
    sync.error instanceof ApiClientError &&
    sync.error.code === 'UPSTREAM_ERROR';

  function pick(p: SealedProductDTO) {
    setSelected(p);
    setSubtype(p.subtype);
    setManualPrice('');
  }

  function goToQuantity(p: SealedProductDTO) {
    pick(p);
    setCreatedOnce(false);
    setStep('quantity');
  }

  function backToPick() {
    setStep('pick');
    setCreatedOnce(false);
  }

  function addAnother() {
    setSelected(null);
    setManualPrice('');
    setCreatedOnce(false);
    setStep('pick');
  }

  const stepLabel = step === 'pick' ? t('step1') : t('step2');

  // v1.41 (IMP-1): la visibilidad del campo manual y el copy «valor de mercado» se keyean en
  // `effectiveMarketCents` (AUTORITATIVO, YA gateado por `sealedPriceSource`), NUNCA en `marketRef`
  // (informativo/caché — el dead-end anterior). Invariante: lo que la UI ofrece == lo que el backend
  // acepta.
  //   effectiveMarketCents == null ⟺ el alta acepta precio manual (dial off/seed o sin mercado).
  //   effectiveMarketCents != null ⟺ el alta se registra a valor de mercado ($X); el manual → 422.
  const gatedMarketCents = selected?.effectiveMarketCents ?? null;
  // `marketRef` queda SOLO como sugerencia informativa cuando NO hay mercado gateado (nunca decide UI).
  const marketRefSuggestionCents =
    selected?.marketRef?.status === 'priced' ? selected.marketRef.referenceMxnCents ?? null : null;
  const manualCents = parsePesos(manualPrice);
  const manualInvalid = manualPrice.trim() !== '' && (manualCents == null || manualCents <= 0);
  const manualValid = manualCents != null && manualCents > 0;
  // Mercado RESUELTO de la aportación = el gateado, o el manual capturado (rehabilita). null ⇒ pendiente.
  const resolvedMarketCents = gatedMarketCents ?? (manualValid ? manualCents : null);
  // El campo manual solo aplica cuando NO hay mercado gateado, y solo a vault_operator+.
  const showManualField = selected != null && gatedMarketCents == null && canManualMarket;

  const linkerTrigger =
    isSuperAdmin && setId !== '' ? (
      <button
        type="button"
        className="w-fit border-b border-accent pb-0.5 text-xs text-accent hover:text-text"
        onClick={() => setLinkerOpen((v) => !v)}
      >
        {t('linker.open')}
      </button>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(26,26,24,.55)] p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[100dvh] w-full max-w-3xl flex-col border-t border-border bg-bg p-5 outline-none sm:max-h-[92vh] sm:border"
      >
        {/* Encabezado + stepper textual mono (aria-current en el paso activo). */}
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-xl text-text">{t('title')}</h2>
            <p
              aria-current="step"
              className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted"
            >
              {stepLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="p-1 text-muted hover:text-text"
          >
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto text-sm text-text">
          {step === 'pick' ? (
            <div className="flex flex-col gap-4">
              {/* Paso 0 — selector de set (solo si no viene precargado). */}
              {!presetSet && (
                <Select
                  label={t('pickSet')}
                  placeholder={t('pickSetPlaceholder')}
                  options={(sets.data ?? []).map((s) => ({
                    value: s.id,
                    label: s.year ? `${s.name} (${s.year})` : s.name,
                  }))}
                  value={setId}
                  onChange={(e) => {
                    setSetId(e.target.value);
                    setSelected(null);
                    setQ('');
                    setPrincipalOnly(false);
                    setSyncResult(null);
                    setLinkerOpen(false);
                  }}
                />
              )}

              {setId === '' ? (
                <p className="border-y border-border px-6 py-16 text-center text-sm text-muted">
                  {t('pickSetPlaceholder')}
                </p>
              ) : list.isLoading ? (
                <SealedProductPickerSkeleton />
              ) : needsSync ? (
                <SyncState
                  canSync={isSuperAdmin}
                  loading={sync.isPending}
                  upstreamDown={!!syncUpstreamDown}
                  onSync={() => sync.mutate()}
                  result={syncResult}
                />
              ) : listUpstreamDown ? (
                <div className="flex flex-col gap-3">
                  <Banner variant="danger" role="alert">
                    {t('upstreamError')}
                  </Banner>
                  <Button variant="secondary" size="sm" onClick={() => list.refetch()}>
                    {t('retry')}
                  </Button>
                </div>
              ) : legitEmpty ? (
                <div className="flex flex-col gap-4">
                  <EmptyState title={t('legitEmpty')} body={t('legitEmptyHint')} />
                  {linkerTrigger}
                  {linkerOpen && isSuperAdmin && (
                    <SealedGroupLinker
                      setId={setId}
                      onLinked={() => {
                        sync.mutate();
                        setLinkerOpen(false);
                      }}
                    />
                  )}
                </div>
              ) : (
                <>
                  {/* Buscador + toggle «Solo principales» sobre AMBAS secciones. */}
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <Input
                      label={t('searchProducts')}
                      className="w-full sm:w-72"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                    <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={principalOnly}
                        onChange={(e) => setPrincipalOnly(e.target.checked)}
                        className="h-4 w-4 accent-[color:var(--color-accent)]"
                      />
                      {t('principalOnly')}
                    </label>
                  </div>

                  {syncResult && (
                    <Banner variant="success" role="status">
                      {t('sync.resultSummary', {
                        products: syncResult.productsUpserted,
                        priced: syncResult.pricedCount,
                        pending: syncResult.pendingPriceCount,
                      })}
                    </Banner>
                  )}

                  <SealedProductPicker
                    data={data}
                    setName={list.data?.set.name ?? ''}
                    selectedId={selected?.id ?? null}
                    onSelect={pick}
                    onConfirm={goToQuantity}
                  />

                  {/* Curación de grupos promo/colección (super_admin). */}
                  {isSuperAdmin && (
                    <div className="flex flex-col gap-3 border-t border-border pt-3">
                      {!linkerOpen && data.length > 0 && linkerTrigger}
                      {linkerOpen && (
                        <SealedGroupLinker
                          setId={setId}
                          onLinked={() => {
                            sync.mutate();
                            setLinkerOpen(false);
                          }}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            /* Paso 2 — cantidad y origen + precio manual money-safe. */
            selected && (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={backToPick}
                  className="flex w-fit items-center gap-1 text-sm text-muted hover:text-text"
                >
                  <ChevronLeft size={16} /> {t('back')}
                </button>

                <SelectedSummary
                  product={selected}
                  locale={locale}
                  subtypeLabel={tSub(selected.subtype)}
                  principalLabel={t('principalBadge')}
                  noMarketLabel={t('noMarket')}
                  gatedMarketCents={gatedMarketCents}
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label={t('subtype')}
                    options={SEALED_SUBTYPES.map((s) => ({ value: s, label: tSub(s) }))}
                    value={subtype}
                    onChange={(e) => setSubtype(e.target.value as SealedSubtype)}
                  />
                  <div>
                    <Select
                      label={t('condition')}
                      options={SEALED_CONDITIONS.map((c) => ({ value: c, label: tCond(c) }))}
                      value={condition}
                      onChange={(e) => setCondition(e.target.value as SealedCondition)}
                    />
                    <p className="mt-2 font-mono text-xs text-muted">{t('conditionHint')}</p>
                  </div>
                </div>

                {/* Precio de mercado MANUAL money-safe — solo si NO hay mercado gateado y vault_operator+. */}
                {showManualField && (
                  <SealedManualMarketField
                    value={manualPrice}
                    onChange={setManualPrice}
                    invalid={manualInvalid}
                    suggestionCents={marketRefSuggestionCents}
                    locale={locale}
                  />
                )}

                <QuickAddSection
                  target={{
                    // H-P38-5: NO se envía cardId — con `sealedProductId` el backend deriva la Card
                    // ancla. Antes se mandaba `selected.id` (un SealedProduct.id) como relleno de tipo,
                    // confiando en que el batch lo ignoraba; ahora se omite (identidad inequívoca).
                    productType: 'sealed',
                    finish: 'normal',
                    sealedSubtype: subtype,
                    sealedCondition: condition,
                    sealedProductId: selected.id,
                    // v1.41 (IMP-1): el manual SOLO viaja cuando el mercado GATEADO es null (coherente
                    // con el backend: con mercado gateado, el manual → 422 MANUAL_MARKET_NOT_ALLOWED).
                    manualMarketMxnCents: gatedMarketCents == null && manualValid ? manualCents : null,
                  }}
                  buyEffectiveCents={null}
                  buySource={null}
                  marketRefCents={resolvedMarketCents}
                  onToast={onToast}
                  onCreated={(folios) => {
                    setCreatedOnce(true);
                    onCreated?.(folios);
                  }}
                />

                {/* Money-safe visible: sin precio manual, la aportación quedará pendiente. */}
                {gatedMarketCents == null && !manualValid && (
                  <p className="text-xs text-muted">{t('manualMarket.pendingIfEmpty')}</p>
                )}

                {createdOnce && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                    <Button variant="secondary" onClick={addAnother}>
                      {t('addAnother')}
                    </Button>
                    <Button variant="ghost" onClick={onClose}>
                      {t('close')}
                    </Button>
                  </div>
                )}
              </div>
            )
          )}
        </div>

        {/* Pie: en el paso 1, Cancelar + Continuar (deshabilitado sin selección). */}
        {step === 'pick' && (
          <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('close')}
            </Button>
            <Button disabled={!selected} onClick={() => selected && goToQuantity(selected)}>
              {t('continue')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Estado «Sincronizar» (`needsSync`) — CTA solo super_admin; vault_operator ve copy sin botón muerto. */
function SyncState({
  canSync,
  loading,
  upstreamDown,
  onSync,
  result,
}: {
  canSync: boolean;
  loading: boolean;
  upstreamDown: boolean;
  onSync: () => void;
  result: SealedSyncResultDTO | null;
}) {
  const t = useTranslations('admin.sealedAdd.sync');
  return (
    <div className="flex flex-col gap-4">
      <EmptyState title={t('title')} body={t('body')} />
      {upstreamDown && (
        <Banner variant="danger" role="alert">
          {t('error')}
        </Banner>
      )}
      {result && (
        <Banner variant="success" role="status">
          {t('resultSummary', {
            products: result.productsUpserted,
            priced: result.pricedCount,
            pending: result.pendingPriceCount,
          })}
        </Banner>
      )}
      {canSync ? (
        <Button className="w-fit" onClick={onSync} loading={loading} disabled={loading}>
          {loading ? t('loading') : upstreamDown ? t('retry') : t('cta')}
        </Button>
      ) : (
        <p className="text-sm text-muted">{t('notAllowed')}</p>
      )}
    </div>
  );
}

function SelectedSummary({
  product,
  locale,
  subtypeLabel,
  principalLabel,
  noMarketLabel,
  gatedMarketCents,
}: {
  product: SealedProductDTO;
  locale: AppLocale;
  subtypeLabel: string;
  principalLabel: string;
  noMarketLabel: string;
  // v1.41 (IMP-1): mercado AUTORITATIVO gateado (SealedProductDTO.effectiveMarketCents). El chip
  // refleja ESTE valor, no `marketRef`/caché — así el resumen no promete un «valor de mercado» que
  // el backend rechazaría cuando el dial está off.
  gatedMarketCents: number | null;
}) {
  const name = product.cleanName ?? product.name;
  const refCents = gatedMarketCents;
  return (
    <div className="flex items-center gap-3 border border-border-strong bg-surface-2 p-3">
      <div className="flex h-[78px] w-[56px] shrink-0 items-center justify-center overflow-hidden bg-bg">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={name} className="h-full w-full object-contain" />
        ) : (
          <span lang="en" className="px-1 text-center font-mono text-[9px] leading-tight text-muted">
            {name}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span lang="en" className="font-medium text-text">
          {name}
        </span>
        <span className="flex flex-wrap items-center gap-2">
          <span className="border border-info px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-info">
            {subtypeLabel}
          </span>
          {product.isPrincipal && (
            <span className="border border-border-strong px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-text">
              {principalLabel}
            </span>
          )}
          {refCents != null ? (
            <span className="font-mono tabular-nums text-xs text-muted">
              {formatMoneyCents(refCents, locale)}
            </span>
          ) : (
            <span className="border border-accent px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-accent">
              {noMarketLabel}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
