'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { getGradedEstimateConfig, updateGradedEstimateConfig } from '@/lib/api';
import type { GradedEstimateConfigDTO, GradingCostTierDTO } from '@/types/contract';
import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import {
  GRADING_INGEST_RUNS_PER_DAY,
  gradingIngestDailyCreditCeiling,
} from '@/lib/grading-hook-cost';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { pesosToCents, sanitizeDecimalInput } from './shared';

/**
 * Sección 5c — **config del «gancho de grading»** (`GET/PUT /admin/pricing/graded-estimates`,
 * PROJECT §O.2/§O.2.1, criterio **110(e)**: «el súper-admin puede añadir/quitar/editar escalones
 * **sin redeploy**, con **auditoría** y **recálculo** de qué se promociona»).
 *
 * **Por qué existe (D2 del techlead):** hasta ahora los escalones solo se editaban por API. Un dial
 * que el dueño no puede tocar desde el back-office **no cumple** el criterio, por muy correcto que
 * sea el backend.
 *
 * **Cómo se respetan los invariantes I1–I5 del contrato: por CONSTRUCCIÓN, no por regaño.**
 * La tabla no pide `min` y `max` por fila —así es como se producen huecos y solapes—: pide **una
 * frontera por escalón**. El `min` de cada fila **se deriva** del `max` de la anterior, el primero
 * es **0** y el último es **abierto** («de X en adelante»). De ese modo:
 *  - **I3/I4 (contigüidad, sin huecos ni solapes)** y **I5 (final abierto)** son imposibles de
 *    romper desde esta UI: no existe el campo que las rompería.
 *  - **I1 (tabla no vacía)**: no se puede borrar el último escalón (queda `[0, ∞)`).
 *  - **I2 (`costMxnCents ≥ 1`, JAMÁS 0)**: el costo se valida en cliente y el botón se deshabilita;
 *    un costo subestimado es exactamente lo que promocionaría una carta en la que el comprador
 *    pierde dinero (§O.4).
 * La **fuente de verdad sigue siendo el servidor** (validación fail-closed en cada write): si el
 * `PUT` responde 422, el mensaje se muestra **tal cual**, traducido y accionable.
 *
 * **Money-safe:** un campo vacío o mal formado **no se guarda como 0** (mismo criterio S-P1-1 que
 * las reglas de precio); el guardado se bloquea y la fila se marca.
 */
/**
 * Rango del tope de cartas por corrida — **I8, contrato v1.51-a** (`[1, 1000]`). El 5 000 de la
 * versión anterior quedó FUERA del contrato: no se escribe aquí, ni en un `placeholder`, ni en un
 * ejemplo, ni en un test (§22.14e). La validación de cliente **previene** el 422; la fuente de
 * verdad sigue siendo el servidor.
 */
const INGEST_CAP_MIN = 1;
const INGEST_CAP_MAX = 1000;

/**
 * `<b>` y `<n>` del aviso de créditos, **los mismos chunks que M10** (§22.13/§22.14c): la cifra va
 * en mono `tabular-nums` (§20.14, voz del dinero) y las entradillas en `<b>` dentro de la MISMA
 * clave — partir la frase en dos claves o concatenarla está prohibido (§9.4).
 */
const RICH_BOLD = {
  b: (chunks: React.ReactNode) => <strong className="font-medium text-text">{chunks}</strong>,
};
const RICH_FIGURE = {
  n: (chunks: React.ReactNode) => <span className="font-mono tabular">{chunks}</span>,
};

/**
 * Lee el tope tecleado. Devuelve `null` cuando **no se puede guardar**: vacío, no entero o fuera de
 * `[1, 1000]`. Money-safe (S-P1-1): un campo vacío **no cae a 0 ni al default** — bloquea. Aquí un
 * 0 no sería un cobro, sería un ingest que no mira nada, pero la dirección del fallo tiene que ser
 * explícita, no accidental.
 */
function parseIngestCap(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < INGEST_CAP_MIN || n > INGEST_CAP_MAX) return null;
  return n;
}

