'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { getHoldings } from '@/lib/api';
import { useCart } from '@/lib/cart';
import type { AppLocale } from '@/i18n/routing';
import type { HoldingDTO } from '@/types/contract';
import { formatMoneyCents } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { MasterSetPanel } from '@/components/master-set/MasterSetPanel';
import { CardImage } from '@/components/ui/CardImage';
import { ListingSpec } from '@/components/domain/ListingSpec';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { PortfolioTrendChart } from '@/components/domain/PortfolioTrendChart';
import { WithdrawalBadge } from '@/components/domain/WithdrawalBadge';
import { SealedVaultPanel } from '@/components/domain/SealedVaultPanel';
import { ClaimableOrdersNotice } from '@/components/domain/claimable/ClaimableOrdersNotice';
import { WithdrawalsList } from './WithdrawalsList';
import { VAULT_WITHDRAWALS_TAB, WITHDRAWAL_REQUESTED_KEY } from './vaultTabs';

type SortKey = 'default' | 'set' | 'value_desc' | 'value_asc';
// v1.20: "Mi bóveda" gana la vista master set (vista (iii) del contrato, scope user_vault).
// v1.23-sealed-sales: pestaña «Sellado» — superficie dedicada del producto cerrado (§3 GET /vault/sealed).
// §33.4 (Stream A): cuarta pestaña «Retiros» — un retiro es una acción sobre la bóveda. Es la única
// direccionable por URL (`/vault?tab=retiros`): la enlazan el detalle del retiro y el flujo de solicitar.
type VaultTab = 'pieces' | 'masterSet' | 'sealed' | 'withdrawals';
const VAULT_TABS: VaultTab[] = ['pieces', 'masterSet', 'sealed', 'withdrawals'];

/**
 * Ordena los holdings en cliente. `set` usa `card.setName` (localeCompare, desempate
 * por nombre de carta). `value_*` usa el valor de referencia por carta
 * (`referenceValue.referenceMxnCents`); las cartas con precio pendiente (sin valor)
 * quedan SIEMPRE al final en ambos sentidos.
 */
function sortHoldings(rows: HoldingDTO[], key: SortKey, locale: string): HoldingDTO[] {
  if (key === 'default') return rows;
  const copy = [...rows];
  if (key === 'set') {
    copy.sort(
      (a, b) =>
        a.card.setName.localeCompare(b.card.setName, locale) ||
        a.card.name.localeCompare(b.card.name, locale),
    );
    return copy;
  }
  const val = (h: HoldingDTO) => h.referenceValue.referenceMxnCents ?? null;
  copy.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // pendientes al final
    if (bv == null) return -1;
    return key === 'value_desc' ? bv - av : av - bv;
  });
  return copy;
}

/**
 * 6c — El portafolio manda: valor, tendencia y valor por set arriba; abajo el
 * inventario como renglones con folio, estado y valor de referencia, no como
 * tarjetas. Todo se separa con reglas de borde a borde.
 */
