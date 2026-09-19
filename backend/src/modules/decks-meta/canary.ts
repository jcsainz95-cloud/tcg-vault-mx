/**
 * DECKS-META Fase 2 — CANARY de validación (gate DURO antes de publicar). Norma: spec §5.
 *
 * PURO (sin I/O): corre en memoria tras traer+parsear+matchear TODO. Si CUALQUIER umbral falla, el
 * veredicto es `NO_PUBLISH` y el llamante conserva el último-bueno + registra `MetaFetchRun{applied:false}`.
 * Umbrales inyectados (`CanaryThresholds`, todos configurables por env, §5).
 */
import type { CanaryThresholds } from './limitless.config';

/** Resumen por deck que el canary evalúa (lo produce el pipeline tras parsear+matchear). */
export interface DeckCanarySummary {
  archetypeId: string;
  slug: string;
  name: string;
  /** Nº de líneas parseadas. */
  cardsParsed: number;
  /** Σ de `quantity` (un deck estándar = 60). Es lo que hace cumplir «las 60». */
  sumQuantity: number;
  /** Líneas casadas (`matched`). */
  matched: number;
  /** Total de líneas. */
  total: number;
  /** Líneas con `unmatched_set`. */
  unmatchedSet: number;
}

export interface CanaryInput {
  /** ¿La home se pudo parsear (bloques `.leader`)? */
  homeParseable: boolean;
  /** Bloques `.leader` con `listId` no nulo (candidatos). */
  leadersWithListId: number;
  /** Decks que se trajeron y parsearon OK (los que fallaron su fetch no entran). */
  decks: DeckCanarySummary[];
}

export interface CanaryCheck {
  id: 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
  ok: boolean;
  /** Valor medido (número o texto compacto). */
  measured: number;
  /** Umbral contra el que se comparó. */
  threshold: number;
  /** Etiqueta corta legible del check (procedencia; NO es i18n de UI). */
  label: string;
}

export interface CanaryResult {
  verdict: 'PUBLISH' | 'NO_PUBLISH';
  checks: CanaryCheck[];
  /** Motivo del NO_PUBLISH (checks fallidos), o `null` si publica. */
  reason: string | null;
  /** Decks dentro de banda (los publicables). */
  inBandDeckCount: number;
}

/** Evalúa los cinco umbrales C1–C5. Determinista, sin I/O. */
export function evaluateCanary(input: CanaryInput, t: CanaryThresholds): CanaryResult {
  const decks = input.decks;
  const inBand = decks.filter((d) => d.sumQuantity >= t.cardsMin && d.sumQuantity <= t.cardsMax);
  const outOfBand = decks.filter((d) => d.sumQuantity < t.cardsMin || d.sumQuantity > t.cardsMax);

  const total = decks.reduce((s, d) => s + d.total, 0);
  const matched = decks.reduce((s, d) => s + d.matched, 0);
  const unmatchedSet = decks.reduce((s, d) => s + d.unmatchedSet, 0);
  const matchRatio = total > 0 ? matched / total : 0;
  const unmatchedSetRatio = total > 0 ? unmatchedSet / total : 0;

  const checks: CanaryCheck[] = [
    {
      id: 'C1',
      ok: inBand.length >= t.minDecks,
      measured: inBand.length,
      threshold: t.minDecks,
      label: `arquetipos en banda (${inBand.length}) ≥ ${t.minDecks}`,
    },
    {
      id: 'C2',
      // Ningún deck traído puede quedar fuera de la banda 55–61 (un deck a medio parsear = ~30).
      ok: decks.length > 0 && outOfBand.length === 0,
      measured: outOfBand.length,
      threshold: 0,
      label: `decks fuera de banda [${t.cardsMin},${t.cardsMax}] (${outOfBand.length}) = 0`,
    },
    {
      id: 'C3',
      ok: matchRatio >= t.matchFloor,
      measured: round2(matchRatio),
      threshold: t.matchFloor,
      label: `ratio de match (${round2(matchRatio)}) ≥ ${t.matchFloor}`,
    },
    {
      id: 'C4',
      ok: unmatchedSetRatio <= t.unmatchedSetMaxRatio,
      measured: round2(unmatchedSetRatio),
      threshold: t.unmatchedSetMaxRatio,
      label: `ratio unmatched_set (${round2(unmatchedSetRatio)}) ≤ ${t.unmatchedSetMaxRatio}`,
    },
    {
      id: 'C5',
      ok: input.homeParseable && input.leadersWithListId >= t.minDecks,
      measured: input.leadersWithListId,
      threshold: t.minDecks,
      label: `home parseable, bloques con listId (${input.leadersWithListId}) ≥ ${t.minDecks}`,
    },
  ];

  const failed = checks.filter((c) => !c.ok);
  const verdict = failed.length === 0 ? 'PUBLISH' : 'NO_PUBLISH';
  const reason = failed.length === 0 ? null : failed.map((c) => `${c.id}: ${c.label}`).join('; ');

  return { verdict, checks, reason, inBandDeckCount: inBand.length };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
