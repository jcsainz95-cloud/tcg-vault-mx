import type { LocationView, PreparationItemDTO, PreparationOrderDTO } from '@/types/contract';

/**
 * **Orden de «Pedidos a preparar»** (contrato **§M4-PREP**, `DESIGN_SYSTEM §35.2/§35.4`).
 *
 * ⭐ **Vive en `lib/` y no dentro de la vista por una razón medida, no por gusto.** El techlead
 * contó **tres** fuentes para un mismo orden: el backend (`shipments.service.ts`), estas funciones
 * dentro del componente, y **un tercer comparador escrito a mano en la rama mock de
 * `getAdminPreparationQueue`**. Tres copias de una regla es la forma exacta de que dos se queden
 * atrás sin que nadie lo note. Aquí quedan **dos**: el servidor —que es quien manda— y **una sola**
 * copia de cliente que usan **la vista y el servidor falso**, así que el mock ya no puede
 * «equivocarse mejor» que el código que sirve.
 *
 * ⚠️ **Por qué el cliente ordena, si el servidor ya ordena** (decisión aprobada por el techlead y
 * ratificada por ux-ui en §35.13): el orden *lo más viejo primero* es un **criterio de aceptación de
 * producto** (CA #9), y anclarlo donde el operador lo ve es lo que lo hace verificable en la
 * pantalla. Ordenar una lista **completa** es idempotente: aplicarlo sobre datos ya ordenados no
 * cambia nada.
 *
 * 🔴 **Y ahí está su única condición de validez, que hoy NO está en el código: esto es correcto
 * SOLO mientras la cola NO pagine.** Sobre una página, ordenar en el cliente **destruye el orden
 * global** (el mismo `DESIGN_SYSTEM` lo prohíbe para una pantalla paginada, §28.2a). Si alguien
 * pagina `GET /admin/shipments/picking-list`, **estas funciones se retiran** — ver `M4P-SORT` en
 * `docs/TECH_DEBT.md`.
 */

/**
 * Clave de orden de una ubicación. `null` = la pieza **no tiene** ubicación a la que caminar.
 *
 * ⭐ **v1.78.2 — una sola pregunta, y es TOTAL.** `LocationView` pasó a **unión discriminada**
 * (`{kind:'assigned'; label: string} | {kind:'unassigned'}`), así que `kind === 'assigned'`
 * **basta**: en ese brazo `label` es `string` obligatorio. ⛔ **Se retira el `&& location.label`**
 * que había aquí: un predicado sobre el campo vuelve a admitir el estado que el tipo acaba de
 * borrar, y era **una de las cuatro ramas defensivas** que el techlead midió como coste del tipo
 * flojo. *El invariante ya no vive en este comentario: vive en el tipo.*
 */
function locationSortKey(location: LocationView): string | null {
  return location.kind === 'assigned' ? location.label : null;
}

/**
 * Orden NORMATIVO de los pedidos: `requestedAt` **asc** — lo más viejo primero (CA #9).
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
