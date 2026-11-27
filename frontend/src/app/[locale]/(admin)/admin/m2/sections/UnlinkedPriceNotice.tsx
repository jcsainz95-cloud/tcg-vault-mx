'use client';

import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { groupLabel, readGroupUsed, readSetReason, repairCatalogLinks, type LinkGroupUsed, type LinkSetReason } from '@/lib/api/catalog-link-repair';
import { getLinkExceptions, NO_BUTTON_REASONS } from '@/lib/api/catalog-link-exceptions';
import type { UnlinkedPriceReport } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { LinkRepairResultNotice } from './LinkRepairResultNotice';
import { LINK_REPAIR_KEY } from './useCatalogSync';

/** Fila normalizada: sale de `link-exceptions` (§AUTO-ENLACE §2) o, si no responde, de `sync-status.unlinkedPrice`. */
interface NoButtonRow {
  setId: string; name: string; unlinked: number; reasonKey: string; exception: LinkSetReason | null; groupUsed: LinkGroupUsed | null;
}

interface Row {
  setId: string;
  name: string;
  unlinked: number;
  total: number;
  collisions?: number | null;
  omittedProducts?: number | null;
  conflicts?: number | null;
  reason: LinkSetReason | null;
  groupUsed: LinkGroupUsed | null;
  nextAttemptAt: string | null;
}

/**
 * §AUTO-ENLACE F1/F2/F4 — lista única de sets con cartas sin ligar. Un solo botón por set, «Actualizar este set»
 * (`POST /admin/catalog/link-repair`: enlaza y precia en la misma llamada). El resultado se pinta DENTRO de la fila
 * pulsada, nunca al final de la lista. Muestra el grupo de la fuente de precios usado y el motivo (solo lectura).
 */
