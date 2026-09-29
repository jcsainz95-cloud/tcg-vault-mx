import { NameSource } from '@prisma/client';
import { nullIfBlank } from '../shipments/preparation-view';

/**
 * ⭐ `customerDisplayName` — API_CONTRACT §M4-VAULT.3 «Nombre y apellido» (v1.79.2) y H-1 (v1.79.3).
 *
 * `nameSource === 'derived'` ⇒ **`null`**: el alta con Google llegó sin nombre y el servidor guardó
 * `email.split('@')[0]` — es un nombre FABRICADO, no uno que alguien dijo. Presentarlo como nombre en
 * la pantalla del operador es justo lo que la regla existe para impedir (`juan.perez95` parece un
 * nombre y no lo es). Cualquier otro origen ⇒ `nullIfBlank(name)` (el valor tal cual, sin recortar).
 *
 * **UNA función, un cuerpo** — la usan las cinco fuentes que el contrato enumera: la tarjeta `vault`
 * de la cola (`customer.fullName`), la vista física (`owner.name`), `GET /admin/vaults` (`name`),
 * `GET /admin/vaults/:userId/sealed` y las dos `master-sets` de la vista admin (ii) (`owner.name`).
 * ⛔ Nada de repetir el ternario en cada servicio: cinco copias son cinco sitios donde olvidarlo.
 * ⛔ No aplica a operadores (`preparedBy.name`/`placedBy.name`: `nullIfBlank` a secas) ni a la vista
 * (iii) del propio cliente (sigue con `User.name`).
 */
export function customerDisplayName(user: {
  name: string;
  nameSource?: NameSource | null;
}): string | null {
  return user.nameSource === 'derived' ? null : nullIfBlank(user.name);
}

/**
 * Orden de dos clientes por su nombre mostrado (H-1, §M1 `GET /admin/vaults`): los que tienen nombre
 * primero (entre ellos, la comparación que ya usaba la lista: `localeCompare`), los `null` **al final**
 * y entre ellos por `email` en **unidades de código**, luego `userId`. ⛔ Nunca compara `null` como
 * cadena. Con nombres iguales, también desempata por `email` y `userId` (orden total, estable).
 */
export function compareByDisplayName(
  a: { name: string | null; email: string; userId: string },
  b: { name: string | null; email: string; userId: string },
): number {
  if (a.name !== null && b.name === null) return -1;
  if (a.name === null && b.name !== null) return 1;
  if (a.name !== null && b.name !== null) {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
  }
  if (a.email !== b.email) return a.email < b.email ? -1 : 1;
  if (a.userId !== b.userId) return a.userId < b.userId ? -1 : 1;
  return 0;
}
