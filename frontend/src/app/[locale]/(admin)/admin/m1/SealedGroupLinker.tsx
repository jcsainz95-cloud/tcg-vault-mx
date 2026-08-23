'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getSealedSyncCandidates, linkSealedSetGroup } from '@/lib/api';
import type { TcgcsvGroupCandidateDTO } from '@/types/contract';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Curación de grupos promo/colección (DESIGN_SYSTEM §16.8a, P-38 · `SealedGroupLinker`). SOLO
 * `super_admin` (el padre garantiza el rol antes de renderizar). Lista los candidatos TCGCSV por
 * name-match (`GET .../sync/candidates`) con su `matchScore` (medidor de confianza orientativo, nunca
 * una cifra cruda sola) y estado `Ya enlazado`. Enlazar un candidato (`POST .../sealed-sets/:id/groups`)
 * dispara un re-sync del set (`onLinked`) para repoblar las secciones. Money-safe: enlazar/sincronizar
 * JAMÁS fija precio.
 */

export interface SealedGroupLinkerProps {
  setId: string;
  /** Se dispara tras enlazar un grupo (el padre re-sincroniza + refetch de secciones). */
  onLinked: () => void;
}

function confidenceKey(score: number): 'high' | 'mid' | 'low' {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'mid';
  return 'low';
}

export function SealedGroupLinker({ setId, onLinked }: SealedGroupLinkerProps) {
  const t = useTranslations('admin.sealedAdd.linker');

  const candidates = useQuery({
    queryKey: ['sealed-sync-candidates', setId],
    queryFn: () => getSealedSyncCandidates({ setId }),
    enabled: setId !== '',
  });

  const link = useMutation({
    mutationFn: (c: TcgcsvGroupCandidateDTO) =>
      linkSealedSetGroup(setId, { tcgplayerGroupId: c.tcgplayerGroupId, kind: 'promo_collection' }),
    onSuccess: () => {
      candidates.refetch();
      onLinked();
    },
  });

  return (
    <div className="flex flex-col gap-3 border border-border bg-surface-2 p-3">
      <h4 className="eyebrow">{t('title')}</h4>

      {candidates.isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : candidates.isError ? (
        <Banner variant="warning" role="alert">
          {t('empty')}
        </Banner>
      ) : (candidates.data?.candidates.length ?? 0) === 0 ? (
        <p className="text-xs text-muted">{t('empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {candidates.data!.candidates.map((c) => {
            const conf = confidenceKey(c.matchScore);
            return (
              <li
                key={c.tcgplayerGroupId}
                className="flex flex-wrap items-center justify-between gap-2 border border-border bg-bg p-2"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span lang="en" className="truncate text-sm text-text">
                    {t('candidateName', { name: c.name })}
                  </span>
                  <span className="flex items-center gap-2 font-mono text-[11px] text-muted">
                    {c.publishedOn && <span className="tabular-nums">{c.publishedOn}</span>}
                    <span
                      className={
                        conf === 'high'
                          ? 'text-success'
                          : conf === 'mid'
                            ? 'text-warning'
                            : 'text-muted'
                      }
                    >
                      {t(`confidence.${conf}`)}
                    </span>
                  </span>
                </div>
                {c.alreadyLinked ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    {t('alreadyLinked')}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={link.isPending && link.variables?.tcgplayerGroupId === c.tcgplayerGroupId}
                    disabled={link.isPending}
                    onClick={() => link.mutate(c)}
                  >
                    {t('linkCta')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
