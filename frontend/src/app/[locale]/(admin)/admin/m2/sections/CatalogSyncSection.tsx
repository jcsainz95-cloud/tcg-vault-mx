'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, Layers } from 'lucide-react';
import type {
  CatalogSyncAllResponse,
  CatalogSyncStatusResponse,
  RefreshVariantsAllFailure,
  RefreshVariantsStatusResponse,
  RemoteSetDTO,
} from '@/types/contract';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Banner } from '@/components/ui/Banner';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState, useErrorMessage } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  computeVerdict,
  formatFigure,
  verdictRole,
  verdictTone,
  UNKNOWN_FIGURE,
  type Verdict,
  type VerdictTone,
} from '@/lib/verdict';
import { SyncProgress } from './shared';
import type { CatalogSync, RepairSetResult } from './useCatalogSync';

/**
 * M2 › **Sincronización del catálogo** — `DESIGN_SYSTEM §32` (v4.0, decisión del dueño).
 *
 * Supersede §19.0–§19.4, §19.6, §19.8 y §19.10: **UNA** sección donde había tres grupos, **TRES**
 * acciones donde había ocho, y **ningún** menú de overflow (§32.2 regla 2 — la acción de
 * reparación vivía escondida en un ⋯ y la rutinaria era la que mentía).
 *
 * ⭐ **El corazón: el aviso no puede afirmar más de lo que pasó** (§32.4). El tono sale SIEMPRE de
 * `computeVerdict` sobre las **cifras de escritura**; ⛔ jamás de `mutation.isSuccess` (H10), que
 * es lo que pintaba «191 cartas procesadas · 0 precios» **en verde** sobre un set que no se tocó.
 *
 * Lo que §32 pide y **no** se implementa aquí, por falta de dato en backend (⇒ H4, no invención):
 *  - la columna **`PRECIOS` `N/M`** (§32.15 R5): necesita `pricedVariants`/`variants` en
 *    `remote-sets` (§M2-CS.3). ⛔ No se deriva de `cardCount`: sería otra cifra inventada.
 *  - el **corte de catálogo a la vista antes de apretar** (§32.3): necesita `catalogWindow` en
 *    `remote-sets` (§M2-CS.4). Hoy el corte sólo lo reporta el `202` de la corrida ⇒ el subtítulo
 *    permanente lo pinta **«—»** y la frase dice que no se pudo leer. ⛔ Y **no** hay enlace
 *    «Cambiar la fecha» a M10: §M2-CS.4 derogó ese dial y enlazarlo sería mandar al dueño a un
 *    mando que dejó de existir.
 */

/** `<b>` = cifra de escritura (H3: primera y en negrita) · `<c>` = contexto muted tras «de». */
const RICH = {
  b: (chunks: ReactNode) => <strong className="font-medium tabular text-text">{chunks}</strong>,
  c: (chunks: ReactNode) => <span className="tabular text-muted">{chunks}</span>,
};

/** Un aviso de resultado: **versalita primero**, frase después, color al final (§32.4a). */
function ResultNotice({
  label,
  tone,
  role,
  children,
  technical,
  action,
}: {
  label: string;
  tone: VerdictTone;
  role: 'status' | 'alert';
  children: ReactNode;
  technical?: ReactNode;
  action?: ReactNode;
}) {
  const t = useTranslations('admin.m2.catalog');
  return (
    <Banner variant={tone} role={role} action={action}>
      {/*
        §32.10: la versalita va DENTRO de la región viva y **primera** — es el portador del
        significado y lo primero que se anuncia. §32.9: en móvil ocupa su propia línea.
        ⛔ Nunca se trunca con elipsis: un veredicto truncado es un veredicto distinto.
      */}
      <span className="block font-mono text-xs uppercase tracking-[0.18em] text-text sm:inline">
        {label}
      </span>{' '}
      <span>{children}</span>
      {technical != null && (
        // §32.4c: `jobId` e ids crudos NO van en la frase que lee el dueño. Si hacen falta para
        // soporte, van aquí, plegados.
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer">{t('technicalDetail')}</summary>
          <div className="mt-1 break-all font-mono text-muted">{technical}</div>
        </details>
      )}
    </Banner>
  );
}

