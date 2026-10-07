/**
 * restock-subscribe.ts — errata v1.87.3⟨wishlist⟩ (API_CONTRACT §WSH.7 (f), WSH-T42 candado (a)). Propiedad: backend.
 *
 * El ÚNICO sitio de `backend/test/**` que golpea `POST /catalog/sealed/restock-subscriptions`. El cuerpo es EXACTAMENTE el de
 * la pantalla: `{ email, inventoryItemId }` (`RestockSubscriptionInput` de `frontend/src/lib/api.ts`). La identidad del
 * producto la deriva el servidor de esa pieza; una prueba no puede volver a apuntarse con un cuerpo que la pantalla no manda
 * (el defecto B-1: T25/T26 se suscribían con `tcgplayerProductId` y por eso nunca vieron la clave `c:` de la pantalla).
 *
 * `postRestockExpectingRejection` existe SOLO para WSH-T42 (4) («el cuerpo viejo ⇒ 400»); el candado
 * `test/wishlist.source-locks.spec.ts` fija que no tiene otro llamador.
 */
import { E2EHarness } from './e2e-app';

const RESTOCK_PATH = '/catalog/sealed/restock-subscriptions';

/** El cuerpo de la pantalla: dos claves, ni una más. */
export interface RestockBody {
  email: string;
  inventoryItemId: string;
}

export function restockBody(email: string, inventoryItemId: string): RestockBody {
  return { email, inventoryItemId };
}

/** Apuntarse como lo hace la pantalla (el `json` se arma de las dos claves, no del objeto recibido). */
export function subscribeRestock(h: E2EHarness, body: RestockBody, token?: string) {
  return h.api('POST', RESTOCK_PATH, { token, json: { email: body.email, inventoryItemId: body.inventoryItemId } });
}

/** ⛔ Solo WSH-T42 (4): manda un cuerpo que el servidor DEBE rechazar con `400`. */
export function postRestockExpectingRejection(h: E2EHarness, json: Record<string, unknown>) {
  return h.api('POST', RESTOCK_PATH, { json });
}
