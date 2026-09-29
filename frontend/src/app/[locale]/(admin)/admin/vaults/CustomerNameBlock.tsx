'use client';

import { useTranslations } from 'next-intl';
import { customerDisplayName } from './customer-name';

/**
 * **De quién es** — el bloque de persona de la tarjeta «Para bóveda» (§36.2 plano 1) y de la vista
 * «Qué debe haber» (§36.11 punto 1). UNA pieza para las dos superficies: §36.4 exige «la misma regla y
 * el mismo copy» en ambas, y dos implementaciones de una ausencia son dos sitios donde olvidarla.
 *
 * - **V1:** el titular es el nombre completo **tal cual se capturó**. ⛔ Nunca `lastName`, nunca
 *   «Apellido, Nombre».
 * - **V2 / §36.4:** `name === null` (en blanco o **fabricado del correo**, `nameSource='derived'`) se
 *   pinta como **ausencia con nombre**: marca «Sin nombre registrado» + frase + correo, tres nodos de
 *   BLOQUE con un espacio real entre ellos (§35.6a-f: la separación no puede depender de un `gap`).
 *   ⛔ Nunca se reconstruye un nombre desde el correo; ⛔ nunca un «—».
 * - El correo va **siempre** en segunda línea (desempate entre homónimos), ⛔ nunca truncado.
 */
export function CustomerNameBlock({
  name,
  email,
  testId,
}: {
  name: string | null;
  email: string;
  testId?: string;
}) {
  const t = useTranslations('admin.m4.prep.vault.nameMissing');
  // La regla vive en `customer-name.ts` (una sola fuente; la cabecera del detalle usa la misma).
  const display = customerDisplayName(name);

  return (
    <div data-testid={testId} className="flex flex-col gap-0.5">
      {display !== null ? (
        <p className="font-serif text-2xl leading-tight text-text">{display}</p>
      ) : (
        <>
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-accent">{t('tag')}</p>{' '}
          <p className="text-sm text-text">{t('body')}</p>{' '}
        </>
      )}
      <p className="break-all font-mono text-sm text-text">{email}</p>
    </div>
  );
}
