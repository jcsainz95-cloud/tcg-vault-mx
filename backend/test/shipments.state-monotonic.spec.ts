/**
 * # shipments.state-monotonic.spec.ts — ⭐⭐ **LA PREMISA DE «CERO COLUMNAS NUEVAS», VIGILADA**
 * (`API_CONTRACT §R.4.c` cláusula 3 · `PROJECT` criterio **205** · `REL-B`/`REL-C`.)
 *
 * El contrato decide que `AV-5`/`AV-6` **no estrenan sello** porque el CAS de la transición ya los
 * hace únicos. Eso es cierto **solo si el ciclo no se puede reabrir**:
 *
 * > CAS ⇒ **un aviso por TRANSICIÓN**.  Transición + **estado monótono** ⇒ **un aviso por CICLO**.
 *
 * La segunda mitad es la frágil, y **era falsa** hasta este pase (`REL-C`: `setTracking` devolvía un
 * `enviado` a `guia`; el webhook de Stripe lo devolvía a `picking`). Este fichero la sostiene con
 * dos candados independientes, y **ninguno de los dos mira la prosa**:
 *
 *  - **(A) el grafo `TRANSITIONS` no tiene ciclos** — se lee la tabla REAL del servicio, no una copia.
 *  - **(B) ninguna escritura de `src/` mueve `status` sin llevarlo en el `WHERE`** — censo por
 *    aparición, con tercera clase `unclassified` que cuenta como rojo.
 *
 * ⚠️ Si cualquiera de los dos se cae, la decisión correcta deja de ser «cero columnas» y **pasa a ser
 * del arquitecto** (regla 9). Por eso el mensaje de fallo lo dice: *no se arregla aflojando el test.*
 */
import { join } from 'node:path';
import { ShipmentStatus } from '@prisma/client';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import {
  censoDeEscriturasDeEstado,
  clasificarEscriturasDeEstado,
} from './helpers/shipment-status-writers';

const SRC = join(__dirname, '..', 'src');
const BASE = join(__dirname, '..');

/**
 * La tabla **REAL**, no una copia. `private static` es privacidad de TypeScript: en ejecución está
 * ahí, y leerla es lo único que hace que este candado mida el producto y no un duplicado que se
 * queda atrás en silencio — que es exactamente cómo `§4.54.4` llegó a afirmar una garantía que el
 * código no daba.
 */
const TRANSITIONS = (
  ShipmentsService as unknown as { TRANSITIONS: Record<ShipmentStatus, ShipmentStatus[]> }
).TRANSITIONS;

describe('⭐⭐ (A) — el grafo de `TRANSITIONS` es ACÍCLICO (la premisa de «un aviso por ciclo»)', () => {
  it('se leyó la tabla REAL del servicio y cubre los 6 estados del enum', () => {
    // ⛔ Rojo si alguien renombra o mueve la tabla: mejor un rojo ruidoso que un candado que en
    // silencio empieza a medir `undefined`.
    expect(TRANSITIONS).toBeDefined();
    expect(Object.keys(TRANSITIONS).sort()).toEqual(Object.values(ShipmentStatus).sort());
  });

  it('⛔ NO existe ningún ciclo: ningún estado es alcanzable desde sí mismo', () => {
    // Búsqueda de ciclos sobre el grafo entero (no solo desde `solicitado`): un ciclo en una
    // componente inalcanzable hoy es un ciclo el día que alguien le abra una arista.
    const ciclos: string[] = [];
    for (const inicio of Object.keys(TRANSITIONS) as ShipmentStatus[]) {
      const vistos = new Set<ShipmentStatus>();
      const pila: ShipmentStatus[] = [...TRANSITIONS[inicio]];
      while (pila.length > 0) {
        const s = pila.pop()!;
        if (s === inicio) {
          ciclos.push(inicio);
          break;
        }
        if (vistos.has(s)) continue;
        vistos.add(s);
        pila.push(...TRANSITIONS[s]);
      }
    }
    expect({
      ciclos,
      porque:
        'un ciclo permite volver a entrar a `enviado`/`cancelado` ⇒ un SEGUNDO AV-5/AV-6 legítimo ' +
        '⇒ se rompe el criterio 205. Si esto es deliberado, la decisión de §R.4.c(3) («cero ' +
        'columnas nuevas») deja de sostenerse y pasa por el ARQUITECTO — ⛔ no se afloja el test.',
    }).toEqual({ ciclos: [], porque: expect.any(String) });
  });

  it('⭐ `enviado` solo se alcanza desde `guia`, y de `cancelado` no sale nada (los dos avisos)', () => {
    const entrantes = (destino: ShipmentStatus) =>
      (Object.keys(TRANSITIONS) as ShipmentStatus[])
        .filter((s) => TRANSITIONS[s].includes(destino))
        .sort();
    expect(entrantes('enviado')).toEqual(['guia']);
    expect(TRANSITIONS.cancelado).toEqual([]);
    expect(TRANSITIONS.entregado).toEqual([]);
  });
});

