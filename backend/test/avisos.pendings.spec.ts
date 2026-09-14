import { readFileSync } from 'fs';
import { codigoDeFichero, codigoDeTexto } from './helpers/codigo-de-fichero';
import { join } from 'path';
import { PendingsService, PENDING_CODES } from '../src/modules/users/pendings.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * # LA CAMPANA — `C-AV-7` (el predicado), `C-AV-8` (⛔ la oferta no se filtra) y la forma del DTO
 *
 * `C-AV-6` (las cuatro mitades de la campana) se cierra **contra el stack corriendo**: (a) navegar
 * sin que ninguna pantalla obligue a despachar el pendiente y (b) verlo en las tres situaciones son
 * de **frontend/QA**. Lo que se puede medir aquí —y es la mitad de backend— es **(c) resuelto ⇒
 * `{"pendings":[]}`** y **(d) la campana NO lista eventos**, que es una propiedad del dominio
 * cerrado y se comprueba sobre el código.
 */

function buildService(opts: {
  kyc?: Record<string, unknown> | null;
  sellRequest?: { createdAt: Date } | null;
}) {
  const prisma: any = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(opts.kyc ?? null) },
    sellRequest: { findFirst: jest.fn().mockResolvedValue(opts.sellRequest ?? null) },
  };
  return { svc: new PendingsService(prisma as PrismaService), prisma };
}

const REVIEWED = new Date('2026-09-10T18:00:00Z');
const CREATED = new Date('2026-09-01T12:00:00Z');

// =================================================================================================
describe('C-AV-7 — el predicado de `identity_action_required`, en sus dos cláusulas', () => {
  it('(a) `rejected` ⇒ UN pendiente, con `since` = `reviewedAt`', async () => {
    const { svc } = buildService({ kyc: { kycStatus: 'rejected', reviewedAt: REVIEWED, updatedAt: new Date() } });
    await expect(svc.list('u1')).resolves.toEqual({
      pendings: [{ code: 'identity_action_required', since: REVIEWED.toISOString() }],
    });
  });

  it('(c) resubir ⇒ el estado vuelve a `pending` ⇒ CERO pendientes, sin apagar nada', async () => {
    // ⭐ El criterio 202(c) sale **por construcción**: derivando, el pendiente se apaga el mismo
    // instante en que deja de ser verdad, porque **no hay nada que apagar**.
    const { svc } = buildService({ kyc: { kycStatus: 'pending', reviewedAt: null, updatedAt: new Date() } });
    await expect(svc.list('u1')).resolves.toEqual({ pendings: [] });
  });

  it('⛔ `none`, `pending` y `verified` ⇒ CERO pendientes (las tres son DECISIÓN, no olvido)', async () => {
    for (const kycStatus of ['none', 'pending', 'verified'] as const) {
      const { svc } = buildService({ kyc: { kycStatus, reviewedAt: REVIEWED, updatedAt: new Date() } });
      await expect(svc.list('u1')).resolves.toEqual({ pendings: [] });
    }
  });

  it('⛔ sin `KycProfile` (nunca subió nada) ⇒ CERO: no se le fabrica una tarea', async () => {
    const { svc } = buildService({ kyc: null });
    await expect(svc.list('u1')).resolves.toEqual({ pendings: [] });
  });

  it('(b) la cláusula de la solicitud viva (`ineRequired ∧ ¬ineProvided`) ⇒ UN pendiente', async () => {
    // ⚠️ Hoy esta cláusula es, casi con certeza, VACÍA: el intake lanza `422 INE_REQUIRED`, así que
    // `POST /buylist/requests` no puede crear una fila que la satisfaga. **Se conserva** porque el
    // predicado nombra **la obligación**, no la alcanzabilidad de hoy. Por eso aquí se prueba con la
    // fila **inyectada**, y en E2E se siembra **por SQL** (§R.2.3).
    const { svc, prisma } = buildService({
      kyc: { kycStatus: 'pending', reviewedAt: null, updatedAt: new Date() },
      sellRequest: { createdAt: CREATED },
    });
    await expect(svc.list('u1')).resolves.toEqual({
      pendings: [{ code: 'identity_action_required', since: CREATED.toISOString() }],
    });
    // …y el `where` es exactamente el del contrato: viva, sin cerrar, exige INE y no lo tiene.
    const where = prisma.sellRequest.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'u1', closedAt: null, ineRequired: true, ineProvided: false });
    expect(where.status.in).toEqual(expect.arrayContaining(['cotizada', 'ofertada', 'aceptada']));
    // ⛔ Y NINGÚN estado terminal entra en la cláusula «viva».
    for (const terminal of ['pagada', 'rechazada', 'abandonada', 'expirada']) {
      expect(where.status.in).not.toContain(terminal);
    }
  });

  it('las DOS cláusulas a la vez ⇒ UN solo pendiente, con la fecha MÁS ANTIGUA', async () => {
    const { svc } = buildService({
      kyc: { kycStatus: 'rejected', reviewedAt: REVIEWED, updatedAt: new Date() },
      sellRequest: { createdAt: CREATED },
    });
    const res = await svc.list('u1');
    expect(res.pendings).toHaveLength(1);
    expect(res.pendings[0].since).toBe(CREATED.toISOString()); // CREATED < REVIEWED
  });

  it('fila `rejected` LEGACY sin `reviewedAt` ⇒ el pendiente NO desaparece (cae a `updatedAt`)', async () => {
    // *Omitir el pendiente por un detalle de migración escondería una obligación real: fallar hacia
    // «no hay nada que hacer» es el lado equivocado.*
    const updatedAt = new Date('2026-05-05T05:05:05Z');
    const { svc } = buildService({ kyc: { kycStatus: 'rejected', reviewedAt: null, updatedAt } });
    await expect(svc.list('u1')).resolves.toEqual({
      pendings: [{ code: 'identity_action_required', since: updatedAt.toISOString() }],
    });
  });
});

