'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { getPendingPrices, overridePrice } from '@/lib/api';
import type { PendingPriceEntryDTO, PendingPriceReason } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { FinishBadge } from '@/components/domain/FinishBadge';
import { pesosToCents, sanitizeDecimalInput, isSaveableRuleValue } from './shared';

/**
 * Sección 2 — cola de precio pendiente en DOS BUCKETS (P-6, v1.26). VENTA = context=inventory
 * (fijable por override → publica el ítem). COMPRA = context=buylist, vista READ-ONLY (producir
 * el precio de compra on-request es un WRITE del stream buylist, acoplado a INE/AML — FUERA DE
 * ALCANCE de M2; aquí solo se muestra). Incluye el modal de override manual de precio.
 */

// v1.42 (BLOQ-2b): nombre a mostrar de un pendiente. Para sellado usa `sealedProductName` (el operador
// ve «ETB …», no la carta ancla); ETB y blíster del mismo set son entradas SEPARADAS por `sealedProductId`.
// raw/graded caen a la carta. Residual money-safe: sellado legacy sin nombre cae a la carta ancla.
function pendingDisplayName(e: PendingPriceEntryDTO): string {
  if (e.productType === 'sealed' && e.sealedProductName) return e.sealedProductName;
  return e.cardName ?? e.card?.name ?? e.cardId;
}

