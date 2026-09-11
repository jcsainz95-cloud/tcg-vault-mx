/**
 * greeting-name.ts — v1.67 (ARCHITECTURE §4.47.5, D-CTA-5). Propiedad: backend (módulo `mail`).
 *
 * Decide con qué nombre saluda un correo. `User.name` puede ser **fabricado** por el sistema (alta
 * Google sin `name` en el ID token ⇒ `name = email.split('@')[0]`, `nameSource='derived'`): se sigue
 * guardando y mostrando en la UI (un nombre vacío rompe 16 copys), pero un correo que dice «Hola
 * jcsainz95:» afirma un dato que nadie tecleó. Con `derived` el saludo va SIN nombre («Hola:» /
 * «Hi,»). Con `user`/`google` (o sin `nameSource`, p. ej. llamadores antiguos) va con él.
 *
 * Adoptan este helper: las dos plantillas de cuenta (`mail.templates.ts`). Los correos del buylist
 * (`buylist.service.ts`, `buylist-sweep.service.ts`) lo adoptan **en su propio stream** (D-CTA-5) —
 * no se tocan en Stream A.
 */
export type NameSourceLike = 'user' | 'google' | 'derived';

export interface GreetingUser {
  name: string;
  nameSource?: NameSourceLike | null;
}

/** Nombre para el saludo, o `null` si no debe saludarse con nombre (derivado o vacío). */
export function greetingName(user: GreetingUser): string | null {
  if (user.nameSource === 'derived') return null;
  const trimmed = (user.name ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}