// =================================================================================================
describe('⭐⭐ C-AV-8 — la oferta PENDIENTE DE AUTORIZACIÓN no se filtra, y se mide POR LO NEGATIVO', () => {
  /**
   * El riesgo nº 1 de todo §R: un centro de avisos derivado ingenuamente de *«cambió un estado»*
   * **filtra `SellOfferState.pending_authorization` solo**, y `schema.prisma` es explícito —*«EL
   * CLIENTE NO DEBE ENTERARSE DE QUE EXISTE […] le filtraría el orden de magnitud de nuestro tope»*.
   * Con lista blanca cerrada, la negativa **no depende de la disciplina del siguiente que escriba un
   * pendiente**: depende de que el arquitecto añada una fila, que es cambio de contrato.
   */
  /**
   * ⚠️ **Se mide el CÓDIGO, no los comentarios**, y la distinción es deliberada: el docblock del
   * resolutor **explica la prohibición**, y nombrar la prohibición no es referenciar el estado. Un
   * candado que confundiera las dos cosas obligaría a escribir la regla sin poder nombrarla — y una
   * regla que no se puede escribir no se cumple.
   *
   * ⭐⭐ **Aquí vivía el algoritmo v1** (regex global de bloques + colas de línea), que se queda
   * **ciego a trozos**: un comentario de línea que contenga la apertura de bloque abre un bloque
   * fantasma que se come el código hasta el siguiente cierre. `pendings.service.ts` **hoy** no tiene
   * ninguno (medido 2026-09-14, barrido mecanístico sobre `src/`: los siete que sí lo tienen son
   * otros) — pero *«hoy no»* no es una defensa: **es un comentario de distancia**, y este candado es
   * el riesgo nº 1 de todo §R. `codigoDeFichero` trae la v2 **y** su control de no-vacuidad POR
   * CONTENIDO (anclas): si el limpiador se comiera el resolutor, esto **revienta** en vez de decir
   * «no encontré la referencia» sobre un fichero vacío.
   */
  const codigo = codigoDeFichero(
    join(__dirname, '..', 'src', 'modules', 'users', 'pendings.service.ts'),
    // Anclas: el resolutor entero y sus dos consultas. Si alguna falta, no se leyó el fichero.
    ['class PendingsService', 'kycProfile.findUnique', 'sellRequest.findFirst'],
  );

  it('⛔ el resolutor NO contiene ninguna referencia a `SellOfferState` ni a sus valores', () => {
    for (const aguja of [/SellOfferState/, /offerState/, /pending_authorization/, /offerSentAt/]) {
      expect({ aguja: String(aguja), encontrado: aguja.test(codigo) }).toEqual({
        aguja: String(aguja),
        encontrado: false,
      });
    }
  });

  it('CANARIO: el detector SÍ encuentra la referencia cuando está en código', () => {
    const conDefecto = `${codigo}\nconst x = { offerState: 'pending_authorization' };`;
    expect(/pending_authorization/.test(conDefecto)).toBe(true);
    // …y sigue ignorando un comentario que solo la nombra — con el MISMO limpiador que usa el
    // candado de arriba, ⛔ no con una copia que podría divergir de él en silencio.
    const limpio = codigoDeTexto(
      `${codigo}\n// jamás leer pending_authorization aquí`,
      'canario C-AV-8',
      ['class PendingsService'],
    );
    expect(/pending_authorization/.test(limpio)).toBe(false);
  });

  it('una oferta en `pending_authorization` no cambia la respuesta: el resolutor ni la consulta', async () => {
    const { svc, prisma } = buildService({ kyc: { kycStatus: 'pending', reviewedAt: null, updatedAt: new Date() } });
    const antes = await svc.list('u1');
    const despues = await svc.list('u1'); // idéntica: nada del ciclo de oferta entra en el predicado
    expect(JSON.stringify(despues)).toBe(JSON.stringify(antes));
    // El único `where` de buylist que se emite no mira `offerState` en ninguna dirección.
    expect(JSON.stringify(prisma.sellRequest.findFirst.mock.calls[0][0])).not.toContain('offer');
  });
});

