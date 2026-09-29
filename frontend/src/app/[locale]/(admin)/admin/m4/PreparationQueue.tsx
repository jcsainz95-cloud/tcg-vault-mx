'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminPreparationQueue } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Banner } from '@/components/ui/Banner';
// El orden vive en `lib/` para que la vista y el servidor falso usen LA MISMA regla
// (tres fuentes → dos). Su condición de validez —la cola no pagina— está allí y en
// `docs/TECH_DEBT.md` (`M4P-SORT`).
import { sortPreparationItems, sortPreparationOrders } from '@/lib/preparation-order';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type { PreparationDestination, ShipPreparationOrderDTO } from '@/types/contract';
import { Link } from '@/i18n/navigation';
import { LABEL } from './prep-shared';
import { VaultPlacementCard, type QueueNotice } from './VaultPlacementCard';
import { ShipPreparationCard } from './ShipPreparationCard';

/**
 * **«Pedidos por preparar»** — la hoja de trabajo del operador (contrato **§M4-PREP** v1.78 ·
 * `GET /admin/shipments/picking-list`, `PROJECT.md` §«Pedidos a preparar», CA #6/#8/#9/#11).
 *
 * **Una tarjeta = UN pedido**, no una fila por pieza: el operador arma un paquete completo, y la
 * lista plana ordenada por ubicación le obligaba a reconstruir mentalmente a qué pedido pertenecía
 * cada carta. Las cartas van anidadas dentro de su pedido y ordenadas por ubicación, así que el
 * beneficio de «caminar la bóveda en orden» **no se pierde**: se conserva dentro del paquete.
 *
 * ⚠️ La ruta interna sigue diciendo `picking-list` (decisión del arquitecto, §M4-PREP). El
 * renombrado es de cara al operador: en pantalla **no aparece la palabra «picking»**.
 *
 * ⭐ **§M4-VAULT (v1.79):** la cubeta «Para bóveda» tiene su tarjeta con verbos
 * (`VaultPlacementCard`, `DESIGN_SYSTEM §36`): palomear, «Pedido preparado», «Deshacer preparado» y
 * «Confirmar colocación». ⭐ **§M4-SHIP (v1.80, `DESIGN_SYSTEM §37`):** la tarjeta de **ENVÍO** deja de
 * ser de solo lectura (`ShipPreparationCard`): palomear con «Llegó dañada», «Pedido preparado» con la
 * cifra del servidor, «Deshacer preparado» y «Capturar guía».
 */

/** Cubeta elegida por el operador (CA #8). `''` = ambas (⇒ `?destination` ausente). */
export type Bucket = '' | PreparationDestination;

const BUCKETS: { value: Bucket; labelKey: 'filterAll' | 'filterVault' | 'filterShip' }[] = [
  { value: '', labelKey: 'filterAll' },
  { value: 'ship', labelKey: 'filterShip' },
  { value: 'vault', labelKey: 'filterVault' },
];

