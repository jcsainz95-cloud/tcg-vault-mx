'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getSettings,
  updateSettings,
  getAuditLog,
  getGradedEstimateConfig,
  type AuditLogFilters,
} from '@/lib/api';
import type { SettingsDTO, AuditLogDTO, PriceProvider } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import {
  GRADING_COST_MEASUREMENT,
  GRADING_INGEST_CREDITS_PER_CARD,
  GRADING_INGEST_RUNS_PER_DAY,
  gradingCostBasis,
  gradingIngestDailyCreditCeiling,
} from '@/lib/grading-hook-cost';
import { formatDate } from '@/lib/format';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';

type DialKind = 'cents' | 'pct' | 'fraction' | 'int' | 'text' | 'provider' | 'onOff';

interface DialSpec {
  key: keyof SettingsDTO;
  kind: DialKind;
}

/** Interruptores del contrato (`on | off`). Select cerrado: un typo no puede apagar una feature. */
const ON_OFF_OPTIONS = ['off', 'on'] as const;

/**
 * Proveedores válidos de referencia de precio POR-CARTA (contrato §M10 · `PriceSource`).
 * Antes eran texto libre en M10: un typo (p. ej. "pokemontcg" sin `_io`) rompía la
 * resolución de precio. Ahora es un Select cerrado. OJO: este `pricingProvider*` es la
 * referencia por-carta, distinto del `priceProvider` del ingest BULK (M2 §3b) — son
 * conceptos separados y ambos viven.
 */
const PRICE_PROVIDER_OPTIONS = [
  'pokemontcg_io',
  'pokemonpricetracker',
  'poketrace',
  'manual',
] as const;

/**
 * Proveedores válidos de la INGESTA MASIVA de precios (dial `priceProvider` /
 * `price_provider`, contrato §M10 · `PriceProvider`). Es el barrido diario de precios (P-47),
 * DISTINTO de los tres `pricingProvider*` per-carta de arriba. Debe COINCIDIR exacto con
 * `PRICE_PROVIDER_VALUES` del backend: cualquier otro valor (p. ej. `poketrace`/`manual`) → 422.
 * Rollback money-safe = volver a `pokemontcg_io`.
 */
const PRICE_PROVIDER_INGEST_OPTIONS = [
  'pokemontcg_io',
  'pokemonpricetracker',
  'tcgcsv_singles',
] as const;

// Diales editables (contrato §M10). El PUT es parcial: solo se envían las keys tocadas.
// `salesMarkupPct` (dial MUERTO: el precio de venta lo deriva SALES_PRICE_RULES+fallback
// de M2 §5, contrato lo marca DEPRECADO) y `fxBufferPct` (DUPLICADO del mismo
// `fx_buffer_pct`; editor canónico = M2 §3 FX) se quitaron del UI de M10 para dedup de la
// config de DINERO. Las keys siguen en el backend/SettingsDTO como rollback; solo dejan de
// editarse desde aquí.
const DIALS: DialSpec[] = [
  { key: 'shippingFeeCents', kind: 'cents' },
  { key: 'aportacionPct', kind: 'pct' },
  { key: 'ivaPct', kind: 'pct' },
  { key: 'buylistCapPerRequestCents', kind: 'cents' },
  { key: 'buylistCapPerMonthCents', kind: 'cents' },
  { key: 'ineThresholdCents', kind: 'cents' },
  { key: 'repoCapPerCardCents', kind: 'cents' },
  { key: 'stripeFeePct', kind: 'pct' },
  { key: 'stripeFeeFixedCents', kind: 'cents' },
  { key: 'pricingProviderRaw', kind: 'provider' },
  { key: 'pricingProviderGraded', kind: 'provider' },
  { key: 'pricingProviderSealed', kind: 'provider' },
  { key: 'catalogSyncFromDate', kind: 'text' },
  // v1.51-one-dial (§M10, M-46): el DIAL ÚNICO del «gancho de grading». Seed `off` fail-closed, y la
  // clave es NUEVA ⇒ ningún entorno la trae encendida. Gobierna exhibición Y obtención: sin él en la
  // UI, la única forma de tocarlo sería `curl` — exactamente lo que el criterio 110(e) («desde el
  // back-office, sin redeploy, auditado») no acepta. Ese fue el defecto real del segundo dial
  // retirado (`gradedEstimateIngestEnabled`), que se declaró gobernable y nunca se dibujó.
  { key: 'gradingHookEnabled', kind: 'onOff' },
];

