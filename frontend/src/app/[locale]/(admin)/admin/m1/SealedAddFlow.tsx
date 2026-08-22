'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronLeft, X } from 'lucide-react';
import { getSealedCatalog, listBuylistSets } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import type {
  SealedCatalogProductDTO,
  SealedCondition,
  SealedSubtype,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRole } from '@/lib/role';
import { Link } from '@/i18n/navigation';
import { QuickAddSection } from './QuickAdd';
import { SealedProductGrid, SealedProductGridSkeleton } from './SealedProductGrid';

/**
 * Alta de producto SELLADO — flujo dedicado de 2 pasos (DESIGN_SYSTEM §16.8a, P-35). Reemplaza la
 * reutilización del buscador de CARTAS: el operador elige un PRODUCTO sellado real (ETB, booster
 * box…) de `GET /admin/inventory/sealed-catalog`, y da de alta con el MISMO `QuickAddSection` de
 * P-19 (cantidad + Comprar/Aportación). La pieza NACE MAPEADA (tcgplayerProductId+groupId) ⇒ la
 * aportación valúa en el acto. Camino de respaldo honesto si la fuente TCGCSV cae (PRICE_PENDING).
 */

const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
const SEALED_CONDITIONS: SealedCondition[] = ['mint', 'minor_box_damage'];

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
  const { isSuperAdmin } = useRole();
  const dialogRef = useRef<HTMLDivElement>(null);

  const [step, setStep] = useState<'pick' | 'quantity'>('pick');
  const [setId, setSetId] = useState(presetSet?.id ?? '');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<SealedCatalogProductDTO | null>(null);
  // Paso 2 — subtipo/condición (subtipo prellenado con el inferido; editable).
  const [subtype, setSubtype] = useState<SealedSubtype>('box');
  const [condition, setCondition] = useState<SealedCondition>('mint');
  // Camino de respaldo (fuente caída / producto inexistente): captura manual explícita.
  const [fallback, setFallback] = useState(false);
  const [fallbackName, setFallbackName] = useState('');
  const [createdOnce, setCreatedOnce] = useState(false);

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

  const catalog = useQuery({
    queryKey: ['sealed-catalog', setId],
    queryFn: () => getSealedCatalog({ setId }),
    enabled: setId !== '',
  });

  // Filtro por nombre client-side (§16.8a: buscador sobre el grid dentro del set).
  const products = useMemo(() => {
    const data = catalog.data?.data ?? [];
    if (!q.trim()) return data;
    const needle = q.trim().toLowerCase();
    return data.filter((p) => (p.cleanName ?? p.name).toLowerCase().includes(needle));
  }, [catalog.data, q]);

  const upstreamDown =
    catalog.isError &&
    catalog.error instanceof ApiClientError &&
    catalog.error.code === 'UPSTREAM_ERROR';
  const groupUnresolved = catalog.data && !catalog.data.groupResolved;
  const emptyGrid = catalog.data && catalog.data.groupResolved && products.length === 0;

  function pick(p: SealedCatalogProductDTO) {
    setSelected(p);
    if (p.sealedSubtype) setSubtype(p.sealedSubtype);
  }

  function goToQuantity(p: SealedCatalogProductDTO) {
    pick(p);
    setCreatedOnce(false);
    setStep('quantity');
  }

  function openFallback() {
    setFallback(true);
    setSelected(null);
    setCreatedOnce(false);
    setStep('quantity');
  }

  function backToPick() {
    setStep('pick');
    setFallback(false);
    setCreatedOnce(false);
  }

  function addAnother() {
    setSelected(null);
    setFallback(false);
    setFallbackName('');
    setCreatedOnce(false);
    setStep('pick');
  }

  const anchorCardId = catalog.data?.anchorCardId ?? '';
  const groupId = catalog.data?.tcgcsvGroupId ?? null;

  // Referencia de mercado money-safe de la aportación (null ⇒ tarjeta deshabilitada en QuickAdd).
  const marketRefCents =
    !fallback && selected?.marketRef?.status === 'priced'
      ? selected.marketRef.referenceMxnCents ?? null
      : null;

  const canQuickAdd = fallback
    ? fallbackName.trim() !== '' && anchorCardId !== ''
    : selected != null && anchorCardId !== '';

  const stepLabel = step === 'pick' ? t('step1') : t('step2');

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
                  }}
                />
              )}

              {setId === '' ? (
                <p className="border-y border-border px-6 py-16 text-center text-sm text-muted">
                  {t('pickSetPlaceholder')}
                </p>
              ) : (
                <>
                  {/* Buscador sobre el grid. */}
                  <Input
                    label={t('searchProducts')}
                    className="w-full sm:w-72"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    disabled={catalog.isLoading || !!upstreamDown}
                  />

                  {catalog.isLoading ? (
                    <SealedProductGridSkeleton />
                  ) : upstreamDown ? (
                    <div className="flex flex-col gap-3">
                      <Banner variant="danger" role="alert">
                        {t('upstreamError')}
                      </Banner>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button variant="secondary" size="sm" onClick={() => catalog.refetch()}>
                          {t('retry')}
                        </Button>
                        <button
                          type="button"
                          className="border-b border-accent pb-0.5 text-xs text-accent hover:text-text"
                          onClick={openFallback}
                        >
                          {t('fallbackLink')}
                        </button>
                      </div>
                    </div>
                  ) : groupUnresolved || emptyGrid ? (
                    <div className="flex flex-col gap-4">
                      <EmptyState title={t('noProducts')} body={t('noProductsHint')} />
                      {isSuperAdmin && (
                        <Link
                          href="/admin/m2"
                          className="mx-auto border-b border-accent pb-0.5 text-xs text-accent hover:text-text"
                        >
                          {t('noProductsQueue')}
                        </Link>
                      )}
                      <button
                        type="button"
                        className="mx-auto border-b border-accent pb-0.5 text-xs text-accent hover:text-text"
                        onClick={openFallback}
                      >
                        {t('fallbackLink')}
                      </button>
                    </div>
                  ) : (
                    <SealedProductGrid
                      products={products}
                      setName={catalog.data?.set.name ?? ''}
                      selectedId={selected?.tcgplayerProductId ?? null}
                      onSelect={pick}
                      onConfirm={goToQuantity}
                    />
                  )}
                </>
              )}
            </div>
          ) : (
            /* Paso 2 — cantidad y origen. */
            <div className="flex flex-col gap-4">
              <button
                type="button"
                onClick={backToPick}
                className="flex w-fit items-center gap-1 text-sm text-muted hover:text-text"
              >
                <ChevronLeft size={16} /> {t('back')}
              </button>

              {fallback ? (
                <>
                  {/* Camino de respaldo: excepción EXPLÍCITA, money-safe visible (PRICE_PENDING). */}
                  <Banner variant="info">{t('fallbackNotice')}</Banner>
                  <Input
                    label={t('fallbackProductName')}
                    value={fallbackName}
                    onChange={(e) => setFallbackName(e.target.value)}
                  />
                </>
              ) : (
                selected && <SelectedSummary product={selected} locale={locale} subtypeLabel={selected.sealedSubtype ? tSub(selected.sealedSubtype) : null} noMarketLabel={t('noMarket')} />
              )}

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

              {canQuickAdd && (
                <QuickAddSection
                  target={{
                    cardId: anchorCardId,
                    productType: 'sealed',
                    finish: 'normal',
                    sealedSubtype: subtype,
                    sealedCondition: condition,
                    ...(fallback
                      ? { sealedProductName: fallbackName.trim() }
                      : {
                          tcgplayerProductId: selected!.tcgplayerProductId,
                          tcgplayerGroupId: groupId ?? undefined,
                          sealedImageUrl: selected!.imageUrl,
                          sealedProductName: selected!.name,
                        }),
                  }}
                  buyEffectiveCents={null}
                  buySource={null}
                  marketRefCents={marketRefCents}
                  onToast={onToast}
                  onCreated={(folios) => {
                    setCreatedOnce(true);
                    onCreated?.(folios);
                  }}
                />
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
          )}
        </div>

        {/* Pie: en el paso 1, Cancelar + Continuar (deshabilitado sin selección). */}
        {step === 'pick' && (
          <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('close')}
            </Button>
            <Button
              disabled={!selected}
              onClick={() => selected && goToQuantity(selected)}
            >
              {t('continue')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedSummary({
  product,
  locale,
  subtypeLabel,
  noMarketLabel,
}: {
  product: SealedCatalogProductDTO;
  locale: AppLocale;
  subtypeLabel: string | null;
  noMarketLabel: string;
}) {
  const name = product.cleanName ?? product.name;
  const refCents =
    product.marketRef?.status === 'priced' ? product.marketRef.referenceMxnCents ?? null : null;
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
          {subtypeLabel && (
            <span className="border border-info px-1 font-mono text-[10px] uppercase tracking-[0.06em] text-info">
              {subtypeLabel}
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