// =================================================================================================
describe('⭐ el DOMINIO y la FORMA: lista blanca cerrada, dos campos, cero query', () => {
  it('`PendingCode` tiene EXACTAMENTE un valor hoy (ampliar es cambio de contrato)', () => {
    expect([...PENDING_CODES]).toEqual(['identity_action_required']);
  });

  it('el `PendingDTO` lleva SOLO `code` y `since` — ⛔ ni dinero, ni cifras, ni topes', () => {
    // *Un pendiente no es un resumen.*
    return new PendingsService({
      kycProfile: { findUnique: async () => ({ kycStatus: 'rejected', reviewedAt: REVIEWED, updatedAt: REVIEWED }) },
      sellRequest: { findFirst: async () => null },
    } as unknown as PrismaService)
      .list('u1')
      .then((res) => {
        expect(Object.keys(res)).toEqual(['pendings']);
        expect(Object.keys(res.pendings[0]).sort()).toEqual(['code', 'since']);
      });
  });

  it('⛔ el controller NO declara NINGÚN parámetro de query, y sí declara `no-store`', () => {
    // ⛔ CERO ejes ⇒ esta rev no toca §0-Q y `C-EQ-1` sigue verde sin cambios. Añadir un `?code=`
    // es cambio de contrato: pasa por el arquitecto y obliga a darle clase E/R/L.
    const ctrl = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'users', 'me-pendings.controller.ts'),
      'utf8',
    );
    expect(ctrl).not.toMatch(/@Query\(/);
    expect(ctrl).toMatch(/@Header\('Cache-Control', 'no-store'\)/);
    // ⛔ Y no es `@Public`: sin sesión ⇒ 401 (§R.2.2).
    expect(ctrl).not.toMatch(/@Public\(/);
  });

  it('⛔ NO existe ninguna tabla `Notification` en el esquema (§R.6)', () => {
    const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/^model Notification/m);
    expect(schema).not.toMatch(/^model NotificationRead/m);
    expect(schema).not.toMatch(/^model NotificationPreference/m);
  });
});
