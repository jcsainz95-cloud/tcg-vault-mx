'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminPreparationQueue } from '@/lib/api';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { FinishMark } from '@/components/domain/FinishMark';
import { formatAge, formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type {
  LocationView,
  PreparationDestination,
  PreparationItemDTO,
  PreparationOrderDTO,
} from '@/types/contract';

/**
 * **«Pedidos a preparar»** — la hoja de trabajo del operador (contrato **§M4-PREP** v1.78 ·
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
 * ⛔ **Rebanada de SOLO LECTURA.** Palomear cartas, firmar el pedido como preparado, sugerir
 * ubicación de bóveda y el reembolso parcial por carta faltante **no se construyen aquí** (§M4-PREP,
 * recuadro «PLANEADO»). Esta pantalla no tiene ni un verbo de escritura.
 */

/** §32.4: lo desconocido es «—», nunca omitido en silencio. */
const DASH = '—';

/** Cubeta elegida por el operador (CA #8). `''` = ambas (⇒ `?destination` ausente). */
type Bucket = '' | PreparationDestination;

const BUCKETS: { value: Bucket; labelKey: 'filterAll' | 'filterVault' | 'filterShip' }[] = [
  { value: '', labelKey: 'filterAll' },
  { value: 'ship', labelKey: 'filterShip' },
  { value: 'vault', labelKey: 'filterVault' },
];

/**
 * Clave de orden de una ubicación. `null` = la pieza **no tiene** ubicación utilizable, y eso
 * incluye el caso defensivo `kind:'assigned'` **sin** `label` (el contrato declara `label?`
 * opcional): sin etiqueta no se puede caminar hacia ella, así que se trata igual que `unassigned`
 * — al final de la lista — en vez de colarse arriba con una cadena vacía.
 */
function locationSortKey(location: LocationView): string | null {
  return location.kind === 'assigned' && location.label ? location.label : null;
}

/**
 * Orden NORMATIVO de los pedidos: `requestedAt` **asc** — lo más viejo primero (CA #9).
 *
 * El backend ya lo sirve así (§M4-PREP). Se repite aquí **a propósito** y no es «dos fuentes para
 * un hecho»: el orden de la cola es el criterio de aceptación #9, y anclarlo en la pantalla es lo
 * que lo hace verificable *donde el operador lo ve*. Si el servidor cambiara de orden, la pantalla
 * seguiría cumpliendo el criterio en vez de heredar el defecto en silencio.
 *
 * Una `requestedAt` inválida va **al final**: una fecha que no se puede leer no es «la más vieja».
 */
export function sortPreparationOrders(orders: PreparationOrderDTO[]): PreparationOrderDTO[] {
  const at = (o: PreparationOrderDTO) => {
    const ms = Date.parse(o.requestedAt);
    return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms;
  };
  return orders.slice().sort((a, b) => at(a) - at(b));
}

/** Cartas del pedido por ubicación (asignadas primero y ordenadas; las sin ubicar, al final). */
export function sortPreparationItems(items: PreparationItemDTO[]): PreparationItemDTO[] {
  return items.slice().sort((a, b) => {
    const ka = locationSortKey(a.currentLocation);
    const kb = locationSortKey(b.currentLocation);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka.localeCompare(kb);
  });
}

export function PreparationQueue() {
  const t = useTranslations('admin.m4.prep');
  const tm4 = useTranslations('admin.m4');
  const locale = useLocale() as AppLocale;
  const [bucket, setBucket] = useState<Bucket>('');

  const queue = useQuery({
    queryKey: ['admin-preparation-queue', bucket],
    queryFn: () => getAdminPreparationQueue({ destination: bucket || undefined }),
  });

  const orders = sortPreparationOrders(queue.data ?? []);

  /**
   * El vacío de la cubeta **bóveda** tiene copy propio, y ese copy es un HECHO medido, no un
   * consuelo: bajo el modelo actual las compras a bóveda **no generan cola de preparación** (§M4-PREP,
   * hallazgo del arquitecto 2026-09-22). Un «nada pendiente» genérico dejaría al operador sin saber
   * si la cola está al día o si la pantalla se rompió, y la respuesta correcta no es ninguna de las
   * dos: ahí todavía no hay nada que preparar **por diseño**.
   */
  const emptyKey = bucket === 'vault' ? 'emptyVault' : bucket === 'ship' ? 'emptyShip' : 'empty';

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-h2 font-semibold">{t('title')}</h2>
          <p className="text-sm text-muted">{t('hint')}</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="prep-bucket-label" className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            {t('filterLabel')}
          </span>
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

      <QueryState
        isLoading={queue.isLoading}
        isError={queue.isError}
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
        {orders.length === 0 ? (
          <EmptyState tone="positive" title={t(`${emptyKey}.title`)} body={t(`${emptyKey}.body`)} />
        ) : (
          <>
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted" role="status">
              {t('orderCount', { count: orders.length })}
            </p>
            <ol className="flex flex-col gap-4">
              {orders.map((order) => (
                <li key={order.shipmentId}>
                  <PreparationCard order={order} locale={locale} t={t} tm4={tm4} />
                </li>
              ))}
            </ol>
          </>
        )}
      </QueryState>
    </section>
  );
}

