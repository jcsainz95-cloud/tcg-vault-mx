'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Wand2 } from 'lucide-react';
import { getRarityHealth, unifyRarities } from '@/lib/api';
import type { UnifyRaritiesResponse } from '@/types/contract';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { VerdictBanner } from '@/components/ui/VerdictNotice';
import { computeVerdict, type Verdict } from '@/lib/verdict';

/** `<b>` = cifra de ESCRITURA (H3: primera y en negrita) · `<c>` = contexto muted tras «de». */
const RICH = {
  b: (chunks: ReactNode) => <strong className="font-medium tabular text-text">{chunks}</strong>,
  c: (chunks: ReactNode) => <span className="tabular text-muted">{chunks}</span>,
};

/**
 * ⭐⭐ **El veredicto de «Unificar rarezas»** — `DESIGN_SYSTEM §32.4`, la MISMA norma que rige la
 * sección de sincronización. §32.4 es transversal: *vale para el aviso de resultado de CUALQUIER
 * acción de cualquier panel*, y esta acción vive en el mismo panel, diez líneas más allá.
 *
 * Hasta hoy este aviso salía de `mutation.isSuccess` (⛔ H10) y abría con «Rarezas unificadas. La
 * lista ya refleja las rarezas canónicas.» **en verde** aunque la corrida hubiera reescrito **0**
 * cartas: la misma frase que el docstring de `lib/verdict.ts` cita como el defecto de origen. Y no
 * era cosmético — el `hint` de esta acción promete que *puede cambiar qué cartas quedan retenidas
 * por el guardarraíl*, así que un verde falso aquí manda a revisar el guardarraíl que nadie movió.
 *
 * **Cómo se traduce el contrato a hechos** (`POST /admin/catalog/unify-rarities`):
 *
 *  - `cardsUpdated` — la ÚNICA cifra de **escritura**: cartas cuyo `rarityCanonical` **difería** y
 *    se corrigió. Es la que decide.
 *  - `cardsProcessed` — **contexto**: cartas *recorridas*, no tocadas. ⛔ **No entra en `writes`**
 *    (H3) y no puede abrir la frase: es exactamente el «191 cartas procesadas» de D2.
 *  - `distinctCanonical` — contexto: rarezas canónicas resultantes.
 *  - `unmapped` — **no** es trabajo pendiente de esta corrida: son rarezas que el catálogo canónico
 *    (código, no datos) todavía no conoce. Se listan aparte, íntegras, y ⛔ no degradan el veredicto:
 *    afirmar «parcial» por algo que esta corrida no podía hacer también sería afirmar de más.
 *
 * **`hadWork`, que es donde se juega el `SIN CAMBIOS` vs `NO SE HIZO`:** la acción es un **censo
 * completo** —recorre todo el catálogo con rareza y escribe exactamente lo divergente; el contrato
 * lo dice: «0 en 2ª corrida»—, así que un `cardsUpdated: 0` sobre un censo que de verdad clasificó
 * (`distinctCanonical > 0`) es un cero **demostrable** ⇒ `SIN CAMBIOS`, tono neutro. Si el censo
 * recorrió cartas y **no clasificó ninguna**, no hay nada que demuestre que no hiciera falta ⇒ en la
 * duda `hadWork: true` ⇒ `NO SE HIZO`. ⛔ En ninguno de los dos casos es verde (H2).
 */
export function unifyRaritiesView(data: UnifyRaritiesResponse): {
  verdict: Verdict;
  phraseKey: string;
  vars: Record<string, string | number>;
} {
  const censusClassified = data.cardsProcessed > 0 && data.distinctCanonical > 0;
  const emptyUniverse = data.cardsProcessed === 0;
  const verdict = computeVerdict({
    nothingRan: false,
    // ⭐ Una sola cifra de escritura, y es la de escritura. ⛔ `cardsProcessed` NO entra (H3).
    writes: [data.cardsUpdated],
    // Síncrona, de una pasada y sin cola: no hay fase que pueda quedarse a medias (§M2 unify).
    failedOrPending: false,
    hadWork: !(censusClassified || emptyUniverse),
  });
  const vars = {
    updated: data.cardsUpdated,
    processed: data.cardsProcessed,
    distinct: data.distinctCanonical,
  };
  // ⭐ `unifyRarities.result.done` —la única frase que afirma «rarezas unificadas»— sólo es
  // alcanzable con veredicto `done`, que exige `cardsUpdated > 0` (H1). No hay otra rama que la
  // devuelva, y ése es el candado: el verde no tiene de dónde salir si no hay escritura.
  const phraseKey =
    verdict === 'done'
      ? 'unifyRarities.result.done'
      : verdict === 'noChanges'
        ? 'unifyRarities.result.noChanges'
        : verdict === 'notDone'
          ? 'unifyRarities.result.notDone'
          : 'unifyRarities.result.unknown';
  return { verdict, phraseKey, vars };
}