describe('⭐⭐ (B) — censo: ninguna escritura mueve `status` sin llevarlo en el `WHERE`', () => {
  const censo = censoDeEscriturasDeEstado(SRC, BASE);

  /**
   * ⭐ **NO-VACUIDAD POR CONTENIDO, no «no está vacío».**
   * El modo de fallo real de esta familia de candados **no es el total, es el PARCIAL**: el
   * instrumento se queda ciego a *trozos* del árbol y el censo sale corto — verde por ceguera.
   * (`PendingsBell.test.tsx:140` ya blindaba el caso total y el que ocurre de verdad es éste.)
   * Por eso aquí se exige **el contenido esperado**: los sitios que HOY sabemos que existen y el
   * fichero donde viven. Si el censo deja de verlos, esto revienta en vez de pasar en falso.
   */
  it('⛔ NO-VACUIDAD: el censo ve los escritores que sabemos que existen', () => {
    const ficheros = new Set(censo.map((s) => s.file));
    expect(ficheros).toContain('src/modules/shipments/shipments.service.ts');
    expect(ficheros).toContain('src/modules/payments/payments.service.ts');
    // Cotas por contenido: 3 escrituras de `setTracking`/`updateStatus` + el sello de `claimAndNotify`
    // + el `stripePaymentIntentId` ⇒ nunca menos de 5 en shipments, y nunca menos de 3 en payments.
    expect(
      censo.filter((s) => s.file === 'src/modules/shipments/shipments.service.ts').length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      censo.filter((s) => s.file === 'src/modules/payments/payments.service.ts').length,
    ).toBeGreaterThanOrEqual(3);
    // Y al menos una de cada clase esperada: si todo saliera `sin-status`, el detector estaría roto.
    expect(censo.filter((s) => s.kind === 'guarded').length).toBeGreaterThanOrEqual(5);
    expect(censo.filter((s) => s.kind === 'sin-status').length).toBeGreaterThanOrEqual(2);
  });

  it('⛔⛔ CERO escrituras `unguarded` y CERO `unclassified`', () => {
    const malas = censo.filter((s) => s.kind === 'unguarded' || s.kind === 'unclassified');
    expect({
      malas: malas.map((s) => `${s.key} → ${s.kind}`),
      porque:
        'una escritura de `status` sin `status` en el `WHERE` decide sobre una lectura CADUCA: ' +
        'puede retroceder el estado (REL-C, medido ROJO 10/10 con entrelazado forzado) y reabrir ' +
        'el ciclo ⇒ un segundo AV-5. `unclassified` = forma nueva que este censo no sabe leer: se ' +
        'clasifica a mano en helpers/shipment-status-writers.ts, ⛔ no se ignora.',
    }).toEqual({ malas: [], porque: expect.any(String) });
  });
});

