'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  triggerPriceIngest,
  getPriceSyncStatus,
  getRemoteSets,
  syncCatalog,
  backfillCatalog,
  syncAllCatalog,
  refreshVariants,
  refreshVariantsAll,
  getRefreshVariantsStatus,
  getSyncStatus,
} from '@/lib/api';
import type { RemoteSetDTO } from '@/types/contract';
import { useKeepSessionAlive } from '@/lib/keep-alive';

/**
 * TD-1 refactor: estado y orquestación COMPARTIDOS entre el disparo de precios (Sección 1) y los
 * grupos de sync de catálogo (Datos/Catálogo/Avanzado + tabla de sets). Ambos frentes están
 * acoplados por diseño: el «Sync completo» por-fila del catálogo arranca el barrido de PRECIOS
 * (justDispatched + priceSyncStatus.refetch), y `catalogBusy` —que gobierna el keep-alive— agrega
 * el barrido de precios Y todas las operaciones de catálogo. Se mantiene en UN solo hook para que
 * la serialización (`catalogBusy`/`batchBusy`), el keep-alive y las invalidaciones de queries sean
 * EXACTAS (comportamiento idéntico al monolito previo).
 */
export function useCatalogSync() {
  const qc = useQueryClient();

  // --- Sección 3b/1: disparo del ingest masivo de precios + estado del barrido de precios ---
  // N-14: tras disparar el ingest, el barrido tarda un instante en reportar `running:true` en el
  // backend. Sin esto, el `refetchInterval` (que solo poll-ea cuando YA vio running) se apagaba de
  // inmediato y la barra no aparecía hasta recargar. `justDispatched` fuerza el poll durante una
  // ventana de gracia hasta que el barrido asome (o hasta un tope, para no poll-ear infinito).
  const [justDispatched, setJustDispatched] = useState(false);

  // Estado del barrido MASIVO de precios (GET /admin/pricing/sync-status). Calca el patrón del
  // sync de catálogo: se POLLEA cada 3 s mientras `running` para pintar done/total en vivo y saber
  // CUÁNDO terminó. No llama al proveedor, así que pollearlo no consume presupuesto diario.
  const priceSyncStatus = useQuery({
    queryKey: ['price-sync-status'],
    queryFn: getPriceSyncStatus,
    retry: false,
    // Poll activo si el barrido corre O si acabamos de dispararlo (ventana de gracia hasta que el
    // backend reporte `running:true`). Al terminar (running:false y sin dispatch reciente) se apaga.
    refetchInterval: (query) => (query.state.data?.running || justDispatched ? 2000 : false),
  });
  const priceSweeping = priceSyncStatus.data?.running ?? false;

  // Una vez que el barrido está realmente en curso, suelta la bandera de gracia: a partir de ahí el
  // poll lo gobierna `running` (y se detiene solo al terminar).
  useEffect(() => {
    if (justDispatched && priceSyncStatus.data?.running) setJustDispatched(false);
  }, [justDispatched, priceSyncStatus.data?.running]);

  // Red de seguridad anti-poll-infinito: si tras disparar el barrido nunca asoma `running` (p. ej.
  // terminó tan rápido que no lo vimos, o el disparo no encoló nada), la gracia caduca sola.
  useEffect(() => {
    if (!justDispatched) return;
    const timer = setTimeout(() => setJustDispatched(false), 30000);
    return () => clearTimeout(timer);
  }, [justDispatched]);

  const ingestMutation = useMutation({
    mutationFn: () => triggerPriceIngest(),
    // El ingest repuebla PriceReference → puede resolver pendientes; refresca esa cola.
    // Además arranca de inmediato el poll del estado del barrido de precios (refetch YA, sin esperar
    // recarga) y marca `justDispatched` para que el poll no se apague antes de que el barrido asome.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
      setJustDispatched(true);
      void priceSyncStatus.refetch();
    },
  });

  // --- Sección 6: sync de catálogo ---
  // Estado del barrido `sync-all` (GET /admin/catalog/sync-status). Se POLLEA cada 3 s
  // mientras `running` para saber en vivo cuántos sets faltan y CUÁNDO terminó (lo que
  // pedía el operador: "saber que acabó"). El endpoint puede no existir aún en backend
  // (404/405): en ese caso no se pinta la barra (retry:false + isError → nada). No llama
  // a pokemontcg.io, así que pollearlo no consume rate-limit.
  const syncStatus = useQuery({
    queryKey: ['catalog-sync-status'],
    queryFn: getSyncStatus,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const isSweeping = syncStatus.data?.running ?? false;

  // RV-ALL: el batch «Refrescar variantes + precios de TODO» es ASÍNCRONO. El POST solo lo arranca
  // (202); el progreso y el resumen se leen por su STATUS PROPIO GET /refresh-variants-status (NO el
  // sync-status de sync-all). Se POLLEA cada 3 s mientras `running`, o durante una ventana de gracia
  // tras disparar (hasta que el backend reporte `running:true`), calcando el patrón N-14 de precios.
  const [refreshAllDispatched, setRefreshAllDispatched] = useState(false);
  const refreshVariantsStatus = useQuery({
    queryKey: ['refresh-variants-status'],
    queryFn: getRefreshVariantsStatus,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.running || refreshAllDispatched ? 3000 : false,
  });
  const batchRunning = refreshVariantsStatus.data?.running ?? false;

  // Suelta la bandera de gracia en cuanto el status refleja el batch disparado: bien porque ya está
  // `running` (a partir de ahí el poll lo gobierna `running`), bien porque terminó tan rápido que
  // llegó directo con `summary` (evita que el banner "corriendo" conviva con el resumen final).
  useEffect(() => {
    if (
      refreshAllDispatched &&
      (refreshVariantsStatus.data?.running || refreshVariantsStatus.data?.summary)
    ) {
      setRefreshAllDispatched(false);
    }
  }, [refreshAllDispatched, refreshVariantsStatus.data?.running, refreshVariantsStatus.data?.summary]);

  // Red anti-poll-infinito: si tras disparar nunca asoma `running` (terminó tan rápido que no lo
  // vimos, o no encoló nada), la gracia caduca sola.
  useEffect(() => {
    if (!refreshAllDispatched) return;
    const timer = setTimeout(() => setRefreshAllDispatched(false), 30000);
    return () => clearTimeout(timer);
  }, [refreshAllDispatched]);

  // El batch async está OCUPADO desde que se dispara (POST) hasta que su STATUS PROPIO reporta
  // running:false — aunque el POST 202 ya haya vuelto. Gobierna loading/serialización/keep-alive.
  // (declarado abajo, tras las mutaciones que lo componen)

  // Mientras hay un barrido en curso, refresca la tabla (cardCount/imported avanzan solos).
  const remoteSets = useQuery({
    queryKey: ['remote-sets'],
    queryFn: getRemoteSets,
    // Refresca la tabla mientras hay un barrido (sync-all) o el batch de variantes en curso:
    // cardCount/imported avanzan solos.
    refetchInterval: isSweeping || batchRunning ? 5000 : false,
  });
  const catalogSyncMutation = useMutation({
    mutationFn: (setId?: string) => syncCatalog(setId ? { setId } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  const backfillMutation = useMutation({
    mutationFn: () => backfillCatalog({ batchSize: 10 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['remote-sets'] }),
  });
  // Tras lanzar un barrido (sync-all / force), arranca de inmediato el poll del estado
  // (invalida la query) y refresca la tabla; el barrido corre en segundo plano en backend.
  const onSweepLaunched = () => {
    qc.invalidateQueries({ queryKey: ['catalog-sync-status'] });
    qc.invalidateQueries({ queryKey: ['remote-sets'] });
  };
  // v1.3: sync-all puede no existir en backend; se usa condicionalmente y su fallo
  // no rompe la vista (se muestra aviso). Ver contrato §M2.
  const syncAllMutation = useMutation({
    mutationFn: () => syncAllCatalog(),
    onSuccess: onSweepLaunched,
  });
  // v1.6-finish: re-sync FORZADO (contrato §M2, `force=true`): reprocesa TODO el catálogo
  // (incluidos sets ya importados) para repoblar metadata, cartas y variantes estructurales
  // (availableFinishes vía resolver TCGCSV + reconcile). ⛔ v1.27: NO repuebla precios (desde
  // v1.14/§4.15g el pricing vive SOLO en price-ingest). Operación pesada → confirmación (modal).
  const syncAllForceMutation = useMutation({
    mutationFn: () => syncAllCatalog({ force: true }),
    onSuccess: onSweepLaunched,
  });

  // --- P-12 (v1.27): «Sync completo» POR SET = cartas + variantes → precios ---
  // Encadena las DOS fases del flujo recomendado del contrato (§M2 v1.27): (1) POST
  // /admin/catalog/sync { setId, force:true } → metadata + cartas + variantes estructurales
  // TCGCSV del set; (2) POST /admin/jobs/price-ingest { setId } → precios del set COMPLETO
  // (bypass del scope <2020 de ppt-sync-scope). Feedback HONESTO por fase: se reporta qué fase
  // corre, cuál falló y si el ingest NO encoló (single-flight) — nunca un "202 cosmético".
  const [fullSyncPhase, setFullSyncPhase] = useState<'catalog' | 'prices' | null>(null);
  const fullSyncMutation = useMutation({
    mutationFn: async (set: RemoteSetDTO) => {
      setFullSyncPhase('catalog');
      const catalog = await syncCatalog({ setId: set.id, force: true });
      // Fase 1 OK: refresca la tabla (imported/cardCount) sin esperar la fase 2.
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      setFullSyncPhase('prices');
      const ingest = await triggerPriceIngest({ setId: set.id });
      return { catalog, ingest };
    },
    onSuccess: (data) => {
      setFullSyncPhase(null);
      if (data.ingest.enqueued) {
        // El ingest repuebla PriceReference → puede resolver pendientes; además arranca YA el
        // poll del barrido de precios (misma mecánica N-14 que el disparo global de arriba).
        qc.invalidateQueries({ queryKey: ['pending-prices'] });
        setJustDispatched(true);
        void priceSyncStatus.refetch();
      }
    },
    // En error NO se limpia fullSyncPhase: el banner reporta EN QUÉ fase falló (catalog|prices).
  });

  // --- P-13: «Refrescar variantes + precios» POR SET usando SOLO TCGCSV (sin pokemontcg.io) ---
  // Endpoint SÍNCRONO POST /admin/catalog/refresh-variants { setId }: repuebla variantes/acabados y
  // precios de un set YA importado desde TCGCSV, SIN re-importar cartas ni depender de pokemontcg.io.
  // Existe para desbloquear el arreglo del "fantasma" de un set (variantes/precios faltantes) cuando
  // pokemontcg.io está caído — algo que el «Sync completo» (cartas pokemontcg.io + TCGCSV) no permite.
  // Devuelve un RESUMEN honesto (cards procesadas, productos, precios, pendientes) que se pinta tal cual.
  const refreshVariantsMutation = useMutation({
    mutationFn: (set: RemoteSetDTO) => refreshVariants({ setId: set.id }),
    onSuccess: () => {
      // Repuebla variantes + PriceReference → puede resolver/mover pendientes y cambia el conteo del set.
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
    },
  });

  // --- RV-ALL: «Refrescar variantes + precios de TODO» usando SOLO TCGCSV (batch, sin pokemontcg.io) ---
  // Corre el mismo trabajo que el refresh por-set (variantes/acabados + precios desde TCGCSV, SIN
  // re-importar cartas ni depender de pokemontcg.io) sobre TODO el catálogo YA importado. Es ASÍNCRONO
  // (POST /admin/catalog/refresh-variants-all → 202 { jobId, setsQueued, remaining }): el POST solo lo
  // arranca; el progreso y el RESUMEN AGREGADO honesto (sets ok/fallidos, productos, precios,
  // pendientes, `failures`) se leen por su STATUS PROPIO (poll de refreshVariantsStatus). Masivo →
  // confirmación (modal). Al disparar arranca YA el poll (refetch + ventana de gracia, patrón N-14).
  const refreshVariantsAllMutation = useMutation({
    mutationFn: () => refreshVariantsAll(),
    onSuccess: () => {
      setRefreshAllDispatched(true);
      void refreshVariantsStatus.refetch();
      // El batch repuebla variantes + PriceReference de TODO el catálogo → refresca la tabla; la cola
      // de pendientes se invalida al terminar (cuando el status reporta running:false).
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
    },
  });

  // Cuando el batch TERMINA (running pasa a false teniendo un summary), refresca la tabla y la cola de
  // pendientes: el barrido repobló variantes/precios y pudo resolver/mover pendientes.
  const batchFinishedAt = refreshVariantsStatus.data?.finishedAt ?? null;
  useEffect(() => {
    if (!batchRunning && refreshVariantsStatus.data?.summary) {
      qc.invalidateQueries({ queryKey: ['remote-sets'] });
      qc.invalidateQueries({ queryKey: ['pending-prices'] });
    }
    // Se dispara al cambiar `finishedAt` (un batch nuevo terminó), no en cada poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchFinishedAt]);

  // El batch async está OCUPADO desde que se dispara (POST) hasta que su STATUS PROPIO reporta
  // running:false — aunque el POST 202 ya haya vuelto. Gobierna loading/serialización/keep-alive.
  const batchBusy = refreshVariantsAllMutation.isPending || refreshAllDispatched || batchRunning;

  // El operador mira el barrido de catálogo (o espera un backfill/sync por set, que son
  // requests síncronos largos) SIN interactuar → sin esto, el auto-logout por inactividad
  // (5 min) lo sacaría a mitad de la operación. Mientras haya una operación de catálogo en
  // curso, mantenemos viva la sesión; al terminar, el idle-logout vuelve a la normalidad.
  const catalogBusy =
    isSweeping ||
    priceSweeping ||
    ingestMutation.isPending ||
    catalogSyncMutation.isPending ||
    backfillMutation.isPending ||
    syncAllMutation.isPending ||
    syncAllForceMutation.isPending ||
    fullSyncMutation.isPending ||
    refreshVariantsMutation.isPending ||
    batchBusy;
  useKeepSessionAlive(catalogBusy);

  return {
    // Sección 1 (disparo de precios) + estado del barrido de precios
    ingestMutation,
    priceSyncStatus,
    // Catálogo (grupos + tabla + modales)
    remoteSets,
    syncStatus,
    isSweeping,
    refreshVariantsStatus,
    batchRunning,
    batchBusy,
    catalogBusy,
    catalogSyncMutation,
    backfillMutation,
    syncAllMutation,
    syncAllForceMutation,
    fullSyncPhase,
    fullSyncMutation,
    refreshVariantsMutation,
    refreshVariantsAllMutation,
  } as const;
}

export type CatalogSync = ReturnType<typeof useCatalogSync>;