export function VaultView() {
  const t = useTranslations('vault');
  const locale = useLocale() as AppLocale;
  const query = useQuery({ queryKey: ['holdings'], queryFn: getHoldings });
  const [sort, setSort] = useState<SortKey>('default');
  // Filtro por set (client-side). 'all' = todos los sets presentes en los holdings.
  const [setFilter, setSetFilter] = useState<string>('all');
  // Pestañas: "Piezas" (renglones actuales) | "Master set" (binder v1.20, vista (iii)) |
  // "Sellado" | "Retiros" (§33.4). Solo «Retiros» arranca desde la URL (`?tab=retiros`).
  const searchParams = useSearchParams();
  const startOnWithdrawals = searchParams.get('tab') === VAULT_WITHDRAWALS_TAB;
  const [tab, setTab] = useState<VaultTab>(startOnWithdrawals ? 'withdrawals' : 'pieces');
  const tabRefs = useRef<Record<VaultTab, HTMLButtonElement | null>>({
    pieces: null,
    masterSet: null,
    sealed: null,
    withdrawals: null,
  });
  // §33.4: al montar con `?tab=retiros` el foco va al `role="tab"` activo (el usuario llega desde
  // un enlace y debe saber dónde aterrizó). Solo al montar: no se roba el foco al cambiar de pestaña.
  useEffect(() => {
    if (startOnWithdrawals) tabRefs.current.withdrawals?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // «Retiro solicitado. Aquí verás su avance.» — marca que deja `/shipments` al pagar; se consume
  // UNA vez (sessionStorage, no URL: un marcador no repite un aviso).
  const [withdrawalRequested, setWithdrawalRequested] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(WITHDRAWAL_REQUESTED_KEY) === '1') {
        window.sessionStorage.removeItem(WITHDRAWAL_REQUESTED_KEY);
        setWithdrawalRequested(true);
      }
    } catch {
      /* sin sessionStorage: no hay aviso que consumir */
    }
  }, []);

  // La pestaña «Retiros» se refleja en la URL (y se quita al salir de ella) sin recargar ni
  // re-renderizar por router: `history.replaceState` es lo que Next 15 sincroniza con useSearchParams.
  const selectTab = useCallback((next: VaultTab) => {
    setTab(next);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (next === 'withdrawals') url.searchParams.set('tab', VAULT_WITHDRAWALS_TAB);
    else url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, []);

  // Teclado del tablist (WAI-ARIA tabs, activación automática): ← → Home End con tabindex itinerante.
  function onTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, current: VaultTab) {
    const idx = VAULT_TABS.indexOf(current);
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % VAULT_TABS.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + VAULT_TABS.length) % VAULT_TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = VAULT_TABS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    const next = VAULT_TABS[nextIdx];
    selectTab(next);
    tabRefs.current[next]?.focus();
  }
  // Carrito de COMPRA del storefront: el CTA de una variante faltante `buyable` agrega la
  // pieza publicada (inventoryItemId) al MISMO carrito/checkout que usa el catálogo (§4).
  const cart = useCart();

  const sortedHoldings = useMemo(
    () => (query.data ? sortHoldings(query.data.data, sort, locale) : []),
    [query.data, sort, locale],
  );

  // Sets presentes en los holdings del usuario (distinct por setId → poblar el filtro).
  // HoldingDTO.card expone setId + setName, así que se agrupa por setId sin ambigüedad.
  const presentSets = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of query.data?.data ?? []) {
      if (!map.has(h.card.setId)) map.set(h.card.setId, h.card.setName);
    }
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [query.data, locale]);

  // Holdings tras aplicar el filtro por set (respeta el orden ya calculado).
  const filteredHoldings = useMemo(
    () => (setFilter === 'all' ? sortedHoldings : sortedHoldings.filter((h) => h.card.setId === setFilter)),
    [sortedHoldings, setFilter],
  );

  // Agrupación por set: cada grupo lleva su valor (suma de referenceMxnCents; los
  // pendientes sin valor no aportan). Preserva el orden de aparición en filteredHoldings.
  const groups = useMemo(() => {
    const byId = new Map<string, { setId: string; setName: string; items: HoldingDTO[]; valueCents: number }>();
    for (const h of filteredHoldings) {
      let g = byId.get(h.card.setId);
      if (!g) {
        g = { setId: h.card.setId, setName: h.card.setName, items: [], valueCents: 0 };
        byId.set(h.card.setId, g);
      }
      g.items.push(h);
      g.valueCents += h.referenceValue.referenceMxnCents ?? 0;
    }
    return [...byId.values()];
  }, [filteredHoldings]);

  // Total del subconjunto filtrado (suma de todos los grupos visibles).
  const filteredTotalCents = useMemo(() => groups.reduce((sum, g) => sum + g.valueCents, 0), [groups]);

  return (
    <div>
      <div className="gutter flex flex-wrap items-end justify-between gap-4 pb-6 pt-10 lg:pt-[46px]">
        <h1 className="font-serif text-[30px] leading-[1.1] text-text lg:text-[40px]">{t('title')}</h1>
        <Link
          href="/shipments"
          className="inline-flex min-h-[44px] items-center border border-text px-6 text-[11px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg"
        >
          {t('requestWithdrawal')}
        </Link>
      </div>

      {/* §33.9: aviso de pedidos de invitado reclamables, entre la cabecera y las pestañas. Sin
          nada que ofrecer no hay nodo (regla 4); su copy dice que NO entran a la bóveda (regla 5). */}
      <ClaimableOrdersNotice surface="vault" className="gutter pb-6" />

      {/* Pestañas: piezas (renglones) ⇆ master set (binder por variantes, v1.20) ⇆ sellado ⇆ retiros. */}
      <div className="gutter flex gap-5 overflow-x-auto border-b border-border" role="tablist" aria-label={t('title')}>
        {VAULT_TABS.map((key) => (
          <button
            key={key}
            id={`vault-tab-${key}`}
            ref={(el) => {
              tabRefs.current[key] = el;
            }}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls={`vault-panel-${key}`}
            tabIndex={tab === key ? 0 : -1}
            onClick={() => selectTab(key)}
            onKeyDown={(e) => onTabKeyDown(e, key)}
            className={`-mb-px min-h-[44px] shrink-0 whitespace-nowrap border-b-2 px-1 text-sm ${
              tab === key ? 'border-primary text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>

      {/* §33.4: «Retiros» — la lista extraída de /shipments (retiros + disputas) con el CTA
          «Solicitar retiro». Al volver de pagar un retiro, el aviso de aterrizaje. */}
      {tab === 'withdrawals' && (
        <div id="vault-panel-withdrawals" role="tabpanel" aria-labelledby="vault-tab-withdrawals">
          {withdrawalRequested && (
            <p role="status" className="gutter rule-note mt-6 text-sm text-text">
              {t('withdrawalRequested')}
            </p>
          )}
          <WithdrawalsList />
        </div>
      )}

      {/* Vista (iii): mi colección por set — faltantes con imagen atenuada y CTA de compra
          cuando la variante trae `buyable`; sin acciones de venta (contrato §3 v1.20). */}
      {tab === 'masterSet' && (
        <div id="vault-panel-masterSet" role="tabpanel" aria-labelledby="vault-tab-masterSet" className="gutter py-8">
          <MasterSetPanel mode="user_vault_self" onBuyMissing={cart.add} />
        </div>
      )}

      {/* Pestaña «Sellado» (§3 GET /vault/sealed): producto cerrado agrupado por producto+condición. */}
      {tab === 'sealed' && (
        <div id="vault-panel-sealed" role="tabpanel" aria-labelledby="vault-tab-sealed" className="gutter py-8">
          <SealedVaultPanel mode="self" />
        </div>
      )}

      {tab === 'pieces' && (
      <div id="vault-panel-pieces" role="tabpanel" aria-labelledby="vault-tab-pieces">
      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data &&
          (query.data.data.length === 0 ? (
            <EmptyState
              title={t('emptyTitle')}
              body={t('emptyBody')}
              action={
                <Link
                  href="/catalog"
                  className="inline-flex min-h-[44px] items-center bg-primary px-6 text-[11px] font-medium uppercase tracking-label text-primary-fg"
                >
                  {t('emptyCta')}
                </Link>
              }
            />
          ) : (
            <>
              {/* Portafolio a la izquierda, custodia y valor por set a la derecha. */}
              <div className="grid border-y border-border lg:grid-cols-[1.2fr_1fr]">
                <div className="gutter border-b border-border py-8 lg:border-b-0 lg:border-r">
                  <PortfolioTrendChart
                    label={t('portfolioValue')}
                    currentValueFallbackCents={query.data.portfolio.totalValueMxnCents}
                    footnote={
                      <>
                        <p className="mt-2.5 text-xs leading-relaxed text-muted">{t('portfolioHint')}</p>
                        {query.data.portfolio.pendingPriceCount > 0 && (
                          <p className="mt-2 font-mono text-[11px] text-accent">
                            {t('pendingPrice', { count: query.data.portfolio.pendingPriceCount })}
                          </p>
                        )}
                      </>
                    }
                  />
                </div>

                <div className="gutter py-8">
                  <p className="rule-note text-sm leading-[1.7] text-text">{t('trustBanner')}</p>

                  {/* Valor por set: suma de referenceMxnCents por set del subconjunto filtrado. */}
                  {groups.length > 0 && (
                    <>
                      <h2 className="eyebrow mt-7">{t('valueBySet')}</h2>
                      <ul className="mt-4">
                        {groups.map((g) => (
                          <li
                            key={g.setId}
                            className="flex items-baseline justify-between gap-3 border-b border-border py-3 text-sm last:border-b-0"
                          >
                            <span className="min-w-0 truncate text-text">
                              <span lang="en">{g.setName}</span>
                              <span className="ml-2 font-mono text-[11px] text-muted">
                                {t('setCount', { count: g.items.length })}
                              </span>
                            </span>
                            <span className="tabular font-medium text-text">
                              {formatMoneyCents(g.valueCents, locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </div>

              {/* Controles cliente: filtro por set + orden + total del subconjunto. */}
              <div className="gutter flex flex-wrap items-end gap-8 border-b border-border py-6">
                <div className="min-w-[200px]">
                  <Select
                    label={t('setFilter.label')}
                    value={setFilter}
                    onChange={(e) => setSetFilter(e.target.value)}
                    options={[
                      { value: 'all', label: t('setFilter.all') },
                      ...presentSets.map((s) => ({ value: s.id, label: s.name })),
                    ]}
                  />
                </div>
                <div className="min-w-[200px]">
                  <Select
                    label={t('sort.label')}
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    options={[
                      { value: 'default', label: t('sort.default') },
                      { value: 'set', label: t('sort.set') },
                      { value: 'value_desc', label: t('sort.valueDesc') },
                      { value: 'value_asc', label: t('sort.valueAsc') },
                    ]}
                  />
                </div>
                <div className="ml-auto text-right">
                  <div className="eyebrow">{t('filteredTotal')}</div>
                  <div className="tabular mt-2.5 text-xl font-medium leading-none text-text">
                    {formatMoneyCents(filteredTotalCents, locale)}
                  </div>
                </div>
              </div>

              {/* Makeover 1a (artboard «Mi bóveda»): «Mis piezas» como TEJAS — imagen
                  5:7, nombre en serif, spec mono, folio, valor + estado sobre regla y
                  CTA «Retirar» por pieza. La retícula sigue la escala del binder
                  (2→3→4→5 columnas). */}
              <div className="gutter pb-14 pt-7">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="eyebrow">{t('myPieces')}</p>
                  <p className="font-mono text-[11px] text-muted">{t('piecesLegend')}</p>
                </div>

                <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-6 lg:grid-cols-4 xl:grid-cols-5">
                  {filteredHoldings.map((h) => {
                    // v1.17: `withdrawable` es la fuente ÚNICA de verdad para habilitar RETIRAR
                    // (true solo si settled && sin envío activo). El hint accesible del botón
                    // deshabilitado distingue "en retiro" (envío activo) de "no liquidada".
                    const inWithdrawal = h.shipmentState !== null;
                    const disabledHint = inWithdrawal ? t('inWithdrawalHint') : t('onlySettled');
                    // v1.42 (BLOQ-2a): para sellado la identidad REAL viene RESUELTA server-side; se pinta
                    // la CAJA (sealedProductName/sealedImageUrl), no el single ancla («Charizard/Tropius»).
                    // raw/graded caen a la carta. Cascada money-safe: nombre nunca null (termina en card.name).
                    const isSealed = h.productType === 'sealed';
                    const displayName = (isSealed ? h.sealedProductName : undefined) ?? h.card.name;
                    const displayImage =
                      (isSealed ? h.sealedImageUrl : undefined) ?? h.card.imageSmallUrl;
                    return (
                      <li key={h.inventoryItemId} className="flex min-w-0 flex-col">
                        {/* imagen de catálogo remota (v1.2, sin fotos propias) */}
                        <CardImage src={displayImage} alt={displayName} className="p-1.5" />

                        <p className="mt-2.5 truncate font-serif text-[15px] leading-[1.3] text-text" lang="en">
                          {displayName}
                        </p>
                        {/* v1.6-finish: acabado del holding; el portafolio valúa contra ese acabado. */}
                        <ListingSpec
                          productType={h.productType}
                          rawCondition={h.rawCondition}
                          sealedSubtype={h.sealedSubtype}
                          finish={h.finish}
                          gradingCompany={h.gradingCompany}
                          gradeValue={h.gradeValue}
                          certNumber={h.certNumber}
                          compact
                          className="mt-1.5 truncate text-muted"
                        />
                        <p className="tabular mt-2 font-mono text-[11px] text-muted">{h.folio}</p>

                        {/* Valor + estado sobre regla. Sin precio NO se pinta MX$0.00 ni «—»:
                            se dice «pendiente» (regla de honestidad). */}
                        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1.5 border-t border-border pt-2">
                          {h.referenceValue.referenceMxnCents != null ? (
                            <span className="tabular text-[15px] font-medium text-text">
                              {formatMoneyCents(h.referenceValue.referenceMxnCents, locale)}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent">
                              {t('valuePending')}
                            </span>
                          )}
                          {/* v1.17: con envío activo manda "EN RETIRO" + etapa (deep-link al
                              rastreo); si no, el badge de titularidad. */}
                          {inWithdrawal ? (
                            <WithdrawalBadge stage={h.shipmentState!} activeShipmentId={h.activeShipmentId} />
                          ) : (
                            <StatusBadge domain="ownership" value={h.ownershipStatus} />
                          )}
                        </div>

                        {/* Retirar solo si `withdrawable` (v1.17: settled && sin envío activo) → navega a
                            /shipments con el ítem preseleccionado (?item=<inventoryItemId>). Si no es
                            retirable, botón deshabilitado con hint accesible ("En retiro" si ya está en
                            un envío; "solo liquidadas" si aún es pending). */}
                        <div className="mt-auto pt-3">
                          {h.withdrawable ? (
                            <Link
                              href={`/shipments?item=${h.inventoryItemId}`}
                              className="inline-flex min-h-[44px] w-full items-center justify-center border border-text px-4 text-[10px] font-medium uppercase leading-none tracking-label text-text hover:bg-text hover:text-primary-fg sm:min-h-[40px]"
                            >
                              {t('withdraw')}
                            </Link>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled
                              className="w-full"
                              title={disabledHint}
                              aria-label={`${t('withdraw')} — ${disabledHint}`}
                            >
                              {t('withdraw')}
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <p className="mt-6 font-mono text-xs text-muted">{t('onlySettled')}</p>
              </div>
            </>
          ))}
      </QueryState>
      </div>
      )}
    </div>
  );
}