describe('⭐ CANARIO — el censo SÍ muerde (si no, los dos `it` de arriba son decorativos)', () => {
  const caso = (fuente: string) => clasificarEscriturasDeEstado(fuente, 'sintetico.ts');

  it('escritura de `status` SIN guarda ⇒ `unguarded`', () => {
    const s = caso(`await tx.shipmentRequest.update({ where: { id }, data: { status: 'guia' } });`);
    expect(s.map((x) => x.kind)).toEqual(['unguarded']);
  });

  it('la MISMA escritura con la precondición en el `where` ⇒ `guarded`', () => {
    const s = caso(
      `await tx.shipmentRequest.updateMany({ where: { id, status: 'picking' }, data: { status: 'guia' } });`,
    );
    expect(s.map((x) => x.kind)).toEqual(['guarded']);
  });

  it('`data` OPACO (un identificador) exige guarda igual — no se puede mirar dentro', () => {
    expect(caso(`await p.shipmentRequest.update({ where: { id }, data });`).map((x) => x.kind)).toEqual(
      ['unguarded'],
    );
    expect(
      caso(`await p.shipmentRequest.updateMany({ where: { id, status: prev }, data });`).map(
        (x) => x.kind,
      ),
    ).toEqual(['guarded']);
  });

  it('una escritura que NO toca `status` no exige nada (y no se confunde con `metadata`)', () => {
    const s = caso(
      `await p.shipmentRequest.update({ where: { id }, data: { stripePaymentIntentId: pi.id } });`,
    );
    expect(s.map((x) => x.kind)).toEqual(['sin-status']);
  });

  it('⭐ el `status` de un objeto ANIDADO no cuenta como guarda (la guarda es de primer nivel)', () => {
    const s = caso(
      `await p.shipmentRequest.update({ where: { id, order: { is: { status: 'paid' } } }, data: { status: 'guia' } });`,
    );
    expect(s.map((x) => x.kind)).toEqual(['unguarded']);
  });

  it('⭐ DOS escrituras en la MISMA línea se cuentan por APARICIÓN, no por línea', () => {
    const s = caso(
      `a.shipmentRequest.update({where:{id},data:{status:'x'}}); b.shipmentRequest.update({where:{id,status:'y'},data:{status:'z'}});`,
    );
    expect(s.map((x) => x.kind)).toEqual(['unguarded', 'guarded']);
  });

  it('⛔ un `create` NO entra al censo: una fila que nace no puede RETROCEDER', () => {
    expect(caso(`await tx.shipmentRequest.create({ data: { status: 'solicitado' } });`)).toEqual([]);
  });

  /**
   * ⭐⭐ **LA MUTACIÓN QUE MATA A LA v1 DEL INSTRUMENTO — y la razón de este fichero entero.**
   * Con la regex de bloques de la v1 (`replace(/\/\*[\s\S]*?\*\//g, '')`), un comentario de LÍNEA que
   * contenga la secuencia de apertura de bloque **abre un bloque** que se come el fichero hasta el
   * siguiente cierre. Aquí ese comentario está **antes** de la escritura sin guarda: con la v1, la
   * escritura desaparece y el censo sale **verde por ceguera** sobre el camino del dinero.
   */
  it('⛔⛔ un comentario con la apertura de bloque NO esconde la escritura de abajo', () => {
    const fuente = [
      `// la etiqueta viaja por /admin/* y no toca el estado`,
      `await tx.shipmentRequest.update({ where: { id }, data: { status: 'guia' } });`,
      `/* cierre que la v1 usaría para terminar el bloque fantasma */`,
    ].join('\n');
    expect(caso(fuente).map((x) => x.kind)).toEqual(['unguarded']);
    // …y se demuestra que la v1 SÍ se lo comía, para que el porqué no sea una afirmación de prosa.
    const v1 = fuente.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(v1).not.toContain('shipmentRequest.update');
  });
});
