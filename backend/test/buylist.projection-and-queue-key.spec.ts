import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v1.51.20 — **DOS INVARIANTES DE CÓDIGO QUE NINGÚN TEST DE RUNTIME BARATO ATRAPA**, y que ya se
 * rompieron una vez cada uno. Los dos son de la misma familia: *una regla escrita dos veces, en dos
 * archivos, sobre dinero.*
 *
 * - **BL-29** — la proyección de CLIENTE se construía como *«la de admin **MENOS N campos**»*, así
 *   que **todo campo nuevo del lado admin se publicaba al vendedor** salvo que alguien se acordara
 *   de restarlo. Aguantó mientras la resta eran tres campos; el ciclo añade **veintiuno**, y entre
 *   ellos `offerState` y los **tres montos congelados** —cuya divulgación el contrato prohíbe
 *   explícitamente—. *Una resta de veinticuatro términos no es una lista blanca: es una lista negra
 *   con otro nombre.* Ahora la herencia va **al revés** (base compartida + adición admin-only), y
 *   esto lo vigila.
 * - **R3** — `pendingQueueKey` **decía** ser «la misma llave que usa `escalatePending`» y tenía
 *   **un componente menos**. Como las dos viven en archivos distintos, ni el compilador ni un test
 *   de un módulo solo lo veían: el síntoma era un **deep-link que llevaba al operador a la entrada
 *   de otro producto**.
 *
 * Misma técnica que `sell-request-states.spec.ts` y `enum-values-parity.spec.ts`: se lee el
 * **texto** del código, **sin comentarios** —este repo documenta sus reglas en prosa, y buscar el
 * literal a pelo daría positivo sobre la explicación de por qué el literal no debe existir—.
 */

const SRC = join(__dirname, '..', 'src');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const BUYLIST = read('modules/buylist/buylist.service.ts');
const INVENTORY = read('modules/inventory/inventory.service.ts');
const PRICING = read('modules/pricing/pricing.service.ts');

// ============================================================================================
describe('BL-29 — la proyección de CLIENTE no puede heredar el ciclo por descuido', () => {
  /** El cuerpo de `toCustomerSellRequestDTO`, aislado. */
  function customerProjection(): string {
    const start = BUYLIST.indexOf('function toCustomerSellRequestDTO(');
    expect(start).toBeGreaterThan(-1);
    const end = BUYLIST.indexOf('\n}', start);
    return BUYLIST.slice(start, end);
  }

  it('se construye desde la BASE compartida, NO desde la proyección de admin', () => {
    // La dirección de la herencia **es** la garantía: desde la base, lo admin-only no está presente
    // «porque no se lee». Desde la de admin, está presente salvo que alguien lo reste.
    expect(customerProjection()).toContain('toSellRequestBaseDTO(r)');
    expect(customerProjection()).not.toContain('toAdminSellRequestDTO(');
  });

  it('⚠️ NO menciona NINGUNO de los campos admin-only del ciclo', () => {
    // Lista LITERAL del contrato (§6: «lo que NUNCA viaja al cliente») + los que §11 declara
    // admin-only. Si alguien añade uno a la proyección de cliente, este test lo nombra.
    const prohibidos = [
      'offerState',
      'offerGrossCents',
      'offerShippingFeeCents',
      'offerNetCents',
      'offerIssueDeadlineAt',
      'offerReissueCount',
      'offerReissueAlert',
      'declinedBy',
      'payoutNetCents',
      'guideActualCostCents',
      'isPayable',
      'paidBy',
      'closedAt',
    ];
    const cuerpo = customerProjection();
    for (const campo of prohibidos) {
      expect({ campo, presente: cuerpo.includes(campo) }).toEqual({ campo, presente: false });
    }
  });

  it('la BASE compartida tampoco los lleva (si los llevara, la resta volvería por la puerta de atrás)', () => {
    const start = BUYLIST.indexOf('function toSellRequestBaseDTO(');
    expect(start).toBeGreaterThan(-1);
    const base = BUYLIST.slice(start, BUYLIST.indexOf('\n}', start));
    for (const campo of ['offerState', 'offerNetCents', 'isPayable', 'paidBy', 'closedAt', 'payoutNetCents']) {
      expect({ campo, presente: base.includes(campo) }).toEqual({ campo, presente: false });
    }
  });

  it('y el ciclo SÍ sale por la proyección de ADMIN (los 24 campos de `AdminBuylistDTO`)', () => {
    const start = BUYLIST.indexOf('private adminSellRequestDTO(');
    expect(start).toBeGreaterThan(-1);
    const admin = BUYLIST.slice(start, BUYLIST.indexOf('\n  }', start));
    // ⚠️ El defecto B7 fue **omisión**, no error: los datos estaban en la BD y el DTO no los
    // nombraba. Por eso el guard enumera y no muestrea.
    for (const campo of [
      'offerState',
      'offerSentAt',
      'offerGrossCents',
      'offerShippingFeeCents',
      'offerNetCents',
      'offerAcceptDeadlineAt',
      'acceptedAt',
      'guideSentAt',
      'shipDeadlineAt',
      'shipmentCarrier',
      'shipmentTrackingNumber',
      'sellerShippedDeclaredAt',
      'shipmentConfirmedAt',
      'guideCancellationPendingAt',
      'guideCancellationDoneAt',
      'guideActualCostCents',
      'expiredReason',
      'declinedBy',
      'offerReissueCount',
      'offerReissueAlert',
      'payoutNetCents',
      'offerIssueDeadlineFields',
      'isPayable',
    ]) {
      expect({ campo, presente: admin.includes(campo) }).toEqual({ campo, presente: true });
    }
    // ⚠️ `isTerminal` NO se busca aquí a propósito: sale de la BASE compartida porque **viaja en las
    // DOS proyecciones** (§4.39c sitio 9 — las dos pantallas hacen la misma pregunta). Que esté en
    // la base y no aquí es la conducta correcta, no una omisión.
    expect(admin).toContain('toSellRequestBaseDTO(r)');
    const base = BUYLIST.slice(
      BUYLIST.indexOf('function toSellRequestBaseDTO('),
      BUYLIST.indexOf('\n}', BUYLIST.indexOf('function toSellRequestBaseDTO(')),
    );
    expect(base).toContain('isTerminal: isTerminalSellRequestStatus(');
  });
});