export function GradedEstimatesSection() {
  const t = useTranslations('admin.m2.gradedEstimates');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const qc = useQueryClient();
  const getError = useErrorMessage();

  const cfg = useQuery({ queryKey: ['graded-estimates-config'], queryFn: getGradedEstimateConfig });

  // Borrador COMPLETO (texto en pesos) — `null` = intacto, se lee del servidor.
  const [draft, setDraft] = useState<TierDraft[] | null>(null);
  const [minUpsideDraft, setMinUpsideDraft] = useState<string | null>(null);
  const [freshnessDraft, setFreshnessDraft] = useState<string | null>(null);
  const [ingestCapDraft, setIngestCapDraft] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (payload: {
      gradingCostTiers: GradingCostTierDTO[];
      minUpsidePct: number;
      freshnessDays: number;
      // §22.14a: `ingestMaxCardsPerRun` ya es opcional en `GradedEstimateConfigInput` — el campo
      // entra en el payload SIN cambio de contrato. Hasta hoy la única cota entre un `PUT` y la
      // factura del proveedor no se mandaba desde ninguna pantalla.
      ingestMaxCardsPerRun: number;
    }) => updateGradedEstimateConfig(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['graded-estimates-config'] });
      setDraft(null);
      setMinUpsideDraft(null);
      setFreshnessDraft(null);
      setIngestCapDraft(null);
    },
  });

  const server = cfg.data;
  const rows: TierDraft[] = draft ?? (server ? toDraft(server.gradingCostTiers) : []);
  const minUpside = minUpsideDraft ?? (server ? String(server.minUpsidePct) : '');
  const freshness = freshnessDraft ?? (server ? String(server.freshnessDays) : '');

  /*
   * ── El tope de cartas por corrida (§22.14) ────────────────────────────────────────────────
   * No es un dial más: es **la única cota entre un `PUT` y la factura del proveedor**
   * (ARCHITECTURE §4.38r.3). Sus dos vecinos —margen mínimo y frescura— son gates de PUBLICACIÓN;
   * éste GASTA, y por eso vive en su propio bloque y no como tercera celda de aquella retícula.
   */
  const ingestCapText = ingestCapDraft ?? (server ? String(server.ingestMaxCardsPerRun) : '');
  const ingestCap = parseIngestCap(ingestCapText);
  const savedIngestCap = server?.ingestMaxCardsPerRun;
  /*
   * El aviso de créditos aparece **solo cuando el borrador difiere de lo guardado** (§22.14b/d): el
   * estado en reposo no repite el techo —eso es de M10, la pantalla del consentimiento— porque el
   * dueño necesita la cifra en el momento en que el número cambia, que es cuando decide. Con un
   * valor inválido NO se calcula nada: un techo sobre un número que no se puede guardar sería
   * peor que ninguno.
   */
  const ingestCapDirection: 'Up' | 'Down' | null =
    ingestCap === null || savedIngestCap == null || ingestCap === savedIngestCap
      ? null
      : ingestCap > savedIngestCap
        ? 'Up'
        : 'Down';
  // Una sola aritmética en el producto: el mismo módulo que cifra el aviso de M10 (§22.14c).
  const ingestCapCredits = gradingIngestDailyCreditCeiling(ingestCap);

  const issues = validate(rows, minUpside, freshness);
  // El rango del tope SÍ bloquea el guardado (es un 422 seguro); el aviso de créditos NO —no es un
  // error, y bloquear la única palanca de contención sería el peor resultado posible (§22.14e).
  const blocking = issues.blocking || ingestCap === null;
  const dirty =
    draft !== null || minUpsideDraft !== null || freshnessDraft !== null || ingestCapDraft !== null;

  function patchRow(index: number, patch: Partial<TierDraft>) {
    setDraft(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  /** Añade una frontera ANTES del escalón abierto: el último sigue siendo el abierto (I5). */
  function addTier() {
    const next = [...rows];
    const openIndex = next.length - 1;
    const openMinCents = minCentsAt(next, openIndex);
    // Default: una frontera $1,000 por encima del inicio del escalón abierto, con su mismo costo.
    next.splice(openIndex, 0, {
      max: String((openMinCents + 100_000) / 100),
      cost: next[openIndex]?.cost ?? '',
    });
    setDraft(next);
  }

  /** Quita un escalón fusionándolo con el siguiente. El último NO se puede quitar (I1). */
  function removeTier(index: number) {
    if (rows.length <= 1) return;
    const next = rows.filter((_, i) => i !== index);
    // Si se quitó el abierto, el nuevo último hereda la apertura: la tabla nunca queda cerrada.
    next[next.length - 1] = { ...next[next.length - 1], max: null };
    setDraft(next);
  }

  function save() {
    if (blocking) return;
    mutation.mutate({
      gradingCostTiers: rows.map((r, i) => ({
        minValueMxnCents: minCentsAt(rows, i),
        maxValueMxnCents: r.max === null ? null : pesosToCents(r.max),
        costMxnCents: pesosToCents(r.cost),
      })),
      minUpsidePct: Number(minUpside),
      freshnessDays: Math.round(Number(freshness)),
      ingestMaxCardsPerRun: ingestCap!,
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-h2 font-semibold">{t('title')}</h2>
      <p className="text-sm text-muted">{t('subtitle')}</p>

      <QueryState
        isLoading={cfg.isLoading}
        isError={cfg.isError}
        error={cfg.error}
        onRetry={() => cfg.refetch()}
      >
        {server && (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
            {/* Espejo READ-ONLY del interruptor maestro (se edita en M10, no aquí). Editar con la
                feature apagada es legítimo —se prepara la tabla antes de encender—, pero hay que
                decirlo: lo que se guarda aquí no se ve en la tienda hasta encenderla. */}
            <div className="flex flex-wrap items-center gap-3 border-b border-border pb-4">
              <span className="text-sm font-medium">{t('masterSwitch')}</span>
              <Badge tone={server.enabled ? 'success' : 'neutral'}>
                {server.enabled ? t('enabledOn') : t('enabledOff')}
              </Badge>
              <span className="text-xs text-muted">{t('masterSwitchHint')}</span>
            </div>

            {!server.enabled && <Banner variant="info">{t('offBanner')}</Banner>}

            {/* --- Escalones de costo de gradeo (§O.2.1) --- */}
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('tiers.title')}</h3>
              <p className="text-xs text-muted">{t('tiers.hint')}</p>

              <ul className="flex flex-col divide-y divide-border">
                <li className="hidden gap-3 py-2 text-xs uppercase tracking-wide text-muted md:grid md:grid-cols-[1fr_1fr_1fr_auto]">
                  <span>{t('tiers.from')}</span>
                  <span>{t('tiers.to')}</span>
                  <span>{t('tiers.cost')}</span>
                  <span />
                </li>
                {rows.map((row, i) => {
                  const isOpen = row.max === null;
                  const rowIssue = issues.rows[i];
                  return (
                    <li
                      key={i}
                      className="grid grid-cols-1 items-end gap-3 py-3 md:grid-cols-[1fr_1fr_1fr_auto]"
                    >
                      {/* `min` DERIVADO: no es editable, y por eso no puede abrir un hueco (I3/I4). */}
                      <div className="flex flex-col gap-1">
                        <span className="text-xs uppercase tracking-wide text-muted md:hidden">
                          {t('tiers.from')}
                        </span>
                        <span className="tabular text-sm">
                          {formatMoneyCents(minCentsAt(rows, i), locale)}
                        </span>
                      </div>

                      {isOpen ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs uppercase tracking-wide text-muted md:hidden">
                            {t('tiers.to')}
                          </span>
                          {/* I5: el ÚLTIMO escalón es abierto siempre. Ninguna carta, por cara que
                              sea, se queda sin escalón (criterio 110(b)). */}
                          <span className="text-sm text-muted">{t('tiers.openEnded')}</span>
                        </div>
                      ) : (
                        <Input
                          label={t('tiers.to')}
                          aria-label={t('tiers.toFor', { index: i + 1 })}
                          type="text"
                          inputMode="decimal"
                          prefix="MX$"
                          error={rowIssue === 'range' ? t('tiers.errors.range') : undefined}
                          value={row.max ?? ''}
                          onChange={(e) => patchRow(i, { max: sanitizeDecimalInput(e.target.value) })}
                        />
                      )}

                      <Input
                        label={t('tiers.cost')}
                        aria-label={t('tiers.costFor', { index: i + 1 })}
                        type="text"
                        inputMode="decimal"
                        prefix="MX$"
                        error={rowIssue === 'cost' ? t('tiers.errors.cost') : undefined}
                        value={row.cost}
                        onChange={(e) => patchRow(i, { cost: sanitizeDecimalInput(e.target.value) })}
                      />

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={rows.length <= 1}
                          aria-label={t('tiers.remove', { index: i + 1 })}
                          onClick={() => removeTier(i)}
                        >
                          <Trash2 size={16} aria-hidden />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div>
                <Button size="sm" variant="secondary" onClick={addTier}>
                  <Plus size={16} aria-hidden /> {t('tiers.add')}
                </Button>
              </div>
            </div>

            {/* --- Margen mínimo y frescura --- */}
            <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Input
                  label={t('minUpside.label')}
                  type="text"
                  inputMode="decimal"
                  suffix="%"
                  className="w-32"
                  value={minUpside}
                  onChange={(e) => setMinUpsideDraft(sanitizeDecimalInput(e.target.value))}
                />
                <p className="text-xs text-muted">{t('minUpside.hint')}</p>
              </div>
              <div className="flex flex-col gap-1">
                <Input
                  label={t('freshness.label')}
                  type="text"
                  inputMode="numeric"
                  className="w-32"
                  value={freshness}
                  onChange={(e) => setFreshnessDraft(sanitizeDecimalInput(e.target.value))}
                />
                <p className="text-xs text-muted">{t('freshness.hint')}</p>
              </div>
            </div>

            {/* --- Tope de cartas por corrida (§22.14) — BLOQUE PROPIO, no una tercera celda ---
                Los dos campos de arriba deciden **qué se enseña**; éste decide **qué se gasta**.
                §7.6 ya separa el dinero saliente del resto del formulario, y meterlo en aquella
                retícula lo haría leerse como un ajuste más de presentación — que es, literalmente,
                cómo se llegó hasta aquí: el aviso de M10 mandaba al dueño a editar aquí un campo
                que esta pantalla no dibujaba. */}
            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">{t('ingestCap.label')}</h3>
              <Input
                label={t('ingestCap.label')}
                type="text"
                inputMode="numeric"
                className="w-32"
                error={ingestCap === null ? t('ingestCap.rangeError') : undefined}
                value={ingestCapText}
                onChange={(e) => setIngestCapDraft(sanitizeDecimalInput(e.target.value))}
              />
              <p className="text-xs text-muted">{t.rich('ingestCap.hint', RICH_BOLD)}</p>
              {ingestCapDirection && ingestCapCredits !== null && (
                /* `role="status"`, nunca `alert`: el dueño está tecleando en su propio borrador y
                   una región asertiva por pulsación es hostil con lector de pantalla (§22.14c).
                   El color NO es el único canal (§2.4): el TÍTULO dice la dirección. */
                <Banner
                  variant={ingestCapDirection === 'Up' ? 'warning' : 'info'}
                  role="status"
                  title={t(`ingestCap.warnTitle${ingestCapDirection}`)}
                >
                  <p className="text-text">
                    {t.rich('ingestCap.warn', {
                      ...RICH_BOLD,
                      ...RICH_FIGURE,
                      // La cifra es la del BORRADOR, no la guardada: es la decisión que se está
                      // tomando. Y va con su supuesto pegado (§22.13d.1, sin excepción).
                      maxCards: ingestCap!,
                      runs: GRADING_INGEST_RUNS_PER_DAY,
                      credits: ingestCapCredits,
                    })}
                  </p>
                </Banner>
              )}
            </div>

            {/* v1.50.3 — los diales del GATE DE CONFIANZA, VISIBLES aunque este panel aún no los
                edite. Se muestran porque cambian el comportamiento que el operador ve y no tenía
                dónde consultarlos: `manualFreshnessDays` decide que un estimado capturado a mano
                CADUCA (antes no caducaba nunca) y `maxRawMultiple` es el tope contra el que se
                compara el PSA 10 en la lista de revisión. Editarlos sigue siendo por API — deuda
                registrada en TECH_DEBT (F-19). */}
            <p className="text-xs text-muted">
              {t('confidenceDials', {
                manualFreshness:
                  server.manualFreshnessDays == null
                    ? t('manualFreshnessNever')
                    : String(server.manualFreshnessDays),
                maxRawMultiple: server.maxRawMultiple,
                minSampleCount: server.minSampleCount,
                sourceStat: server.sourceStat,
              })}
            </p>

            {/* Grados: son dial del servidor y NO se editan aquí (el gate SIEMPRE se evalúa con
                PSA 9 aunque el badge pinte PSA 10). Se muestran para que el dueño sepa qué hay. */}
            <p className="text-xs text-muted">
              {t('grades', {
                grades: server.grades.join(' · '),
                highlight: server.highlightGrades.join(' · '),
              })}
            </p>

            {issues.global && (
              <Banner variant="warning" role="status">
                {t(`globalErrors.${issues.global}`)}
              </Banner>
            )}

            <p className="text-xs text-muted">{t('recalcHint')}</p>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={!dirty || blocking}
                loading={mutation.isPending}
                onClick={save}
              >
                {tc('save')}
              </Button>
              {dirty && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                    setMinUpsideDraft(null);
                    setFreshnessDraft(null);
                    setIngestCapDraft(null);
                  }}
                >
                  {tc('cancel')}
                </Button>
              )}
            </div>

            {mutation.isSuccess && (
              <Banner variant="success" role="status">
                {t('saved')}
              </Banner>
            )}
            {mutation.isError && (
              <Banner variant="danger" role="alert" title={tc('errorTitle')}>
                {getError(mutation.error)}
              </Banner>
            )}
          </div>
        )}
      </QueryState>
    </section>
  );
}

/** Fila del borrador: la FRONTERA superior (pesos, `null` = escalón abierto) y su costo. */
interface TierDraft {
  max: string | null;
  cost: string;
}

function toDraft(tiers: GradingCostTierDTO[]): TierDraft[] {
  const rows = tiers.map((t) => ({
    max: t.maxValueMxnCents === null ? null : String(t.maxValueMxnCents / 100),
    cost: String(t.costMxnCents / 100),
  }));
  // Defensa: si el servidor devolviera una tabla cerrada (o vacía), la UI la presenta abierta —
  // nunca ofrece guardar algo que el backend rechazaría por I5.
  if (rows.length === 0) return [{ max: null, cost: '' }];
  rows[rows.length - 1] = { ...rows[rows.length - 1], max: null };
  return rows;
}

/** `min` DERIVADO de la frontera anterior: el primero es 0 (cobertura desde cero, I3). */
function minCentsAt(rows: TierDraft[], index: number): number {
  if (index === 0) return 0;
  const prev = rows[index - 1]?.max;
  return prev ? pesosToCents(prev) : 0;
}

/** Tope anti-typo del contrato: `GRADING_COST_MAX_CENTS` = MX$100,000. */
const GRADING_COST_MAX_CENTS = 10_000_000;

type RowIssue = 'cost' | 'range';
type GlobalIssue = 'minUpside' | 'freshness';

/**
 * Validación de cliente: **previene** el 422 del servidor, no lo sustituye. Money-safe: un costo
 * vacío, 0 o absurdo bloquea el guardado — jamás se envía un costo de gradeo en 0.
 */
function validate(
  rows: TierDraft[],
  minUpside: string,
  freshness: string,
): { rows: (RowIssue | undefined)[]; global?: GlobalIssue; blocking: boolean } {
  const rowIssues = rows.map((row, i) => {
    const cost = row.cost.trim() === '' ? NaN : pesosToCents(row.cost);
    if (!Number.isFinite(cost) || cost < 1 || cost > GRADING_COST_MAX_CENTS) return 'cost';
    if (row.max !== null) {
      const max = row.max.trim() === '' ? NaN : pesosToCents(row.max);
      if (!Number.isFinite(max) || max <= minCentsAt(rows, i)) return 'range';
    }
    return undefined;
  });

  const upside = minUpside.trim() === '' ? NaN : Number(minUpside);
  const days = freshness.trim() === '' ? NaN : Number(freshness);
  let global: GlobalIssue | undefined;
  if (!Number.isFinite(upside) || upside < 0 || upside > 1000) global = 'minUpside';
  else if (!Number.isInteger(days) || days < 1 || days > 365) global = 'freshness';

  return {
    rows: rowIssues,
    global,
    blocking: rowIssues.some(Boolean) || global !== undefined,
  };
}
