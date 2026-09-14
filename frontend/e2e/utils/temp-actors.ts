import { randomBytes } from 'node:crypto';
import { IS_REAL, apiAs } from './env';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ACTORES DESECHABLES CON CONTRASEÑA TEMPORAL — el arreglo de GA-D3 (hallazgo MENOR de
 * la segunda pasada de QA: «el conteo de saltadas baila entre corridas del MISMO código»).
 *
 * EL DEFECTO, DICHO CON SU MECANISMO. `account.spec.ts` medía el bloqueo de §33.8 con los
 * DOS actores compartidos del seed (`temporal.customer@e2e.local` / `temporal.operator@e2e.local`)
 * y el flujo que mide **consume la temporal**: al terminar, esas cuentas ya tienen definitiva y
 * `mustChangePassword=false`. O sea, la suite **destruye su propio fixture al ejercerlo**. La
 * consecuencia no es un rojo: es que la corrida siguiente encuentra `401 INVALID_CREDENTIALS`,
 * los cuatro casos se SALTAN con su razón… y el informe del gate sigue diciendo «verde».
 *
 *     ► La cobertura del gate dependía de CUÁNDO se sembró por última vez, no del código.
 *     ► Primera corrida tras `--seed`: los 4 miden. Segunda y siguientes: los 4 no miden.
 *
 * POR QUÉ NO SE ARREGLA SEMBRANDO. `./scripts/stack-native.sh up --seed` **borra** filas de
 * evidencia (PoC/pentest) y reinicia cupos mensuales que otras suites consumen. Pedirle a la
 * suite de la cuenta que resiembre el stack entero para poder medirse es romper a los demás.
 *
 * QUÉ SE HACE EN SU LUGAR. Cada corrida se fabrica **su propio actor**, por la API del contrato
 * y con el flujo real del producto: `POST /admin/users` **sin `password`** ⇒ el backend autogenera
 * una temporal de alta entropía, la devuelve UNA vez en `tempPassword` y deja
 * `mustChangePassword=true` (API_CONTRACT §«Alta de usuario por rol desde admin», v1.7-admin-users).
 * Al terminar, `DELETE /admin/users/:id` lo borra en DURO (sin historial económico ⇒ hard delete,
 * §«Eliminar usuario — híbrido hard/soft»).
 *
 * Es el mismo patrón que ya usa `utils/grading.ts` con el gancho de grading: **sembrar por el
 * endpoint que el producto usa de verdad** en vez de exigirle la fila al seed. Y prueba MÁS, no
 * menos: el alta por admin con temporal es, literalmente, cómo nace un operador en este producto.
 *
 * ⛔ **Este módulo NO salta nunca.** Si `POST /admin/users` no contesta 201 con `tempPassword`, eso
 * es un desacuerdo real con el contrato y tiene que verse ROJO. Cambiar un salto dinámico por otro
 * habría movido el problema, no cerrado.
 *
 * ⚠️ Coste de cupo de login (`POST /auth/login`, `{ttl:60_000, limit:5}` por IP): **cero extra**.
 * El alta y el borrado usan la sesión de `admin` que `sessionFor` ya cachea y comparte entre
 * workers; los logins que hace `account.spec.ts` son los mismos de antes (los mismos cuatro), solo
 * que ahora todos llegan a medir algo en vez de rebotar en un 401.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

/** Rol del contrato para el actor desechable. */
export type TempActorKind = 'customer' | 'vault_operator';

export interface TempPasswordActor {
  /** `id` del `User` creado. `null` en MOCK (no hay backend al que pedírselo). */
  id: string | null;
  email: string;
  /** La contraseña TEMPORAL recién emitida: la que el flujo de §33.8 va a consumir. */
  password: string;
  kind: TempActorKind;
}

/**
 * Prefijo de correo de TODO actor desechable. Lo comparten el alta y la barredera de huérfanos:
 * si alguien lo cambia en un sitio y no en el otro, la barredera deja de barrer (y se nota porque
 * los huérfanos se acumulan en `GET /admin/users`).
 */
const DISPOSABLE_EMAIL_PREFIX = 'e2e-disposable-temp-';

/** Dominio reservado del arnés, el mismo que usan los actores del seed (`utils/env.ts`). */
const DISPOSABLE_EMAIL_DOMAIN = '@e2e.local';

/**
 * Edad a partir de la cual un desechable se considera HUÉRFANO y se barre. Generosa a propósito:
 * una corrida lenta contra el stack real pasa de media hora, y barrer el actor de una corrida VIVA
 * la tumbaría con un 401 — exactamente la clase de avería que este módulo vino a cerrar.
 */
const ORPHAN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Credenciales de la rama MOCK: ahí no hay backend y el correo es lo único que decide el rol. */
const MOCK_ACTORS: Record<TempActorKind, { email: string; password: string }> = {
  customer: { email: 'temporal@example.com', password: 'cualquiera' },
  vault_operator: { email: 'operador.temporal@example.com', password: 'temporal-op' },
};

