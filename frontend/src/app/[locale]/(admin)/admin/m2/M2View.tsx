'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw, DownloadCloud, Layers, Zap, ExternalLink, MoreHorizontal, Wand2 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import {
  unifyRarities,
  getPendingPrices,
  overridePrice,
  getFx,
  updateFx,
  refreshFx,
  triggerPriceIngest,
  getPriceSyncStatus,
  getPriceProvider,
  updatePriceProvider,
  getBuylistRarities,
  getBuylistRules,
  updateBuylistRules,
  getSalesRarities,
  getSalesRules,
  updateSalesRules,
  getSealedSpreads,
  updateSealedSpreads,
  getRemoteSets,
  syncCatalog,
  backfillCatalog,
  syncAllCatalog,
  refreshVariants,
  refreshVariantsAll,
  getRefreshVariantsStatus,
  getSyncStatus,
} from '@/lib/api';
import type {
  PendingPriceEntryDTO,
  RemoteSetDTO,
  BuylistRule,
  BuylistRuleMode,
  SalesRule,
  SalesRuleMode,
  PriceProvider,
  SealedSubtype,
  Finish,
} from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { ApiClientError } from '@/lib/api-client';
import { useKeepSessionAlive } from '@/lib/keep-alive';

const RULE_MODES: BuylistRuleMode[] = ['fixed', 'pct'];
const SALES_RULE_MODES: SalesRuleMode[] = ['fixed', 'pct'];
// v1.14-price-ingest: proveedores del dial `priceProvider` (ingesta masiva de precios).
const PRICE_PROVIDERS: PriceProvider[] = ['pokemontcg_io', 'pokemonpricetracker'];
// v1.23-sealed-sales: presentaciones del sellado con spread editable (§M2 sealed-spreads).
const SEALED_SUBTYPES: SealedSubtype[] = ['box', 'etb', 'bundle', 'tin', 'blister'];
// v1.29 (§4.28d): acabados que tienen su PROPIO eje de regla (finishRules). `normal` NO lleva
// finish-rule (usa la rareza), por eso queda fuera. Reemplazan las viejas keys sintéticas
// "Holo"/"Reverse Holo" del mapa plano (parche INV-1 retirado).
const FINISH_RULE_KEYS: Finish[] = ['reverse_holo', 'holofoil', 'first_edition_holofoil'];

/** Convierte pesos (texto) a centavos enteros. */
function pesosToCents(value: string): number {
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * S-P1-1 (money-safe): sanea entrada monetaria a dígitos + UN SOLO punto decimal. Un
 * `replace(/[^0-9.]/g,'')` deja pasar "1.2.3"/"12..5", que luego castean a NaN→0 y listarían
 * cartas a MX$0. Aquí se conserva solo el PRIMER punto y se descartan los siguientes.
 */
function sanitizeDecimalInput(value: string): string {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const firstDot = cleaned.indexOf('.');
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
}

/**
 * S-P1-1 (money-safe): un valor CRUDO de regla es guardable solo si NO está vacío y parsea a un
 * número finito. Vacío ("") o mal formado (".", "1.2.3") NO deben guardarse como 0 (regalo).
 */
function isSaveableRuleValue(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === '') return false;
  return Number.isFinite(Number(trimmed));
}

/**
 * El endpoint `sync-all` puede no existir aún en el backend (contrato v1.3, condicional).
 * Un 404/405 se trata como "no disponible" (warning); cualquier otro error real (rate limit,
 * timeout, 5xx) se muestra como error con su código/mensaje.
 */
function isEndpointMissing(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 405);
}

/**
 * Barra de progreso del barrido de catálogo (sync-all). Mientras corre pinta done/total en
 * SETS y avisa —honestamente— que sigue en segundo plano; al terminar muestra el éxito.
 * `role="status"` + `aria-live` para que un lector de pantalla anuncie el avance.
 */
function SyncProgress({
  running,
  done,
  total,
  labels,
}: {
  running: boolean;
  done: number;
  total: number;
  labels: { running: string; runningHint: string; done: string };
}) {
  const pct = total > 0 ? Math.min(100, Math.round((Math.min(done, total) / total) * 100)) : 0;
  const value = running ? pct : 100;
  return (
    // FE-9: semántica de progreso REAL (`role="progressbar"` con `aria-value*`) en la propia
    // barra, en vez de un `role="status"` verboso que re-anunciaba el bloque completo cada ~3 s.
    // El lector de pantalla anuncia el cambio de `aria-valuenow` de forma nativa y moderada.
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{running ? labels.running : labels.done}</span>
        {running && <span className="tabular text-muted">{pct}%</span>}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={running ? `${labels.running} ${pct}%` : labels.done}
        aria-label={running ? labels.running : labels.done}
      >
        <div
          className={`h-full rounded-full transition-all ${running ? 'bg-accent' : 'bg-success'}`}
          style={{ width: `${value}%` }}
        />
      </div>
      {running && <p className="text-xs text-muted">{labels.runningHint}</p>}
    </div>
  );
}

/**
 * §19.4 / §19.9: menú «Más ▾» por-fila que esconde la acción AVANZADA H («Sync completo») fuera del
 * renglón principal para no invitarla por default. Accesible: disparador `aria-haspopup="menu"` +
 * `aria-expanded`; el panel es `role="menu"` con `menuitem`s; `Esc` cierra y devuelve el foco al
 * disparador; un clic fuera también cierra. El icono del kebab es el ÚNICO icono con `aria-label`.
 */