export function UnlinkedPriceNotice({ report }: { report: UnlinkedPriceReport | undefined }) {
  const t = useTranslations('admin.m2.catalog.unlinkedPrice');
  const format = useFormatter();
  const qc = useQueryClient();
  const exceptions = useQuery({ queryKey: ['link-exceptions'], queryFn: getLinkExceptions, retry: false });
  // M-3: el botón de la tabla general y el de esta lista comparten clave; mientras uno corre, ambos se deshabilitan.
  const anyRepairRunning = useIsMutating({ mutationKey: LINK_REPAIR_KEY }) > 0;
  const retry = useMutation({
    mutationKey: LINK_REPAIR_KEY,
    mutationFn: (v: { setId: string; name: string }) => repairCatalogLinks(v.setId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
      qc.invalidateQueries({ queryKey: ['link-exceptions'] });
    },
  });

  // Fase 1: `link-exceptions` aún no existe (404); el camino real es `sync-status.unlinkedPrice` con grupo y motivo.
  const fromReport: Row[] = (report?.sets ?? []).map((s) => ({
    ...s, reason: readSetReason(s.reason), groupUsed: readGroupUsed(s.groupUsed), nextAttemptAt: null,
  }));
  const fromApi = exceptions.data?.sets ?? null;
  const linkable: Row[] = fromApi ? fromApi.filter((s) => !(s.reason && NO_BUTTON_REASONS.includes(s.reason)) && s.unlinked > 0) : fromReport;
  const noButton: NoButtonRow[] = fromApi
    ? fromApi.filter((s) => s.reason && NO_BUTTON_REASONS.includes(s.reason)).map((s) => ({ setId: s.setId, name: s.name, unlinked: s.unlinked, reasonKey: s.reason === 'tcgcsv_source' ? 'tcgcsvSource' : 'notInProvider', exception: s.reason, groupUsed: s.groupUsed }))
    : (report?.notLinkable?.sets ?? []).map((s) => ({
        setId: s.setId, name: s.name, unlinked: s.unlinked,
        reasonKey: s.reason === 'no_group' ? 'noGroup' : s.reason === 'tcgcsv_source' ? 'tcgcsvSource' : 'other',
        exception: readSetReason(s.exceptionReason), groupUsed: readGroupUsed(s.groupUsed),
      }));
  const totalCards = fromApi ? linkable.reduce((n, s) => n + s.unlinked, 0) : (report?.totalCards ?? 0);
  const notLinkableCards = noButton.reduce((n, s) => n + s.unlinked, 0);

  const pendingId = retry.isPending ? retry.variables?.setId : null;
  // El nombre viaja con la acción: la fila puede desaparecer al refrescar el contador.
  const lastName = retry.variables?.name ?? '';
  const lastSetId = retry.variables?.setId ?? null;

  const tf = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const reasonText = (k: string) => tf(`reason.${k}`);
  const setReasonText = (r: LinkSetReason) => tf(`setReason.${r}`);
  const hasLinkable = linkable.length > 0;
  const timeOf = (iso: string) => format.dateTime(new Date(iso), { timeStyle: 'short' });
  const hasResult = retry.isSuccess || retry.isError;
  const resultInRowEarly = retry.variables?.setId != null && linkable.some((s) => s.setId === retry.variables?.setId);
  if (!linkable.length && !noButton.length && !hasResult) return null;
  const groupText = (g: LinkGroupUsed) => t('groupLine', { name: groupLabel(g, tf), via: tf(`via.${g.via}`) });

  /** Resultado de la última acción, con motivo en claro. Se monta junto a la fila pulsada. */
  const result = (
    <LinkRepairResultNotice
      onDismiss={!resultInRowEarly ? () => retry.reset() : undefined}
      name={lastName}
      result={retry.isSuccess ? retry.data : null}
      error={retry.isError ? retry.error : undefined}
    />
  );
  const resultInRow = lastSetId != null && linkable.some((s) => s.setId === lastSetId);
  // I-4: si la fila ya se resolvió (desapareció al refrescar), el resultado queda FIJO arriba de la lista.
  const resolvedOnTop = hasResult && !resultInRow;

  return (
    <Banner
      variant="warning"
      role="status"
      title={hasLinkable ? t('title', { cards: totalCards, sets: linkable.length }) : noButton.length ? t('notLinkableTitle', { count: notLinkableCards }) : t('resolvedTitle')}
    >
      {resolvedOnTop && <div data-testid="unlinked-resolved">{result}</div>}
      {hasLinkable && <p className="text-sm">{t('lead')}</p>}
      <ul className="mt-2 divide-y divide-border">
        {linkable.map((s) => (
          <li key={s.setId} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted">
                  {t('row', { unlinked: s.unlinked, total: s.total })}
                  {s.collisions != null && ` · ${t('collisions', { n: s.collisions })}`}
                  {s.omittedProducts != null && ` · ${t('omitted', { n: s.omittedProducts })}`}
                  {s.conflicts != null && s.conflicts > 0 && ` · ${t('conflictsCount', { n: s.conflicts })}`}
                </p>
                {s.reason && <p className="text-xs text-muted" data-testid="unlinked-reason">{setReasonText(s.reason)}</p>}
                {(fromApi || s.groupUsed || s.reason) && (
                  <p className="text-xs text-muted" data-testid="unlinked-group">
                    {s.groupUsed ? groupText(s.groupUsed) : t('groupNone')}
                    {s.nextAttemptAt && ` · ${t('nextAttempt', { when: timeOf(s.nextAttemptAt) })}`}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="secondary"
                aria-label={t('aria', { name: s.name })}
                loading={pendingId === s.setId}
                disabled={retry.isPending || anyRepairRunning}
                onClick={() => retry.mutate({ setId: s.setId, name: s.name })}
              >
                <RefreshCw size={14} aria-hidden /> {pendingId === s.setId ? t('retrying') : t('retry')}
              </Button>
            </div>
            {lastSetId === s.setId && result}
          </li>
        ))}
      </ul>
      {noButton.length > 0 && (
        <div className="mt-3" data-testid="unlinked-not-linkable">
          {hasLinkable && <p className="text-sm font-medium">{t('notLinkableTitle', { count: notLinkableCards })}</p>}
          <ul className="divide-y divide-border">
            {noButton.map((s) => (
              <li key={s.setId} className="py-2">
                <p className="text-sm font-medium">{s.name}</p>
                <p className="text-xs text-muted">
                  {t('cardsCount', { n: s.unlinked })} · {s.exception ? setReasonText(s.exception) : reasonText(s.reasonKey)}
                </p>
                {s.groupUsed && <p className="text-xs text-muted" data-testid="unlinked-group">{groupText(s.groupUsed)}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Banner>
  );
}
