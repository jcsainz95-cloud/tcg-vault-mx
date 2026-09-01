'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getSellRequests, respondSellRequest } from '@/lib/api';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { PipelineStepper } from '@/components/ui/PipelineStepper';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { QueryState } from '@/components/ui/QueryState';
import { Link } from '@/i18n/navigation';
import { useBuylistSteps } from '@/lib/pipelines';

export interface MyRequestsSectionProps {
  /** `false` durante SSR/hidratación (patrón useSession): no consultar ni pintar gating aún. */
  ready: boolean;
  isAuthenticated: boolean;
}

/**
 * Sección "Mis solicitudes" (TL-C3/FE-13: extracción MECÁNICA de BuylistView, sin cambio de
 * comportamiento). Es dueña de su query (`GET /buylist/requests`, key `['sell-requests']` —
 * la MISMA que invalida el dueño al crear una solicitud) y de la mutación de respuesta al
 * ajuste (F5). Sin sesión NUNCA muestra error: invita a iniciar sesión en tono informativo
 * (y no consulta el endpoint).
 */
export function MyRequestsSection({ ready, isAuthenticated }: MyRequestsSectionProps) {
  const t = useTranslations('buylist');
  const locale = useLocale() as AppLocale;
  const buylistSteps = useBuylistSteps();
  const queryClient = useQueryClient();

  // "Mis solicitudes" SOLO se consulta con sesión: sin sesión no hay request (y por
  // tanto nunca un estado de error) — la sección muestra una invitación neutra.
  const requestsEnabled = ready && isAuthenticated;
  const requests = useQuery({
    queryKey: ['sell-requests'],
    queryFn: getSellRequests,
    enabled: requestsEnabled,
  });

  // F5 · Responder un AJUSTE de venta (contrato §6 · POST /buylist/requests/:id/respond).
  // El cliente acepta/rechaza el precio ajustado por el admin; al éxito refresca la lista.
  const respondMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'accept' | 'decline' }) =>
      respondSellRequest(id, decision),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sell-requests'] });
    },
  });

  return (
    <section className="gutter border-t border-border pb-14 pt-10">
      <h2 className="font-serif text-[22px] leading-tight text-text lg:text-[28px]">{t('myRequests')}</h2>
      <div className="mt-6">
        {!ready ? null : !isAuthenticated ? (
          <div className="max-w-[560px]">
            <p className="text-[13px] leading-[1.7] text-muted">{t('requestsLoginInvite')}</p>
            <Link
              href="/login"
              className="mt-4 inline-block border-b border-accent pb-1.5 text-xs font-medium text-accent hover:border-text hover:text-text"
            >
              {t('loginCta')}
            </Link>
          </div>
        ) : (
          <QueryState
            isLoading={requests.isLoading}
            isError={requests.isError}
            error={requests.error}
            onRetry={() => requests.refetch()}
          >
            {(requests.data?.length ?? 0) === 0 ? (
              <EmptyState title={t('noRequests')} />
            ) : (
              requests.data!.map((r) => {
                const hasPendingItems = r.items.some((it) => it.quotedPriceCents == null);
                // F5: `ajustada` es item-level (no request-level) → se detecta por ítem.
                const adjustedItems = r.items.filter((it) => it.itemStatus === 'ajustada');
                const hasAdjustedItems = adjustedItems.length > 0;
                const adjustedTotalCents = adjustedItems.reduce(
                  (s, it) => s + (it.approvedPriceCents ?? 0),
                  0,
                );
                const responding =
                  respondMutation.isPending && respondMutation.variables?.id === r.sellRequestId;
                return (
                  <div key={r.sellRequestId} className="border-t border-border py-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <span className="flex items-center gap-3">
                        <span className="tabular font-mono text-[13px] text-text">{r.sellRequestId}</span>
                        {/* §23.1d — `expirada` se pinta por su MOTIVO. Aquí importa más que en
                            ningún otro lado: es la pantalla del VENDEDOR, y pintar un
                            `no_offer` («no procedimos con la oferta») con el rojo de
                            `not_shipped` le imputaría un incumplimiento que nunca cometió. */}
                        <StatusBadge
                          domain="sellRequest"
                          value={r.status}
                          reason={r.expiredReason}
                        />
                      </span>
                      <span className="tabular text-sm font-medium text-text">
                        {formatMoneyCents(r.quotedTotalCents, locale)}
                      </span>
                    </div>

                    <div className="mt-5">
                      {/* Rama de error = desenlace terminal que NO es el feliz. `isTerminal` lo
                          dice el SERVIDOR (contrato §6 · v1.51): antes había aquí una lista de dos
                          literales que, con `expirada` en el enum, dejaba de reconocer un cierre
                          real. Lo único que queda escrito es el único terminal FELIZ, que es un
                          literal suelto y no un subconjunto que haya que mantener. */}
                      <PipelineStepper
                        steps={buylistSteps}
                        current={r.status}
                        errored={r.isTerminal && r.status !== 'pagada'}
                      />
                    </div>

                    <div className="mt-5">
                      {r.items.map((it) => (
                        <div
                          key={it.id}
                          className="flex items-center justify-between gap-3 border-b border-border py-2.5 text-sm last:border-b-0"
                        >
                          <span lang="en" className="text-text">
                            {it.card.name}
                          </span>
                          <span className="flex items-center gap-4">
                            {/* Ajustada: el precio vigente es el ajustado (approvedPriceCents),
                                con el original tachado para que el cliente compare. */}
                            {it.itemStatus === 'ajustada' && it.approvedPriceCents != null ? (
                              <span className="flex items-center gap-2">
                                {it.quotedPriceCents != null && (
                                  <span className="tabular text-[11px] text-muted line-through">
                                    {formatMoneyCents(it.quotedPriceCents, locale)}
                                  </span>
                                )}
                                <span className="tabular font-medium text-text">
                                  {formatMoneyCents(it.approvedPriceCents, locale)}
                                </span>
                              </span>
                            ) : it.quotedPriceCents == null ? (
                              /* Honesto: sin cotización NO se muestra MX$0.00. */
                              <span className="font-mono text-[11px] text-accent">{t('linePending')}</span>
                            ) : (
                              <span className="tabular text-muted">
                                {formatMoneyCents(it.quotedPriceCents, locale)}
                              </span>
                            )}
                            <StatusBadge domain="sellItem" value={it.itemStatus} />
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* F5: bloque de respuesta al AJUSTE — visible solo con ítems `ajustada`. */}
                    {/* Makeover 1a: el bloque de ajuste es una nota al margen con regla
                        roja (rule-note), no una caja de color (sin rellenos, §2.1). */}
                    {hasAdjustedItems && (
                      <div className="rule-note mt-5 py-1">
                        <p className="eyebrow text-accent">{t('adjust.title')}</p>
                        <p className="mt-2 text-[13px] leading-[1.6] text-text">
                          {t('adjust.body')}
                        </p>
                        <p className="mt-3 flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-muted">{t('adjust.newTotal')}</span>
                          <span className="tabular font-medium text-text">
                            {formatMoneyCents(adjustedTotalCents, locale)}
                          </span>
                        </p>
                        {respondMutation.isError &&
                          respondMutation.variables?.id === r.sellRequestId && (
                            <p role="alert" className="mt-3 font-mono text-[11px] text-accent">
                              {t('adjust.error')}
                            </p>
                          )}
                        <div className="mt-4 flex gap-3">
                          <Button
                            size="sm"
                            loading={responding && respondMutation.variables?.decision === 'accept'}
                            disabled={responding}
                            onClick={() =>
                              respondMutation.mutate({ id: r.sellRequestId, decision: 'accept' })
                            }
                          >
                            {t('adjust.accept')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-accent"
                            loading={responding && respondMutation.variables?.decision === 'decline'}
                            disabled={responding}
                            onClick={() =>
                              respondMutation.mutate({ id: r.sellRequestId, decision: 'decline' })
                            }
                          >
                            {t('adjust.decline')}
                          </Button>
                        </div>
                      </div>
                    )}

                    {hasPendingItems && (
                      <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">
                        {t('requestPendingNote')}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </QueryState>
        )}
      </div>
    </section>
  );
}
