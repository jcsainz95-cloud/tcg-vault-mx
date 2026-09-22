'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { getAdminPreparationQueue } from '@/lib/api';
import { ApiClientError } from '@/lib/api-client';
import { QueryState } from '@/components/ui/QueryState';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { CardImage } from '@/components/ui/CardImage';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { FinishMark } from '@/components/domain/FinishMark';
import { formatAge, formatDate } from '@/lib/format';
// El orden vive en `lib/` para que la vista y el servidor falso usen LA MISMA regla
// (tres fuentes → dos). Su condición de validez —la cola no pagina— está allí y en
// `docs/TECH_DEBT.md` (`M4P-SORT`).
import { sortPreparationItems, sortPreparationOrders } from '@/lib/preparation-order';
import { cn } from '@/lib/cn';
import type { AppLocale } from '@/i18n/routing';
import type {
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

/**
 * Tono del **RÓTULO** (§35.3 regla 1: *el valor pesa más que su etiqueta*). Vive en una constante
 * para que ningún bloque vuelva a invertir la relación por descuido: los rótulos («Destinatario»,
 * «CP», «Tel», «Ubicación», «Folio») se leen **una vez en la vida**; los valores, **cada vez**.
 */
const LABEL = 'font-mono text-[11px] uppercase tracking-[0.06em] text-muted';

/** Cubeta elegida por el operador (CA #8). `''` = ambas (⇒ `?destination` ausente). */
type Bucket = '' | PreparationDestination;

const BUCKETS: { value: Bucket; labelKey: 'filterAll' | 'filterVault' | 'filterShip' }[] = [
  { value: '', labelKey: 'filterAll' },
  { value: 'ship', labelKey: 'filterShip' },
  { value: 'vault', labelKey: 'filterVault' },
];

export function PreparationQueue() {
  const t = useTranslations('admin.m4.prep');
  const tm4 = useTranslations('admin.m4');
  const tc = useTranslations('common');
  const locale = useLocale() as AppLocale;
  const [bucket, setBucket] = useState<Bucket>('');

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
  const corruptRow = queue.error instanceof ApiClientError && queue.error.status === 409;

  /**
   * Un copy de vacío por cubeta: las tres situaciones son distintas (§35.8).
   *
   * ⚠️ **P-1 — el de BÓVEDA es el delicado, y la versión anterior afirmaba de más.** Decía «No hay
   * nada pendiente ni nada roto»: acertaba en *nada roto* y **afirmaba sin base** en *nada
   * pendiente*. Lo medido (`API_CONTRACT §M4-PREP`) es que **no existe artefacto** que diga si una
   * compra a bóveda está pendiente de colocar ⇒ el sistema **no sabe** si hay trabajo físico
   * esperando. **Un estado vacío afirma solo lo que el sistema sabe**: puede decir «esta lista no
   * tiene nada», ⛔ **no puede decir «no hay trabajo»** si nadie lo mide. Tranquilizar sobre trabajo
   * que nadie cuenta es el error más caro de un vacío en una superficie de operación. Copy
   * normativo en §35.8; el candado es **PR-1**.
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
           * ⚠️⚠️ **PENDIENTE-UX — la COSTURA está hecha, la REDACCIÓN no es mía.**
           * §M4-PREP v1.78.2 dice, con todas las letras, que **la redacción la decide ux-ui** y que
           * su sitio es `DESIGN_SYSTEM §35.8` («Carga, error y vacío»), que ya separa el vacío del
           * error. Lo que el contrato **sí** fija —y es lo que queda cableado aquí— es que este
           * estado sea **distinguible de una cola vacía** y que el operador **no se quede creyendo
           * que terminó su trabajo**.
           *
           * Mientras llega el copy se pinta **el mensaje del servidor**, que ⛔ no es copy inventada:
           * es el dato, y el contrato dice que **`shipmentId` viaja en él y es la pista** para
           * soporte. Es la misma costura que funcionó con el «—» de `fullName` (§35.6a): rama
           * aislada, `data-testid`, marca `PENDIENTE-UX` y ⛔ **ningún candado que fije un
           * provisional** — los de abajo asertan lo que es cierto con CUALQUIER redacción.
           */
          <div
            data-testid="prep-corrupt-row"
            role="alert"
            className="flex flex-col gap-3 border border-accent bg-surface p-4"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
              {/* PENDIENTE-UX: marca provisional tomada del código del contrato, ⛔ no redactada. */}
              {queue.error instanceof ApiClientError ? queue.error.code : 'CONFLICT'}
            </p>
            <p className="text-sm text-text">
              {queue.error instanceof ApiClientError ? queue.error.message : ''}
            </p>
            <div>
              <Button size="sm" variant="secondary" onClick={() => queue.refetch()}>
                {tc('retry')}
              </Button>
            </div>
          </div>
        ) : orders.length === 0 ? (
          // P-6: ⛔ sin `tone`. `EmptyState` lo acepta por compatibilidad y **no lo pinta** — la
          // dirección 5a retiró los rellenos de color (§2.1) y §35.8 corrige el «verde suave» de
          // §8.1: el vacío positivo se comunica con el texto y el aire, no con color.
          <EmptyState title={t(`${emptyKey}.title`)} body={t(`${emptyKey}.body`)} />
        ) : (
          <>
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
  /**
   * ⭐ §M4-PREP **v1.78.1** — `customer.fullName` es `string | null`, y `null` es la **única** marca
   * de ausencia. ⛔ La cadena vacía está **PROHIBIDA** por el contrato; si llegara igual (servidor no
   * conforme) se lee como ausencia, que es la lectura segura: ⛔ nunca se pinta un hueco invisible.
   */
  const fullNameMissing = order.customer.fullName === null || order.customer.fullName.trim() === '';
  const fullName = order.customer.fullName?.trim() ?? '';
  const lastName = order.customer.lastName?.trim();
  // La dirección solo existe (y solo se pinta) en destino ENVÍO — CA #6.
  const shipTo = order.destination === 'ship' ? order.shipTo : undefined;

  return (
    <article
      data-testid={`prep-order-${order.shipmentId}`}
      /* P-9 / §35.10: sin nombre, un lector de pantalla anuncia «artículo» N veces seguidas. El
         nombre es el folio — o «Retiro de bóveda», que es lo que ocupa su lugar cuando no hay orden. */
      aria-labelledby={`prep-ref-${order.shipmentId}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col items-start gap-1.5">
          {/* Destino de un vistazo (DECISIÓN #1): es del PEDIDO, nunca de la carta. */}
          {/* P-5 / §2.4: **los dos destinos van en `primary`**. El verde es el ÚNICO color positivo
              del sistema (§2.1: confirmado/liquidado) y gastarlo en un destino —que no es un estado—
              diluye la señal que sostiene la confianza en las pantallas de dinero. Los distingue **la
              palabra** en versalitas: el color nunca es el portador del significado. */}
          <Badge tone="primary" shape="outline">
            {t(`destination.${order.destination}`)}
          </Badge>
          <div className="flex flex-wrap items-baseline gap-2">
            {/* Folio del pedido; en un RETIRO DE BÓVEDA no hay orden ⇒ se dice lo que es, no un hueco. */}
            {order.orderNumber ? (
              <span id={`prep-ref-${order.shipmentId}`} className="tabular text-lg font-semibold text-text">
                {order.orderNumber}
              </span>
            ) : (
              <span id={`prep-ref-${order.shipmentId}`} className="font-serif text-lg text-text">
                {t('withdrawal')}
              </span>
            )}
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              {t('shipmentRef')} <span className="tabular">{order.shipmentId}</span>
            </span>
          </div>
        </div>
        {/* Antigüedad legible (CA #9) + la fecha absoluta al lado: el «hace N días» nunca la sustituye. */}
        <p className="flex flex-col items-start gap-0.5 text-sm sm:items-end">
          {/* P-7 / §32.4: `formatAge` devuelve `''` con una fecha ilegible, y la línea quedaba EN
              BLANCO mientras la de abajo sí caía a «—». Y ese pedido es justo el que el orden manda
              **al final**: el más sospechoso se quedaba sin nada que leer. Candado: **PR-5**. */}
          <span className="font-medium text-text">{formatAge(order.requestedAt, locale) || DASH}</span>
          <time dateTime={order.requestedAt} className="text-xs text-muted">
            {t('requestedAt')} <span>{formatDate(order.requestedAt, locale) || DASH}</span>
          </time>
        </p>
      </header>

      {/*
        * **Plano 1 · quién** (§35.3). El APELLIDO manda porque es la llave del archivero alfabético.
        *
        * ⭐ **§35.6a-e — UNA ausencia, UNA frase: las dos de este plano son MUTUAMENTE EXCLUYENTES.**
        * `lastNameUnknown` («no supe partir el nombre — míralo tú debajo») **solo tiene sentido si hay
        * nombre completo debajo**; sin él apunta a un remedio que no está en la tarjeta, y además
        * **afirma de más** (insinúa que el sistema tiene el nombre y falló al derivarlo, cuando el
        * hecho es más duro: nunca lo hubo). Y hay una razón de operación por encima de las dos: **dos
        * líneas de ausencia apiladas se cuentan como dos averías**, y una tarjeta que parece rota se
        * salta. ⇒ la condición del apellido es «no hay apellido **pero sí** nombre completo».
        */}
      <div data-testid={`prep-customer-${order.shipmentId}`} className="flex flex-col gap-0.5">
        {lastName ? (
          <p className="font-serif text-2xl leading-tight text-text">{lastName}</p>
        ) : (
          !fullNameMissing && (
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              {t('lastNameUnknown')}
            </p>
          )
        )}
        {fullNameMissing ? (
          /*
           * ⭐⭐ **§35.6a — LA AUSENCIA SE NOMBRA, y ⛔ NO se pinta con un guion.** Cierra la no
           * conformidad que este código llevaba marcada `PENDIENTE-UX` (§M4-PREP v1.78.1 prohíbe el
           * «—» mudo). ux-ui va **más lejos que el contrato** y prohíbe el guion **del todo** aquí, con
           * tres motivos que no son de gusto: (1) en este sistema el em dash **ya está ocupado por el
           * dinero** —«precio pendiente», §16.3a— y **se lee como cero**; (2) §32.4-H4 pide «—» porque
           * su sujeto es **una cifra que ocuparía columna**, y esto es **una línea de prosa sin
           * retícula** (precedente §25.7(c): versalita + oración, sin glifo de valor); (3) un guion
           * **no distingue las dos causas** —derivación fallida vs. dato que nunca se capturó—, que son
           * averías distintas.
           *
           * **El hecho que el copy transmite:** *no es que el cliente no tenga nombre — es que la
           * tienda no lo guardó.* Comprador invitado con `addressSnapshot` en el formato viejo de ocho
           * campos; el operador tiene el pedido, la dirección y las cartas, y lo único que le falta es
           * **a nombre de quién** empaqueta. Leerlo como «hueco del registro» y no como «cliente
           * anónimo» lleva a dos conductas distintas.
           *
           * **Tonos, y la escalada ES información** (§35.6a-d): la marca va en `accent` —*el dato no
           * existe y no hay de dónde sacarlo*, misma semántica que «Sin ubicar»— y ⛔ **no** en `muted`
           * como `lastNameUnknown`, que significa *el dato está debajo y lo cazas a ojo*. La frase va en
           * **tinta**: §10 prohíbe `muted` para información esencial, y ésta lo es — es lo único que
           * impide rotular el paquete a nombre de nadie.
           *
           * ⛔ Y lo que la frase NO dice es lo más importante que tiene: no manda a buscar el nombre a
           * ninguna parte, porque **no existe hoy pantalla que lo recupere** (`guestEmail` no se pinta
           * en ninguna vista de `(admin)`, medido por ux-ui). Mandar a un camino no medido sería la
           * misma falta que §35.8 le corrigió al vacío de bóveda.
           */
          <div data-testid={`prep-fullname-missing-${order.shipmentId}`} className="flex flex-col gap-0.5">
            {/*
              * §35.6a-f · **dos nodos de BLOQUE**, uno tras otro: la separación entre marca y frase
              * ⛔ **no puede venir de un `gap`** — el texto accesible concatena los nodos sin el aire
              * del CSS y produce cadenas pegadas. Es el defecto «ParaAsh Ketchum» de esta misma
              * pantalla, convertido en norma. Candado: **PR-9**.
              *
              * Las versalitas las pone el CSS (`uppercase`), ⛔ **no** la cadena en mayúsculas: hay
              * lectores de pantalla que deletrean la caja alta.
              */}
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">
              {t('nameMissing.tag')}
            </p>{' '}
            {/*
              * ⚠️ **Ese `{' '}` entre dos bloques no es decorativo, y tampoco es un rodeo del test.**
              * `textContent` **no inserta separador entre elementos de bloque**: dos `<p>` seguidos
              * concatenan «…registradoLa dirección…». Para un lector que recorre el documento eso no
              * es un problema (los bloques se enuncian por separado), pero **sí** lo es para todo
              * consumidor que aplane el nodo a una cadena — que es justo lo que hace el candado
              * **PR-9**, y lo que hace el cálculo de nombre accesible si algún día este bloque se
              * usa como tal. §35.6a-f lo dice literal: *el espacio que separa dos palabras tiene que
              * existir en el DOM, no en la hoja de estilo*. En un contenedor flex un nodo de texto
              * con solo espacios **no se renderiza como ítem** ⇒ coste visual **cero**.
              */}
            <p className="text-sm text-text">{t('nameMissing.body')}</p>
          </div>
        ) : (
          /* P-4b / §35.6: `text-text`, ⛔ ya no `muted`. El apellido grande de arriba es **derivado**
             («último token»), y en México eso entrega el apellido **materno** cuando el archivero se
             ordena por el **paterno**. El nombre completo es el ÚNICO dato con el que el operador
             caza ese error a ojo ⇒ no puede pintarse como secundario. ⛔ El TAMAÑO del apellido no se
             toca: esa jerarquía está ratificada. */
          <p className="text-sm text-text">{fullName}</p>
        )}
      </div>

      {shipTo && (
        /*
         * ⭐ **P-4 / §35.5 — ESTA DIRECCIÓN SE TRANSCRIBE A MANO, y por eso NO puede ir en `muted`.**
         * En este sistema **no hay impresión de etiquetas**: el operador copia la calle, el CP y el
         * teléfono de la pantalla al paquete o a la ventanilla del transportista. Un dato que se lee
         * **dígito a dígito** no se pinta en el tono de lo secundario — la diferencia entre `muted` y
         * `text-text` aquí no es estética, es **la probabilidad de equivocar un CP**.
         *
         * La regla que invierte lo que había: **el VALOR pesa más que su RÓTULO.** «Destinatario»,
         * «CP» y «Tel» son rótulos (mono 11px `muted`, se leen una vez en la vida); lo que sigue va
         * en `text-text` con `tabular` (se lee cada vez). Candado: **PR-4**.
         *
         * ⛔ NO va en un <address>: el HTML reserva ese elemento para los datos de contacto DEL
         * artículo/documento, no para la dirección postal de un tercero.
         */
        <div
          data-testid={`prep-address-${order.shipmentId}`}
          className="flex flex-col gap-1 text-sm text-text"
        >
          {/* `recipientName` es nullable (snapshots de 8 campos anteriores a v1.67): si no viene, la
              línea NO se pinta vacía — el bloque «cliente» de arriba ya nombra a la persona. Una
              línea «Destinatario: —» parecería una avería (§35.3). */}
          {shipTo.recipientName && (
            /* ⚠️ El espacio entre rótulo y valor es un `{' '}` REAL, no un `gap` de flex: con el
               hueco pintado por CSS el texto accesible queda pegado («ParaAsh Ketchum») y un lector
               de pantalla lo lee así. El aire visual puede venir del layout; **la separación de
               palabras, no**. */
            <p>
              <span className={LABEL}>{tm4('recipient')}</span>{' '}
              <span>{shipTo.recipientName}</span>
            </p>
          )}
          {/* CA #6: la CALLE completa y en su propia línea, primera del bloque — es el dato que la
              pantalla anterior omitía y el que hace la dirección utilizable. `line2`/`neighborhood`
              son nullable ⇒ se filtran en vez de dejar comas colgando. */}
          <p>
            {[shipTo.line1, shipTo.line2, shipTo.neighborhood]
              .map((p) => p?.trim())
              .filter((p): p is string => Boolean(p))
              .join(', ') || DASH}
          </p>
          <p>
            {shipTo.city}, {shipTo.state} · <span className={LABEL}>{tm4('postalCode')}</span>{' '}
            <span className="tabular">{shipTo.postalCode}</span> · {shipTo.country}
          </p>
          <p>
            <span className={LABEL}>{tm4('phone')}</span>{' '}
            <span className="tabular">{shipTo.phone}</span>
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
  // CA #11: «UNASSIGNED» ya no viaja como código — y tampoco se pinta.
  // ⭐ v1.78.2: `LocationView` es unión discriminada ⇒ `kind === 'assigned'` **basta** (ahí `label`
  // es `string` obligatorio). ⛔ Se retira el `&& Boolean(currentLocation.label)` que había aquí:
  // era la segunda de las ramas defensivas que el tipo flojo obligaba a escribir.
  const located = currentLocation.kind === 'assigned';

  return (
    <li
      data-testid={`prep-item-${item.shipmentItemId}`}
      className="flex flex-col gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4"
    >
      {/*
        * ⭐⭐ **P-3 / §35.4 — LA UBICACIÓN VA PRIMERO Y FORMA COLUMNA.** Es lo único de esta pantalla
        * que el operador usa **mientras camina**, y era el dato **menos visible** de la tarjeta:
        * último renglón, mono 11px, `muted`, detrás del folio.
        *
        * ⚠️ **No era un problema de contraste** —`muted` sobre papel da ~4.8:1 y cumple AA (§10)—
        * **era de jerarquía**: `muted` es por definición el tono de lo **secundario**, y la ubicación
        * es **el criterio de orden de la lista**. *Lo que ordena una lista tiene que formar columna*:
        * enterrada al final de un párrafo, el orden existe pero no se ve, y el operador vuelve a
        * recorrer la tarjeta entera por cada carta. ⛔ Y **no se trunca nunca**: es corta y es una
        * llave. Candado: **PR-3** (la ubicación se renderiza ANTES que el folio en el DOM).
        */}
      <div
        data-testid={`prep-location-${item.shipmentItemId}`}
        className="flex shrink-0 flex-col gap-0.5 sm:w-32"
      >
        <span className={LABEL}>{t('location')}</span>
        {located ? (
          <span className="tabular text-sm text-text">{currentLocation.label}</span>
        ) : (
          /* «Sin ubicar» en bermellón —*esto te va a costar trabajo*— y **al mismo tamaño** que una
             ubicación real: es una excepción que se atiende, no una nota al pie. Su carta va al final
             del pedido, que es donde el recorrido la encuentra. */
          <span className="text-sm text-accent">{t('unassigned')}</span>
        )}
      </div>
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
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <FinishMark finish={card.finish} band={false} />
          {/* ⛔ La condición NO se recompone aquí: viene ya compuesta del back (`conditionLabel`,
              graded/raw/sealed). Repetir esa precedencia en el front sería la segunda fuente. */}
          <span className="text-text">{card.conditionLabel}</span>
          {/* `quantity` es constante 1 bajo el modelo actual: se pinta SOLO si alguna vez no lo es. */}
          {item.quantity !== 1 && <span className="tabular text-text">×{item.quantity}</span>}
        </p>
        {/* El folio baja DETRÁS de la ubicación: es el dato de **cotejo en mano** (ya con la carta
            delante), no de recorrido. Se lee de cerca ⇒ mono 11px muted es su sitio. */}
        <p className={LABEL}>
          {t('folio')} <span className="tabular">{item.folio}</span>
        </p>
      </div>
    </li>
  );
}