export function PendingQueueSection() {
  const t = useTranslations('admin.m2');
  const tc = useTranslations('common');
  const tReason = useTranslations('status.pendingReason');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const [bucket, setBucket] = useState<'venta' | 'compra'>('venta');
  // §21.7c: la cola recibe entradas de DOS orígenes que se arreglan de forma distinta, así que se
  // distinguen a la vista y se pueden filtrar. El segundo conteo es la señal de calibración del
  // piso: si crece mucho, el piso está mal puesto (o el dato de mercado está roto).
  const [reason, setReason] = useState<PendingPriceReason | 'all'>('all');
  // Cada bucket pide SOLO su contexto y solo cuando su pestaña está activa (calca M6). El override
  // invalida el prefijo ['pending-prices'] → refresca el bucket VENTA al cerrar el pendiente.
  const ventaPending = useQuery({
    queryKey: ['pending-prices', 'inventory', reason],
    queryFn: () => getPendingPrices('inventory', reason === 'all' ? undefined : reason),
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
          {pendingDisplayName(e)}
          {/* Menor display: el `#número` es el de la CARTA ANCLA, no de la pieza de sellado
              (una ETB no tiene «#4»). Solo se pinta para piezas NO selladas. */}
          {e.productType !== 'sealed' && e.card?.number ? (
            <span className="tabular text-muted"> #{e.card.number}</span>
          ) : null}
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
      key: 'reason',
      header: t('pending.reasonCol'),
      render: (e) =>
        e.reason ? (
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-[0.06em]',
              e.reason === 'premium_at_floor' ? 'text-accent' : 'text-muted',
            )}
          >
            {tReason(e.reason)}
          </span>
        ) : (
          // Filas históricas (anteriores a v2.0) no traen motivo: se dice, no se inventa.
          <span className="text-muted">—</span>
        ),
    },
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
          {pendingDisplayName(e)}
          {/* Menor display: el `#número` es el de la CARTA ANCLA, no de la pieza de sellado
              (una ETB no tiene «#4»). Solo se pinta para piezas NO selladas. */}
          {e.productType !== 'sealed' && e.card?.number ? (
            <span className="tabular text-muted"> #{e.card.number}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'finish',
      header: t('pending.finish'),
      render: (e) => <FinishBadge finish={e.finish} productType={e.productType} />,
    },
  ];

  // S-L1 (money-safe): el override de precio (Fijar precio) publica el ítem a este valor. Un vacío
  // o mal formado ("1.2.3") castea a NaN→0 vía pesosToCents y publicaría a MX$0. Mismo guard que
  // salesRules: solo es fijable un valor no vacío que parsea a número finito → si no, se bloquea.
  const overrideDraftInvalid = !isSaveableRuleValue(overridePriceValue);

  // v2.1: el conteo por motivo VIENE SERVIDO en el cuerpo de la respuesta y se pinta VERBATIM.
  // NO se recalcula ni se filtra en cliente: los `counts` del contrato IGNORAN `?reason=` y la
  // paginación pero RESPETAN `?context=` — derivarlos de la página cargada era justo el defecto
  // (con un filtro activo el encabezado describía el subconjunto, y el número mentía cuando el
  // dueño filtraba para triar, que es cuando más lo mira).
  const countsByReason = ventaPending.data?.counts ?? null;

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="text-h2 font-semibold">{t('pending.title')}</h2>
        <p className="text-sm text-muted">{t('pending.subtitle')}</p>
        {/* §21.7c + ARCH §4.36.5c — los dos primeros números JUNTOS son un DIAGNÓSTICO, no volumen
            de trabajo: contra la línea base ≈3/333, `premium_at_floor` subiendo con `no_market`
            PLANO ⇒ hay dato de mercado y está bajo el piso ⇒ PISO MAL CALIBRADO; subiendo LOS DOS
            ⇒ feed de mercado degradado, y tocar el piso empeoraría las cosas. Por eso el segundo
            va en tinta de atención y no se entierra entre el resto del encabezado. */}
        {bucket === 'venta' && countsByReason && (
          <p
            className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted"
            data-testid="pending-counts"
          >
            <span className="tabular-nums">
              {t('pending.countNoMarket', { count: countsByReason.no_market })}
            </span>
            {' · '}
            <span className="tabular-nums font-medium text-accent">
              {t('pending.countPremiumAtFloor', { count: countsByReason.premium_at_floor })}
            </span>
            {/* `unknown` (filas anteriores a M-41, sin motivo) NO es adorno: sostiene el invariante
                `no_market + premium_at_floor + unknown === entradas open de esta cola`. Sin pintarla,
                los números no cuadrarían con la lista y parecería un bug del backend. Se omite
                cuando es 0 para no añadir ruido a la cola sana. */}
            {countsByReason.unknown > 0 && (
              <>
                {' · '}
                <span className="tabular-nums">
                  {t('pending.countUnknown', { count: countsByReason.unknown })}
                </span>
              </>
            )}
          </p>
        )}

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
          <div role="tabpanel" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">{t('pending.filterLabel')}</span>
              {(['all', 'no_market', 'premium_at_floor'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={reason === k}
                  onClick={() => setReason(k)}
                  className={cn(
                    'min-h-[44px] px-3 font-mono text-[11px] uppercase tracking-[0.06em] sm:min-h-0 sm:py-2',
                    reason === k
                      ? 'border-b-2 border-accent text-text'
                      : 'border-b-2 border-transparent text-muted hover:text-text',
                  )}
                >
                  {k === 'all' ? t('pending.filterAll') : tReason(k)}
                </button>
              ))}
            </div>
            <QueryState
              isLoading={ventaPending.isLoading}
              isError={ventaPending.isError}
              error={ventaPending.error}
              onRetry={() => ventaPending.refetch()}
            >
              {ventaPending.data && ventaPending.data.data.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-2">
                  <DataTable columns={pendingColumns} rows={ventaPending.data.data} rowKey={(e) => e.id} />
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
              {compraPending.data && compraPending.data.data.length > 0 ? (
                <div className="rounded-lg border border-border bg-surface p-2">
                  <DataTable columns={compraColumns} rows={compraPending.data.data} rowKey={(e) => e.id} />
                </div>
              ) : (
                <EmptyState tone="positive" title={t('pending.compraEmpty')} />
              )}
            </QueryState>
          </div>
        )}
      </section>

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
                {pendingDisplayName(overrideTarget)}
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
    </>
  );
}
