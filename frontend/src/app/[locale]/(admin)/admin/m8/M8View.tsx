'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getAdminDisputes } from '@/lib/api';
import { useRole } from '@/lib/role';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { CardImage } from '@/components/ui/CardImage';
import { GradedCertChip } from '@/components/ui/GradedCertChip';
import { CertNumberField } from '@/components/ui/CertNumberField';
import { QueryState } from '@/components/ui/QueryState';
import { DisputeEvidenceContact } from '@/components/domain/DisputeEvidenceContact';
import type { DisputeDTO } from '@/types/contract';

export function M8View() {
  const t = useTranslations('admin.m8');
  const tm = useTranslations('admin');
  const { isSuperAdmin } = useRole();
  const query = useQuery({ queryKey: ['admin-disputes'], queryFn: getAdminDisputes });
  const [selected, setSelected] = useState<DisputeDTO | null>(null);
  const active = selected ?? query.data?.[0] ?? null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      <QueryState
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        <div className="grid gap-6 lg:grid-cols-[280px,1fr]">
          <div className="flex flex-col gap-2">
            {(query.data ?? []).map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d)}
                className={
                  active?.id === d.id
                    ? 'rounded-lg border border-primary bg-surface-2 p-3 text-left'
                    : 'rounded-lg border border-border bg-surface p-3 text-left hover:bg-surface-2'
                }
              >
                <div className="flex items-center justify-between">
                  <span className="tabular text-sm font-medium">{d.id}</span>
                  <StatusBadge domain="dispute" value={d.status} />
                </div>
                <p className="mt-1 text-xs text-muted" lang="en">
                  {d.item?.card.name} · {d.item?.folio}
                </p>
              </button>
            ))}
          </div>

          {active && (
            <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-5">
              {/* v1.2: sin comparador de fotos; evidencia por correo a soporte (§7.11) */}
              <div className="flex flex-wrap items-start gap-4">
                {active.item && (
                  <div className="w-24 shrink-0">
                    {/* imagen de catálogo remota (v1.2) */}
                    <CardImage src={active.item.card.imageSmallUrl} alt={active.item.card.name} />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="text-sm font-semibold" lang="en">
                    {active.item?.card.name} · {active.item?.folio}
                  </p>
                  {/* Base de resolución de gradeada: empresa + grado + certificado */}
                  {active.item?.productType === 'graded' && (
                    <div className="flex flex-col gap-2">
                      <GradedCertChip
                        gradingCompany={active.item.gradingCompany}
                        gradeValue={active.item.gradeValue}
                        certNumber={active.item.certNumber}
                      />
                      {active.item.certNumber && (
                        <CertNumberField certNumber={active.item.certNumber} />
                      )}
                    </div>
                  )}
                  <p className="text-sm text-muted">{active.description}</p>
                </div>
              </div>

              {/* La evidencia del cliente llega por correo; el admin coteja el hilo */}
              <DisputeEvidenceContact email={active.evidenceContact} reference={active.id} />

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="accent"
                  disabled={!isSuperAdmin}
                  title={!isSuperAdmin ? tm('masked') : undefined}
                >
                  {t('resolveRepurchase')}
                </Button>
                <Button variant="secondary">{t('resolveReject')}</Button>
              </div>
              <p className="text-xs text-muted">{tm('moneyOutNote')}</p>
            </div>
          )}
        </div>
      </QueryState>
    </div>
  );
}
