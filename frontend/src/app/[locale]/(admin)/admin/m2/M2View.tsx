'use client';

import { useTranslations } from 'next-intl';
import { useCatalogSync } from './sections/useCatalogSync';
import { PriceIngestSection } from './sections/PriceIngestSection';
import { PendingQueueSection } from './sections/PendingQueueSection';
import { FxSection } from './sections/FxSection';
import { PricingCurveSection } from './curve/PricingCurveSection';
import { RarityHealthSection } from './sections/RarityHealthSection';
import { SealedSpreadsSection } from './sections/SealedSpreadsSection';
import { GradedEstimatesSection } from './sections/GradedEstimatesSection';
import { CatalogSyncSection } from './sections/CatalogSyncSection';

/**
 * M2 · Catálogo y precios (panel admin). TD-1: este orquestador solo compone las secciones y
 * comparte —vía `useCatalogSync`— el estado acoplado entre el disparo de precios (Sección 1) y los
 * grupos de sync de catálogo (serialización `catalogBusy`/`batchBusy`, keep-alive e invalidaciones).
 * Cada sección es dueña de su propio estado/queries; las invalidaciones cross-sección viajan por el
 * QueryClient compartido (p. ej. el override de precios refresca la cola pendiente, el ingest/refresh
 * de catálogo invalida `pending-prices`, y «Unificar rarezas» recompone los editores de compra/venta).
 * El orden de render se conserva EXACTO respecto del monolito previo (mismo DOM, misma UX).
 */
export function M2View() {
  const t = useTranslations('admin.m2');
  const catalog = useCatalogSync();

  return (
    <div className="flex flex-col gap-10">
      <h1 className="text-h1 font-bold">{t('title')}</h1>

      {/* Sección 1 · «Actualizar precios» (PRIMARIA · G3) */}
      <PriceIngestSection catalog={catalog} />

      {/* Sección 2 · cola de precio pendiente en DOS BUCKETS (P-6, v1.26) + modal de override */}
      <PendingQueueSection />

      {/* Sección 3 · FX */}
      <FxSection />

      {/* P-33: la Sección 3b («proveedor de respaldo») se RETIRÓ del panel por decisión del
          humano — TCGCSV sigue primario y PPT queda fijo como respaldo en el backend, sin
          control en UI. La ingesta a mano vive en la Sección 1 (PriceIngestSection). */}

      {/* Sección 4 · LA CURVA de precio por valor de mercado (v2.0, P-48, §21.1–§21.6). Ocupa el
          mismo lugar que los cuatro editores retirados (reglas de buylist, reglas de venta, precios
          por tier y mapa rareza→tier): el precio ya no depende de la rareza ni del acabado. */}
      <PricingCurveSection />

      {/* Sección 5 · salud del catálogo de rarezas (§21.7b) — solo lectura; respalda el guardarraíl
          y hospeda «Unificar rarezas» (§19.5), que dejó de colgar de un editor de precios. */}
      <RarityHealthSection />

      {/* Sección 5b · spreads de VENTA del SELLADO por presentación (v1.23-sealed-sales) */}
      <SealedSpreadsSection />

      {/* Sección 5c · config del «gancho de grading»: escalones de costo de gradeo + margen mínimo
          + frescura (v1.44-graded-estimate, criterio 110(e)). El interruptor maestro vive en M10. */}
      <GradedEstimatesSection />

      {/* §19 · los TRES grupos de sync de catálogo (Datos/Catálogo/Avanzado) + tabla de sets + modales */}
      <CatalogSyncSection catalog={catalog} />
    </div>
  );
}
