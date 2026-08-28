'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import {
  getGradedEstimateConfig,
  getGradedEstimatePreview,
  overridePrice,
  searchBuylistCards,
} from '@/lib/api';
import type { CardDTO, GradedEstimatePreviewDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { buildGradedKey } from '@/lib/gradeKey';
import { formatMoneyCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { pesosToCents, sanitizeDecimalInput } from './shared';

/**
 * Sección 5d — **captura MANUAL de estimados del gancho de grading** (PROJECT §O.6: «el override
 * manual se conserva y manda: es la herramienta para curar cartas concretas —corregir un dato malo,
 * empujar una pieza gancho o tapar un hueco del proveedor—»).
 *
 * **Por qué existe.** El contrato (v1.50.2) exige declarar `intent` en todo override `graded`, con
 * dos valores que hacen cosas OPUESTAS con la misma fila: `market` fija el **precio de venta real**
 * de un slab publicado, y `graded_estimate` publica una **cifra ilustrativa**. Antes de esta
 * sección **no existía ninguna superficie** capaz de mandar `graded_estimate`: la captura manual
 * que §O.6 conserva como curaduría y respaldo del ingest era **inalcanzable desde el back-office**,
 * y el gancho dependía por completo del ingest automático.
 *
 * **La frontera con M1 › Gradeadas, dicha explícitamente en la UI (no solo en este comentario):**
 * aquella pestaña lista **piezas reales** y fija su **precio de mercado** (dinero); ésta escribe
 * una **estimación sobre cartas raw** (argumento de venta). Confundirlas es exactamente el error
 * que §O.8 prohíbe, y por eso el copy lo nombra en las dos direcciones.
 *
 * **Tres guardas, en este orden:**
 *  1. **Pre-vuelo** (`GET …/graded-estimates/preview`): si la carta ya tiene un slab publicado de un
 *     grado, ese campo se **deshabilita** con el motivo a la vista — el operador se entera *antes*
 *     de escribir, no por un 409.
 *  2. **El 409 sigue siendo la verdad** (`GRADED_ESTIMATE_SLAB_PUBLISHED`): el pre-vuelo puede estar
 *     rancio (alguien publica un slab entre la lectura y el guardado), así que el error se muestra
 *     **por grado** y con los `details` del contrato (cuántas piezas y de qué grado).
 *  3. **Money-safe:** un campo vacío o mal formado **no se guarda como 0** ni se toca; cada grado se
 *     escribe por separado, así que un grado bloqueado **no impide** guardar el otro.
 */
export function GradedEstimateCaptureSection() {
  const t = useTranslations('admin.m2.gradedEstimateCapture');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const [query, setQuery] = useState('');
  const [card, setCard] = useState<CardDTO | null>(null);
  /** Borrador por grado, en PESOS como texto (`''` = intacto ⇒ no se manda). */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ gradeValue: string; error?: unknown }[] | null>(null);

  // Misma queryKey que la sección de config: el editor de escalones ya la trae en caché, así que
  // abrir esta sección NO dispara una segunda lectura del mismo recurso.
  const cfg = useQuery({ queryKey: ['graded-estimates-config'], queryFn: getGradedEstimateConfig });

  const trimmed = query.trim();
  const search = useQuery({
    queryKey: ['graded-estimate-card-search', trimmed],
    queryFn: () => searchBuylistCards({ q: trimmed, pageSize: 8 }),
    enabled: trimmed.length >= 2 && card === null,
  });

  const preview = useQuery({
    queryKey: ['graded-estimate-preview', card?.id],
    queryFn: () => getGradedEstimatePreview(card!.id),
    enabled: card !== null,
  });

  /** Grados con slab PUBLICADO (INV-D): su fila es dinero, no admite estimado. */
  const blockedGrades = new Set(
    preview.data?.groups.flatMap((g: GradedEstimatePreviewDTO) => g.publishedSlabGrades) ?? [],
  );
  const grades = cfg.data?.grades ?? [];

  const capture = useMutation({
    mutationFn: async (entries: { gradeValue: string; cents: number }[]) => {
      const out: { gradeValue: string; error?: unknown }[] = [];
      // SECUENCIAL y tolerante por grado a propósito: un `Promise.all` habría que abortarlo entero
      // en el primer 409, y perdería la escritura del grado que sí era legítima.
      for (const entry of entries) {
        try {
          await overridePrice({
            cardId: card!.id,
            productType: 'graded',
            gradeKey: buildGradedKey('PSA', entry.gradeValue),
            priceMxnCents: entry.cents,
            // La razón de ser de esta sección. `market` fijaría el precio de venta de una pieza.
            intent: 'graded_estimate',
          });
          out.push({ gradeValue: entry.gradeValue });
        } catch (error) {
          out.push({ gradeValue: entry.gradeValue, error });
        }
      }
      return out;
    },
    onSuccess: (out) => {
      setResults(out);
      // Solo se limpian los campos que SÍ se guardaron: el que falló conserva lo capturado para
      // poder corregirlo sin volver a teclearlo.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const r of out) if (!r.error) delete next[r.gradeValue];
        return next;
      });
      void preview.refetch();
      qc.invalidateQueries({ queryKey: ['graded-inventory'] });
    },
  });

  /** Entradas guardables: valor presente, numérico y `> 0`, y grado no bloqueado. */
  const payload = grades
    .filter((g) => !blockedGrades.has(g))
    .map((gradeValue) => ({ gradeValue, raw: drafts[gradeValue] ?? '' }))
    .filter((e) => e.raw.trim() !== '')
    .map((e) => ({ gradeValue: e.gradeValue, cents: pesosToCents(e.raw) }))
    .filter((e) => e.cents > 0);

  const hasInvalidDraft = grades.some((g) => {
    const raw = (drafts[g] ?? '').trim();
    return raw !== '' && !(pesosToCents(raw) > 0);
  });

  function selectCard(next: CardDTO) {
    setCard(next);
    setDrafts({});
    setResults(null);
    setQuery('');
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      {/* La frontera con M1 › Gradeadas, arriba del todo: es la confusión que mueve dinero. */}
      <Banner variant="warning" title={t('boundaryTitle')}>
        {t('boundaryBody')}
      </Banner>

      <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        {cfg.data && !cfg.data.enabled && <Banner variant="info">{t('featureOff')}</Banner>}

        {card === null ? (
          <div className="flex flex-col gap-3">
            <Input
              label={t('searchLabel')}
              hint={t('searchHint')}
              placeholder={t('searchPlaceholder')}
              prefix="⌕"
              className="max-w-md"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {trimmed.length >= 2 && (
              <QueryState
                isLoading={search.isLoading}
                isError={search.isError}
                error={search.error}
                onRetry={() => search.refetch()}
              >
                {search.data &&
                  (search.data.data.length === 0 ? (
                    <p className="text-sm text-muted">{t('searchEmpty')}</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {search.data.data.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-3 py-2 text-left hover:text-accent"
                            onClick={() => selectCard(c)}
                          >
                            <Search size={14} aria-hidden className="shrink-0 text-muted" />
                            <span lang="en" className="font-medium">
                              {c.name}
                            </span>
                            <span className="font-mono text-xs text-muted">
                              <span lang="en">{c.setName}</span> ·{' '}
                              <span className="tabular">#{c.number}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ))}
              </QueryState>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
              <span className="flex flex-col">
                <span lang="en" className="font-medium">
                  {card.name}
                </span>
                <span className="font-mono text-xs text-muted">
                  <span lang="en">{card.setName}</span> ·{' '}
                  <span className="tabular">#{card.number}</span>
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => setCard(null)}>
                {t('changeCard')}
              </Button>
            </div>

            {/* --- Pre-vuelo / diagnóstico de curaduría (solo back-office, §M2) --- */}
            <QueryState
              isLoading={preview.isLoading}
              isError={preview.isError}
              error={preview.error}
              onRetry={() => preview.refetch()}
            >
              {preview.data && (
                <div className="flex flex-col gap-3">
                  {blockedGrades.size > 0 && (
                    <Banner variant="danger" role="alert" title={t('slabTitle')}>
                      {t('slabBody', { grades: [...blockedGrades].join(' · ') })}
                    </Banner>
                  )}
                  {preview.data.groups.length === 0 ? (
                    <p className="text-sm text-muted">{t('diagnosis.noGroups')}</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <h3 className="text-sm font-semibold">{t('diagnosis.title')}</h3>
                      <p className="text-xs text-muted">{t('diagnosis.hint')}</p>
                      <ul className="flex flex-col divide-y divide-border">
                        {preview.data.groups.map((g) => (
                          <li
                            key={`${g.representativeInventoryItemId}|${g.finish}`}
                            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2 text-sm"
                          >
                            <Badge tone={g.eligible ? 'success' : 'neutral'}>
                              {g.eligible ? t('diagnosis.eligible') : t('diagnosis.notEligible')}
                            </Badge>
                            <span className="font-mono text-xs uppercase tracking-[0.06em] text-muted">
                              {g.finish}
                            </span>
                            <span className="tabular">
                              {t('diagnosis.salePrice')}: {formatMoneyCents(g.salePriceCents, locale)}
                            </span>
                            <span className="tabular">
                              PSA 10:{' '}
                              {g.psa10MxnCents != null
                                ? formatMoneyCents(g.psa10MxnCents, locale)
                                : t('diagnosis.none')}
                            </span>
                            <span className="tabular">
                              PSA 9:{' '}
                              {g.psa9MxnCents != null
                                ? formatMoneyCents(g.psa9MxnCents, locale)
                                : t('diagnosis.none')}
                            </span>
                            {g.capturedDate && (
                              <span className="text-xs text-muted">
                                {t('diagnosis.captured', { date: formatDate(g.capturedDate, locale) })}
                              </span>
                            )}
                            {!g.eligible && g.reason && (
                              <span className="text-xs text-muted">
                                {t(`diagnosis.reason.${g.reason}`)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </QueryState>

            {/* --- Captura por grado --- */}
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              {grades.map((gradeValue) => {
                const blocked = blockedGrades.has(gradeValue);
                const raw = (drafts[gradeValue] ?? '').trim();
                const invalid = raw !== '' && !(pesosToCents(raw) > 0);
                return (
                  <div key={gradeValue} className="flex flex-col gap-1">
                    <Input
                      label={t('gradeLabel', { grade: gradeValue })}
                      prefix="MX$"
                      type="text"
                      inputMode="decimal"
                      disabled={blocked}
                      error={
                        blocked
                          ? t('gradeBlocked', { grade: gradeValue })
                          : invalid
                            ? t('gradeInvalid')
                            : undefined
                      }
                      value={drafts[gradeValue] ?? ''}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [gradeValue]: sanitizeDecimalInput(e.target.value),
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>

            {results && (
              <ul className="flex flex-col gap-2">
                {results.map((r) => (
                  <li key={r.gradeValue}>
                    <Banner variant={r.error ? 'danger' : 'success'} role={r.error ? 'alert' : 'status'}>
                      {r.error
                        ? t('resultError', { grade: r.gradeValue, message: getError(r.error) })
                        : t('resultOk', { grade: r.gradeValue })}
                    </Banner>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                loading={capture.isPending}
                disabled={payload.length === 0 || hasInvalidDraft || capture.isPending}
                onClick={() => capture.mutate(payload)}
              >
                {t('save')}
              </Button>
              <span className="text-xs text-muted">{t('saveHint')}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