export function PreparationQueue({
  onCaptureGuide,
  initialBucket = '',
}: {
  /** §37.3a: «Capturar guía» del paso 2 abre el MISMO diálogo de `admin.m4.tracking.*` que la cola de envíos. */
  onCaptureGuide: (order: ShipPreparationOrderDTO) => void;
  initialBucket?: Bucket;
}) {
  const t = useTranslations('admin.m4.prep');
  const ts = useTranslations('admin.m4.prep.ship');
  const locale = useLocale() as AppLocale;
  const [bucket, setBucket] = useState<Bucket>(initialBucket);
  /**
   * §36.8 — el AVISO DE RESULTADO (o de «ya no está pendiente», §36.9) queda ENCIMA de la lista:
   * la tarjeta sale de ella y el resultado no puede irse con ella. El último sustituye al anterior;
   * se cierra a mano. `seq` fuerza el remontaje para que un aviso cerrado pueda volver a abrirse.
   */
  const [notice, setNotice] = useState<(QueueNotice & { seq: number }) | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const pushNotice = (n: QueueNotice) => setNotice((prev) => ({ ...n, seq: (prev?.seq ?? 0) + 1 }));
  // §36.12: al salir la tarjeta de la lista, el foco va al aviso de resultado.
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const queue = useQuery({
    queryKey: ['admin-preparation-queue', bucket],
    queryFn: () => getAdminPreparationQueue({ destination: bucket || undefined }),
    /**
     * ⭐ **P-2 / DESIGN_SYSTEM §35.9 — una superficie que promete actualizarse sola tiene que
     * actualizarse sola.** El cliente global fija `refetchOnWindowFocus: false`
     * (`Providers.tsx:12`); **esta cola lo sobrescribe**, con el precedente exacto de
     * `hooks/usePendings.ts:38`, que ya hace la misma excepción para las pendientes del
     * back-office y por el mismo motivo: **volver a la ventana ES el gesto de «¿hay algo
     * nuevo?»**. Sin esto, un operador con la pestaña abierta en el mostrador mira una lista
     * muerta toda la tarde mientras el copy del vacío le dice que los nuevos aparecen solos.
     *
     * ⛔ **Sin `refetchInterval`**, y es deliberado (§35.9): un sondeo de fondo gasta en una
     * pantalla que pasa horas abierta sin nadie delante, y el foco ya cubre el caso real.
     *
     * ⚠️ **`true`, no `'always'` — y la distinción se midió, no se supuso.** Llegué a poner
     * `'always'` creyendo que `true` no cumplía la promesa (PR-6 se quedaba en **1** llamada). Era
     * **falso**: el `1` venía de que la prueba despachaba `visibilitychange` en `document`, y
     * `query-core@5.101.4` lo escucha en **`window`** (`focusManager.js:12`). Con el evento en su
     * sitio, **`true` pasa igual** ⇒ ⛔ no hay motivo para desviarse de la letra de §35.9 ni del
     * precedente citado (`usePendings.ts:38`, que también usa `true` con `staleTime: 30_000`).
     *
     * **Lo que `true` significa de verdad, dicho para que nadie lo lea de más:** re-pide al volver
     * a la ventana **si la consulta está obsoleta**; con el `staleTime: 30_000` global
     * (`Providers.tsx:12`) eso es *«a partir de 30 s»*, no *«en cada parpadeo»*. Es la conducta
     * que §35.9 pide y la que evita una petición por cada alt-tab. ⚠️ **El candado PR-6 no puede
     * ver ese matiz**: el cliente de pruebas (`test/render.tsx`) no fija `staleTime`, así que ahí
     * la consulta nace obsoleta. PR-6 mide **el cableado** (que la cola se re-pide en el gesto),
     * ⛔ no la ventana de frescura de producción.
     */
    refetchOnWindowFocus: true,
  });

  const orders = sortPreparationOrders(queue.data ?? []);

  /**
   * ⭐⭐ **§M4-PREP v1.78.2 — el `409` de FILA CORRUPTA, que ⛔ NO se pinta como «cola vacía».**
   *
   * Una fila con `orderId` cuyo `Order.fulfillmentMode` no es `direct_ship` viola un invariante, y
   * el endpoint rechaza **la petición ENTERA** —no solo esa cubeta—. El contrato **prohíbe
   * expresamente** degradar: ni pintar vacío, ni tratarlo como un error de red genérico.
   *
   * **Y el motivo no es de pulcritud.** Degradar convierte una violación de invariante en **una
   * lista más corta**, y en una cola de preparación una lista más corta se lee **igual** que «no hay
   * nada que preparar». El resultado sería **un envío ya cobrado que nunca sale por la puerta**,
   * con el operador convencido de que terminó. Por eso tiene que ser **distinguible de
   * `200 {data:[]}`** — que es, literalmente, lo que el contrato fija que el consumidor garantice.
   */
  /**
   * §35.15.8 punto 1: **los DOS términos**, `status` **y** `code`. El código `CONFLICT` es **compartido
   * entre endpoints** (`§M4-PREP v1.78.2`: *un cuerpo, muchos lectores*) — el mismo gobierna el `409`
   * de §M5-T—, así que lo que nombra ESTE hecho es **código + endpoint**, y el endpoint lo sabe el
   * cliente. ⛔ Cualquier otro error sigue cayendo en `QueryState`, con su «Reintentar» intacto.
   */
  const corruptRow =
    queue.error instanceof ApiClientError &&
    queue.error.status === 409 &&
    queue.error.code === 'CONFLICT';

  /**
   * Evidencia del `<details>` (§35.15.5(c)), por orden de preferencia: `details.shipmentId` →
   * `message` verbatim → **nada** (y entonces el cajón ⛔ no se pinta: nunca un cajón vacío ni un «—»).
   * ⚠️ **Hoy es siempre la segunda rama**: el contrato declara que el cuerpo del `409` es
   * `{error:{code,message}}` y que `details:{shipmentId, fulfillmentMode}` es deuda no bloqueante.
   * Por eso la frase de acción ⛔ **no** dice «con la referencia de abajo» — es la única redacción que
   * se rompería si el cajón faltara.
   */
  const conflictError = corruptRow ? (queue.error as ApiClientError) : null;
  const conflictShipmentId =
    typeof conflictError?.details?.shipmentId === 'string' ? conflictError.details.shipmentId : null;
  const conflictMessage = conflictError?.message?.trim() || null;

  /**
   * Un copy de vacío por cubeta: las tres situaciones son distintas (§35.8).
   *
   * ⭐ **§36.10 — el vacío de BÓVEDA se reescribe, y ahora SÍ puede afirmar que no hay trabajo.** El
   * texto anterior («Esta cubeta todavía no se alimenta») era cierto cuando no existía artefacto que
   * contara las compras a bóveda pendientes de colocar (P-1). Con `§M4-VAULT` cada compra a bóveda
   * pagada nace con su `VaultPlacement` pendiente y solo sale al colocarse o cancelarse ⇒ la cubeta
   * **cuenta el trabajo**, y dejar el texto viejo sería afirmar algo que dejó de ser verdad. El
   * candado es **PV-12**.
   */
  const emptyKey = bucket === 'vault' ? 'vault.emptyVault' : bucket === 'ship' ? 'emptyShip' : 'empty';

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2 font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted">{t('hint')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span id="prep-bucket-label" className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              {t('filterLabel')}
            </span>
            {/* §37.11c — la hoja imprimible: la misma cola, en papel, sin precios ni correos ni teléfonos. */}
            <Link
              href={{ pathname: '/admin/m4/print', query: bucket ? { destination: bucket } : undefined }}
              className="inline-flex min-h-[44px] items-center border border-text px-3.5 text-[10px] font-medium uppercase tracking-label text-text hover:bg-text hover:text-primary-fg print:hidden"
            >
              {ts('print.cta')}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="prep-bucket-label">
            {BUCKETS.map((b) => {
              const active = bucket === b.value;
              return (
                <button
                  key={b.value || 'all'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setBucket(b.value)}
                  className={cn(
                    'inline-flex min-h-[44px] items-center border px-3.5 text-xs font-medium transition-colors',
                    active
                      ? 'border-text bg-text text-primary-fg'
                      : 'border-border-strong text-text hover:border-text',
                  )}
                >
                  {t(b.labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/*
        * ⭐ **P-8 / PR-2 / §35.10 — la región viva está SIEMPRE montada, y por eso vive FUERA de
        * `QueryState`.** Dentro no bastaba: al cambiar de cubeta cambia la clave de la consulta ⇒
        * `isLoading` ⇒ `QueryState` sustituye a TODOS sus hijos por el esqueleto y **desmonta la
        * región**; una región que se remonta con su contenido **no se anuncia de forma fiable**, que
        * es exactamente el defecto que P-8 venía a cerrar. *(Lo descubrió el candado PR-2 al exigir
        * que fuera el MISMO nodo antes y después, no «una región con el texto nuevo».)*
        *
        * Mientras carga no anuncia nada (cadena vacía): afirmar «esta cubeta no se alimenta» antes
        * de que llegue la respuesta sería decirle al operador algo que todavía no se sabe.
        */}
      <p
        className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted"
        role="status"
        data-testid="prep-live-region"
      >
        {queue.isLoading || queue.isError
          ? '' /* ⛔ ni el conteo ni un título de vacío mientras carga o si hubo error: un `409` de
                  fila corrupta NO es «cero pedidos», y anunciarlo así sería el mismo engaño. */
          : orders.length === 0
            ? t(`${emptyKey}.title`)
            : t('orderCount', { count: orders.length })}
      </p>

      {notice && (
        <div ref={noticeRef} tabIndex={-1} data-testid="prep-notice" className="outline-none focus-visible:shadow-focus">
          <Banner key={notice.seq} variant={notice.role === 'alert' ? 'warning' : 'info'} role={notice.role} dismissible>
            <p className={LABEL}>
              {t('vault.orderRef')} <span className="tabular">{notice.folio}</span>
            </p>
            {notice.lines.map((line) => (
              <p key={line} className="text-sm text-text">
                {line}
              </p>
            ))}
          </Banner>
        </div>
      )}

      <QueryState
        isLoading={queue.isLoading}
        isError={queue.isError && !corruptRow}
        error={queue.error}
        onRetry={() => queue.refetch()}
        loading={
          // §8.1: el esqueleto respeta el layout final (tarjeta por pedido), no un spinner.
          <div className="flex flex-col gap-4" data-testid="prep-loading">
            {[0, 1].map((i) => (
              <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-20 w-full" />
              </div>
            ))}
          </div>
        }
      >
        {corruptRow ? (
          /*
           * ⭐⭐ **§35.15 — LA COLA BLOQUEADA, que ⛔ NO es una cola vacía.** Copy normativo de
           * §35.15.1/.2, copiado del documento **carácter por carácter** (con un extractor, ⛔ no
           * transcrito). Sustituye a la costura `PENDIENTE-UX` que este sitio llevaba.
           *
           * **P-13, y era un defecto VIVO:** hasta ahora esto caía en `QueryState`, que ante
           * cualquier error pinta «Algo salió mal» + «Hubo un conflicto con el estado actual» +
           * «Reintentar» — **literalmente lo que el contrato prohíbe**: un error genérico de red
           * delante de un envío ya cobrado que nadie va a preparar.
           *
           * ⛔ **El copy NO vive en `error.CONFLICT_OPERATOR`**, y la trampa está medida (§35.15.3):
           * `M5View.tsx` llama `useErrorMessage('operator')` y `_OPERATOR` tiene **precedencia** sobre
           * la base ⇒ esta redacción aterrizaría en la **mesa de buylist**, diciéndole al operador que
           * «hay pedidos cobrados esperando» cuando lo único que pasó es que una solicitud estaba
           * cerrada. *El copy va en `error.<CODE>` cuando el CÓDIGO nombra el hecho; va en la pantalla
           * cuando lo nombra código + endpoint.*
           */
          <Banner variant="danger" role="alert" title={t('conflict.title')}>
            <div data-testid="prep-conflict" className="flex flex-col gap-2">
              {/*
                * ⚠️ **`text-text` EXPLÍCITO, y no es capricho.** `Banner` envuelve a todos sus hijos
                * en `text-muted` y solo el `title` va en tinta (`Banner.tsx:56-58`, re-medido en este
                * pase). Dejar en tono **secundario** la frase que impide que el operador se vaya a su
                * casa es el mismo defecto que P-4, P-4b y PR-10 cerraron en esta pantalla.
                * ⛔ NO se modifica `Banner`: es compartido y su convención sirve al resto del sistema.
                * Candado: **PR-15**.
                */}
              <p className="text-sm font-medium text-text">{t('conflict.impact')}</p>
              <p>{t('conflict.body')}</p>
              <p>{t('conflict.action')}</p>
              {/*
                * §32.4c / §35.15.5(c): el identificador ⛔ no va en la frase que lee el operador —para
                * él un UUID es ruido y no lo puede buscar en ninguna pantalla—, pero es **lo único que
                * identifica el renglón** para quien repara. Mismo mueble, mismo rótulo y mismo sitio
                * que M2: `<details>` **cerrado** al pie. Si no hay ni campo ni mensaje, ⛔ no se pinta
                * el cajón. Candado: **PR-14**.
                */}
              {(conflictShipmentId || conflictMessage) && (
                <details data-testid="prep-conflict-detail">
                  <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    {t('conflict.technicalDetail')}
                  </summary>
                  {conflictShipmentId ? (
                    <p className="mt-1 text-xs">
                      <span className={LABEL}>{t('shipmentRef')}</span>{' '}
                      {/* Un identificador ⛔ no lleva `lang`: no es idioma, es un código (§35.10). */}
                      <span className="tabular">{conflictShipmentId}</span>
                    </p>
                  ) : (
                    /* Inglés de desarrollador ⇒ `lang="en"` (§9.2), y por eso va PLEGADO y rotulado
                       como técnico: la prohibición de §26.6(7) es sobre **la frase**, no sobre el
                       cajón de la evidencia. */
                    <p className="mt-1 font-mono text-xs" lang="en">
                      {conflictMessage}
                    </p>
                  )}
                </details>
              )}
            </div>
          </Banner>
        ) : orders.length === 0 ? (
          // P-6: ⛔ sin `tone`. `EmptyState` lo acepta por compatibilidad y **no lo pinta** — la
          // dirección 5a retiró los rellenos de color (§2.1) y §35.8 corrige el «verde suave» de
          // §8.1: el vacío positivo se comunica con el texto y el aire, no con color.
          <EmptyState title={t(`${emptyKey}.title`)} body={t(`${emptyKey}.body`)} />
        ) : (
          <>
            <ol className="flex flex-col gap-4">
              {orders.map((order) =>
                order.destination === 'ship' ? (
                  <li key={`ship-${order.shipmentId}`}>
                    <ShipPreparationCard order={order} locale={locale} onNotice={pushNotice} onCaptureGuide={onCaptureGuide} />
                  </li>
                ) : (
                  <li key={`vault-${order.placementId}`}>
                    <VaultPlacementCard order={order} locale={locale} onNotice={pushNotice} />
                  </li>
                ),
              )}
            </ol>
          </>
        )}
      </QueryState>
    </section>
  );
}