/**
 * El dial que NO es un número más. Encenderlo es un **acto de dinero** (ARCHITECTURE §4.38r.3):
 * publica una afirmación comercial **y** autoriza al barrido a pedir datos a un proveedor de paga y
 * a escribir precios. Por eso tiene dos avisos, uno por sentido (DESIGN_SYSTEM §22.13).
 */
const GRADING_HOOK_KEY: keyof SettingsDTO = 'gradingHookEnabled';

const PAGE_SIZE = 20;

/**
 * Rich text de los avisos del gancho (§22.13b/d). Las entradillas —«Publica.» / «Y gasta.»— van en
 * `<b>` **dentro de la misma clave**: partir la frase en dos claves o concatenarla está prohibido
 * (§9.4), y son el mecanismo por el que la consecuencia nueva se lee aunque nadie lea el párrafo.
 */
const RICH_BOLD = {
  b: (chunks: React.ReactNode) => <strong className="font-medium text-text">{chunks}</strong>,
};

/**
 * `<n>` envuelve **cada cifra de créditos**: son una cuenta, no una frase, así que van en mono
 * `tabular-nums` (§20.14, voz del dinero operativo). Va como chunk y no como clase del párrafo
 * entero porque el resto del aviso es prosa.
 */
const RICH_FIGURE = {
  n: (chunks: React.ReactNode) => <span className="font-mono tabular">{chunks}</span>,
};

/** Convierte el valor del dial a texto de input (cents → pesos). */
function toInputValue(kind: DialKind, value: number | string | undefined): string {
  // Un interruptor ausente en la respuesta se lee como `off` (fail-closed, igual que el seed).
  if (value == null) return kind === 'onOff' ? 'off' : '';
  if (kind === 'cents') return String(Number(value) / 100);
  return String(value);
}

/** Convierte el texto del input al valor del dial (pesos → cents). */
function fromInputValue(kind: DialKind, text: string): number | string {
  if (kind === 'text' || kind === 'provider' || kind === 'onOff') return text;
  const n = Number(text);
  if (kind === 'cents') return Math.round(n * 100);
  if (kind === 'int') return Math.round(n);
  return n;
}