function RowMoreMenu({
  triggerLabel,
  disabled,
  children,
}: {
  triggerLabel: string;
  disabled?: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex min-h-[44px] items-center justify-center px-2 text-text transition-colors hover:text-accent sm:min-h-0 sm:py-2',
          'disabled:cursor-not-allowed disabled:text-muted',
        )}
      >
        <MoreHorizontal size={18} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 z-10 mt-1 flex min-w-[12rem] flex-col rounded-lg border border-border bg-surface p-1 shadow-md"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function M2View() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const tSub = useTranslations('status.sealedSubtype');
  const tFinish = useTranslations('finish');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  // --- §19.5: «Unificar rarezas» — anclado al editor de reglas por rareza (Sección 4/5) ---
  // Backfill LOCAL de `Card.rarityCanonical` (money-safe, sin fuentes externas): colapsa duplicados y
  // variantes de escritura para que el editor muestre UNA fila por rareza real. Al éxito invalida las
  // queries del editor (rarezas + reglas de compra y venta) para recomponer la lista sin duplicados.
  const [unifyConfirmOpen, setUnifyConfirmOpen] = useState(false);
  const unifyMutation = useMutation({
    mutationFn: () => unifyRarities(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buylist-rarities'] });
      qc.invalidateQueries({ queryKey: ['sales-rarities'] });
      qc.invalidateQueries({ queryKey: ['buylist-rules'] });
      qc.invalidateQueries({ queryKey: ['sales-rules'] });
    },
  });

  // --- Sección 2: cola de precio pendiente en DOS BUCKETS (P-6, v1.26) ---
  // VENTA = context=inventory (fijable por override → publica el ítem). COMPRA = context=buylist,
  // vista READ-ONLY (producir el precio de compra on-request es un WRITE del stream buylist,
  // acoplado a INE/AML — FUERA DE ALCANCE de M2; aquí solo se muestra). Ver contrato §M2.
  const [bucket, setBucket] = useState<'venta' | 'compra'>('venta');
  // Cada bucket pide SOLO su contexto y solo cuando su pestaña está activa (calca M6). El override
  // invalida el prefijo ['pending-prices'] → refresca el bucket VENTA al cerrar el pendiente.
  const ventaPending = useQuery({
    queryKey: ['pending-prices', 'inventory'],
    queryFn: () => getPendingPrices('inventory'),
    enabled: bucket === 'venta',
  });
  const compraPending = useQuery({
    queryKey: ['pending-prices', 'buylist'],
    queryFn: () => getPendingPrices('buylist'),
    enabled: bucket === 'compra',
  });
  const [overrideTarget, setOverrideTarget] = useState<PendingPriceEntryDTO | null>(null);
  const [overridePriceValue, setOverridePriceValue] = useState('');
  const overrideMutation = useMutation({
    mutationFn: (entry: PendingPriceEntryDTO) =>
      overridePrice({
        cardId: entry.cardId,
        productType: entry.productType,
        gradeKey: entry.gradeKey,
        // v1.8: la cola es POR ACABADO — sin `finish` el backend defaultea `normal` y el
        // pendiente real (p. ej. holofoil) quedaría abierto.
        finish: entry.finish,
        priceMxnCents: pesosToCents(overridePriceValue),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      setOverrideTarget(null);
      setOverridePriceValue('');
    },
  });

  const pendingColumns: Column<PendingPriceEntryDTO>[] = [
    {
      key: 'card',
      header: t('pending.card'),
      render: (e) => (
        <span lang="en">
          {e.cardName ?? e.card?.name ?? e.cardId}
          {e.card?.number ? <span className="tabular text-muted"> #{e.card.number}</span> : null}
        </span>
      ),
    },
    { key: 'type', header: t('pending.type'), render: (e) => e.productType },
    { key: 'gradeKey', header: t('pending.gradeKey'), render: (e) => <span className="tabular">{e.gradeKey}</span> },
    {
      key: 'finish',
      header: t('pending.finish'),
      render: (e) => <FinishBadge finish={e.finish} productType={e.productType} />,
    },
    { key: 'context', header: t('pending.context'), render: (e) => <Badge tone="warning" shape="outline">{e.context}</Badge> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (e) => (
        <Button size="sm" variant="secondary" onClick={() => { setOverrideTarget(e); setOverridePriceValue(''); }}>
          {t('pending.setPrice')}
        </Button>
      ),
    },
  ];

  // COMPRA (context=buylist): columnas READ-ONLY (carta/número/acabado). SIN acción de fijar precio:
  // el precio de compra lo produce el stream buylist (M5), no M2. Ver contrato §M2 / ARCHITECTURE §4.24c.
  const compraColumns: Column<PendingPriceEntryDTO>[] = [
    {
      key: 'card',
      header: t('pending.card'),
      render: (e) => (
        <span lang="en">
          {e.cardName ?? e.card?.name ?? e.cardId}
          {e.card?.number ? <span className="tabular text-muted"> #{e.card.number}</span> : null}
        </span>
      ),
    },
    {
      key: 'finish',
      header: t('pending.finish'),
      render: (e) => <FinishBadge finish={e.finish} productType={e.productType} />,
    },
  ];

  // --- Sección 3: FX ---
  const fx = useQuery({ queryKey: ['admin-fx'], queryFn: getFx });
  const [fxRate, setFxRate] = useState('');
  const [fxBuffer, setFxBuffer] = useState('');
  // #13: se puede guardar SOLO el colchón. El payload se arma con las keys realmente
  // capturadas: si la tasa queda vacía, se manda `{ bufferPct }` sin `rate` → el backend
  // conserva la tasa vigente y no pinnea un override manual de tasa.
  const fxUpdateMutation = useMutation({
    mutationFn: (payload: { rate?: number; bufferPct?: number }) => updateFx(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fx'] }),
  });
  const fxRefreshMutation = useMutation({
    mutationFn: refreshFx,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-fx'] }),
  });
  function saveFx() {
    const payload: { rate?: number; bufferPct?: number } = {};
    if (fxRate !== '') payload.rate = Number(fxRate);
    if (fxBuffer !== '') payload.bufferPct = Number(fxBuffer);
    fxUpdateMutation.mutate(payload);
  }

  // --- Sección 3b: proveedor de la ingesta masiva + disparo manual (v1.14-price-ingest) ---
  const priceProvider = useQuery({ queryKey: ['price-provider'], queryFn: getPriceProvider });
  const [providerDraft, setProviderDraft] = useState<PriceProvider | null>(null);
  const providerValue: PriceProvider = providerDraft ?? priceProvider.data ?? 'pokemontcg_io';
  const providerDirty = providerDraft != null && providerDraft !== priceProvider.data;
  const providerMutation = useMutation({
    mutationFn: (provider: PriceProvider) => updatePriceProvider(provider),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['price-provider'] });
      setProviderDraft(null);
    },
  });
  // N-14: tras disparar el ingest, el barrido tarda un instante en reportar `running:true` en el
  // backend. Sin esto, el `refetchInterval` (que solo poll-ea cuando YA vio running) se apagaba de
  // inmediato y la barra no aparecía hasta recargar. `justDispatched` fuerza el poll durante una
  // ventana de gracia hasta que el barrido asome (o hasta un tope, para no poll-ear infinito).
  const [justDispatched, setJustDispatched] = useState(false);

  // Estado del barrido MASIVO de precios (GET /admin/pricing/sync-status). Calca el patrón del
  // sync de catálogo: se POLLEA cada 3 s mientras `running` para pintar done/total en vivo y saber
  // CUÁNDO terminó. No llama al proveedor, así que pollearlo no consume presupuesto diario.
  const priceSyncStatus = useQuery({
    queryKey: ['price-sync-status'],
    queryFn: getPriceSyncStatus,
    retry: false,
    // Poll activo si el barrido corre O si acabamos de dispararlo (ventana de gracia hasta que el
    // backend reporte `running:true`). Al terminar (running:false y sin dispatch reciente) se apaga.
    refetchInterval: (query) => (query.state.data?.running || justDispatched ? 2000 : false),
  });
  const priceSweeping = priceSyncStatus.data?.running ?? false;

  // Una vez que el barrido está realmente en curso, suelta la bandera de gracia: a partir de ahí el
  // poll lo gobierna `running` (y se detiene solo al terminar).
  useEffect(() => {
    if (justDispatched && priceSyncStatus.data?.running) setJustDispatched(false);
  }, [justDispatched, priceSyncStatus.data?.running]);

  // Red de seguridad anti-poll-infinito: si tras disparar el barrido nunca asoma `running` (p. ej.
  // terminó tan rápido que no lo vimos, o el disparo no encoló nada), la gracia caduca sola.
  useEffect(() => {
    if (!justDispatched) return;
    const timer = setTimeout(() => setJustDispatched(false), 30000);
    return () => clearTimeout(timer);
  }, [justDispatched]);

  const ingestMutation = useMutation({
    mutationFn: () => triggerPriceIngest(),
    // El ingest repuebla PriceReference → puede resolver pendientes; refresca esa cola.
    // Además arranca de inmediato el poll del estado del barrido de precios (refetch YA, sin esperar
    // recarga) y marca `justDispatched` para que el poll no se apague antes de que el barrido asome.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      setJustDispatched(true);
      void priceSyncStatus.refetch();
    },
  });

  // --- Sección 4: precio de buylist en DOS EJES (v1.29, §4.28d) — retira el parche INV-1 ---
  // Antes las reglas eran un mapa plano que MEZCLABA rareza y acabado: el editor tenía que
  // preservar a mano las keys SINTÉTICAS "Holo"/"Reverse Holo" de la tabla cruda (parche INV-1)
  // porque no aparecían en `rarities` (=groupBy(Card.rarity)) y el PUT (reemplazo total) las
  // borraba. Con el contrato v1.29 esto se separa LIMPIO en un `PriceRuleSet` de dos ejes:
  //  - `rarityRules`: regla por RAREZA CANÓNICA de la carta (empatan 1:1 con `rarities`).
  //  - `finishRules`: regla por ACABADO de la variante (reverse_holo/holofoil/1st ed).
  // El merge del guardado parte del PriceRuleSet del servidor (que YA trae ambos ejes) y aplica el
  // borrador encima: ningún eje pisa al otro y no hay keys sintéticas que rescatar.
  const rarities = useQuery({ queryKey: ['buylist-rarities'], queryFn: getBuylistRarities });
  const buylistRules = useQuery({ queryKey: ['buylist-rules'], queryFn: getBuylistRules });
  // Borradores por EJE: reglas por rareza canónica + reglas por acabado + fallback.
  const [ruleDraft, setRuleDraft] = useState<Record<string, BuylistRule>>({});
  const [finishRuleDraft, setFinishRuleDraft] = useState<Partial<Record<Finish, BuylistRule>>>({});
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const rulesMutation = useMutation({
    mutationFn: (payload: {
      rarityRules: Record<string, BuylistRule>;
      finishRules: Partial<Record<Finish, BuylistRule>>;
      fallbackPct: number;
    }) => updateBuylistRules(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['buylist-rarities'] });
      qc.invalidateQueries({ queryKey: ['buylist-rules'] });
      setRuleDraft({});
      setFinishRuleDraft({});
      setFallbackDraft(null);
    },
  });

  const serverFallback = rarities.data?.fallbackPct ?? 40;
  const effectiveFallback = fallbackDraft ?? String(serverFallback);
  // Regla efectiva de una RAREZA: borrador > regla explícita del servidor > fallback.
  function effectiveRule(rarity: string, serverRule: BuylistRule, source: 'rule' | 'fallback'): BuylistRule {
    if (ruleDraft[rarity]) return ruleDraft[rarity];
    if (source === 'rule') return serverRule;
    return { mode: 'pct', value: Number(effectiveFallback) || 0 };
  }
  // Regla efectiva de un ACABADO: borrador > regla explícita del servidor. Sin regla = HEREDA la
  // rareza (no hay finish-rule): la fila lo indica y su valor de edición arranca vacío.
  function effectiveFinishRule(finish: Finish): { rule: BuylistRule | null; hasRule: boolean } {
    if (finishRuleDraft[finish]) return { rule: finishRuleDraft[finish]!, hasRule: true };
    const server = buylistRules.data?.finishRules[finish];
    if (server) return { rule: server, hasRule: true };
    return { rule: null, hasRule: false };
  }
  const rulesDirty =
    Object.keys(ruleDraft).length > 0 ||
    Object.keys(finishRuleDraft).length > 0 ||
    (fallbackDraft != null && fallbackDraft !== String(serverFallback));

  function saveRules() {
    // Sin el PriceRuleSet del servidor no guardamos: el merge parte de él (dos ejes) para que el
    // REEMPLAZO TOTAL del PUT preserve lo no editado. (Ya no hay keys sintéticas que rescatar.)
    if (!buylistRules.data) return;
    rulesMutation.mutate({
      rarityRules: { ...buylistRules.data.rarityRules, ...ruleDraft },
      finishRules: { ...buylistRules.data.finishRules, ...finishRuleDraft },
      fallbackPct: Number(effectiveFallback) || 0,
    });
  }

  // --- Sección 5: precio de VENTA por RAREZA (v1.13-sales-pricing) ---
  // Análogo a buylist (Sección 4). DIFERENCIA CLAVE: aquí el `pct` es MARKUP ARRIBA de
  // mercado (precio = mercado × (1 + %)), no "% de la referencia"; y `fixed` es un PISO.
  // El validador de venta permite pct hasta 1000 (no topa en 100).
  const salesRarities = useQuery({ queryKey: ['sales-rarities'], queryFn: getSalesRarities });
  // v1.29 (§4.28d): mismo PriceRuleSet de dos ejes que buylist (rareza canónica + acabado). El
  // parche INV-1 (rescatar la key sintética "Holo" de la tabla cruda) queda RETIRADO: el eje de
  // acabado es ahora explícito. El merge del guardado parte del PriceRuleSet del servidor.
  const salesRules = useQuery({ queryKey: ['sales-rules'], queryFn: getSalesRules });
  // Borrador por rareza / por acabado: el `value` se guarda como TEXTO CRUDO (permite edición
  // parcial/decimal/vaciado "12.50","","12."). Se castea a número (centavos si fixed, pct si pct)
  // SOLO al guardar. Re-derivar un número en cada tecla rompía el punto decimal y el vaciado.
  const [salesRuleDraft, setSalesRuleDraft] = useState<Record<string, { mode: SalesRuleMode; value: string }>>({});
  const [salesFinishRuleDraft, setSalesFinishRuleDraft] = useState<
    Partial<Record<Finish, { mode: SalesRuleMode; value: string }>>
  >({});
  const [salesFallbackDraft, setSalesFallbackDraft] = useState<string | null>(null);
  const salesRulesMutation = useMutation({
    mutationFn: (payload: {
      rarityRules: Record<string, SalesRule>;
      finishRules: Partial<Record<Finish, SalesRule>>;
      fallbackPct: number;
    }) => updateSalesRules(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-rarities'] });
      qc.invalidateQueries({ queryKey: ['sales-rules'] });
      setSalesRuleDraft({});
      setSalesFinishRuleDraft({});
      setSalesFallbackDraft(null);
    },
  });

  const salesServerFallback = salesRarities.data?.fallbackPct ?? 15;
  const salesEffectiveFallback = salesFallbackDraft ?? String(salesServerFallback);
  // Texto crudo a mostrar para una regla del servidor: fixed = pesos (centavos/100), pct = tal cual.
  function salesRuleToRaw(rule: SalesRule): string {
    return rule.mode === 'fixed' ? String(rule.value / 100) : String(rule.value);
  }
  // Regla efectiva de una RAREZA (value en TEXTO CRUDO): borrador > regla del servidor > fallback.
  function salesEffectiveRule(
    rarity: string,
    serverRule: SalesRule,
    source: 'rule' | 'fallback',
  ): { mode: SalesRuleMode; value: string } {
    const draft = salesRuleDraft[rarity];
    if (draft) return draft;
    if (source === 'rule') return { mode: serverRule.mode, value: salesRuleToRaw(serverRule) };
    return { mode: 'pct', value: salesEffectiveFallback };
  }
  // Regla efectiva de un ACABADO: borrador > regla del servidor. Sin regla = HEREDA la rareza.
  function salesEffectiveFinishRule(
    finish: Finish,
  ): { mode: SalesRuleMode; value: string; hasRule: boolean } {
    const draft = salesFinishRuleDraft[finish];
    if (draft) return { ...draft, hasRule: true };
    const server = salesRules.data?.finishRules[finish];
    if (server) return { mode: server.mode, value: salesRuleToRaw(server), hasRule: true };
    return { mode: 'fixed', value: '', hasRule: false };
  }
  const salesRulesDirty =
    Object.keys(salesRuleDraft).length > 0 ||
    Object.keys(salesFinishRuleDraft).length > 0 ||
    (salesFallbackDraft != null && salesFallbackDraft !== String(salesServerFallback));
  // S-P1-1 (money-safe): alguna regla TOCADA (rareza o acabado) tiene valor vacío/mal formado → NO
  // es guardable. Bloquea Guardar para que un vacío/NaN nunca se persista como 0 (fixed 0 = MX$0.00
  // → carta regalada; el server acepta 0 y no da 422).
  const salesDraftInvalid =
    Object.values(salesRuleDraft).some((d) => !isSaveableRuleValue(d.value)) ||
    Object.values(salesFinishRuleDraft).some((d) => d != null && !isSaveableRuleValue(d.value));

  // S-L1 (money-safe): el override de precio (Fijar precio) publica el ítem a este valor. Un vacío
  // o mal formado ("1.2.3") castea a NaN→0 vía pesosToCents y publicaría a MX$0. Mismo guard que
  // salesRules: solo es fijable un valor no vacío que parsea a número finito → si no, se bloquea.
  const overrideDraftInvalid = !isSaveableRuleValue(overridePriceValue);

  // Castea un borrador CRUDO de venta a la regla numérica del contrato (fixed: pesos→centavos;
  // pct: número topado a [0,1000]). Money-safe: omite valores vacíos/mal formados (nunca 0).
  function castSalesDraft(d: { mode: SalesRuleMode; value: string }): SalesRule | null {
    if (!isSaveableRuleValue(d.value)) return null;
    const value =
      d.mode === 'fixed'
        ? Math.max(0, pesosToCents(d.value))
        : Math.min(1000, Math.max(0, Number(d.value) || 0));
    return { mode: d.mode, value };
  }

  function saveSalesRules() {
    // Sin el PriceRuleSet del servidor no guardamos: el merge parte de él (dos ejes) para que el
    // REEMPLAZO TOTAL del PUT preserve lo no editado. (Ya no hay key sintética "Holo" que rescatar.)
    if (!salesRules.data) return;
    const draftRarityRules: Record<string, SalesRule> = {};
    for (const [rarity, d] of Object.entries(salesRuleDraft)) {
      const rule = castSalesDraft(d);
      if (rule) draftRarityRules[rarity] = rule;
    }
    const draftFinishRules: Partial<Record<Finish, SalesRule>> = {};
    for (const [finish, d] of Object.entries(salesFinishRuleDraft)) {
      if (!d) continue;
      const rule = castSalesDraft(d);
      if (rule) draftFinishRules[finish as Finish] = rule;
    }
    salesRulesMutation.mutate({
      rarityRules: { ...salesRules.data.rarityRules, ...draftRarityRules },
      finishRules: { ...salesRules.data.finishRules, ...draftFinishRules },
      fallbackPct: Number(salesEffectiveFallback) || 0,
    });
  }

  // --- Sección 5b: spreads de VENTA del SELLADO (v1.23-sealed-sales) ---
  // Clon del editor de venta por rareza, pero keyeado por PRESENTACIÓN (SealedSubtype). El pct es
  // MARKUP ARRIBA de mercado: salePriceCents = round(mercadoTCGCSV × (1 + spread/100)). Un spread 0%
  // vende sin margen → se advierte visualmente.
  const sealedSpreads = useQuery({ queryKey: ['sealed-spreads'], queryFn: getSealedSpreads });
  // Borrador por subtipo + fallback (texto para permitir edición parcial; se castea al guardar).
  const [spreadDraft, setSpreadDraft] = useState<Partial<Record<SealedSubtype, string>>>({});
  const [spreadFallbackDraft, setSpreadFallbackDraft] = useState<string | null>(null);
  const sealedSpreadsMutation = useMutation({
    mutationFn: (payload: { spreadPctBySubtype: Partial<Record<SealedSubtype, number>>; fallbackPct: number }) =>
      updateSealedSpreads(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sealed-spreads'] });
      setSpreadDraft({});
      setSpreadFallbackDraft(null);
    },
  });

  const serverSpreadFallback = sealedSpreads.data?.fallbackPct ?? 15;
  const effectiveSpreadFallback = spreadFallbackDraft ?? String(serverSpreadFallback);
  // Valor efectivo (texto) de un subtipo: borrador > valor del servidor > fallback efectivo.
  function effectiveSpread(sub: SealedSubtype): string {
    if (spreadDraft[sub] != null) return spreadDraft[sub]!;
    const server = sealedSpreads.data?.spreadPctBySubtype[sub];
    return server != null ? String(server) : effectiveSpreadFallback;
  }
  const spreadsDirty =
    Object.keys(spreadDraft).length > 0 ||
    (spreadFallbackDraft != null && spreadFallbackDraft !== String(serverSpreadFallback));
  // Advertencia money-safe: cualquier spread efectivo (o el fallback) en 0% vende sin margen.
  const anyZeroSpread =
    Number(effectiveSpreadFallback) === 0 ||
    SEALED_SUBTYPES.some((s) => {
      const server = sealedSpreads.data?.spreadPctBySubtype[s];
      // Solo cuenta como 0% si el subtipo tiene regla explícita (o borrador) en 0 — no el hueco→fallback.
      const hasExplicit = spreadDraft[s] != null || server != null;
      return hasExplicit && Number(effectiveSpread(s)) === 0;
    });

  function saveSpreads() {
    if (!sealedSpreads.data) return;
    // Preserva los subtipos con regla explícita del servidor y aplica el borrador encima.
    const next: Partial<Record<SealedSubtype, number>> = { ...sealedSpreads.data.spreadPctBySubtype };
    for (const [sub, val] of Object.entries(spreadDraft)) {
      next[sub as SealedSubtype] = Number(val) || 0;
    }
    sealedSpreadsMutation.mutate({
      spreadPctBySubtype: next,
      fallbackPct: Number(effectiveSpreadFallback) || 0,
    });
  }

  // --- Sección 6: sync de catálogo ---
  // Estado del barrido `sync-all` (GET /admin/catalog/sync-status). Se POLLEA cada 3 s
  // mientras `running` para saber en vivo cuántos sets faltan y CUÁNDO terminó (lo que
  // pedía el operador: "saber que acabó"). El endpoint puede no existir aún en backend
  // (404/405): en ese caso no se pinta la barra (retry:false + isError → nada). No llama
  // a pokemontcg.io, así que pollearlo no consume rate-limit.
  const [refreshAllConfirmOpen, setRefreshAllConfirmOpen] = useState(false);
  const syncStatus = useQuery({
    queryKey: ['catalog-sync-status'],
    queryFn: getSyncStatus,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const isSweeping = syncStatus.data?.running ?? false;

  // RV-ALL: el batch «Refrescar variantes + precios de TODO» es ASÍNCRONO. El POST solo lo arranca
  // (202); el progreso y el resumen se leen por su STATUS PROPIO GET /refresh-variants-status (NO el
  // sync-status de sync-all). Se POLLEA cada 3 s mientras `running`, o durante una ventana de gracia
  // tras disparar (hasta que el backend reporte `running:true`), calcando el patrón N-14 de precios.
  const [refreshAllDispatched, setRefreshAllDispatched] = useState(false);
  const refreshVariantsStatus = useQuery({
    queryKey: ['refresh-variants-status'],
    queryFn: getRefreshVariantsStatus,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.running || refreshAllDispatched ? 3000 : false,
  });
  const batchRunning = refreshVariantsStatus.data?.running ?? false;

  // Suelta la bandera de gracia en cuanto el status refleja el batch disparado: bien porque ya está
  // `running` (a partir de ahí el poll lo gobierna `running`), bien porque terminó tan rápido que
  // llegó directo con `summary` (evita que el banner "corriendo" conviva con el resumen final).
  useEffect(() => {
    if (
      refreshAllDispatched &&
      (refreshVariantsStatus.data?.running || refreshVariantsStatus.data?.summary)
    ) {
      setRefreshAllDispatched(false);
    }
  }, [refreshAllDispatched, refreshVariantsStatus.data?.running, refreshVariantsStatus.data?.summary]);

  // Red anti-poll-infinito: si tras disparar nunca asoma `running` (terminó tan rápido que no lo
  // vimos, o no encoló nada), la gracia caduca sola.
  useEffect(() => {
    if (!refreshAllDispatched) return;
    const timer = setTimeout(() => setRefreshAllDispatched(false), 30000);
    return () => clearTimeout(timer);
  }, [refreshAllDispatched]);

  // Mientras hay un barrido en curso, refresca la tabla (cardCount/imported avanzan solos).
  const remoteSets = useQuery({
    queryKey: ['remote-sets'],
    queryFn: getRemoteSets,
    // Refresca la tabla mientras hay un barrido (sync-all) o el batch de variantes en curso:
    // cardCount/imported avanzan solos.
    refetchInterval: isSweeping || batchRunning ? 5000 : false,
  });
  const catalogSyncMutation = useMutation({
    mutationFn: (setId?: string) => syncCatalog(setId ? { setId } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  const backfillMutation = useMutation({
    mutationFn: () => backfillCatalog({ batchSize: 10 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  // Tras lanzar un barrido (sync-all / force), arranca de inmediato el poll del estado
  // (invalida la query) y refresca la tabla; el barrido corre en segundo plano en backend.
  const onSweepLaunched = () => {
    qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    qc.invalidateQueries({ queryKey: ['remote-sets'] });
  };
  // v1.3: sync-all puede no existir en backend; se usa condicionalmente y su fallo
  // no rompe la vista (se muestra aviso). Ver contrato §M2.
  const syncAllMutation = useMutation({
    mutationFn: () => syncAllCatalog(),
    onSuccess: onSweepLaunched,
  });
  // v1.6-finish: re-sync FORZADO (contrato §M2, `force=true`): reprocesa TODO el catálogo
  // (incluidos sets ya importados) para repoblar metadata, cartas y variantes estructurales
  // (availableFinishes vía resolver TCGCSV + reconcile). ⛔ v1.27: NO repuebla precios (desde
  // v1.14/§4.15g el pricing vive SOLO en price-ingest). Operación pesada → confirmación (modal).
  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);
  const syncAllForceMutation = useMutation({
    mutationFn: () => syncAllCatalog({ force: true }),
    onSuccess: onSweepLaunched,
  });

  // --- P-12 (v1.27): «Sync completo» POR SET = cartas + variantes → precios ---
  // Encadena las DOS fases del flujo recomendado del contrato (§M2 v1.27): (1) POST
  // /admin/catalog/sync { setId, force:true } → metadata + cartas + variantes estructurales
  // TCGCSV del set; (2) POST /admin/jobs/price-ingest { setId } → precios del set COMPLETO
  // (bypass del scope <2020 de ppt-sync-scope). Feedback HONESTO por fase: se reporta qué fase
  // corre, cuál falló y si el ingest NO encoló (single-flight) — nunca un "202 cosmético".
  const [fullSyncPhase, setFullSyncPhase] = useState<'catalog' | 'prices' | null>(null);
  const fullSyncMutation = useMutation({
    mutationFn: async (set: RemoteSetDTO) => {
      setFullSyncPhase('catalog');
      const catalog = await syncCatalog({ setId: set.id, force: true });
      // Fase 1 OK: refresca la tabla (imported/cardCount) sin esperar la fase 2.
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      setFullSyncPhase('prices');
      const ingest = await triggerPriceIngest({ setId: set.id });
      return { catalog, ingest };
    },
    onSuccess: (data) => {
      setFullSyncPhase(null);
      if (data.ingest.enqueued) {
        // El ingest repuebla PriceReference → puede resolver pendientes; además arranca YA el
        // poll del barrido de precios (misma mecánica N-14 que el disparo global de arriba).
        qc.invalidateQueries({ queryKey: ['pending-prices'] });
        setJustDispatched(true);
        void priceSyncStatus.refetch();
      }
    },
    // En error NO se limpia fullSyncPhase: el banner reporta EN QUÉ fase falló (catalog|prices).
  });

  // --- P-13: «Refrescar variantes + precios» POR SET usando SOLO TCGCSV (sin pokemontcg.io) ---
  // Endpoint SÍNCRONO POST /admin/catalog/refresh-variants { setId }: repuebla variantes/acabados y
  // precios de un set YA importado desde TCGCSV, SIN re-importar cartas ni depender de pokemontcg.io.
  // Existe para desbloquear el arreglo del "fantasma" de un set (variantes/precios faltantes) cuando
  // pokemontcg.io está caído — algo que el «Sync completo» (cartas pokemontcg.io + TCGCSV) no permite.
  // Devuelve un RESUMEN honesto (cards procesadas, productos, precios, pendientes) que se pinta tal cual.
  const refreshVariantsMutation = useMutation({
    mutationFn: (set: RemoteSetDTO) => refreshVariants({ setId: set.id }),
    onSuccess: () => {
      // Repuebla variantes + PriceReference → puede resolver/mover pendientes y cambia el conteo del set.
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
    },
  });

  // --- RV-ALL: «Refrescar variantes + precios de TODO» usando SOLO TCGCSV (batch, sin pokemontcg.io) ---
  // Corre el mismo trabajo que el refresh por-set (variantes/acabados + precios desde TCGCSV, SIN
  // re-importar cartas ni depender de pokemontcg.io) sobre TODO el catálogo YA importado. Es ASÍNCRONO
  // (POST /admin/catalog/refresh-variants-all → 202 { jobId, setsQueued, remaining }): el POST solo lo
  // arranca; el progreso y el RESUMEN AGREGADO honesto (sets ok/fallidos, productos, precios,
  // pendientes, `failures`) se leen por su STATUS PROPIO (poll de refreshVariantsStatus). Masivo →
  // confirmación (modal). Al disparar arranca YA el poll (refetch + ventana de gracia, patrón N-14).
  const refreshVariantsAllMutation = useMutation({
    mutationFn: () => refreshVariantsAll(),
    onSuccess: () => {
      setRefreshAllDispatched(true);
      void refreshVariantsStatus.refetch();
      // El batch repuebla variantes + PriceReference de TODO el catálogo → refresca la tabla; la cola
      // de pendientes se invalida al terminar (cuando el status reporta running:false).
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
    },
  });

  // Cuando el batch TERMINA (running pasa a false teniendo un summary), refresca la tabla y la cola de
  // pendientes: el barrido repobló variantes/precios y pudo resolver/mover pendientes.
  const batchFinishedAt = refreshVariantsStatus.data?.finishedAt ?? null;
  useEffect(() => {
    if (!batchRunning && refreshVariantsStatus.data?.summary) {
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
    }
    // Se dispara al cambiar `finishedAt` (un batch nuevo terminó), no en cada poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchFinishedAt]);

  // El batch async está OCUPADO desde que se dispara (POST) hasta que su STATUS PROPIO reporta
  // running:false — aunque el POST 202 ya haya vuelto. Gobierna loading/serialización/keep-alive.
  const batchBusy = refreshVariantsAllMutation.isPending || refreshAllDispatched || batchRunning;

  // El operador mira el barrido de catálogo (o espera un backfill/sync por set, que son
  // requests síncronos largos) SIN interactuar → sin esto, el auto-logout por inactividad
  // (5 min) lo sacaría a mitad de la operación. Mientras haya una operación de catálogo en
  // curso, mantenemos viva la sesión; al terminar, el idle-logout vuelve a la normalidad.
  const catalogBusy =
    isSweeping ||
    priceSweeping ||
    ingestMutation.isPending ||
    catalogSyncMutation.isPending ||
    backfillMutation.isPending ||
    syncAllMutation.isPending ||
    syncAllForceMutation.isPending ||
    fullSyncMutation.isPending ||
    refreshVariantsMutation.isPending ||
    batchBusy;
  useKeepSessionAlive(catalogBusy);

  const setColumns: Column<RemoteSetDTO>[] = [
    { key: 'name', header: t('catalog.set'), render: (s) => <span lang="en">{s.name}</span> },
    { key: 'release', header: t('catalog.releaseDate'), render: (s) => <span className="tabular">{s.releaseDate ?? '—'}</span> },
    {
      key: 'imported',
      header: t('catalog.imported'),
      render: (s) =>
        s.imported ? (
          <Badge tone="success" shape="soft">{t('catalog.yes')}</Badge>
        ) : (
          <Badge tone="neutral" shape="outline">{t('catalog.no')}</Badge>
        ),
    },
    {
      key: 'cardCount',
      header: t('catalog.cardCount'),
      align: 'right',
      // Progreso por set: cartas importadas / total impreso del set. Si no hay printedTotal
      // (dato remoto ausente) se muestra solo el conteo. Da una noción de "cuánto trajo".
      render: (s) => (
        <span className="tabular">
          {s.cardCount}
          {s.printedTotal ? <span className="text-muted"> / {s.printedTotal}</span> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      // §19.4: jerarquía por-fila = I (primaria · Datos/TCGCSV) → G (secundaria · Catálogo) → H
      // (overflow AVANZADO en el menú «Más ▾»). I refresca variantes+precios solo-TCGCSV (reparación
      // segura, no depende de pokemontcg.io). G importa/re-sincroniza cartas (pokemontcg.io). H
      // encadena cartas + precios del set (pesado, roto sin pokemontcg.io) → escondido en el menú.
      // Se serializan entre sí (una operación por-set a la vez) y con el batch global (RV-ALL).
      render: (s) => {
        const rowFullSyncing = fullSyncMutation.isPending && fullSyncMutation.variables?.id === s.id;
        const rowSyncing = catalogSyncMutation.isPending && catalogSyncMutation.variables === s.id;
        const rowRefreshing =
          refreshVariantsMutation.isPending && refreshVariantsMutation.variables?.id === s.id;
        const otherPerSetPending =
          (catalogSyncMutation.isPending && !rowSyncing) ||
          (fullSyncMutation.isPending && !rowFullSyncing) ||
          (refreshVariantsMutation.isPending && !rowRefreshing) ||
          batchBusy;
        return (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* I — PRIMARIA (Datos · solo TCGCSV). Requiere el set YA importado (si no, el backend
                responde SET_NOT_IMPORTED) → deshabilitada con el motivo en title + aria-describedby. */}
            <Button
              size="sm"
              variant="secondary"
              loading={rowRefreshing}
              disabled={
                !s.imported ||
                otherPerSetPending ||
                catalogSyncMutation.isPending ||
                fullSyncMutation.isPending
              }
              aria-label={t('catalog.refreshVariantsAria', { name: s.name })}
              aria-describedby={!s.imported ? 'm2-reason-needs-import' : undefined}
              title={!s.imported ? t('catalog.refreshVariantsNeedsImport') : undefined}
              onClick={() => refreshVariantsMutation.mutate(s)}
            >
              <RefreshCw size={14} aria-hidden /> {t('catalog.refreshVariantsShort')}
            </Button>
            {/* G — SECUNDARIA (Catálogo · pokemontcg.io): importa/re-sincroniza cartas. */}
            <Button
              size="sm"
              variant="secondary"
              loading={rowSyncing}
              disabled={otherPerSetPending || refreshVariantsMutation.isPending || fullSyncMutation.isPending}
              onClick={() => catalogSyncMutation.mutate(s.id)}
            >
              {s.imported ? t('catalog.resync') : t('catalog.import')}
            </Button>
            {/* H — AVANZADA en overflow: «Sync completo» (cartas + precios del set). */}
            <RowMoreMenu
              triggerLabel={t('catalog.rowMoreAria', { name: s.name })}
              disabled={
                otherPerSetPending || catalogSyncMutation.isPending || refreshVariantsMutation.isPending
              }
            >
              {(closeMenu) => (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={t('catalog.fullSyncAria', { name: s.name })}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text hover:bg-border/40"
                  onClick={() => {
                    closeMenu();
                    fullSyncMutation.mutate(s);
                  }}
                >
                  <Zap size={14} aria-hidden /> {t('catalog.fullSyncMenuItem')}
                </button>
              )}
            </RowMoreMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {/* PRIMARIA (G3): UNA acción de "Actualizar precios" clara y visible. El resto de
          operaciones de sync/catálogo (backfill, importar sets, re-sync, por-set, sync de
          bóveda) se de-enfatizan bajo "Operaciones avanzadas" más abajo. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('updatePrices.title')}</h2>
        <p className="text-sm text-muted">{t('updatePrices.subtitle')}</p>
        <div>
          <Button size="lg" loading={ingestMutation.isPending} onClick={() => ingestMutation.mutate()}>
            <Zap size={18} /> {t('priceIngest.trigger')}
          </Button>
        </div>
        <p className="text-xs text-muted">{t('priceIngest.triggerHint')}</p>
        {ingestMutation.isSuccess && (
          <Banner variant="success" role="status">
            {/* single-flight: enqueued=false = ya había un pase en curso. */}
            {ingestMutation.data.enqueued
              ? t('priceIngest.queued')
              : t('priceIngest.alreadyRunning')}
          </Banner>
        )}
        {ingestMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(ingestMutation.error)}</Banner>
        )}

        {/* Aviso de pausa por límite diario del proveedor de paga (retoma a las 00:00 UTC). */}
        {priceSyncStatus.data?.dailyLimited && (
          <Banner variant="warning" role="status">
            {t('priceIngest.dailyLimited', { pending: priceSyncStatus.data.pending })}
          </Banner>
        )}
        {/* Presupuesto diario restante del proveedor, cuando el estado lo reporta. */}
        {priceSyncStatus.data?.dailyRemaining != null && (
          <p className="text-xs text-muted">
            {t('priceIngest.dailyRemaining', { remaining: priceSyncStatus.data.dailyRemaining })}
          </p>
        )}

        {/* Barra de progreso del barrido de PRECIOS en curso / recién terminado (poll cada 3 s).
            Reusa el mismo SyncProgress (role="progressbar" accesible) que el sync de catálogo. */}
        {priceSyncStatus.data && (priceSyncStatus.data.running || priceSyncStatus.data.total > 0) && (
          <SyncProgress
            running={priceSyncStatus.data.running}
            done={priceSyncStatus.data.done}
            total={priceSyncStatus.data.total}
            labels={{
              running: t('priceIngest.sweepRunning', {
                done: Math.min(priceSyncStatus.data.done, priceSyncStatus.data.total),
                total: priceSyncStatus.data.total,
              }),
              runningHint: t('priceIngest.sweepRunningHint'),
              done: t('priceIngest.sweepDone', { total: priceSyncStatus.data.total }),
            }}
          />
        )}
      </section>

      {/* Sección 2: cola de precio pendiente en DOS BUCKETS (P-6, v1.26) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('pending.title')}</h2>
        <p className="text-sm text-muted">{t('pending.subtitle')}</p>

        {/* Pestañas VENTA / COMPRA (patrón de tabs de M6) */}
        <div role="tablist" aria-label={t('pending.bucketsLabel')} className="flex flex-wrap gap-1 border-b border-border">
          {(['venta', 'compra'] as const).map((k) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={bucket === k}
              onClick={() => setBucket(k)}
              className={cn(
                '-mb-px rounded-t-md px-3 py-2 text-sm font-medium',
                bucket === k ? 'border-b-2 border-primary text-text' : 'text-muted hover:text-text',
              )}
            >
              {t(`pending.buckets.${k}`)}
            </button>
          ))}
        </div>

        {/* VENTA (context=inventory): fijable por override → publica el ítem */}
        {bucket === 'venta' && (
          <div role="tabpanel">
            <QueryState
              isLoading={ventaPending.isLoading}
              isError={ventaPending.isError}
              error={ventaPending.error}
              onRetry={() => ventaPending.refetch()}
            >
              {ventaPending.data && ventaPending.data.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-2">
                  <DataTable columns={pendingColumns} rows={ventaPending.data} rowKey={(e) => e.id} />
                </div>
              ) : (
                <EmptyState tone="positive" title={t('pending.ventaEmpty')} />
              )}
            </QueryState>
          </div>
        )}

        {/* COMPRA (context=buylist): READ-ONLY. NO hay acción de fijar precio aquí. */}
        {bucket === 'compra' && (
          <div role="tabpanel" className="flex flex-col gap-3">
            <Banner variant="info" role="status">
              {t('pending.compraNote')}{' '}
              <Link href="/admin/m5" className="inline-flex items-center gap-1 font-medium underline">
                {t('pending.compraLink')} <ExternalLink size={14} />
              </Link>
            </Banner>
            <QueryState
              isLoading={compraPending.isLoading}
              isError={compraPending.isError}
              error={compraPending.error}
              onRetry={() => compraPending.refetch()}
            >
              {compraPending.data && compraPending.data.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-2">
                  <DataTable columns={compraColumns} rows={compraPending.data} rowKey={(e) => e.id} />
                </div>
              ) : (
                <EmptyState tone="positive" title={t('pending.compraEmpty')} />
              )}
            </QueryState>
          </div>
        )}
      </section>

      {/* Sección 3: FX */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('fx.title')}</h2>
        <QueryState isLoading={fx.isLoading} isError={fx.isError} error={fx.error} onRetry={() => fx.refetch()}>
          {fx.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.rate')}</p>
                  <p className="tabular text-h2 font-semibold">{fx.data.rate.toFixed(4)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.buffer')}</p>
                  <p className="tabular text-h2 font-semibold">{fx.data.bufferPct}%</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.source')}</p>
                  <Badge tone={fx.data.source === 'manual' ? 'accent' : 'info'} shape="soft">
                    {t(`fx.sourceLabel.${fx.data.source}`)}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('fx.effectiveDate')}</p>
                  <p className="tabular text-sm">{formatDate(fx.data.effectiveDate, locale)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <Input
                  label={t('fx.newRate')}
                  type="text"
                  inputMode="decimal"
                  className="w-32"
                  value={fxRate}
                  onChange={(e) => setFxRate(e.target.value)}
                  placeholder={String(fx.data.rate)}
                />
                <Input
                  label={t('fx.newBuffer')}
                  type="text"
                  inputMode="decimal"
                  className="w-32"
                  value={fxBuffer}
                  onChange={(e) => setFxBuffer(e.target.value)}
                  placeholder={String(fx.data.bufferPct)}
                />
                <Button
                  variant="secondary"
                  // #13: habilitado si AL MENOS uno de los dos tiene valor (permite guardar
                  // solo el colchón dejando la tasa vacía).
                  disabled={fxRate === '' && fxBuffer === ''}
                  loading={fxUpdateMutation.isPending}
                  onClick={saveFx}
                >
                  {t('fx.saveOverride')}
                </Button>
                <Button variant="ghost" loading={fxRefreshMutation.isPending} onClick={() => fxRefreshMutation.mutate()}>
                  <RefreshCw size={18} /> {t('fx.refreshBanxico')}
                </Button>
              </div>
              <p className="text-xs text-muted">{t('fx.hint')}</p>
              <p className="text-xs text-muted">{t('fx.bufferOnlyHint')}</p>
              {fxUpdateMutation.isSuccess && (
                <Banner variant="success" role="status">
                  {/* Mensaje claro según lo que se guardó: solo colchón vs tasa (+colchón). */}
                  {fxUpdateMutation.variables?.rate === undefined
                    ? t('fx.savedBufferOnly')
                    : t('fx.saved')}
                </Banner>
              )}
              {fxRefreshMutation.isSuccess && (
                <Banner variant="success" role="status">{t('fx.saved')}</Banner>
              )}
              {fxUpdateMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(fxUpdateMutation.error)}</Banner>
              )}
              {fxRefreshMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(fxRefreshMutation.error)}</Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 3b: proveedor de precios + ingesta masiva (v1.14-price-ingest) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('priceIngest.title')}</h2>
        <p className="text-sm text-muted">{t('priceIngest.subtitle')}</p>
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          {/* Selector del dial priceProvider (fuente del ingest, sin redeploy) */}
          <QueryState
            isLoading={priceProvider.isLoading}
            isError={priceProvider.isError}
            error={priceProvider.error}
            onRetry={() => priceProvider.refetch()}
          >
            <div className="flex flex-col gap-2">
              {/* §19.7: fila FIJA no editable de la fuente PRIMARIA (TCGCSV manda, no aparece en el
                  Select). Deja claro que el dial de abajo solo elige el RESPALDO/fallback. */}
              <div className="flex flex-wrap items-baseline gap-2 border-b border-border pb-3">
                <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
                  {t('priceIngest.primarySourceLabel')}
                </span>
                <span className="font-mono text-sm font-semibold text-text">
                  {t('priceIngest.primarySourceValue')}
                </span>
                <span className="text-xs text-muted">{t('priceIngest.primarySourceHint')}</span>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label={t('priceIngest.fallbackLabel')}
                  className="w-64"
                  options={PRICE_PROVIDERS.map((p) => ({
                    value: p,
                    label: t(`priceIngest.providerOptions.${p}`),
                  }))}
                  value={providerValue}
                  onChange={(e) => setProviderDraft(e.target.value as PriceProvider)}
                />
                <Button
                  variant="secondary"
                  disabled={!providerDirty}
                  loading={providerMutation.isPending}
                  onClick={() => providerMutation.mutate(providerValue)}
                >
                  {tc('save')}
                </Button>
              </div>
              <p className="text-xs text-muted">{t('priceIngest.fallbackHint')}</p>
              {/* Línea de precedencia money-safe (§19.7): primario → respaldo → override manual. */}
              <p className="text-xs text-muted">
                {t('priceIngest.precedenceHint', {
                  fallback: t(`priceIngest.providerOptions.${providerValue}`),
                })}
              </p>
              {providerMutation.isSuccess && (
                <Banner variant="success" role="status">{t('priceIngest.providerSaved')}</Banner>
              )}
              {providerMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(providerMutation.error)}</Banner>
              )}
            </div>
          </QueryState>
        </div>
      </section>

      {/* Sección 4: precio de buylist en DOS EJES — rareza canónica + acabado (v1.29, §4.28d) */}
      <section className="flex flex-col gap-3">
        {/* §19.5: «Unificar rarezas» se ancla AQUÍ (junto al editor por rareza), no en Datos: el
            «por qué» solo se entiende mirando la lista fragmentada de rarezas que este botón limpia. */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="text-h2 font-semibold">{t('buylistRules.title')}</h2>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              size="sm"
              loading={unifyMutation.isPending}
              onClick={() => setUnifyConfirmOpen(true)}
            >
              <Wand2 size={14} aria-hidden /> {t('unifyRarities.button')}
            </Button>
            <p className="max-w-xs text-right text-xs text-muted">{t('unifyRarities.hint')}</p>
          </div>
        </div>
        <p className="text-sm text-muted">{t('buylistRules.subtitle')}</p>
        {/* Resumen HONESTO de la unificación: cuántas actualizó + rarezas `unmapped` accionables. */}
        {unifyMutation.isSuccess && (
          <Banner variant="success" role="status">
            <span className="font-medium">{t('unifyRarities.done')}</span>{' '}
            {t('unifyRarities.summary', {
              updated: unifyMutation.data.cardsUpdated,
              processed: unifyMutation.data.cardsProcessed,
              distinct: unifyMutation.data.distinctCanonical,
            })}
            {unifyMutation.data.unmapped.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <p className="font-medium">
                  {t('unifyRarities.unmappedTitle', { count: unifyMutation.data.unmapped.length })}
                </p>
                <ul className="list-disc pl-5">
                  {unifyMutation.data.unmapped.map((u) => (
                    <li key={u.raw}>
                      <span lang="en" className="font-medium">{u.raw}</span>{' '}
                      <span className="tabular text-muted">({u.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Banner>
        )}
        {unifyMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(unifyMutation.error)}</Banner>
        )}
        {/* G3: ejemplo en línea del % — en buylist el % es lo que PAGAS de la referencia
            (semántica OPUESTA a la de venta, por eso el ejemplo textual). */}
        <p className="text-xs text-muted">{t('buylistRules.example')}</p>
        <QueryState
          isLoading={rarities.isLoading}
          isError={rarities.isError}
          error={rarities.error}
          onRetry={() => rarities.refetch()}
        >
          {rarities.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              {/* Fallback % para rarezas sin regla explícita */}
              <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
                <Input
                  label={t('buylistRules.fallbackLabel')}
                  type="text"
                  inputMode="decimal"
                  suffix="%"
                  className="w-32"
                  value={effectiveFallback}
                  onChange={(e) => setFallbackDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <p className="text-xs text-muted">{t('buylistRules.fallbackHint')}</p>
              </div>

              {/* EJE 1 — reglas por RAREZA CANÓNICA (empatan 1:1 con las cartas del catálogo). */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('buylistRules.rarityAxis')}
              </p>
              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto_auto]">
                  <span>{t('buylistRules.rarity')}</span>
                  <span className="text-right">{t('buylistRules.cardCount')}</span>
                  <span>{t('buylistRules.mode')}</span>
                  <span>{t('buylistRules.value')}</span>
                  <span>{t('buylistRules.source')}</span>
                </li>
                {rarities.data.rarities.map((row) => {
                  const rule = effectiveRule(row.canonical, row.rule, row.source);
                  const edited = !!ruleDraft[row.canonical];
                  const effectiveSource: 'rule' | 'fallback' = edited ? 'rule' : row.source;
                  return (
                    <li
                      key={row.canonical}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto_auto]"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span lang="en">{row.canonical}</span>
                        {/* v1.29: atributo `premium` del catálogo canónico (§4.28e). */}
                        {row.premium && (
                          <Badge tone="accent" shape="outline">{t('buylistRules.premium')}</Badge>
                        )}
                        {/* v1.29: rareza `unmapped` (aún sin forma canónica) → cae al fallback pct. */}
                        {row.mapped === false && (
                          <Badge tone="warning" shape="outline">{t('buylistRules.unmapped')}</Badge>
                        )}
                      </span>
                      <span className="tabular text-right text-sm text-muted">{row.cardCount}</span>
                      <Select
                        label={t('buylistRules.mode')}
                        aria-label={t('buylistRules.modeFor', { rarity: row.canonical })}
                        className="w-32"
                        options={RULE_MODES.map((m) => ({ value: m, label: t(`buylistRules.modeLabel.${m}`) }))}
                        value={rule.mode}
                        onChange={(e) => {
                          const mode = e.target.value as BuylistRuleMode;
                          setRuleDraft((prev) => ({ ...prev, [row.canonical]: { mode, value: rule.value } }));
                        }}
                      />
                      <Input
                        label={rule.mode === 'fixed' ? t('buylistRules.valueMxn') : t('buylistRules.valuePct')}
                        aria-label={t('buylistRules.valueFor', { rarity: row.canonical })}
                        type="text"
                        inputMode="decimal"
                        prefix={rule.mode === 'fixed' ? 'MX$' : undefined}
                        suffix={rule.mode === 'pct' ? '%' : undefined}
                        className="w-32"
                        value={rule.mode === 'fixed' ? String(rule.value / 100) : String(rule.value)}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9.]/g, '');
                          const value = rule.mode === 'fixed' ? pesosToCents(raw) : Number(raw) || 0;
                          setRuleDraft((prev) => ({ ...prev, [row.canonical]: { mode: rule.mode, value } }));
                        }}
                      />
                      <Badge tone={effectiveSource === 'rule' ? 'info' : 'neutral'} shape="outline">
                        {t(`buylistRules.sourceLabel.${effectiveSource}`)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              {/* EJE 2 — reglas por ACABADO (reverse holo / holofoil / 1st ed). Reemplazan las viejas
                  keys sintéticas "Holo"/"Reverse Holo"; sin regla, el acabado HEREDA la de la rareza. */}
              <p className="mt-2 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                {t('buylistRules.finishAxis')}
              </p>
              <p className="text-xs text-muted">{t('buylistRules.finishAxisHint')}</p>
              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto]">
                  <span>{t('buylistRules.finish')}</span>
                  <span>{t('buylistRules.mode')}</span>
                  <span>{t('buylistRules.value')}</span>
                  <span>{t('buylistRules.source')}</span>
                </li>
                {FINISH_RULE_KEYS.map((finish) => {
                  const { rule, hasRule } = effectiveFinishRule(finish);
                  const mode: BuylistRuleMode = rule?.mode ?? 'fixed';
                  const finishLabel = tFinish(finish);
                  return (
                    <li
                      key={finish}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto]"
                    >
                      <span className="text-sm font-medium">{finishLabel}</span>
                      <Select
                        label={t('buylistRules.mode')}
                        aria-label={t('buylistRules.modeForFinish', { finish: finishLabel })}
                        className="w-32"
                        options={RULE_MODES.map((m) => ({ value: m, label: t(`buylistRules.modeLabel.${m}`) }))}
                        value={mode}
                        onChange={(e) => {
                          const newMode = e.target.value as BuylistRuleMode;
                          setFinishRuleDraft((prev) => ({
                            ...prev,
                            [finish]: { mode: newMode, value: rule?.value ?? 0 },
                          }));
                        }}
                      />
                      <Input
                        label={mode === 'fixed' ? t('buylistRules.valueMxn') : t('buylistRules.valuePct')}
                        aria-label={t('buylistRules.valueForFinish', { finish: finishLabel })}
                        type="text"
                        inputMode="decimal"
                        prefix={mode === 'fixed' ? 'MX$' : undefined}
                        suffix={mode === 'pct' ? '%' : undefined}
                        placeholder={t('buylistRules.inheritPlaceholder')}
                        className="w-32"
                        value={rule ? (mode === 'fixed' ? String(rule.value / 100) : String(rule.value)) : ''}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^0-9.]/g, '');
                          const value = mode === 'fixed' ? pesosToCents(raw) : Number(raw) || 0;
                          setFinishRuleDraft((prev) => ({ ...prev, [finish]: { mode, value } }));
                        }}
                      />
                      <Badge tone={hasRule ? 'info' : 'neutral'} shape="outline">
                        {hasRule ? t('buylistRules.sourceLabel.rule') : t('buylistRules.inherit')}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  // INV-1 robustez: Guardar merge-ea sobre la tabla CRUDA (buylistRules). Sin ella el
                  // guard hace return silencioso → gateamos el botón también con `!buylistRules.data`
                  // para que el clic NUNCA sea un no-op mudo (cargando o en error).
                  disabled={!rulesDirty || !buylistRules.data}
                  loading={rulesMutation.isPending}
                  onClick={saveRules}
                >
                  {tc('save')}
                </Button>
                {rulesDirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRuleDraft({});
                      setFallbackDraft(null);
                    }}
                  >
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {/* Si la tabla cruda falló, se explica por qué no se puede guardar (con reintento). */}
              {buylistRules.isError && (
                <Banner
                  variant="warning"
                  role="alert"
                  title={tc('errorTitle')}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => buylistRules.refetch()}>
                      {tc('retry')}
                    </Button>
                  }
                >
                  {t('buylistRules.rulesUnavailable')}
                </Banner>
              )}
              {rulesMutation.isSuccess && (
                <Banner variant="success" role="status">{t('buylistRules.saved')}</Banner>
              )}
              {rulesMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(rulesMutation.error)}</Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 5: precio de VENTA por RAREZA (v1.13-sales-pricing) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('salesRules.title')}</h2>
        <p className="text-sm text-muted">{t('salesRules.subtitle')}</p>
        {/* G3: ejemplo en línea del % — en venta el % es lo que SUBES sobre el mercado
            (semántica opuesta a la de buylist). */}
        <p className="text-xs text-muted">{t('salesRules.example')}</p>
        <QueryState
          isLoading={salesRarities.isLoading}
          isError={salesRarities.isError}
          error={salesRarities.error}
          onRetry={() => salesRarities.refetch()}
        >
          {salesRarities.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              {/* Fallback % (markup arriba de mercado) para rarezas sin regla explícita */}
              <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
                <Input
                  label={t('salesRules.fallbackLabel')}
                  type="text"
                  inputMode="decimal"
                  suffix="%"
                  className="w-32"
                  value={salesEffectiveFallback}
                  onChange={(e) => setSalesFallbackDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <p className="text-xs text-muted">{t('salesRules.fallbackHint')}</p>
              </div>

              {/* EJE 1 — reglas de VENTA por RAREZA CANÓNICA. */}
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {t('salesRules.rarityAxis')}
              </p>
              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto_auto]">
                  <span>{t('salesRules.rarity')}</span>
                  <span className="text-right">{t('salesRules.cardCount')}</span>
                  <span>{t('salesRules.mode')}</span>
                  <span>{t('salesRules.value')}</span>
                  <span>{t('salesRules.source')}</span>
                </li>
                {salesRarities.data.rarities.map((row) => {
                  const rule = salesEffectiveRule(row.canonical, row.rule, row.source);
                  const edited = !!salesRuleDraft[row.canonical];
                  const effectiveSource: 'rule' | 'fallback' = edited ? 'rule' : row.source;
                  return (
                    <li
                      key={row.canonical}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto_auto]"
                    >
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span lang="en">{row.canonical}</span>
                        {row.premium && (
                          <Badge tone="accent" shape="outline">{t('salesRules.premium')}</Badge>
                        )}
                        {row.mapped === false && (
                          <Badge tone="warning" shape="outline">{t('salesRules.unmapped')}</Badge>
                        )}
                      </span>
                      <span className="tabular text-right text-sm text-muted">{row.cardCount}</span>
                      <Select
                        label={t('salesRules.mode')}
                        aria-label={t('salesRules.modeFor', { rarity: row.canonical })}
                        className="w-32"
                        options={SALES_RULE_MODES.map((m) => ({ value: m, label: t(`salesRules.modeLabel.${m}`) }))}
                        value={rule.mode}
                        onChange={(e) => {
                          const mode = e.target.value as SalesRuleMode;
                          // Money-safe: NO arrastrar el valor entre semánticas (centavos fijos ↔ %):
                          // un 500¢ fijo no debe volverse 500%, ni un 15% volverse $0.15. Se limpia.
                          setSalesRuleDraft((prev) => ({ ...prev, [row.canonical]: { mode, value: '' } }));
                        }}
                      />
                      <Input
                        label={rule.mode === 'fixed' ? t('salesRules.valueMxn') : t('salesRules.valuePct')}
                        aria-label={t('salesRules.valueFor', { rarity: row.canonical })}
                        type="text"
                        inputMode="decimal"
                        prefix={rule.mode === 'fixed' ? 'MX$' : undefined}
                        suffix={rule.mode === 'pct' ? '%' : undefined}
                        className="w-32"
                        value={rule.value}
                        onChange={(e) =>
                          setSalesRuleDraft((prev) => ({
                            ...prev,
                            [row.canonical]: { mode: rule.mode, value: sanitizeDecimalInput(e.target.value) },
                          }))
                        }
                      />
                      <Badge tone={effectiveSource === 'rule' ? 'info' : 'neutral'} shape="outline">
                        {t(`salesRules.sourceLabel.${effectiveSource}`)}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              {/* EJE 2 — reglas de VENTA por ACABADO (reverse holo / holofoil / 1st ed). Sin regla,
                  el acabado HEREDA la de la rareza. Reemplaza la key sintética "Holo" (INV-1). */}
              <p className="mt-2 border-t border-border pt-4 text-xs font-semibold uppercase tracking-wide text-muted">
                {t('salesRules.finishAxis')}
              </p>
              <p className="text-xs text-muted">{t('salesRules.finishAxisHint')}</p>
              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto_auto]">
                  <span>{t('salesRules.finish')}</span>
                  <span>{t('salesRules.mode')}</span>
                  <span>{t('salesRules.value')}</span>
                  <span>{t('salesRules.source')}</span>
                </li>
                {FINISH_RULE_KEYS.map((finish) => {
                  const rule = salesEffectiveFinishRule(finish);
                  const finishLabel = tFinish(finish);
                  return (
                    <li
                      key={finish}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto_auto]"
                    >
                      <span className="text-sm font-medium">{finishLabel}</span>
                      <Select
                        label={t('salesRules.mode')}
                        aria-label={t('salesRules.modeForFinish', { finish: finishLabel })}
                        className="w-32"
                        options={SALES_RULE_MODES.map((m) => ({ value: m, label: t(`salesRules.modeLabel.${m}`) }))}
                        value={rule.mode}
                        onChange={(e) => {
                          const mode = e.target.value as SalesRuleMode;
                          setSalesFinishRuleDraft((prev) => ({ ...prev, [finish]: { mode, value: '' } }));
                        }}
                      />
                      <Input
                        label={rule.mode === 'fixed' ? t('salesRules.valueMxn') : t('salesRules.valuePct')}
                        aria-label={t('salesRules.valueForFinish', { finish: finishLabel })}
                        type="text"
                        inputMode="decimal"
                        prefix={rule.mode === 'fixed' ? 'MX$' : undefined}
                        suffix={rule.mode === 'pct' ? '%' : undefined}
                        placeholder={t('salesRules.inheritPlaceholder')}
                        className="w-32"
                        value={rule.value}
                        onChange={(e) =>
                          setSalesFinishRuleDraft((prev) => ({
                            ...prev,
                            [finish]: { mode: rule.mode, value: sanitizeDecimalInput(e.target.value) },
                          }))
                        }
                      />
                      <Badge tone={rule.hasRule ? 'info' : 'neutral'} shape="outline">
                        {rule.hasRule ? t('salesRules.sourceLabel.rule') : t('salesRules.inherit')}
                      </Badge>
                    </li>
                  );
                })}
              </ul>

              {/* Copy clave de VENTA: el pct es markup ARRIBA de mercado; fixed es un piso. */}
              <p className="text-xs text-muted">{t('salesRules.pctHint')}</p>

              {/* S-P1-1 money-safe: explica por qué Guardar está deshabilitado cuando hay un valor
                  vacío/mal formado (no se persiste como MX$0). */}
              {salesDraftInvalid && (
                <Banner variant="warning" role="alert">{t('salesRules.invalidValue')}</Banner>
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  // INV-1 robustez: idéntico gate que buylist — sin la tabla CRUDA (salesRules) el
                  // guard hace return silencioso; gateamos también con `!salesRules.data`.
                  // S-P1-1: además se bloquea si alguna regla tocada tiene valor vacío/mal formado
                  // (evita persistir 0 = carta regalada; el server acepta 0 y no da 422).
                  disabled={!salesRulesDirty || !salesRules.data || salesDraftInvalid}
                  loading={salesRulesMutation.isPending}
                  onClick={saveSalesRules}
                >
                  {tc('save')}
                </Button>
                {salesRulesDirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSalesRuleDraft({});
                      setSalesFallbackDraft(null);
                    }}
                  >
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {/* Si la tabla cruda de venta falló, se explica por qué no se puede guardar (con reintento). */}
              {salesRules.isError && (
                <Banner
                  variant="warning"
                  role="alert"
                  title={tc('errorTitle')}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => salesRules.refetch()}>
                      {tc('retry')}
                    </Button>
                  }
                >
                  {t('salesRules.rulesUnavailable')}
                </Banner>
              )}
              {salesRulesMutation.isSuccess && (
                <Banner variant="success" role="status">{t('salesRules.saved')}</Banner>
              )}
              {salesRulesMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(salesRulesMutation.error)}</Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 5b: spreads de VENTA del SELLADO por presentación (v1.23-sealed-sales) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('sealedSpreads.title')}</h2>
        <p className="text-sm text-muted">{t('sealedSpreads.subtitle')}</p>
        <p className="text-xs text-muted">{t('sealedSpreads.example')}</p>
        <QueryState
          isLoading={sealedSpreads.isLoading}
          isError={sealedSpreads.isError}
          error={sealedSpreads.error}
          onRetry={() => sealedSpreads.refetch()}
        >
          {sealedSpreads.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              {/* Fallback % (markup arriba de mercado) para presentaciones sin regla explícita */}
              <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4">
                <Input
                  label={t('sealedSpreads.fallbackLabel')}
                  type="text"
                  inputMode="decimal"
                  suffix="%"
                  className="w-32"
                  value={effectiveSpreadFallback}
                  onChange={(e) => setSpreadFallbackDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                />
                <p className="text-xs text-muted">{t('sealedSpreads.fallbackHint')}</p>
              </div>

              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_auto_auto]">
                  <span>{t('sealedSpreads.subtype')}</span>
                  <span>{t('sealedSpreads.spread')}</span>
                  <span />
                </li>
                {SEALED_SUBTYPES.map((sub) => {
                  const value = effectiveSpread(sub);
                  const isZero = Number(value) === 0;
                  return (
                    <li
                      key={sub}
                      className="grid grid-cols-2 items-end gap-3 py-3 md:grid-cols-[1fr_auto_auto]"
                    >
                      <span className="text-sm font-medium">{tSub(sub)}</span>
                      <Input
                        label={t('sealedSpreads.spread')}
                        aria-label={t('sealedSpreads.spreadFor', { subtype: tSub(sub) })}
                        type="text"
                        inputMode="decimal"
                        suffix="%"
                        className="w-32"
                        value={value}
                        onChange={(e) =>
                          setSpreadDraft((prev) => ({ ...prev, [sub]: e.target.value.replace(/[^0-9.]/g, '') }))
                        }
                      />
                      {/* Advertencia por-fila: spread 0% = vende sin margen. */}
                      {isZero ? (
                        <Badge tone="warning" shape="outline">
                          {t('sealedSpreads.zeroWarning')}
                        </Badge>
                      ) : (
                        <span />
                      )}
                    </li>
                  );
                })}
              </ul>

              <p className="text-xs text-muted">{t('sealedSpreads.prereqHint')}</p>

              {/* Aviso global money-safe si algún spread efectivo queda en 0%. */}
              {anyZeroSpread && (
                <Banner variant="warning" role="status">{t('sealedSpreads.zeroBanner')}</Banner>
              )}

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={!spreadsDirty}
                  loading={sealedSpreadsMutation.isPending}
                  onClick={saveSpreads}
                >
                  {tc('save')}
                </Button>
                {spreadsDirty && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSpreadDraft({});
                      setSpreadFallbackDraft(null);
                    }}
                  >
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {sealedSpreadsMutation.isSuccess && (
                <Banner variant="success" role="status">{t('sealedSpreads.saved')}</Banner>
              )}
              {sealedSpreadsMutation.isError && (
                <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(sealedSpreadsMutation.error)}</Banner>
              )}
            </div>
          )}
        </QueryState>
      </section>

      {/* Motivos de deshabilitado (§19.9): descritos por aria-describedby, no solo por color/title. */}
      <span id="m2-reason-needs-import" className="sr-only">{t('catalog.refreshVariantsNeedsImport')}</span>
      <span id="m2-reason-busy" className="sr-only">{t('catalog.busyReason')}</span>

      {/* ═══ GRUPO 1 · DATOS (rápido · TCGCSV) — §19.2 ═══
          Máximo peso tras A: repuebla variantes/acabados + precios desde TCGCSV, FUNCIONAN SIEMPRE
          aunque pokemontcg.io esté caída. F es global; I es la acción PRIMARIA por-fila (en la tabla). */}
      <section
        role="group"
        aria-labelledby="m2-group-data"
        className="flex flex-col gap-3 border-t border-border pt-8"
      >
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{t('groups.data.eyebrow')}</p>
          <h2 id="m2-group-data" className="text-h2 font-semibold">{t('groups.data.title')}</h2>
          <p className="text-sm text-muted">{t('groups.data.subtitle')}</p>
        </div>
        {/* F global — «Refrescar variantes + precios (todo)», solo TCGCSV. Masivo → confirmación. El
            «(solo TCGCSV)» ya no va en el botón: lo dice el subtítulo del grupo (§19.2). */}
        <div>
          <Button
            variant="secondary"
            loading={batchBusy}
            disabled={catalogBusy && !batchBusy}
            aria-describedby={catalogBusy && !batchBusy ? 'm2-reason-busy' : undefined}
            title={catalogBusy && !batchBusy ? t('catalog.busyReason') : undefined}
            onClick={() => setRefreshAllConfirmOpen(true)}
          >
            <RefreshCw size={18} aria-hidden /> {t('catalog.refreshVariantsAllShort')}
          </Button>
        </div>
        {/* RV-ALL: banner "corriendo" + barra de progreso (poll del STATUS PROPIO) + resumen agregado. */}
        {batchBusy && (
          <Banner variant="info" role="status">{t('catalog.refreshVariantsAllRunning')}</Banner>
        )}
        {refreshVariantsStatus.data &&
          (refreshVariantsStatus.data.running || refreshVariantsStatus.data.total > 0) && (
            <SyncProgress
              running={refreshVariantsStatus.data.running}
              done={refreshVariantsStatus.data.done}
              total={refreshVariantsStatus.data.total}
              labels={{
                running: t('catalog.refreshVariantsAllSweepRunning', {
                  done: Math.min(refreshVariantsStatus.data.done, refreshVariantsStatus.data.total),
                  total: refreshVariantsStatus.data.total,
                }),
                runningHint: t('catalog.refreshVariantsAllSweepRunningHint'),
                done: t('catalog.refreshVariantsAllSweepDone', { total: refreshVariantsStatus.data.total }),
              }}
            />
          )}
        {!batchRunning &&
          refreshVariantsStatus.data?.summary &&
          (() => {
            const r = refreshVariantsStatus.data!.summary!;
            const partial = r.setsFailed > 0 || r.pending > 0;
            return (
              <Banner variant={partial ? 'warning' : 'success'} role="status">
                <span className="font-medium">
                  {partial
                    ? t('catalog.refreshVariantsAllPartial')
                    : t('catalog.refreshVariantsAllDone')}
                </span>{' '}
                {t('catalog.refreshVariantsAllSummary', {
                  setsOk: r.setsOk,
                  setsTotal: r.setsTotal,
                  products: r.cardProductsUpserted,
                  prices: r.pricesUpserted,
                })}
                {r.pending > 0 && ' ' + t('catalog.refreshVariantsAllPending', { pending: r.pending })}
                {r.failures.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    <p className="font-medium">
                      {t('catalog.refreshVariantsAllFailuresTitle', { count: r.setsFailed })}
                    </p>
                    <ul className="list-disc pl-5">
                      {r.failures.map((f) => {
                        const name = remoteSets.data?.find((s) => s.id === f.setId)?.name ?? f.setId;
                        return (
                          <li key={f.setId}>
                            <span lang="en" className="font-medium">{name}</span>{' '}
                            <span className="tabular text-muted">({f.setId})</span> —{' '}
                            {f.message || f.code}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </Banner>
            );
          })()}
        {refreshVariantsAllMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {t('catalog.refreshVariantsAllError')} {getError(refreshVariantsAllMutation.error)}
          </Banner>
        )}

        {/* Tabla de sets ÚNICA (§19.1), anclada al grupo Datos: su acción por-fila PRIMARIA es I. */}
        <QueryState
          isLoading={remoteSets.isLoading}
          isError={remoteSets.isError}
          error={remoteSets.error}
          onRetry={() => remoteSets.refetch()}
        >
          {remoteSets.data &&
            (remoteSets.data.length > 0 ? (
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={setColumns} rows={remoteSets.data} rowKey={(s) => s.id} />
              </div>
            ) : (
              <EmptyState title={t('catalog.setsEmpty')} />
            ))}
        </QueryState>

        {/* Feedback de las acciones POR-FILA disparadas desde la tabla (visibles junto a ella): I
            (solo TCGCSV) y H (Sync completo, aunque su disparador viva en el menú «Más»). */}
        {refreshVariantsMutation.isPending && (
          <Banner variant="info" role="status">
            {t('catalog.refreshVariantsRunning', { name: refreshVariantsMutation.variables?.name ?? '' })}
          </Banner>
        )}
        {refreshVariantsMutation.isSuccess &&
          (() => {
            const r = refreshVariantsMutation.data;
            const name = refreshVariantsMutation.variables?.name ?? '';
            const partial = !r.tcgcsvReachable || r.pending > 0;
            const summary = t('catalog.refreshVariantsSummary', {
              cards: r.cardsProcessed,
              products: r.cardProductsUpserted,
              prices: r.pricesUpserted,
            });
            return (
              <Banner variant={partial ? 'warning' : 'success'} role="status">
                <span className="font-medium">
                  {partial
                    ? t('catalog.refreshVariantsPartial', { name })
                    : t('catalog.refreshVariantsDone', { name })}
                </span>{' '}
                {summary}
                {!r.tcgcsvReachable && ' ' + t('catalog.refreshVariantsUnreachable')}
                {r.pending > 0 && ' ' + t('catalog.refreshVariantsPending', { pending: r.pending })}
              </Banner>
            );
          })()}
        {refreshVariantsMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {t('catalog.refreshVariantsError', { name: refreshVariantsMutation.variables?.name ?? '' })}{' '}
            {getError(refreshVariantsMutation.error)}
          </Banner>
        )}
        {/* H (Sync completo): feedback HONESTO por fase (cartas → precios), junto a la tabla. */}
        {fullSyncMutation.isPending && (
          <Banner variant="info" role="status">
            {fullSyncPhase === 'prices'
              ? t('catalog.fullSyncPhasePrices', { name: fullSyncMutation.variables?.name ?? '' })
              : t('catalog.fullSyncPhaseCatalog', { name: fullSyncMutation.variables?.name ?? '' })}
          </Banner>
        )}
        {fullSyncMutation.isSuccess &&
          (fullSyncMutation.data.ingest.enqueued ? (
            <Banner variant="success" role="status">
              {t('catalog.fullSyncDone', { name: fullSyncMutation.variables?.name ?? '' })}
            </Banner>
          ) : (
            <Banner variant="warning" role="status">
              {t('catalog.fullSyncPricesAlreadyRunning', { name: fullSyncMutation.variables?.name ?? '' })}
            </Banner>
          ))}
        {fullSyncMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>
            {fullSyncPhase === 'prices'
              ? t('catalog.fullSyncPricesError', { name: fullSyncMutation.variables?.name ?? '' })
              : t('catalog.fullSyncCatalogError', { name: fullSyncMutation.variables?.name ?? '' })}{' '}
            {getError(fullSyncMutation.error)}
          </Banner>
        )}
      </section>

      {/* ═══ GRUPO 2 · CATÁLOGO (cartas nuevas · usa fuente de catálogo) — §19.3 ═══
          Único camino para CREAR cartas nuevas (importa desde pokemontcg.io) → se de-enfatiza y se
          marca su dependencia externa con un banner persistente. D y C son globales; G es por-fila. */}
      <section
        role="group"
        aria-labelledby="m2-group-catalog"
        className="flex flex-col gap-3 border-t border-border pt-8"
      >
        <div className="flex flex-col gap-1">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{t('groups.catalog.eyebrow')}</p>
          <h2 id="m2-group-catalog" className="text-h2 font-semibold">{t('groups.catalog.title')}</h2>
          <p className="text-sm text-muted">{t('groups.catalog.subtitle')}</p>
        </div>
        {/* Aviso de dependencia PERSISTENTE (§19.3): no es un error, es contexto (role=status). */}
        <Banner variant="info" role="status">{t('groups.catalog.sourceWarning')}</Banner>
        <div className="flex flex-wrap gap-2">
          {/* D — Importar sets nuevos (pokemontcg.io, incremental, sin confirmación). */}
          <Button
            variant="secondary"
            loading={syncAllMutation.isPending}
            disabled={batchBusy}
            aria-describedby={batchBusy ? 'm2-reason-busy' : undefined}
            title={batchBusy ? t('catalog.busyReason') : undefined}
            onClick={() => syncAllMutation.mutate()}
          >
            <Layers size={18} aria-hidden /> {t('catalog.syncAll')}
          </Button>
          {/* C — Backfill (siguiente lote, incremental). */}
          <Button
            variant="secondary"
            loading={backfillMutation.isPending}
            disabled={batchBusy}
            aria-describedby={batchBusy ? 'm2-reason-busy' : undefined}
            title={batchBusy ? t('catalog.busyReason') : undefined}
            onClick={() => backfillMutation.mutate()}
          >
            <DownloadCloud size={18} aria-hidden /> {t('catalog.backfill')}
          </Button>
        </div>
        {/* Barra de progreso del barrido de catálogo (sync-all / force), poll cada 3 s. */}
        {syncStatus.data && (syncStatus.data.running || syncStatus.data.total > 0) && (
          <SyncProgress
            running={syncStatus.data.running}
            done={syncStatus.data.done}
            total={syncStatus.data.total}
            labels={{
              running: t('catalog.sweepRunning', {
                done: Math.min(syncStatus.data.done, syncStatus.data.total),
                total: syncStatus.data.total,
              }),
              runningHint: t('catalog.sweepRunningHint'),
              done: t('catalog.sweepDone', { total: syncStatus.data.total }),
            }}
          />
        )}
        {/* G (Importar / Re-sincronizar por-fila): feedback. */}
        {catalogSyncMutation.isPending && (
          <Banner variant="info" role="status">{t('catalog.syncRunning')}</Banner>
        )}
        {catalogSyncMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('catalog.syncDone', {
              count: catalogSyncMutation.data.setsQueued,
              jobId: catalogSyncMutation.data.jobId,
            })}
          </Banner>
        )}
        {catalogSyncMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(catalogSyncMutation.error)}</Banner>
        )}
        {/* D — feedback (barrido encolado / nada por importar). */}
        {syncAllMutation.isSuccess && !isSweeping && (
          <Banner variant="info" role="status">
            {syncAllMutation.data.setsQueued > 0
              ? t('catalog.syncAllQueued', { count: syncAllMutation.data.setsQueued })
              : t('catalog.syncAllNothing')}
          </Banner>
        )}
        {/* Degradación ante fuente caída (§19.3): 404/405 → warning que REENCAMINA a Datos. */}
        {syncAllMutation.isError &&
          (isEndpointMissing(syncAllMutation.error) ? (
            <Banner variant="warning" role="status">
              {t('catalog.syncAllUnavailable')} {t('groups.catalog.sourceDownReroute')}
            </Banner>
          ) : (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncAllMutation.error)}</Banner>
          ))}
        {/* C — feedback. */}
        {backfillMutation.isSuccess && (
          <Banner variant="success" role="status">
            {t('catalog.backfillDone', {
              count: backfillMutation.data.imported.length,
              remaining: backfillMutation.data.remaining,
            })}
          </Banner>
        )}
        {backfillMutation.isError && (
          <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(backfillMutation.error)}</Banner>
        )}
      </section>

      {/* ═══ GRUPO 3 · AVANZADO — §19.1/§19.9 ═══
          Colapsable NATIVO (<details>) plegado por defecto: operaciones pesadas y raras (E global;
          H vive en el menú «Más» por-fila). No invita a usarlas por default. */}
      <details className="group border-t border-border pt-8">
        <summary className="cursor-pointer text-h2 font-semibold marker:text-muted">
          {t('groups.advanced.summary')}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted">{t('groups.advanced.subtitle')}</p>
          {/* E — Re-sincronizar todo (forzar): pesada → confirmación obligatoria. */}
          <div>
            <Button
              variant="secondary"
              loading={syncAllForceMutation.isPending}
              disabled={batchBusy}
              aria-describedby={batchBusy ? 'm2-reason-busy' : undefined}
              title={batchBusy ? t('catalog.busyReason') : undefined}
              onClick={() => setForceConfirmOpen(true)}
            >
              <RefreshCw size={18} aria-hidden /> {t('catalog.syncAllForce')}
            </Button>
          </div>
          {syncAllForceMutation.isSuccess && !isSweeping && (
            <Banner variant="info" role="status">
              {syncAllForceMutation.data.setsQueued > 0
                ? t('catalog.syncAllQueued', { count: syncAllForceMutation.data.setsQueued })
                : t('catalog.syncAllNothing')}
            </Banner>
          )}
          {syncAllForceMutation.isError &&
            (isEndpointMissing(syncAllForceMutation.error) ? (
              <Banner variant="warning" role="status">
                {t('catalog.syncAllUnavailable')} {t('groups.catalog.sourceDownReroute')}
              </Banner>
            ) : (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(syncAllForceMutation.error)}</Banner>
            ))}
        </div>
      </details>

      {/* §19.5: confirmación one-shot money-safe de «Unificar rarezas» (muta rarityCanonical de TODO
          el catálogo, aunque no toca precios ni reglas → se confirma para dejar claro el alcance). */}
      <Modal
        open={unifyConfirmOpen}
        onClose={() => setUnifyConfirmOpen(false)}
        title={t('unifyRarities.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnifyConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={unifyMutation.isPending}
              onClick={() => {
                setUnifyConfirmOpen(false);
                unifyMutation.mutate();
              }}
            >
              {t('unifyRarities.confirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('unifyRarities.confirmBody')}</p>
      </Modal>

      {/* Modal de override manual de precio */}
      <Modal
        open={!!overrideTarget}
        onClose={() => setOverrideTarget(null)}
        title={t('pending.overrideTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverrideTarget(null)}>
              {tc('cancel')}
            </Button>
            <Button
              // S-L1 money-safe: bloquea Fijar precio si el valor está vacío o mal formado, para que
              // pesosToCents no lo castee a NaN→0 y publique el ítem a MX$0 (mismo gate que salesRules).
              disabled={overrideDraftInvalid}
              loading={overrideMutation.isPending}
              onClick={() =>
                overrideTarget && !overrideDraftInvalid && overrideMutation.mutate(overrideTarget)
              }
            >
              {t('pending.saveOverride')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {overrideTarget && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <span lang="en" className="font-medium text-text">
                {overrideTarget.cardName ?? overrideTarget.card?.name ?? overrideTarget.cardId}
              </span>
              <span className="tabular">{overrideTarget.gradeKey}</span>
              {/* El override fija el precio de ESTE acabado (v1.8: cola por acabado). */}
              <FinishBadge finish={overrideTarget.finish} productType={overrideTarget.productType} />
            </p>
          )}
          <Input
            label={t('pending.priceLabel')}
            type="text"
            inputMode="decimal"
            prefix="MX$"
            value={overridePriceValue}
            // S-L1 money-safe: idéntico saneo que salesRules — solo dígitos + UN punto, para que
            // "1.2.3"/"12..5" no formen un valor que castee a NaN→0 y publique el ítem a MX$0.
            onChange={(e) => setOverridePriceValue(sanitizeDecimalInput(e.target.value))}
          />
          {/* S-L1 money-safe: si el valor quedó vacío/mal formado, explica por qué Fijar está bloqueado. */}
          {overridePriceValue !== '' && overrideDraftInvalid && (
            <Banner variant="warning" role="alert">{t('pending.overrideInvalidValue')}</Banner>
          )}
          {overridePriceValue !== '' && (
            <p className="text-xs text-muted">
              = {formatMoneyCents(pesosToCents(overridePriceValue), locale)}
            </p>
          )}
          {overrideMutation.isError && (
            <Banner variant="danger" role="alert" title={tc('errorTitle')}>{getError(overrideMutation.error)}</Banner>
          )}
        </div>
      </Modal>

      {/* Confirmación del re-sync forzado (operación pesada, contrato §M2 force=true) */}
      <Modal
        open={forceConfirmOpen}
        onClose={() => setForceConfirmOpen(false)}
        title={t('catalog.syncAllForceConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForceConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={syncAllForceMutation.isPending}
              onClick={() => {
                setForceConfirmOpen(false);
                syncAllForceMutation.mutate();
              }}
            >
              {t('catalog.syncAllForceConfirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('catalog.syncAllForceConfirmBody')}</p>
      </Modal>

      {/* RV-ALL: confirmación del batch «Refrescar variantes + precios de TODO (solo TCGCSV)» (masivo) */}
      <Modal
        open={refreshAllConfirmOpen}
        onClose={() => setRefreshAllConfirmOpen(false)}
        title={t('catalog.refreshVariantsAllConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefreshAllConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={refreshVariantsAllMutation.isPending}
              onClick={() => {
                setRefreshAllConfirmOpen(false);
                refreshVariantsAllMutation.mutate();
              }}
            >
              {t('catalog.refreshVariantsAllConfirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('catalog.refreshVariantsAllConfirmBody')}</p>
      </Modal>
    </div>
  );
}
