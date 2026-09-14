import { readFileSync } from 'fs';
import { join } from 'path';
import { codigoDeFichero } from './helpers/codigo-de-fichero';

/**
 * # ⛔⛔ LAS TRES COLUMNAS DE M-57 SON INTERNAS: FUERA DE TODO DTO (§R.6)
 *
 * *No son un hecho del pedido ni de la solicitud: son un hecho **sobre nuestro propio envío de
 * correo**. Publicarlas convierte un detalle de implementación en una promesa de contrato.*
 *
 * ## Por qué este candado existe aunque hoy «no haya nada que publicar»
 * Es exactamente el caso para el que se escribieron las listas blancas de proyección: mientras la
 * respuesta **sea la fila**, la próxima columna se publica sola. Este archivo mide las **dos**
 * mitades:
 *  1. **Estructural** — las tres columnas existen en el esquema, nullable, sin `@default` y sin
 *     índice (si alguien les pone un `@default(now())`, toda fila nueva nacería «ya avisada»).
 *  2. **De proyección** — ninguna aparece en las listas blancas que componen las respuestas, ni en
 *     los `select` de admin. Se mide **sobre el código de las proyecciones**, que es donde el
 *     defecto entraría.
 */

const SRC = join(__dirname, '..', 'src');
const SELLOS = ['kycRejectionNoticeSentAt', 'trackingNoticeSentAt', 'guideNoticeSentAt'] as const;

describe('(1) el ESQUEMA declara las tres columnas como sellos, y nada más', () => {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const modelo = (nombre: string) =>
    (schema.match(new RegExp(`model ${nombre} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');

  it.each([
    ['KycProfile', 'kycRejectionNoticeSentAt'],
    ['ShipmentRequest', 'trackingNoticeSentAt'],
    ['SellRequest', 'guideNoticeSentAt'],
  ])('`%s.%s DateTime?` — nullable, ⛔ sin default y ⛔ sin índice', (model, campo) => {
    const cuerpo = modelo(model);
    expect(cuerpo).toMatch(new RegExp(`${campo}\\s+DateTime\\?`));
    // ⛔ Sin `@default`: un `now()` marcaría como «ya avisado» todo lo que se cree después.
    expect(cuerpo).not.toMatch(new RegExp(`${campo}\\s+DateTime\\?\\s+@default`));
    // ⛔ Sin índice: se leen POR ID dentro de una operación que ya cargó la fila.
    expect(cuerpo).not.toMatch(new RegExp(`@@index\\(\\[${campo}`));
  });

  it('la migración M-57 es ADITIVA y no trae backfill ni índice', () => {
    const sql = readFileSync(
      join(__dirname, '..', 'prisma', 'migrations', '20260914120000_m57_notice_seals', 'migration.sql'),
      'utf8',
    );
    const ddl = sql
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('--'))
      .join('\n');
    expect(ddl.match(/ADD COLUMN/g)).toHaveLength(3);
    expect(ddl).not.toMatch(/UPDATE|CREATE INDEX|DROP|DEFAULT/i);
  });
});

describe('(2) NINGUNA proyección las publica — ni al cliente ni al back-office', () => {
  /**
   * ⭐ **Ancla de no-vacuidad POR CONTENIDO, una por fichero.** ⛔ No es «el texto no está vacío»:
   * el modo de fallo real es el **PARCIAL** —el limpiador conserva el 90 % y pierde justo la región
   * vigilada—, y eso solo lo ve un fragmento de código que **tiene que seguir estando ahí**.
   */
  const ANCLAS: Record<string, string> = {
    'modules/shipments/shipments.service.ts': 'function toAdminShipmentRow',
    'modules/buylist/buylist.service.ts': 'export class BuylistService',
    'modules/admin/admin.service.ts': 'export class AdminService',
    'modules/users/users.service.ts': 'export class UsersService',
    'modules/orders/orders.service.ts': 'export class OrdersService',
  };

  /** Ficheros donde vive **toda** proyección que pueda tocar las tres tablas. */
  const PROYECCIONES = [
    'modules/shipments/shipments.service.ts',
    'modules/buylist/buylist.service.ts',
    'modules/admin/admin.service.ts',
    'modules/users/users.service.ts',
    'modules/orders/orders.service.ts',
  ];

  it.each(PROYECCIONES)('⛔ `%s` no emite ningún sello en una respuesta', (rel) => {
    // Se mide el CÓDIGO: los docblocks explican los sellos a propósito, y explicar una columna no es
    // publicarla. (Misma distinción, y por el mismo motivo, que en `C-AV-8`.)
    // ⭐ v2 + no-vacuidad POR CONTENIDO: aquí vivía el algoritmo v1, que ante un comentario con la
    // apertura de bloque se come el fichero hasta el siguiente cierre. Si se comiera la proyección,
    // este `it` diría «no hay ningún sello publicado» **sobre un fichero que no leyó**.
    const codigo = codigoDeFichero(join(SRC, rel), [ANCLAS[rel]]);
    for (const sello of SELLOS) {
      // Las apariciones legítimas en código son **escrituras y guardas**, nunca campos de salida:
      // `data: { … }`, `where: { … }` y la comparación del sello. Se comprueba que ninguna línea que
      // contenga el sello sea una línea de **proyección** (`campo: row.campo` / `campo: true`).
      const proyecciones = codigo
        .split('\n')
        .filter((l) => new RegExp(`${sello}:\\s*(true|[a-zA-Z_]+\\.${sello})`).test(l))
        .map((l) => l.trim());
      // El mensaje del rojo trae la línea culpable: un candado que dice «falló» sin decir dónde
      // manda a buscar a mano lo que ya sabía.
      expect({ fichero: rel, sello, proyecciones }).toEqual({ fichero: rel, sello, proyecciones: [] });
    }
  });

  it('⛔ y `toAdminShipmentRow` —la lista blanca del back-office de M4— no los menciona', () => {
    const fuente = readFileSync(join(SRC, 'modules/shipments/shipments.service.ts'), 'utf8');
    const lista = fuente.match(/function toAdminShipmentRow[\s\S]*?\n}/)?.[0] ?? '';
    expect(lista).not.toBe('');
    for (const sello of SELLOS) expect(lista).not.toContain(sello);
  });

  it('⛔ y `ADMIN_KYC_SELECT` —el `select` del expediente— tampoco', () => {
    const fuente = readFileSync(join(SRC, 'modules/admin/admin.service.ts'), 'utf8');
    const select =
      fuente.match(/const ADMIN_KYC_SELECT = \{[\s\S]*?\n\} satisfies/)?.[0] ?? '';
    expect(select).not.toBe('');
    expect(select).not.toContain('kycRejectionNoticeSentAt');
  });

  it('CANARIO: el detector RECONOCE una proyección del sello si alguien la añade', () => {
    const linea = '    trackingNoticeSentAt: s.trackingNoticeSentAt,';
    expect(linea).toMatch(/trackingNoticeSentAt:\s*(true|[a-zA-Z_]+\.trackingNoticeSentAt)/);
    const selectLinea = '  kycRejectionNoticeSentAt: true,';
    expect(selectLinea).toMatch(/kycRejectionNoticeSentAt:\s*(true|[a-zA-Z_]+\.kycRejectionNoticeSentAt)/);
  });
});