export function M10View() {
  const t = useTranslations('admin.m10');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();

  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: getSettings });

  // Draft: solo las keys tocadas (para PUT parcial).
  const [draft, setDraft] = useState<Record<string, string>>({});

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<SettingsDTO>) => updateSettings(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setDraft({});
    },
  });

  // --- Dial del bulk price provider (ingesta masiva, §M10 · `priceProvider`) ---
  // Draft y PUT parcial DEDICADOS: es un concepto separado de los diales de arriba, así que
  // se guarda por su cuenta y su patch envía SOLO la key camelCase `priceProvider`.
  const [ingestDraft, setIngestDraft] = useState<string | null>(null);
  const ingestSaved = settings.data?.priceProvider ?? '';
  const ingestValue = ingestDraft ?? ingestSaved;
  const ingestDirty = ingestDraft !== null && ingestDraft !== ingestSaved;

  const ingestMutation = useMutation({
    mutationFn: (provider: PriceProvider) => updateSettings({ priceProvider: provider }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
      setIngestDraft(null);
    },
  });

  function currentText(spec: DialSpec): string {
    if (spec.key in draft) return draft[spec.key];
    return toInputValue(spec.kind, settings.data?.[spec.key] as number | string | undefined);
  }

  const dirtyKeys = Object.keys(draft);

  /*
   * ── Los DOS avisos del dial único (DESIGN_SYSTEM §22.13c) ──────────────────────────────────
   * El dial dejó de ser simétrico, así que **el aviso lo elige el SENTIDO del cambio**, no el
   * estado. `guardado` = lo que hay en el servidor; `efectivo` = el borrador si se tocó el switch.
   *
   *   guardado off + efectivo off → solo la nota persistente
   *   guardado off + efectivo on  → aviso de ENCENDIDO, `role="alert"` (el momento de leerlo)
   *   guardado on  + efectivo on  → aviso de ENCENDIDO, `status` (recordatorio de estado)
   *   guardado on  + efectivo off → aviso de APAGADO, `status` (nunca `alert`: es la vía segura)
   *
   * Los dos nunca coexisten: el estado efectivo es uno solo.
   */
  const hookSavedOn = toInputValue('onOff', settings.data?.[GRADING_HOOK_KEY] as string | undefined) === 'on';
  const hookEffectiveOn = currentText({ key: GRADING_HOOK_KEY, kind: 'onOff' }) === 'on';
  const hookBanner: 'on' | 'off' | null = hookEffectiveOn ? 'on' : hookSavedOn ? 'off' : null;
  // `alert` SOLO en el flip a `on`: es lo que autoriza el gasto. Interrumpir en la dirección segura
  // (apagar) sería ruido, así que el aviso de apagado se queda en `status`.
  const hookTurningOn = hookEffectiveOn && !hookSavedOn;

  /*
   * El tope de cartas por corrida vive en M2 (`GET /admin/pricing/graded-estimates`) y aquí solo se
   * LEE, reusando la misma query key que M2 ya usa — es una lectura más, no un cambio de contrato
   * (DESIGN_SYSTEM §22.12 nº13.c). Sirve para cifrar el gasto máximo diario del aviso de encendido.
   *
   * **Cede la cifra, nunca el aviso** (§22.13d): si la config no está disponible —cargando, error,
   * permiso— el banner se pinta igual en su variante `onNoFigures`. Por eso esta query NO envuelve
   * al aviso en un `QueryState` ni bloquea nada: su fallo degrada el texto, no lo esconde.
   */
  const gradedCfg = useQuery({
    queryKey: ['graded-estimates-config'],
    queryFn: getGradedEstimateConfig,
    // El aviso puede vivir sin este número; reintentar en bucle solo añadiría ruido de red a M10.
    retry: false,
  });
  const hookMaxCards = gradedCfg.data?.ingestMaxCardsPerRun;
  const hookCredits = gradingIngestDailyCreditCeiling(hookMaxCards);

  /*
   * ── Qué variante del aviso de encendido se pinta (§22.13d.1) ───────────────────────────────
   *
   *   sin tope de M2      → `onNoFigures`  (gana sobre las dos siguientes: cede la cifra, no el aviso)
   *   costBasis 'measured'→ `onMeasured`   (hay medición del entorno: cifra Y fecha)
   *   costBasis 'estimated'→ `on`          ← hoy, SIEMPRE
   *
   * `on` publica el techo **con su supuesto pegado**: vale solo si el proveedor cobra por petición,
   * y la petición manda `fetchAllInSet=true`. `onMeasured` está traducido y montado pero **dormido**:
   * no hay canal en el contrato para el coste medido, y rellenarlo a mano sería afirmar «medido»
   * sobre algo que la pantalla no puede verificar (§22.13h). El día que exista, encenderlo es
   * rellenar `GRADING_COST_MEASUREMENT` — ni una cadena que tocar.
   */
  const hookMeasurement = gradingCostBasis() === 'measured' ? GRADING_COST_MEASUREMENT : null;
  const hookVariant: 'on' | 'onMeasured' | 'onNoFigures' =
    hookCredits === null ? 'onNoFigures' : hookMeasurement ? 'onMeasured' : 'on';

  function buildPatch(): Partial<SettingsDTO> {
    const patch: Record<string, number | string> = {};
    for (const key of dirtyKeys) {
      const spec = DIALS.find((d) => d.key === key)!;
      patch[key] = fromInputValue(spec.kind, draft[key]);
    }
    return patch as Partial<SettingsDTO>;
  }

  // --- Bitácora de auditoría ---
  const [actionFilter, setActionFilter] = useState('');
  const [page, setPage] = useState(1);
  const auditFilters: AuditLogFilters = {
    action: actionFilter || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const audit = useQuery({
    queryKey: ['audit-log', auditFilters],
    queryFn: () => getAuditLog(auditFilters),
  });
  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.total / PAGE_SIZE)) : 1;

  const auditColumns: Column<AuditLogDTO>[] = useMemo(
    () => [
      { key: 'date', header: t('audit.date'), render: (a) => <span className="tabular">{formatDate(a.createdAt, locale)}</span> },
      { key: 'actor', header: t('audit.actor'), render: (a) => (
        <span className="flex flex-col">
          <span className="tabular text-sm">{a.actorUserId}</span>
          <Badge tone={a.actorRole === 'super_admin' ? 'primary' : 'neutral'}>{a.actorRole}</Badge>
        </span>
      ) },
      { key: 'action', header: t('audit.action'), render: (a) => <span className="tabular font-medium">{a.action}</span> },
      { key: 'entity', header: t('audit.entity'), render: (a) => <span className="tabular text-muted">{a.entityType} · {a.entityId}</span> },
    ],
    [t, locale],
  );

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {/* Sección 1: diales */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('dials.title')}</h2>
        <p className="text-sm text-muted">{t('dials.subtitle')}</p>
        <QueryState
          isLoading={settings.isLoading}
          isError={settings.isError}
          error={settings.error}
          onRetry={() => settings.refetch()}
        >
          {settings.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {DIALS.map((spec) =>
                  spec.kind === 'provider' || spec.kind === 'onOff' ? (
                    <Select
                      key={spec.key}
                      label={t(`dials.labels.${spec.key}`)}
                      options={(spec.kind === 'onOff'
                        ? ON_OFF_OPTIONS.map((v) => ({ value: v, label: t(`dials.onOff.${v}`) }))
                        : PRICE_PROVIDER_OPTIONS.map((v) => ({ value: v, label: v })))}
                      value={currentText(spec)}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [spec.key]: e.target.value }))
                      }
                    />
                  ) : (
                    <Input
                      key={spec.key}
                      label={t(`dials.labels.${spec.key}`)}
                      hint={t(`dials.units.${spec.kind}`)}
                      type="text"
                      inputMode={spec.kind === 'text' ? undefined : 'decimal'}
                      prefix={spec.kind === 'cents' ? 'MX$' : undefined}
                      value={currentText(spec)}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, [spec.key]: e.target.value }))
                      }
                    />
                  ),
                )}
              </div>

              {/* El «gancho de grading» NO es un dial más: con UN solo interruptor (v1.51, M-46)
                  encenderlo publica una afirmación comercial **y** autoriza el gasto de créditos de
                  un proveedor de paga. Por eso hay DOS avisos, uno por sentido (§22.13): el de
                  encender advierte del dinero; el de apagar enseña la escalera de remedios, para que
                  nadie use el interruptor general para cambiar un foco. El resto de la config
                  (escalones de costo, margen mínimo, frescura, grados, tope por corrida) vive en M2. */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">{t.rich('dials.gradingHook.note', RICH_BOLD)}</p>
                {hookBanner === 'on' && (
                  <Banner
                    variant="warning"
                    role={hookTurningOn ? 'alert' : 'status'}
                    title={t('dials.gradingHook.onTitle')}
                  >
                    <div className="flex flex-col gap-1 text-text">
                      <p>
                        {hookVariant === 'onNoFigures' &&
                          t.rich('dials.gradingHook.onNoFigures', RICH_BOLD)}
                        {hookVariant === 'on' &&
                          t.rich('dials.gradingHook.on', {
                            ...RICH_BOLD,
                            ...RICH_FIGURE,
                            credits: hookCredits!,
                            maxCards: hookMaxCards!,
                            perCard: GRADING_INGEST_CREDITS_PER_CARD,
                            runs: GRADING_INGEST_RUNS_PER_DAY,
                          })}
                        {hookVariant === 'onMeasured' &&
                          t.rich('dials.gradingHook.onMeasured', {
                            ...RICH_BOLD,
                            ...RICH_FIGURE,
                            // La cifra medida NO es el producto de las constantes: es lo que la
                            // corrida gastó de verdad. Si viniera del cálculo, «medido» sería falso.
                            credits: hookMeasurement!.creditsPerDay,
                            maxCards: hookMaxCards!,
                            runs: GRADING_INGEST_RUNS_PER_DAY,
                            // §22.13j: la fecha la formatea el frontend (§9.3), no el ICU.
                            measuredOn: formatDate(hookMeasurement!.measuredOn, locale),
                          })}
                      </p>
                      {/* §7.6: toda acción de dinero saliente declara quién puede y dónde queda. */}
                      <p className="font-mono text-[11px] text-muted">{t('dials.gradingHook.audit')}</p>
                    </div>
                  </Banner>
                )}
                {hookBanner === 'off' && (
                  <Banner variant="info" role="status" title={t('dials.gradingHook.offTitle')}>
                    <p className="text-text">
                      {t.rich('dials.gradingHook.off', {
                        ...RICH_BOLD,
                        // Un solo enlace, y a un destino REAL: la sección de la lista de revisión de
                        // M2 lleva `id="gancho-revision"` con su `scroll-mt`. Sin ese ancla la
                        // escalera de remedios muere en silencio (§22.12 nº13.e).
                        review: (chunks) => (
                          <Link
                            href="/admin/m2#gancho-revision"
                            className="inline-block border-b border-accent py-2 hover:border-text hover:text-text"
                          >
                            {chunks}
                          </Link>
                        ),
                      })}
                    </p>
                  </Banner>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Button
                  disabled={dirtyKeys.length === 0}
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(buildPatch())}
                >
                  <Save size={18} /> {t('dials.save', { count: dirtyKeys.length })}
                </Button>
                {dirtyKeys.length > 0 && (
                  <Button variant="ghost" onClick={() => setDraft({})}>
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {saveMutation.isSuccess && <Banner variant="success" role="status">{t('dials.saved')}</Banner>}
              {saveMutation.isError && <Banner variant="danger" role="alert">{tc('errorGeneric')}</Banner>}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 1b: proveedor de la INGESTA MASIVA (bulk). Separado a propósito de los
          per-carta de arriba para que el humano no los confunda (P-47). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('ingest.title')}</h2>
        <p className="text-sm text-muted">{t('ingest.note')}</p>
        <QueryState
          isLoading={settings.isLoading}
          isError={settings.isError}
          error={settings.error}
          onRetry={() => settings.refetch()}
        >
          {settings.data && (
            <div className="flex flex-col gap-4 rounded-lg border border-primary/40 bg-surface p-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Select
                  label={t('ingest.label')}
                  options={PRICE_PROVIDER_INGEST_OPTIONS.map((v) => ({ value: v, label: v }))}
                  value={ingestValue}
                  onChange={(e) => setIngestDraft(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-3">
                <Button
                  disabled={!ingestDirty}
                  loading={ingestMutation.isPending}
                  onClick={() => ingestMutation.mutate(ingestValue as PriceProvider)}
                >
                  <Save size={18} /> {t('ingest.save')}
                </Button>
                {ingestDirty && (
                  <Button variant="ghost" onClick={() => setIngestDraft(null)}>
                    {tc('cancel')}
                  </Button>
                )}
              </div>
              {ingestMutation.isSuccess && <Banner variant="success" role="status">{t('ingest.saved')}</Banner>}
              {ingestMutation.isError && <Banner variant="danger" role="alert">{tc('errorGeneric')}</Banner>}
            </div>
          )}
        </QueryState>
      </section>

      {/* Sección 2: bitácora */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('audit.title')}</h2>
        <p className="text-sm text-muted">{t('audit.subtitle')}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label={t('audit.filterAction')}
            className="w-64"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            placeholder="settings.update"
          />
        </div>
        <QueryState
          isLoading={audit.isLoading}
          isError={audit.isError}
          error={audit.error}
          onRetry={() => audit.refetch()}
        >
          {audit.data && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg border border-border bg-surface p-2">
                <DataTable columns={auditColumns} rows={audit.data.data} rowKey={(a) => a.id} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">
                  {t('audit.pageInfo', { page: audit.data.page, totalPages, total: audit.data.total })}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft size={16} /> {t('audit.prev')}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    {t('audit.next')} <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </QueryState>
      </section>
    </div>
  );
}
