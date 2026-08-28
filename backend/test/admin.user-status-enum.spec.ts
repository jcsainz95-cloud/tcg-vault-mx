import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserStatus } from '@prisma/client';
import { UpdateStatusDto } from '../src/modules/admin/admin.controller';

/**
 * v2.1.9 · T-3 (techlead) — **`PATCH /admin/users/:id/status` acepta DOS de los TRES `UserStatus`,
 * y eso está fijado por test, no por buena voluntad.**
 *
 * ### Por qué existe este archivo
 * `enum-values.ts` excluye `UserStatus` a propósito y el call-site (`UpdateStatusDto`) ahora explica
 * por qué. Pero un comentario no impide un cambio: el candado de residuo de `enum-values-parity`
 * señala las listas de enums escritas a mano como infractoras, así que el fix «obvio» —derivar esta
 * lista del enum— es exactamente el que abre el agujero.
 *
 * ### Qué se rompería sin este candado
 * `deleted` lo fija **sólo** `DELETE /admin/users/:id` (`AdminService.deleteUser`), que además
 * **anonimiza la PII**, pone `passwordHash: null`, **incrementa `tokenVersion`** (revoca los JWT
 * vivos) y borra direcciones/KYC. Si `PATCH /status` pudiera escribir `deleted`, quedaría un usuario
 * marcado como «eliminado» con su PII intacta y su sesión **todavía válida** — el peor de los dos
 * mundos: la UI lo da por borrado y el sistema no lo borró.
 *
 * Este test falla en el momento exacto en que alguien «termina» la derivación, y el mensaje que lee
 * es el motivo.
 */
describe('T-3 · UpdateStatusDto — `deleted` NO se puede fijar por PATCH /status', () => {
  it('acepta `active` y `blocked`', async () => {
    for (const status of ['active', 'blocked']) {
      const errors = await validate(plainToInstance(UpdateStatusDto, { status }));
      expect(errors).toHaveLength(0);
    }
  });

  it('RECHAZA `deleted` — sólo DELETE /admin/users/:id lo fija (anonimiza PII + revoca sesiones)', async () => {
    const errors = await validate(plainToInstance(UpdateStatusDto, { status: 'deleted' }));
    expect(errors.some((e) => e.property === 'status')).toBe(true);
  });

  it('rechaza cualquier otro valor (no hay puerta trasera de estado)', async () => {
    for (const status of ['DELETED', 'suspended', '', null, 1]) {
      const errors = await validate(plainToInstance(UpdateStatusDto, { status }));
      expect(errors.some((e) => e.property === 'status')).toBe(true);
    }
  });

  /**
   * La afirmación de arriba sólo tiene contenido si el enum del schema es MÁS ancho que la lista
   * aceptada. Si algún día `UserStatus` quedara reducido a `active|blocked`, este test dejaría de
   * medir nada y hay que enterarse.
   */
  it('el enum del schema es ESTRICTAMENTE más ancho: la exclusión de `deleted` es real', () => {
    const schemaValues = Object.values(UserStatus).sort();
    expect(schemaValues).toEqual(['active', 'blocked', 'deleted']);
    expect(schemaValues).toContain('deleted');
  });
});