type Translator = ReturnType<typeof useTranslations>;

function PreparationCard({
  order,
  locale,
  t,
  tm4,
}: {
  order: PreparationOrderDTO;
  locale: AppLocale;
  t: Translator;
  tm4: Translator;
}) {
  const fullName = order.customer.fullName?.trim() || DASH;
  const lastName = order.customer.lastName?.trim();
  // La dirección solo existe (y solo se pinta) en destino ENVÍO — CA #6.
  const shipTo = order.destination === 'ship' ? order.shipTo : undefined;

  return (
    <article
      data-testid={`prep-order-${order.shipmentId}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-1.5">
          {/* Destino de un vistazo (DECISIÓN #1): es del PEDIDO, nunca de la carta. */}
          <Badge tone={order.destination === 'vault' ? 'success' : 'primary'} shape="outline">
            {t(`destination.${order.destination}`)}
          </Badge>
          <div className="flex flex-wrap items-baseline gap-2">
            {/* Folio del pedido; en un RETIRO DE BÓVEDA no hay orden ⇒ se dice lo que es, no un hueco. */}
            {order.orderNumber ? (
              <span className="tabular text-lg font-semibold text-text">{order.orderNumber}</span>
            ) : (
              <span className="font-serif text-lg text-text">{t('withdrawal')}</span>
            )}
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              {t('shipmentRef')} <span className="tabular">{order.shipmentId}</span>
            </span>
          </div>
        </div>
        {/* Antigüedad legible (CA #9) + la fecha absoluta al lado: el «hace N días» nunca la sustituye. */}
        <p className="flex flex-col items-start gap-0.5 text-sm sm:items-end">
          <span className="font-medium text-text">{formatAge(order.requestedAt, locale)}</span>
          <time dateTime={order.requestedAt} className="text-xs text-muted">
            {t('requestedAt')} {formatDate(order.requestedAt, locale) || DASH}
          </time>
        </p>
      </header>

      {/* Cliente: el APELLIDO manda (archivero alfabético). `lastName` es DERIVADO y puede venir
          `null` (§6.A: no hay apellido estructurado en el modelo) — entonces se dice que no se pudo
          identificar y se deja el nombre completo, ⛔ nunca «null» ni un hueco mudo. */}
      <div data-testid={`prep-customer-${order.shipmentId}`} className="flex flex-col gap-0.5">
        {lastName ? (
          <p className="font-serif text-2xl leading-tight text-text">{lastName}</p>
        ) : (
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            {t('lastNameUnknown')}
          </p>
        )}
        <p className="text-sm text-muted">{fullName}</p>
      </div>

      {shipTo && (
        // ⛔ NO va en un <address>: el HTML reserva ese elemento para los datos de contacto DEL
        // artículo/documento, no para una dirección postal arbitraria de un tercero.
        <div
          data-testid={`prep-address-${order.shipmentId}`}
          className="flex flex-col gap-0.5 text-sm text-muted"
        >
          {/* `recipientName` es nullable (snapshots de 8 campos anteriores a v1.67): si no viene, la
              línea NO se pinta vacía — el bloque «cliente» de arriba ya nombra a la persona. */}
          {shipTo.recipientName && (
            <p>
              <span className="font-medium text-text">{tm4('recipient')}</span>{' '}
              <span className="text-text">{shipTo.recipientName}</span>
            </p>
          )}
          {/* CA #6: la CALLE, que la fila de hoy omite. `line2`/`neighborhood` son nullable ⇒ se
              filtran en vez de dejar comas colgando. */}
          <p className="text-text">
            {[shipTo.line1, shipTo.line2, shipTo.neighborhood]
              .map((p) => p?.trim())
              .filter((p): p is string => Boolean(p))
              .join(', ') || DASH}
          </p>
          <p>
            {shipTo.city}, {shipTo.state} · {tm4('postalCode')}{' '}
            <span className="tabular">{shipTo.postalCode}</span> · {shipTo.country}
          </p>
          <p>
            {tm4('phone')} <span className="tabular">{shipTo.phone}</span>
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          {t('itemCount', { count: order.items.length })}
        </p>
        <ul className="flex flex-col gap-3">
          {sortPreparationItems(order.items).map((item) => (
            <PreparationItem key={item.shipmentItemId} item={item} t={t} />
          ))}
        </ul>
      </div>
    </article>
  );
}

function PreparationItem({ item, t }: { item: PreparationItemDTO; t: Translator }) {
  const { card, currentLocation } = item;
  // CA #11: «UNASSIGNED» ya no viaja como código — y tampoco se pinta. `kind:'assigned'` sin
  // `label` (declarado opcional) se lee como sin ubicar: no hay etiqueta que seguir.
  const located = currentLocation.kind === 'assigned' && Boolean(currentLocation.label);

  return (
    <li
      data-testid={`prep-item-${item.shipmentItemId}`}
      className="flex gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
    >
      {/* `imageSmallUrl` es nullable por contrato: sin foto queda el pozo de papel (CardImage ya
          NO pulsa sin `src`), nunca un roto ni un esqueleto eterno. */}
      <CardImage src={card.imageSmallUrl} alt={card.name} className="w-16 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-serif text-lg leading-tight text-text" lang="en">
          {card.name}
        </p>
        {/* El SET va PROMINENTE: al armar el paquete se busca por carpeta de set (§4 del producto).
            Datos de catálogo no se traducen (DESIGN_SYSTEM §9.2) ⇒ lang="en". */}
        <p className="text-sm font-semibold text-text" lang="en">
          {card.setName ?? DASH}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <FinishMark finish={card.finish} band={false} />
          {/* ⛔ La condición NO se recompone aquí: viene ya compuesta del back (`conditionLabel`,
              graded/raw/sealed). Repetir esa precedencia en el front sería la segunda fuente. */}
          <span className="text-text">{card.conditionLabel}</span>
          {/* `quantity` es constante 1 bajo el modelo actual: se pinta SOLO si alguna vez no lo es. */}
          {item.quantity !== 1 && <span className="tabular">×{item.quantity}</span>}
        </p>
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          {t('folio')} <span className="tabular">{item.folio}</span>
          {' · '}
          {t('location')}{' '}
          {located ? (
            <span className="tabular text-text">{currentLocation.label}</span>
          ) : (
            <span className="text-accent">{t('unassigned')}</span>
          )}
        </p>
      </div>
    </li>
  );
}