interface AdminCreateUserResponse {
  user?: { id?: string; email?: string; role?: string };
  tempPassword?: string;
  mustChangePassword?: boolean;
}

interface AdminUserSummary {
  id: string;
  email: string;
  createdAt: string;
}

function disposableEmail(kind: TempActorKind): string {
  const stamp = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const slug = kind === 'customer' ? 'customer' : 'operator';
  return `${DISPOSABLE_EMAIL_PREFIX}${slug}-${stamp}${DISPOSABLE_EMAIL_DOMAIN}`;
}

/**
 * Fabrica un actor con contraseña temporal RECIÉN emitida.
 *
 * En MOCK devuelve las credenciales que entiende la rama mock de `login()` y no toca la red.
 * En REAL habla con `POST /admin/users` como `super_admin` y **exige** las tres cosas que el
 * contrato promete: `201`, `tempPassword` presente y `mustChangePassword === true`. Cualquier otra
 * respuesta lanza con el cuerpo del backend delante — un rojo que dice dónde mirar.
 */
export async function provisionTempPasswordActor(kind: TempActorKind): Promise<TempPasswordActor> {
  if (!IS_REAL) {
    const creds = MOCK_ACTORS[kind];
    return { id: null, email: creds.email, password: creds.password, kind };
  }

  await sweepOrphanDisposables();

  const email = disposableEmail(kind);
  const res = await apiAs<AdminCreateUserResponse>('admin', 'POST', '/admin/users', {
    email,
    name: kind === 'customer' ? 'E2E desechable cliente' : 'E2E desechable operador',
    role: kind,
    locale: 'es',
  });

  if (res.status !== 201) {
    throw new Error(
      `POST /admin/users (actor desechable ${kind}) respondió ${res.status}: ` +
        `${JSON.stringify(res.body)?.slice(0, 400)}. Sin alta por admin no hay forma de emitir una ` +
        `temporal conocida por el arnés, y §33.8 dejaría de medirse.`,
    );
  }

  const { user, tempPassword, mustChangePassword } = res.body;
  if (!user?.id || !tempPassword || mustChangePassword !== true) {
    throw new Error(
      `POST /admin/users sin password DEBE devolver { user.id, tempPassword, mustChangePassword: true } ` +
        `(API_CONTRACT §«Alta de usuario por rol desde admin»). Recibido: ` +
        `${JSON.stringify({ id: user?.id, hasTempPassword: !!tempPassword, mustChangePassword })}`,
    );
  }

  return { id: user.id, email: user.email ?? email, password: tempPassword, kind };
}

/**
 * Borra el actor desechable. Best-effort **a propósito**: si el borrado falla, el caso ya midió lo
 * que tenía que medir y tumbar el `afterAll` convertiría una fuga de limpieza en un rojo de
 * producto. Lo que no se borre aquí lo barre `sweepOrphanDisposables` en la corrida siguiente.
 *
 * Sin historial económico el contrato manda **hard delete**, así que no quedan filas anonimizadas
 * engordando `GET /admin/users`.
 */
export async function disposeTempPasswordActor(actor: TempPasswordActor | null): Promise<void> {
  if (!IS_REAL || !actor?.id) return;
  try {
    await apiAs('admin', 'DELETE', `/admin/users/${actor.id}`);
  } catch {
    // Ver arriba: la limpieza no decide el veredicto del caso.
  }
}

/**
 * Barre desechables que una corrida anterior dejó sin borrar (worker caído, stack tumbado a
 * mitad). Solo toca correos con el prefijo del arnés Y más viejos que `ORPHAN_MAX_AGE_MS`: nunca
 * el actor de una corrida concurrente, y nunca una cuenta que no fabricó este módulo.
 */
async function sweepOrphanDisposables(): Promise<void> {
  try {
    const res = await apiAs<{ data?: AdminUserSummary[] }>(
      'admin',
      'GET',
      `/admin/users?q=${encodeURIComponent(DISPOSABLE_EMAIL_PREFIX)}&pageSize=100`,
    );
    if (res.status !== 200 || !Array.isArray(res.body?.data)) return;
    const cutoff = Date.now() - ORPHAN_MAX_AGE_MS;
    for (const row of res.body.data) {
      if (!row?.email?.startsWith(DISPOSABLE_EMAIL_PREFIX)) continue;
      const born = Date.parse(row.createdAt ?? '');
      if (!Number.isFinite(born) || born > cutoff) continue;
      await apiAs('admin', 'DELETE', `/admin/users/${row.id}`);
    }
  } catch {
    // Barrer es higiene, no precondición: un fallo aquí no puede impedir que el caso mida.
  }
}
