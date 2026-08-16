'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Save, ChevronLeft, ChevronRight } from 'lucide-react';
import { getSettings, updateSettings, getAuditLog, type AuditLogFilters } from '@/lib/api';
import type { SettingsDTO, AuditLogDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatDate } from '@/lib/format';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';

type DialKind = 'cents' | 'pct' | 'fraction' | 'int' | 'text';

interface DialSpec {
  key: keyof SettingsDTO;
  kind: DialKind;
}

// Diales editables (contrato §M10). El PUT es parcial: solo se envían las keys tocadas.
const DIALS: DialSpec[] = [
  { key: 'shippingFeeCents', kind: 'cents' },
  { key: 'salesMarkupPct', kind: 'pct' },
  { key: 'aportacionPct', kind: 'pct' },
  { key: 'ivaPct', kind: 'pct' },
  { key: 'buylistCapPerRequestCents', kind: 'cents' },
  { key: 'buylistCapPerMonthCents', kind: 'cents' },
  { key: 'ineThresholdCents', kind: 'cents' },
  { key: 'repoCapPerCardCents', kind: 'cents' },
  { key: 'fxBufferPct', kind: 'pct' },
  { key: 'stripeFeePct', kind: 'pct' },
  { key: 'stripeFeeFixedCents', kind: 'cents' },
  { key: 'stripeFeeIvaPct', kind: 'fraction' },
  { key: 'pricingProviderRaw', kind: 'text' },
  { key: 'pricingProviderGraded', kind: 'text' },
  { key: 'pricingProviderSealed', kind: 'text' },
  { key: 'catalogSyncFromDate', kind: 'text' },
];

const PAGE_SIZE = 20;

/** Convierte el valor del dial a texto de input (cents → pesos). */
function toInputValue(kind: DialKind, value: number | string | undefined): string {
  if (value == null) return '';
  if (kind === 'cents') return String(Number(value) / 100);
  return String(value);
}

/** Convierte el texto del input al valor del dial (pesos → cents). */
function fromInputValue(kind: DialKind, text: string): number | string {
  if (kind === 'text') return text;
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

  function currentText(spec: DialSpec): string {
    if (spec.key in draft) return draft[spec.key];
    return toInputValue(spec.kind, settings.data?.[spec.key] as number | string | undefined);
  }

  const dirtyKeys = Object.keys(draft);

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
                {DIALS.map((spec) => (
                  <Input
                    key={spec.key}
                    label={t(`dials.labels.${spec.key}`)}
                    hint={t(`dials.units.${spec.kind}`)}
                    type={spec.kind === 'text' ? 'text' : 'text'}
                    inputMode={spec.kind === 'text' ? undefined : 'decimal'}
                    prefix={spec.kind === 'cents' ? 'MX$' : undefined}
                    value={currentText(spec)}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [spec.key]: e.target.value }))
                    }
                  />
                ))}
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
