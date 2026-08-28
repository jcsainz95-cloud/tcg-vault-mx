'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save, ChevronLeft, ChevronRight } from 'lucide-react';
import { getSettings, updateSettings, getAuditLog, type AuditLogFilters } from '@/lib/api';
import type { SettingsDTO, AuditLogDTO, PriceProvider } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
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
  // v1.44-graded-estimate (§M10): interruptor MAESTRO del «gancho de grading». Seed `off`
  // fail-closed. Sin este dial en la UI, la única forma de encender la feature era `curl` — que es
  // exactamente lo que el criterio 110(e) («desde el back-office, sin redeploy, auditado») no acepta.
  { key: 'gradedEstimatesEnabled', kind: 'onOff' },
];

/** El dial que NO es un número más: encenderlo publica una afirmación comercial (ver aviso). */
const GRADED_ESTIMATES_KEY: keyof SettingsDTO = 'gradedEstimatesEnabled';

const PAGE_SIZE = 20;

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

  // Valor EFECTIVO del interruptor del gancho (borrador si se tocó, si no el del servidor).
  const gradedEstimatesOn =
    currentText({ key: GRADED_ESTIMATES_KEY, kind: 'onOff' }) === 'on';
  // Si el dueño acaba de TOCAR el interruptor y queda encendido, el aviso sube a `role="alert"`:
  // ese es el momento de leerlo, no después de guardar.
  const gradedEstimatesTurningOn = gradedEstimatesOn && GRADED_ESTIMATES_KEY in draft;

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

              {/* El «gancho de grading» NO es un dial más: encenderlo PUBLICA una afirmación
                  comercial (§O) cuyo texto legal —el disclaimer de §O.5— todavía espera el visto
                  bueno del humano. La UI lo dice antes de guardar, no después. El resto de su
                  config (escalones de costo, margen mínimo, frescura, grados) vive en M2. */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-muted">{t('dials.gradedEstimates.note')}</p>
                {gradedEstimatesOn && (
                  <Banner
                    variant="warning"
                    role={gradedEstimatesTurningOn ? 'alert' : 'status'}
                    title={t('dials.gradedEstimates.warningTitle')}
                  >
                    {t('dials.gradedEstimates.warning')}
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
