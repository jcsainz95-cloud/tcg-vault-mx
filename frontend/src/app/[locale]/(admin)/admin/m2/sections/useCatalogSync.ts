'use client';

import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  triggerPriceIngest,
  getPriceSyncStatus,
  getRemoteSets,
  syncCatalog,
  syncAllCatalog,
  refreshVariants,
  refreshVariantsAll,
  getRefreshVariantsStatus,
  getSyncStatus,
} from '@/lib/api';
import type { CatalogSyncResponse, RefreshVariantsResponse, RemoteSetDTO } from '@/types/contract';
import { useKeepSessionAlive } from '@/lib/keep-alive';

/**
 * Estado y orquestación de M2 › Sincronización del catálogo — **`DESIGN_SYSTEM §32`** (v4.0).
 *
 * §32 dejó **TRES** acciones donde había ocho (§32.2). Las cuatro que desaparecen no se pierden:
 * se absorben como **fases** de las que quedan, y por eso este hook encadena en vez de exponer un
 * botón por endpoint.
 *
 *  1. **Importar sets nuevos** — `sync-all` (barrido asíncrono observable por `sync-status`).
 *  2. **Sincronizar todo (forzar)** — `sync-all {force}` **y luego** `refresh-variants-all`: dos
 *     barridos asíncronos **encadenados por la pantalla** (límite conocido: §32.15 R4).
 *  3. **Sincronizar este set** — `sync {setId, force}` **y luego** `refresh-variants {setId}`,
 *     síncrona y con cifras contables. ⭐ **La fase 2 corre aunque la 1 falle** (regla dura 4):
 *     si la fuente de catálogo se cae, los precios se actualizan igual y el aviso lo dice.
 *
 * ⛔ **Aquí NO se calcula ningún veredicto ni ningún tono.** Este hook devuelve HECHOS medidos
 * (cifras por fase, fallos por fase); el veredicto sale de `computeVerdict` (§32.4a) en la vista.
 * Es deliberado: mientras el tono no pueda leerse de `isSuccess`, no puede volver a pintarse un
 * verde sin escritura (H10).
 */

/**
 * Resultado de UNA fase: o corrió y midió, o falló. ⛔ Un fallo **no** se representa con cifras en
 * cero: «no se pudo» y «se hizo cero» son hechos distintos (§32.4 H4) y el veredicto los separa.
 */
export type PhaseOutcome<T> = { ok: true; data: T } | { ok: false; error: unknown };

/** Lo que la acción 3 midió, fase por fase. Sin veredicto: eso lo decide §32.4a con estas cifras. */
export interface RepairSetResult {
  set: RemoteSetDTO;
  /** fase 1 — cartas e imágenes (`POST /admin/catalog/sync {setId, force:true}`). */
  catalog: PhaseOutcome<CatalogSyncResponse>;
  /** fase 2 — variantes y precios (`POST /admin/catalog/refresh-variants {setId}`). */
  variants: PhaseOutcome<RefreshVariantsResponse>;
}

/** Fase en curso de una acción de dos fases (para el rótulo del progreso, §32.5b/§32.5c). */
export type SyncPhase = 'catalog' | 'variants';

/**
 * Clave donde se recuerda que la acción 2 dejó una **segunda mitad pendiente**. Sobrevive a
 * cerrar la pestaña porque ése es justamente el escenario que §32.5b tiene que poder contar
 * (CS-5): si la fase 1 terminó y la 2 nunca corrió, el aviso lo dice y ofrece la palanca.
 * ⚠ El límite es conocido y declarado (DEV-1): si el proceso de backend se reinició, no hay
 * `finishedAt` de nadie ⇒ `NO SE SABE`, jamás un verde optimista.
 */
export const FORCE_ALL_PENDING_KEY = 'm2.forceAll.phase1JobId';

function readPendingPhase1(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(FORCE_ALL_PENDING_KEY);
  } catch {
    return null;
  }
}

function writePendingPhase1(jobId: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (jobId == null) window.localStorage.removeItem(FORCE_ALL_PENDING_KEY);
    else window.localStorage.setItem(FORCE_ALL_PENDING_KEY, jobId);
  } catch {
    /* almacenamiento no disponible: la detección se degrada a la sesión en curso, no rompe nada */
  }
}

