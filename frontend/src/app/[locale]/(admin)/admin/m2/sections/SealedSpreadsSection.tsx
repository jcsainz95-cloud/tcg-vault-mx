'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSealedSpreads, updateSealedSpreads } from '@/lib/api';
import type { SealedSubtype } from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { SEALED_SUBTYPES } from './shared';

/**
 * Sección 5b — spreads de VENTA del SELLADO por PRESENTACIÓN (v1.23-sealed-sales). El pct es MARKUP
 * arriba de mercado: salePriceCents = round(mercadoTCGCSV × (1 + spread/100)). Un spread 0% vende
 * sin margen → se advierte visualmente (por fila y con un banner global money-safe).
 */
export function SealedSpreadsSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const tSub = useTranslations('status.sealedSubtype');
  const qc = useQueryClient();
  const getError = useErrorMessage();

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

  return (
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
  );
}