/** Lista de sets fallidos: es una lista de HECHOS, no un resumen — se conserva tal cual (§32.14). */
function FailureList({
  failures,
  sets,
  title,
}: {
  failures: RefreshVariantsAllFailure[];
  sets: RemoteSetDTO[] | undefined;
  title: string;
}) {
  if (failures.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <p className="font-medium">{title}</p>
      <ul className="list-disc pl-5">
        {failures.map((f) => {
          const name = sets?.find((s) => s.id === f.setId)?.name ?? f.setId;
          return (
            <li key={f.setId}>
              <span lang="en" className="font-medium">{name}</span>{' '}
              <span className="tabular text-muted">({f.setId})</span> —{' '}
              {/* `code` es `string | null` (§M2-CS.0): sin código se pinta sólo el mensaje. */}
              {f.message || f.code || UNKNOWN_FIGURE}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ────────────────────────── VISTAS PURAS: hechos → veredicto ──────────────────────────
 * Cada acción tiene una función pura que traduce lo medido en {veredicto, frase, variables}.
 * Viven fuera del componente a propósito: **no tienen acceso a `isSuccess`**, así que el tono no
 * puede volver a salir de ahí (H10), y se pueden poner en rojo con una tabla de casos.
 */

type Vars = Record<string, string | number>;
export type ActionView =
  | { state: 'running'; phraseKey: string; vars: Vars; done: number; total: number }
  | { state: 'result'; verdict: Verdict; phraseKey: string; vars: Vars; jobId?: string | null };

/** ¿Terminó el barrido que ESTA acción lanzó? Se compara por `jobId`: el estado vive en memoria. */
type SweepPhase = 'pending' | 'running' | 'finished' | 'lost';
function sweepOf(status: CatalogSyncStatusResponse | undefined, jobId: string): SweepPhase {
  if (status == null) return 'pending';
  if (status.jobId !== jobId) return 'lost'; // DEV-1: el proceso se reinició y perdió el estado
  if (status.running) return 'running';
  return status.finishedAt == null ? 'pending' : 'finished';
}

/**
 * ACCIÓN 1 · «Importar sets nuevos» (§32.5a).
 *
 * ⚠ `setsQueued: 0` **es ambiguo**: significa «no había nada que encolar» **y** «se rechazó la
 * corrida porque ya había un barrido en curso». Sólo con `remaining: 0` se puede DEMOSTRAR que no
 * faltaba nada ⇒ `SIN CAMBIOS`. Con sets pendientes sin encolar no se sabe qué pasó ⇒
 * `NO SE SABE`. ⛔ Nunca «el catálogo está al día» sobre una corrida rechazada.
 */
export function importNewView(args: {
  launched: CatalogSyncAllResponse | null;
  failed: boolean;
  status: CatalogSyncStatusResponse | undefined;
}): ActionView | null {
  const { launched, failed, status } = args;
  if (failed) {
    return { state: 'result', verdict: computeVerdict({ nothingRan: true, writes: [], failedOrPending: true, hadWork: true }), phraseKey: 'result.importNew.failed', vars: {} };
  }
  if (launched == null) return null;

  if (launched.setsQueued === 0) {
    if (launched.remaining === 0) {
      const date = launched.fromReleaseDate;
      // Cero DEMOSTRABLE: no faltaba ningún set desde el corte. `SIN CAMBIOS`, y NO es verde.
      return {
        state: 'result',
        verdict: computeVerdict({ nothingRan: false, writes: [0], failedOrPending: false, hadWork: false }),
        phraseKey: date ? 'result.importNew.noChanges' : 'result.importNew.noChangesUnknownDate',
        vars: date ? { date } : {},
      };
    }
    return {
      state: 'result',
      verdict: computeVerdict({ nothingRan: false, writes: [null], failedOrPending: true, hadWork: true }),
      phraseKey: 'result.importNew.ambiguous',
      vars: { remaining: launched.remaining },
    };
  }

  const phase = sweepOf(status, launched.jobId);
  if (phase === 'running' && status != null) {
    return {
      state: 'running',
      phraseKey: 'result.importNew.running',
      vars: { done: Math.min(status.done, status.total), total: status.total },
      done: status.done,
      total: status.total,
    };
  }
  if (phase === 'pending' || phase === 'running') {
    return {
      state: 'running',
      phraseKey: 'result.importNew.running',
      vars: { done: status?.done ?? 0, total: status?.total ?? launched.setsQueued },
      done: status?.done ?? 0,
      total: status?.total ?? launched.setsQueued,
    };
  }
  if (phase === 'lost') {
    return {
      state: 'result',
      verdict: computeVerdict({ nothingRan: false, writes: [null], failedOrPending: true, hadWork: true }),
      phraseKey: 'result.importNew.lostState',
      vars: {},
    };
  }

  const summary = status?.summary ?? null;
  const total = status?.total ?? 0;
  const done = status?.done ?? 0;
  if (summary == null) {
    // El barrido terminó y el sistema no reporta qué escribió. Honesto y pobre, pero honesto.
    return {
      state: 'result',
      verdict: computeVerdict({ nothingRan: false, writes: [null], failedOrPending: false, hadWork: true }),
      phraseKey: 'result.importNew.unknownSummary',
      vars: {},
    };
  }
  const verdict = computeVerdict({
    nothingRan: false,
    // ⭐ Cifras de ESCRITURA del barrido de catálogo. ⛔ `setsTotal` no entra: es contexto.
    // ⛔ Y no hay cifra de precios, y es deliberado: este barrido no escribe precios (§M2-CS.1).
    writes: [summary.setsWritten, summary.cardsUpserted],
    // `total > done` = barrido cortado a media: sets encolados que NO se llegaron a intentar
    // (`I-CS2`). No es un cero: es trabajo sin hacer, y por eso degrada a PARCIAL.
    failedOrPending: summary.setsFailed > 0 || total > done,
    hadWork: summary.setsTotal > 0,
  });
  const vars: Vars = {
    written: summary.setsWritten,
    cards: summary.cardsUpserted,
    total: summary.setsTotal,
    failed: summary.setsFailed,
  };
  const phraseKey =
    verdict === 'notDone'
      ? 'result.importNew.notDone'
      : verdict === 'partial'
        ? 'result.importNew.partial'
        : verdict === 'noChanges'
          ? 'result.importNew.noChangesUnknownDate'
          : 'result.importNew.done';
  return { state: 'result', verdict, phraseKey, vars, jobId: status?.jobId ?? null };
}

/**
 * ACCIÓN 2 · «Sincronizar todo (forzar)» — dos fases, **un** veredicto (§32.5b).
 *
 * H7 (manda la fase peor) se aplica así: las **cifras que deciden** son las de la fase 2
 * —variantes y precios—, porque es lo que la acción promete y lo que el dueño vino a preguntar;
 * la fase 1 entra por su **fallo** (⇒ `PARCIAL`, regla dura 4) y por sus cartas en la frase.
 * ⛔ Si la fase 2 escribió 0 y 0, ninguna cantidad de cartas de la fase 1 lo vuelve verde.
 */
export function forceAllView(args: {
  launchFailed: boolean;
  phase: 'catalog' | 'variants' | null;
  catalogStatus: CatalogSyncStatusResponse | undefined;
  variantsStatus: RefreshVariantsStatusResponse | undefined;
  secondHalfMissing: boolean;
  stateLost: boolean;
  started: boolean;
}): ActionView | null {
  const { launchFailed, phase, catalogStatus, variantsStatus, secondHalfMissing, stateLost, started } = args;
  if (launchFailed) {
    return { state: 'result', verdict: 'failed', phraseKey: 'result.forceAll.failed', vars: {} };
  }
  if (phase === 'catalog' && catalogStatus != null && catalogStatus.running) {
    return {
      state: 'running',
      phraseKey: 'forceAll.phase1',
      vars: { done: Math.min(catalogStatus.done, catalogStatus.total), total: catalogStatus.total },
      done: catalogStatus.done,
      total: catalogStatus.total,
    };
  }
  if (phase === 'variants' && variantsStatus != null && variantsStatus.running) {
    return {
      state: 'running',
      phraseKey: 'forceAll.phase2',
      vars: { done: Math.min(variantsStatus.done, variantsStatus.total), total: variantsStatus.total },
      done: variantsStatus.done,
      total: variantsStatus.total,
    };
  }
  if (stateLost) {
    return {
      state: 'result',
      verdict: computeVerdict({ nothingRan: false, writes: [null], failedOrPending: true, hadWork: true }),
      phraseKey: 'result.forceAll.unknown',
      vars: {},
    };
  }
  if (secondHalfMissing) {
    // Versalita propia (§32.5b): el trabajo quedó a medias y hay palanca para terminarlo.
    return { state: 'result', verdict: 'partial', phraseKey: 'result.forceAll.secondHalf', vars: {} };
  }
  if (!started) return null;
  if (phase != null) return null; // encadenando entre fases: sin veredicto todavía

  const summary = variantsStatus?.summary ?? null;
  const catalogSummary = catalogStatus?.summary ?? null;
  const catalogPhaseFailed =
    catalogSummary != null && catalogSummary.setsFailed > 0 && catalogSummary.setsWritten === 0;
  if (summary == null) {
    return {
      state: 'result',
      verdict: computeVerdict({ nothingRan: false, writes: [null], failedOrPending: false, hadWork: true }),
      phraseKey: 'result.forceAll.unknown',
      vars: {},
    };
  }
  const measured = computeVerdict({
    nothingRan: false,
    // ⭐ Las cifras que DECIDEN son las de la fase 2 —variantes y precios—, que es lo que la
    // acción promete. La fase 1 entra por su FALLO (⇒ PARCIAL, regla dura 4) y por sus cartas en
    // la frase. ⛔ Si la fase 2 escribió 0 y 0, ninguna cantidad de cartas de la fase 1 lo
    // vuelve verde (§32.5b, fila «fase 2 escribió 0 y 0» ⇒ NO SE HIZO).
    writes: [summary.cardProductsUpserted, summary.pricesUpserted],
    failedOrPending:
      summary.setsFailed > 0 ||
      summary.pending > 0 ||
      catalogPhaseFailed ||
      (catalogSummary?.setsFailed ?? 0) > 0,
    hadWork: summary.setsTotal > 0,
  });
  // H1: `HECHO` exige que NINGUNA cifra de escritura sea desconocida. Si la fase 1 no dejó
  // resumen, sus cartas se pintan «—» y el verde se degrada: no se afirma lo que no se contó.
  const verdict: Verdict = measured === 'done' && catalogSummary == null ? 'partial' : measured;
  const vars: Vars = {
    variants: summary.cardProductsUpserted,
    prices: summary.pricesUpserted,
    cards: catalogSummary?.cardsUpserted ?? UNKNOWN_FIGURE,
    sets: summary.setsTotal,
    failed: summary.setsFailed,
    pending: summary.pending,
  };
  const phraseKey =
    verdict === 'notDone'
      ? 'result.forceAll.notDone'
      : verdict === 'partial'
        ? catalogPhaseFailed
          ? 'result.forceAll.catalogPhaseFailed'
          : 'result.forceAll.partial'
        : verdict === 'noChanges'
          ? 'result.forceAll.notDone'
          : 'result.forceAll.done';
  return { state: 'result', verdict, phraseKey, vars, jobId: variantsStatus?.jobId ?? null };
}

/**
 * ACCIÓN 3 · «Sincronizar este set» — la de REPARACIÓN (§32.5c). Aquí se corrige D2.
 *
 * ⭐⭐ `pricesUpserted === 0 && cardProductsUpserted === 0` ⇒ **`NO SE HIZO`**, tono `warning`,
 * **cero cifras de contexto**, con la **causa** y la **consecuencia** (H9). Hoy ese mismo
 * desenlace se pintaba verde con «191 cartas procesadas · 0 precios».
 */
export function repairSetView(result: RepairSetResult): ActionView {
  const { set, catalog, variants } = result;
  const name = set.name;
  if (!variants.ok) {
    // La fase 2 no llegó a medir nada. Si además cayó la fase 1, no corrió NADA ⇒ FALLÓ.
    const verdict = computeVerdict({
      nothingRan: !catalog.ok,
      writes: [],
      failedOrPending: true,
      hadWork: true,
    });
    return {
      state: 'result',
      verdict,
      phraseKey: catalog.ok ? 'result.repairSet.pricePhaseFailed' : 'result.repairSet.failed',
      vars: { name },
    };
  }
  const v = variants.data;
  const verdict = computeVerdict({
    nothingRan: false,
    // ⭐ Las cifras que deciden son las de la fase 2. `cardsProcessed` es «cartas que ESTA corrida
    // tocó» y puede ser `null` = no se pudo saber ⇒ «—» y NUNCA un cero de relleno (H4/CS-2).
    writes: [v.cardProductsUpserted, v.pricesUpserted, v.cardsProcessed],
    failedOrPending: !catalog.ok || v.pending > 0 || !v.tcgcsvReachable,
    // ⛔ `hadWork` no se asume: había trabajo si el set tiene cartas que emparejar.
    hadWork: v.cardsInSet > 0,
  });
  const vars: Vars = {
    name,
    variants: formatFigure(v.cardProductsUpserted),
    prices: formatFigure(v.pricesUpserted),
    cards: formatFigure(v.cardsProcessed),
    inSet: v.cardsInSet,
    pending: v.pending,
  };
  if (verdict === 'notDone') {
    // ⛔ CERO cifras de contexto: aquí un «de 191 del set» es justo el número que quemó al dueño.
    return { state: 'result', verdict, phraseKey: 'result.repairSet.notDone', vars: { name } };
  }
  if (verdict === 'noChanges') {
    return { state: 'result', verdict, phraseKey: 'result.repairSet.notDone', vars: { name } };
  }
  if (verdict === 'unknown') {
    return { state: 'result', verdict, phraseKey: 'result.repairSet.unknown', vars: { name } };
  }
  if (verdict === 'partial') {
    const phraseKey = !catalog.ok
      ? 'result.repairSet.catalogPhaseFailed'
      : !v.tcgcsvReachable
        ? 'result.repairSet.unreachable'
        : v.pending > 0
          ? 'result.repairSet.pending'
          : 'result.repairSet.unknownFigure';
    return { state: 'result', verdict, phraseKey, vars };
  }
  return { state: 'result', verdict, phraseKey: 'result.repairSet.done', vars };
}

/* ─────────────────────────────────── LA SECCIÓN ─────────────────────────────────── */

export function CatalogSyncSection({ catalog }: { catalog: CatalogSync }) {
  const t = useTranslations('admin.m2.catalog');
  const tv = useTranslations('common.verdict');
  const tc = useTranslations('common');
  const getError = useErrorMessage('operator');

  const {
    remoteSets,
    syncStatus,
    refreshVariantsStatus,
    phase2Status,
    batchBusy,
    catalogBusy,
    importNewMutation,
    forceAllMutation,
    refreshVariantsAllMutation,
    forceAllPhase,
    secondHalfMissing,
    forceAllStateLost,
    finishSecondHalf,
    repairSetMutation,
    repairPhase,
  } = catalog;

  const [forceConfirmOpen, setForceConfirmOpen] = useState(false);

  /**
   * §32.4c — «el aviso no se autodestruye»: el veredicto permanece hasta que el dueño **lanza
   * otra acción** o recarga. Aquí se hace explícito ese «hasta»: al lanzar una acción se limpian
   * los avisos de las otras dos, para que nunca convivan dos veredictos de dos corridas distintas
   * (que es como se lee un verde viejo como si fuera de la corrida nueva).
   */
  const startAction = (run: () => void, keep: 'import' | 'force' | 'repair') => {
    if (keep !== 'import') importNewMutation.reset();
    if (keep !== 'force') {
      forceAllMutation.reset();
      refreshVariantsAllMutation.reset();
    }
    if (keep !== 'repair') repairSetMutation.reset();
    run();
  };

  /** §32.7.5 — una operación de catálogo a la vez; las demás `disabled` con el motivo anunciado. */
  const busy = catalogBusy || repairSetMutation.isPending;
  const busyProps = (mine: boolean) =>
    ({
      disabled: busy && !mine,
      'aria-describedby': busy && !mine ? 'm2-reason-busy' : undefined,
      title: busy && !mine ? t('busyReason') : undefined,
    }) as const;

  const importView = importNewView({
    launched: importNewMutation.data ?? null,
    failed: importNewMutation.isError,
    status: syncStatus.data,
  });
  const forceView = forceAllView({
    launchFailed: forceAllMutation.isError || refreshVariantsAllMutation.isError,
    phase: forceAllPhase,
    catalogStatus: syncStatus.data,
    // ⛔ Sólo el status del barrido que ESTA corrida lanzó: un `summary` ajeno no se atribuye.
    variantsStatus: phase2Status,
    secondHalfMissing,
    stateLost: forceAllStateLost,
    started: forceAllMutation.isSuccess || refreshVariantsAllMutation.isSuccess,
  });
  const repairView = repairSetMutation.data ? repairSetView(repairSetMutation.data) : null;

  const renderNotice = (view: ActionView, extra?: ReactNode, action?: ReactNode) => {
    if (view.state === 'running') {
      // H6 — «encolado» NO es «hecho»: un trabajo en curso se reporta como ESTADO, con la barra.
      const phrase = t(view.phraseKey, view.vars);
      const compact = t('figure.progress', {
        done: Math.min(view.done, view.total),
        total: view.total,
      });
      return (
        <>
          <ResultNotice label={tv('inProgress')} tone="info" role="status">
            {phrase}
          </ResultNotice>
          {/* La frase de fase vive en el aviso (aria-live) y en el NOMBRE de la barra; el rótulo
              visible de la barra es la cifra corta, para no decir dos veces lo mismo (§32.10). */}
          <SyncProgress
            running
            done={view.done}
            total={view.total}
            labels={{ running: compact, runningHint: t('forceAll.phaseHint'), done: compact, srLabel: phrase }}
          />
        </>
      );
    }
    const label =
      view.phraseKey === 'result.forceAll.secondHalf'
        ? t('forceAll.secondHalfMissing')
        : tv(view.verdict);
    const body =
      view.phraseKey === 'result.forceAll.secondHalf'
        ? t('forceAll.secondHalfBody')
        : t.rich(view.phraseKey, { ...RICH, ...view.vars });
    return (
      <ResultNotice
        label={label}
        tone={verdictTone(view.verdict)}
        role={verdictRole(view.verdict)}
        technical={view.jobId ? view.jobId : undefined}
        action={action}
      >
        {body}
        {extra}
      </ResultNotice>
    );
  };

  const setColumns: Column<RemoteSetDTO>[] = [
    { key: 'name', header: t('set'), render: (s) => <span lang="en">{s.name}</span> },
    {
      key: 'release',
      header: t('releaseDate'),
      render: (s) => <span className="tabular">{s.releaseDate ?? UNKNOWN_FIGURE}</span>,
    },
    {
      key: 'imported',
      header: t('imported'),
      render: (s) =>
        s.imported ? (
          <Badge tone="success" shape="soft">{t('yes')}</Badge>
        ) : (
          <Badge tone="neutral" shape="outline">{t('no')}</Badge>
        ),
    },
    {
      key: 'cardCount',
      header: t('cardCount'),
      align: 'right',
      render: (s) => (
        <span className="tabular">
          {s.cardCount}
          {s.printedTotal ? <span className="text-muted"> / {s.printedTotal}</span> : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      // §32.2: **UN** botón por fila, no tres, y ninguno en un menú ⋯. Es la herramienta de
      // REPARACIÓN, así que NO lleva confirmación (§32.7: la fricción aquí era el defecto), y
      // hace SIEMPRE las dos fases (regla dura 3). Se habilita también en sets NO importados:
      // esa fila es justo lo que reemplazó al `backfill` a ciegas (§32.1).
      render: (s) => {
        const mine = repairSetMutation.isPending && repairSetMutation.variables?.id === s.id;
        return (
          <Button
            size="sm"
            variant="secondary"
            loading={mine}
            aria-label={t('repairSet.aria', { name: s.name })}
            {...busyProps(mine)}
            onClick={() => startAction(() => repairSetMutation.mutate(s), 'repair')}
          >
            <RefreshCw size={14} aria-hidden /> {t('repairSet.label')}
          </Button>
        );
      },
    },
  ];

  return (
    <section
      role="group"
      aria-labelledby="m2-catalog-sync"
      className="flex flex-col gap-3 border-t border-border pt-8"
    >
      {/* Motivo de deshabilitado (§32.10): `title` **y** `aria-describedby`, nunca sólo el color. */}
      <span id="m2-reason-busy" className="sr-only">{t('busyReason')}</span>

      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">{t('section.eyebrow')}</p>
        <h2 id="m2-catalog-sync" className="text-h2 font-semibold">{t('section.title')}</h2>
        <p className="text-sm text-muted">{t('section.subtitle')}</p>
      </div>

      {/* Los DOS botones globales son `secondary` (§32.2): el `primary` del panel es «Actualizar
          precios ahora» y sigue siendo único. Dos primarios compitiendo es lo que produce el
          «botón obvio» que se apretó a ciegas. En móvil apilan a ancho completo (§32.9). */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            loading={importNewMutation.isPending}
            {...busyProps(importNewMutation.isPending)}
            onClick={() => startAction(() => importNewMutation.mutate(), 'import')}
          >
            <Layers size={18} aria-hidden /> {t('importNew.label')}
          </Button>
          {/* Subtítulo PERMANENTE (§32.2/§32.6): no un `title`, no un tooltip, no un popover.
              Es lo que reemplaza a los `*Hint` muertos. ⚠ La fecha del corte todavía no se puede
              leer antes de lanzar (§M2-CS.4 la pone en `remote-sets.catalogWindow`, aún no
              implementado) ⇒ H4: se dice que no se pudo leer, no se inventa una fecha. */}
          <p className="text-xs text-muted">{t('importNew.cutoffUnknown')}</p>
        </div>
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            loading={forceAllMutation.isPending || forceAllPhase != null}
            {...busyProps(forceAllMutation.isPending || forceAllPhase != null)}
            onClick={() => setForceConfirmOpen(true)}
          >
            <RefreshCw size={18} aria-hidden /> {t('forceAll.label')}
          </Button>
          <p className="text-xs text-muted">{t('forceAll.subtitle')}</p>
        </div>
      </div>

      {/* ── Avisos de las dos acciones globales (§32.4c: el veredicto PERMANECE, no es un toast) ── */}
      {importView != null &&
        renderNotice(
          importView,
          importView.state === 'result' && syncStatus.data?.summary?.failures?.length ? (
            <FailureList
              failures={syncStatus.data.summary.failures}
              sets={remoteSets.data}
              title={t('refreshVariantsAllFailuresTitle', {
                count: syncStatus.data.summary.setsFailed,
              })}
            />
          ) : undefined,
        )}
      {importNewMutation.isError && (
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>
          {getError(importNewMutation.error)}
        </Banner>
      )}

      {forceView != null &&
        renderNotice(
          forceView,
          forceView.state === 'result' && phase2Status?.summary ? (
            <>
              {phase2Status.summary.pending > 0 && (
                <p className="mt-1">
                  {t('refreshVariantsAllPending', { pending: phase2Status.summary.pending })}
                </p>
              )}
              <FailureList
                failures={phase2Status.summary.failures}
                sets={remoteSets.data}
                title={t('refreshVariantsAllFailuresTitle', {
                  count: phase2Status.summary.setsFailed,
                })}
              />
            </>
          ) : undefined,
          forceView.state === 'result' && forceView.phraseKey === 'result.forceAll.secondHalf' ? (
            <Button size="sm" variant="secondary" loading={batchBusy} onClick={finishSecondHalf}>
              {t('forceAll.secondHalfCta')}
            </Button>
          ) : undefined,
        )}
      {refreshVariantsAllMutation.isError && (
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>
          {t('refreshVariantsAllError')} {getError(refreshVariantsAllMutation.error)}
        </Banner>
      )}

      {/* ── La tabla, y su acción de reparación por fila ── */}
      <p className="text-sm text-muted">{t('section.repairLead')}</p>
      <QueryState
        isLoading={remoteSets.isLoading}
        isError={remoteSets.isError}
        error={remoteSets.error}
        onRetry={() => remoteSets.refetch()}
      >
        {/* §32.8: la tabla vacía POR ERROR jamás se presenta como «no hay sets» — de eso se
            encarga `QueryState`, que pinta el error con «Reintentar» y no llega hasta aquí. */}
        {remoteSets.data &&
          (remoteSets.data.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-2">
              <DataTable columns={setColumns} rows={remoteSets.data} rowKey={(s) => s.id} />
            </div>
          ) : (
            <EmptyState
              title={t('setsEmpty')}
              body={t('setsEmptyCutoff', { date: UNKNOWN_FIGURE })}
              action={
                <Button
                  variant="secondary"
                  {...busyProps(false)}
                  onClick={() => startAction(() => importNewMutation.mutate(), 'import')}
                >
                  {t('importNew.label')}
                </Button>
              }
            />
          ))}
      </QueryState>

      {repairPhase != null && repairSetMutation.variables && (
        <Banner variant="info" role="status">
          {t(repairPhase === 'catalog' ? 'repairSet.phase1' : 'repairSet.phase2', {
            name: repairSetMutation.variables.name,
          })}
        </Banner>
      )}
      {repairView != null && repairPhase == null && renderNotice(repairView)}
      {repairSetMutation.isError && (
        <Banner variant="danger" role="alert" title={tc('errorTitle')}>
          {getError(repairSetMutation.error)}
        </Banner>
      )}

      {/* Confirmación de la acción 2 (§32.7): el diálogo es donde vive la explicación de las dos
          fases — parte de lo que decían las `*Hint` muertas, ahora en una superficie que se ve. */}
      <Modal
        open={forceConfirmOpen}
        onClose={() => setForceConfirmOpen(false)}
        title={t('syncAllForceConfirmTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setForceConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              loading={forceAllMutation.isPending}
              onClick={() => {
                setForceConfirmOpen(false);
                startAction(() => forceAllMutation.mutate(), 'force');
              }}
            >
              {t('syncAllForceConfirmCta')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">{t('syncAllForceConfirmBody')}</p>
      </Modal>
    </section>
  );
}