export function useCatalogSync() {
  const qc = useQueryClient();

  // --- Sección 1: disparo del ingest masivo de precios + estado del barrido de precios ---
  // N-14: tras disparar el ingest, el barrido tarda un instante en reportar `running:true` en el
  // backend. Sin esto, el `refetchInterval` (que solo poll-ea cuando YA vio running) se apagaba de
  // inmediato y la barra no aparecía hasta recargar. `justDispatched` fuerza el poll durante una
  // ventana de gracia hasta que el barrido asome (o hasta un tope, para no poll-ear infinito).
  const [justDispatched, setJustDispatched] = useState(false);

  const priceSyncStatus = useQuery({
    queryKey: ['price-sync-status'],
    queryFn: getPriceSyncStatus,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running || justDispatched ? 2000 : false),
  });
  const priceSweeping = priceSyncStatus.data?.running ?? false;

  useEffect(() => {
    if (justDispatched && priceSyncStatus.data?.running) setJustDispatched(false);
  }, [justDispatched, priceSyncStatus.data?.running]);

  useEffect(() => {
    if (!justDispatched) return;
    const timer = setTimeout(() => setJustDispatched(false), 30000);
    return () => clearTimeout(timer);
  }, [justDispatched]);

  const ingestMutation = useMutation({
    mutationFn: () => triggerPriceIngest(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      setJustDispatched(true);
      void priceSyncStatus.refetch();
    },
  });

  // --- §32 · estado de los dos barridos de catálogo ---
  // Barrido de CATÁLOGO (`sync-all`): es la acción 1 entera y la fase 1 de la acción 2. Se pollea
  // cada 3 s mientras `running`. Desde v1.66 trae `summary` (§M2-CS.1): sin él, la acción de
  // rutina sólo puede decir `NO SE SABE` — que es honesto, no cómodo.
  const syncStatus = useQuery({
    queryKey: ['catalog-sync-status'],
    queryFn: getSyncStatus,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const isSweeping = syncStatus.data?.running ?? false;

  // Barrido de VARIANTES (`refresh-variants-all`): la fase 2 de la acción 2. Status PROPIO.
  const [refreshAllDispatched, setRefreshAllDispatched] = useState(false);
  const refreshVariantsStatus = useQuery({
    queryKey: ['refresh-variants-status'],
    queryFn: getRefreshVariantsStatus,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.running || refreshAllDispatched ? 3000 : false,
  });
  const batchRunning = refreshVariantsStatus.data?.running ?? false;

  useEffect(() => {
    if (
      refreshAllDispatched &&
      (refreshVariantsStatus.data?.running || refreshVariantsStatus.data?.summary)
    ) {
      setRefreshAllDispatched(false);
    }
  }, [refreshAllDispatched, refreshVariantsStatus.data?.running, refreshVariantsStatus.data?.summary]);

  useEffect(() => {
    if (!refreshAllDispatched) return;
    const timer = setTimeout(() => setRefreshAllDispatched(false), 30000);
    return () => clearTimeout(timer);
  }, [refreshAllDispatched]);

  // Mientras hay un barrido en curso, refresca la tabla (cardCount/imported avanzan solos).
  const remoteSets = useQuery({
    queryKey: ['remote-sets'],
    queryFn: getRemoteSets,
    refetchInterval: isSweeping || batchRunning ? 5000 : false,
  });

  const onSweepLaunched = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    qc.invalidateQueries({ queryKey: ['remote-sets'] });
  }, [qc]);

  // --- ACCIÓN 1 · «Importar sets nuevos» (rutina, sin confirmación) ---
  // Barrido incremental acotado por el CORTE de catálogo (§M2-CS.4). El `202` hace eco de la
  // selección que lo rigió (`fromReleaseDate`), y es hoy la ÚNICA superficie donde el corte se
  // puede leer: `remote-sets` todavía no expone `catalogWindow` (§32.15, pendiente de backend).
  const importNewMutation = useMutation({
    mutationFn: () => syncAllCatalog(),
    onSuccess: onSweepLaunched,
  });

  // --- ACCIÓN 2 · «Sincronizar todo (forzar)» — DOS fases encadenadas por la pantalla ---
  const [forceAllPhase, setForceAllPhase] = useState<SyncPhase | null>(null);
  /** jobId de la fase 1 cuya fase 2 aún no ha corrido (persistido: sobrevive a cerrar la pestaña). */
  const [pendingPhase1, setPendingPhase1] = useState<string | null>(() => readPendingPhase1());

  const setPendingPhase1Job = useCallback((jobId: string | null) => {
    writePendingPhase1(jobId);
    setPendingPhase1(jobId);
  }, []);

  /**
   * `jobId` de la fase 2 lanzada por ESTA corrida. Sin él, el `summary` que el status devuelve
   * podría ser el del barrido ANTERIOR y se leería como resultado del nuevo: atribuir a una
   * corrida el trabajo de otra es la misma familia de mentira que §32 corrige.
   */
  const [phase2Job, setPhase2Job] = useState<string | null>(null);
  const refreshVariantsAllMutation = useMutation({
    mutationFn: () => refreshVariantsAll(),
    onSuccess: (data) => {
      setPhase2Job(data.jobId);
      setRefreshAllDispatched(true);
      setForceAllPhase('variants');
      // La deuda de la segunda mitad queda saldada en cuanto la fase 2 arranca de verdad.
      setPendingPhase1Job(null);
      void refreshVariantsStatus.refetch();
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
    },
    onError: () => setForceAllPhase(null),
  });

  const forceAllMutation = useMutation({
    mutationFn: () => syncAllCatalog({ force: true }),
    onSuccess: (data) => {
      setForceAllPhase('catalog');
      // Se anota ANTES de que la fase 1 termine: si el dueño cierra la pestaña a mitad, al volver
      // la pantalla puede decir que falta la segunda mitad en vez de dar el trabajo por bueno.
      setPendingPhase1Job(data.jobId);
      onSweepLaunched();
    },
    onError: () => setForceAllPhase(null),
  });

  // El batch async está OCUPADO desde que se dispara (POST) hasta que su STATUS PROPIO reporta
  // running:false — aunque el POST 202 ya haya vuelto. Gobierna loading/serialización/keep-alive.
  const batchBusy = refreshVariantsAllMutation.isPending || refreshAllDispatched || batchRunning;

  /** El status de la fase 2 **sólo** cuenta si es el del barrido que esta corrida lanzó. */
  const phase2Status =
    phase2Job != null && refreshVariantsStatus.data?.jobId === phase2Job
      ? refreshVariantsStatus.data
      : undefined;

  // La fase 2 ARRANCA SOLA cuando la fase 1 reporta `running:false` con la pantalla abierta
  // (§32.5b). Si la pantalla no está abierta no corre: el aviso lo detecta y ofrece la palanca —
  // detectarlo no es cumplirlo, y por eso §32.15 R4 pide el trabajo de dos fases en backend.
  const phase1Job = syncStatus.data?.jobId ?? null;
  const phase1Finished = syncStatus.data?.finishedAt ?? null;
  useEffect(() => {
    if (forceAllPhase !== 'catalog') return;
    if (pendingPhase1 == null || phase1Job !== pendingPhase1) return;
    if (isSweeping || phase1Finished == null) return;
    if (refreshVariantsAllMutation.isPending || batchRunning) return;
    refreshVariantsAllMutation.mutate();
    // `mutate` es estable; se depende de los hechos que disparan el encadenado, no del objeto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceAllPhase, pendingPhase1, phase1Job, phase1Finished, isSweeping, batchRunning]);

  // Cuando la fase 2 de ESTA corrida termina, se cierra la acción 2: a partir de ahí la vista
  // pinta el veredicto con las cifras. ⛔ No se cierra con un `summary` ajeno (ver `phase2Status`).
  useEffect(() => {
    if (forceAllPhase === 'variants' && !batchBusy && phase2Status?.summary != null) {
      setForceAllPhase(null);
    }
  }, [forceAllPhase, batchBusy, phase2Status]);

  const batchFinishedAt = refreshVariantsStatus.data?.finishedAt ?? null;
  useEffect(() => {
    if (!batchRunning && refreshVariantsStatus.data?.summary) {
      setForceAllPhase(null);
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
    }
    // Se dispara al cambiar `finishedAt` (un batch nuevo terminó), no en cada poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchFinishedAt]);

  /**
   * ⭐ «¿Falta la segunda mitad?» — derivable con lo que el contrato YA devuelve (§32.5b): la
   * fase 1 de ESTA acción terminó y la fase 2 no ha corrido después. Se compara contra el `jobId`
   * anotado al lanzar para no acusar de «segunda mitad pendiente» a un barrido de la acción 1,
   * que no promete precios y no tiene segunda mitad que echar de menos.
   */
  const secondHalfMissing =
    pendingPhase1 != null &&
    phase1Job === pendingPhase1 &&
    !isSweeping &&
    phase1Finished != null &&
    !batchRunning &&
    (refreshVariantsStatus.data?.finishedAt == null ||
      refreshVariantsStatus.data.finishedAt < phase1Finished);

  /**
   * ⚠ DEV-1: el estado de los barridos vive en memoria del proceso. Si backend se reinició, el
   * `jobId` anotado ya no existe en ningún status ⇒ **no se sabe** cómo terminó aquello. Nunca
   * `HECHO`, nunca `SIN CAMBIOS`: el aviso lo dice y manda a revisar la lista (CS-6).
   */
  const forceAllStateLost =
    pendingPhase1 != null && phase1Job !== pendingPhase1 && !isSweeping && !batchRunning;

  /** Palanca «Terminar la segunda mitad» (§32.5b). */
  const finishSecondHalf = useCallback(() => {
    setForceAllPhase('variants');
    refreshVariantsAllMutation.mutate();
  }, [refreshVariantsAllMutation]);

  /** Descarta la deuda de la segunda mitad que ya no se puede resolver (estado perdido). */
  const dismissPendingPhase1 = useCallback(() => setPendingPhase1Job(null), [setPendingPhase1Job]);

  // --- ACCIÓN 3 · «Sincronizar este set» (reparación, sin confirmación, SIEMPRE las dos fases) ---
  const [repairPhase, setRepairPhase] = useState<SyncPhase | null>(null);
  const repairSetMutation = useMutation({
    mutationFn: async (set: RemoteSetDTO): Promise<RepairSetResult> => {
      setRepairPhase('catalog');
      let catalog: PhaseOutcome<CatalogSyncResponse>;
      try {
        catalog = { ok: true, data: await syncCatalog({ setId: set.id, force: true }) };
      } catch (error) {
        // ⭐ Regla dura 4: una fase que NO depende de la fuente caída no se cancela porque la otra
        // falle. La fuente de catálogo (pokemontcg.io) y la de precios (TCGCSV) son distintas.
        catalog = { ok: false, error };
      }
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      setRepairPhase('variants');
      let variants: PhaseOutcome<RefreshVariantsResponse>;
      try {
        variants = { ok: true, data: await refreshVariants({ setId: set.id }) };
      } catch (error) {
        variants = { ok: false, error };
      }
      return { set, catalog, variants };
    },
    onSettled: () => {
      setRepairPhase(null);
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
    },
  });

  /** §32.7.5 — una operación de catálogo a la vez (serialización intacta de §19.8). */
  const catalogBusy =
    isSweeping ||
    priceSweeping ||
    ingestMutation.isPending ||
    importNewMutation.isPending ||
    forceAllMutation.isPending ||
    forceAllPhase != null ||
    repairSetMutation.isPending ||
    batchBusy;
  useKeepSessionAlive(catalogBusy);

  return {
    // Sección 1 (disparo de precios) + estado del barrido de precios
    ingestMutation,
    priceSyncStatus,
    // §32 · sincronización del catálogo
    remoteSets,
    syncStatus,
    isSweeping,
    refreshVariantsStatus,
    phase2Status,
    batchRunning,
    batchBusy,
    catalogBusy,
    importNewMutation,
    forceAllMutation,
    refreshVariantsAllMutation,
    forceAllPhase,
    secondHalfMissing,
    forceAllStateLost,
    finishSecondHalf,
    dismissPendingPhase1,
    repairSetMutation,
    repairPhase,
  } as const;
}

export type CatalogSync = ReturnType<typeof useCatalogSync>;