/**
 * M2 › **Salud del catálogo de rarezas** (DESIGN_SYSTEM §21.7b). Sustituye al asignador
 * rareza→tier, que se retiró con el pricing por tiers: las rarezas **ya no fijan precios**.
 *
 * Es de **solo lectura** y existe por dos razones: (a) respalda el **guardarraíl** —una carta de
 * rareza premium que aterriza en el piso no se publica—, y (b) es el anfitrión natural de
 * «Unificar rarezas» (§19.5), cuyo *information scent* se conserva intacto: el remedio sigue junto
 * al síntoma (la lista fragmentada), solo que la lista ya no es un editor de precios.
 *
 * Consume `GET /admin/pricing/rarities` (re-propositado en v2.0: sin `rule`, sin `tierId`).
 */
export function RarityHealthSection() {
  const t = useTranslations('admin.m2');
  const tt = useTranslations('admin.m2.rarityHealth');
  const tc = useTranslations('common');
  const tv = useTranslations('common.verdict');
  const qc = useQueryClient();
  const getError = useErrorMessage('operator');

  const health = useQuery({ queryKey: ['rarity-health'], queryFn: getRarityHealth });

  const [unifyOpen, setUnifyOpen] = useState(false);
  const unifyMutation = useMutation({
    mutationFn: () => unifyRarities(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rarity-health'] });
    },
  });
  /**
   * El veredicto sale de las CIFRAS, en una función pura y fuera del componente: la vista no tiene
   * acceso a `isSuccess` desde aquí y por tanto **no tiene de dónde sacar un verde** (H10).
   */
  const unifyView = unifyMutation.data ? unifyRaritiesView(unifyMutation.data) : null;

  return (
    <>
      <section className="flex flex-col gap-3" aria-labelledby="rarity-health-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 id="rarity-health-title" className="text-h2 font-semibold">
            {tt('title')}
          </h2>
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="secondary"
              size="sm"
              loading={unifyMutation.isPending}
              onClick={() => setUnifyOpen(true)}
            >
              <Wand2 size={14} aria-hidden /> {t('unifyRarities.button')}
            </Button>
            <p className="max-w-xs text-right text-xs text-muted">{t('unifyRarities.hint')}</p>
          </div>
        </div>
        <p className="max-w-3xl text-sm text-muted">{tt('subtitle')}</p>

        {unifyView != null && (
          <VerdictBanner verdict={unifyView.verdict} label={tv(unifyView.verdict)}>
            {t.rich(unifyView.phraseKey, { ...RICH, ...unifyView.vars })}
            {unifyMutation.data != null && unifyMutation.data.unmapped.length > 0 && (
              // Lista de HECHOS (no un resumen): se conserva íntegra en todos los veredictos. Es la
              // consecuencia que el `hint` promete —el guardarraíl no reconoce estas rarezas—, y
              // callarla en un desenlace malo dejaría al dueño sin la parte accionable.
              <div className="mt-2 flex flex-col gap-1">
                <p className="font-medium">
                  {t('unifyRarities.unmappedTitle', { count: unifyMutation.data.unmapped.length })}
                </p>
                <ul className="list-disc pl-5">
                  {unifyMutation.data.unmapped.map((u) => (
                    <li key={u.raw}>
                      <span lang="en" className="font-medium">
                        {u.raw}
                      </span>{' '}
                      <span className="tabular text-muted">({u.count})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </VerdictBanner>
        )}
        {unifyMutation.isError && (
          // FALLÓ: `danger` + `role="alert"` salen del veredicto, no de `isError` (§32.4a).
          <VerdictBanner verdict="failed" label={tv('failed')}>
            <span className="font-medium">{tc('errorTitle')}</span> {getError(unifyMutation.error)}
          </VerdictBanner>
        )}

        <QueryState
          isLoading={health.isLoading}
          isError={health.isError}
          error={health.error}
          onRetry={() => health.refetch()}
        >
          {health.data && (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface p-4">
              <table className="w-full border-collapse text-left">
                <caption className="sr-only">{tt('title')}</caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="eyebrow py-2 font-normal">
                      {tt('canonicalCol')}
                    </th>
                    <th scope="col" className="eyebrow py-2 font-normal">
                      {tt('premiumCol')}
                    </th>
                    <th scope="col" className="eyebrow py-2 font-normal">
                      {tt('mappedCol')}
                    </th>
                    <th scope="col" className="eyebrow py-2 text-right font-normal">
                      {tt('cardCountCol')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {health.data.rarities.map((row) => (
                    <tr key={row.canonical} className="border-b border-border">
                      <th scope="row" className="py-2 pr-3 text-sm font-medium" lang="en">
                        {row.canonical}
                      </th>
                      <td className="py-2 pr-3">
                        {row.premium && (
                          <Badge tone="accent" shape="outline">
                            {tt('premium')}
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {!row.mapped && (
                          <Badge tone="warning" shape="outline">
                            {tt('unmapped')}
                          </Badge>
                        )}
                      </td>
                      <td className="tabular py-2 text-right text-sm text-muted">{row.cardCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </QueryState>
      </section>

      {/* §19.5 + §21.7b: la confirmación dice ahora las DOS consecuencias — no cambia precios, pero
          sí puede cambiar QUÉ CARTAS quedan retenidas por el guardarraíl (mira la rareza premium). */}
      <Modal
        open={unifyOpen}
        onClose={() => setUnifyOpen(false)}
        title={t('unifyRarities.confirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setUnifyOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={unifyMutation.isPending}
              onClick={() => {
                setUnifyOpen(false);
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
    </>
  );
}