// ============================================================================================
describe('R3 — `pendingQueueKey` es LA MISMA llave que el dedupe de `escalatePending`', () => {
  /** Los SEIS componentes de la clave lógica de la cola de precio pendiente. */
  const COMPONENTES = [
    'cardId',
    'productType',
    'gradeKey',
    'finish',
    'cardProductId',
    'sealedProductId',
  ] as const;

  it('el `where` de dedupe de `escalatePending` usa los SEIS (es la definición de referencia)', () => {
    const start = PRICING.indexOf('pendingPriceEntry.findFirst(');
    expect(start).toBeGreaterThan(-1);
    const where = PRICING.slice(start, start + 400);
    for (const c of COMPONENTES) {
      expect({ c, presente: where.includes(c) }).toEqual({ c, presente: true });
    }
    expect(where).toContain("status: 'open'");
  });

  it('⚠️ `pendingQueueKey` construye la llave con los SEIS, `cardProductId` incluido', () => {
    const start = INVENTORY.indexOf('function pendingQueueKey(');
    expect(start).toBeGreaterThan(-1);
    const fn = INVENTORY.slice(start, INVENTORY.indexOf('\n}', start));
    for (const c of COMPONENTES) {
      expect({ c, presente: fn.includes(c) }).toEqual({ c, presente: true });
    }
    // El defecto exacto: con CINCO componentes, **una promo y su versión del set base colapsaban**
    // en la misma entrada — y `buylist` sí abre entradas con `cardProductId` no nulo.
    expect(fn).toContain('cardProductId');
  });

  it('`openPendingEntriesFor` SELECCIONA `cardProductId` (sin la columna, la llave sería mentira)', () => {
    const start = INVENTORY.indexOf('private async openPendingEntriesFor(');
    expect(start).toBeGreaterThan(-1);
    const fn = INVENTORY.slice(start, INVENTORY.indexOf('\n  }', start));
    expect(fn).toContain('cardProductId: true');
    expect(fn).toContain('cardProductId: r.cardProductId');
  });

  it('el docblock de `pendingQueueKey` está PEGADO a `pendingQueueKey` (y no a su vecina)', () => {
    // El defecto original no fue solo la llave: el comentario que la describía vivía **sobre
    // `variantPublishMatches`**, que ya tiene el suyo. *Un docblock que describe a su vecino es peor
    // que ninguno: el siguiente lector cree haber leído el contrato.*
    const raw = readFileSync(join(SRC, 'modules/inventory/inventory.service.ts'), 'utf8');
    const decl = raw.indexOf('function pendingQueueKey(');
    const doc = raw.lastIndexOf('/**', decl);
    const entreMedias = raw.slice(raw.indexOf('*/', doc) + 2, decl).trim();
    // Entre el docblock y la declaración no puede haber NADA (ni otra función, ni otro docblock).
    expect(entreMedias).toBe('');
    expect(raw.slice(doc, decl)).toContain('escalatePending');
  });
});
