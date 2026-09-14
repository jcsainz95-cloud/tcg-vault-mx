import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';
import { SettingKey } from '../src/modules/settings/settings.constants';
import {
  IVA_TRANSFER_GATE_LOCK_KEY,
  displayPriceCentsOf,
  ivaTransferPosition,
  ivaTransferPreview,
  taxBaseCentsOf,
} from '../src/modules/settings/iva-transfer';
import { StripeFeeConfig, grossUpTotal } from '../src/common/money';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⭐⭐ **LA PUERTA DEL DIAL DE TRASLACIÓN DEL IVA — `PUT /admin/settings/iva-transfer`.**
 * (v1.74 / **D56**; `API_CONTRACT §M10-IVA.2` y `§M10-IVA.9`, `ARCHITECTURE §4.55`, criterio **213**,
 * candados **`IVA-7`**, **`IVA-8(b)(c)(d)(e)`**.)
 *
 * **Qué mide este fichero, y ninguno mide el nombre de un campo: todos miden QUÉ DINERO SALE.**
 *  1. **La aritmética del dial, al centavo, contra las cifras que `PROJECT §Q.4` publica.** Las tres
 *     posiciones —`100`, `50`, `0`— y el **delta en pesos** del criterio 188 (`−690`).
 *  2. **El acuse, que es la puerta:** obligatorio en cuanto el valor **cambia** (`422
 *     IVA_TRANSFER_ACK_REQUIRED`), rechazado si la cifra confirmada no es la del servidor (`409
 *     IVA_TRANSFER_ACK_STALE`), y ⛔ **en los dos casos SIN ESCRIBIR**.
 *  3. **`IVA-7`, por lo negativo:** mover el dial de traslación ⛔ **no mueve la comisión**, y
 *     `getStripeFee()` **no contiene una sola referencia a `IVA_TRANSFER_PCT`** — *rojo en cuanto
 *     aparezca, aunque los números cuadren ese día*.
 *  4. **`IVA-8(b)`, intacto tras D56:** la clave sigue **fuera** de `SETTING_DTO_MAP` ⇒ el `PUT`
 *     genérico la rechaza como clave desconocida **y la fila no se mueve**. *La puerta es UNA.*
 *
 * ⚠️ **Por qué el harness ESPEJA el rollback y no solo cuenta llamadas.** Los tres rechazos de esta
 * puerta prometen *«⛔ no escribe»*. Un doble que ignore la transacción daría verde a una
 * implementación que escribe y luego lanza — que es exactamente el defecto `P48-B1(2)` un endpoint
 * más allá. Aquí, si el callback lanza, lo escrito **se revierte**, y los tests asertan sobre el
 * estado final.
 */

/** Los diales vigentes del fixture canónico de `IVA-1`: `r = 16`, `0.036` / `300`, dial en `100`. */
const FEE: StripeFeeConfig = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

function harness(seed: Partial<Record<string, unknown>> = {}) {
  const rows = new Map<string, unknown>([
    [SettingKey.IVA_PCT, 16],
    [SettingKey.IVA_TRANSFER_PCT, 100],
    [SettingKey.STRIPE_FEE_PCT, 0.036],
    [SettingKey.STRIPE_FEE_FIXED_CENTS, 300],
    ...Object.entries(seed),
  ]);
  const audited: Array<Record<string, unknown>> = [];
  const locks: unknown[] = [];

  // ⭐ La TRAZA es lo que permite asertar el ORDEN («candado → releer → validar»), y no solo que el
  // candado se llamó. Un test que solo cuenta la llamada da verde a la versión que lee ANTES —que es
  // exactamente el defecto `S-FX-1`— porque ahí el candado también se llama.
  const traza: string[] = [];

  const client = {
    configSetting: {
      findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
        traza.push(`read:${where.key}`);
        return rows.has(where.key) ? { key: where.key, valueJson: rows.get(where.key) } : null;
      }),
      upsert: jest.fn(async ({ where, create }: { where: { key: string }; create: { valueJson: unknown } }) => {
        traza.push(`write:${where.key}`);
        rows.set(where.key, create.valueJson);
        return {};
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: { data: unknown }) => audited.push(data as never)) },
    // `pg_advisory_xact_lock` — aquí solo se registra que se TOMÓ, y en qué orden respecto a la
    // lectura del vigente (que es la mitad que hace que el candado sirva).
    $executeRaw: jest.fn(async (_q: TemplateStringsArray, ...values: unknown[]) => {
      traza.push(`lock:${String(values[0])}`);
      locks.push(values[0]);
      return 1;
    }),
  };

  const prisma = {
    ...client,
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const snapshot = new Map(rows);
      const snapshotAudit = audited.length;
      try {
        return await cb(client);
      } catch (e) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        audited.length = snapshotAudit;
        throw e;
      }
    }),
  } as unknown as PrismaService;

  return {
    svc: new SettingsService(prisma),
    rows,
    audited,
    locks,
    traza,
    dial: () => rows.get(SettingKey.IVA_TRANSFER_PCT),
  };
}

/** Espeja el callback del controller: la bitácora entra DENTRO de la transacción del dial. */
const auditWithin = async (
  tx: { auditLog: { create: (a: unknown) => Promise<unknown> } },
  change: { before: number; after: number },
) => {
  await tx.auditLog.create({
    data: {
      action: 'settings.update',
      entityId: SettingKey.IVA_TRANSFER_PCT,
      before: { ivaTransferPct: change.before },
      after: { ivaTransferPct: change.after },
    },
  });
};

describe('⭐⭐ La ARITMÉTICA del dial — las cifras de `PROJECT §Q.4`, al centavo', () => {
  // `API_CONTRACT §M10-IVA.2`, tabla de «valores exactos que este endpoint debe devolver», y
  // `§M10-IVA.5` candado `IVA-1` («el viaje completo, que es lo que lo hace un candado y no una
  // constante copiada»). Con `L = MX$100.00` y `r = 16`.
  it.each([
    [100, 11600, 10000, 1600, 12469],
    [50, 10800, 9310, 1490, 11634],
    [0, 10000, 8621, 1379, 10799],
  ])(
    'dial %i %% ⇒ exhibido %i · base %i · IVA %i · cobrado %i',
    (t, display, base, iva, total) => {
      const p = ivaTransferPosition(10_000, t, 16, FEE);
      expect(p.displayPriceCents).toBe(display);
      expect(p.taxBaseCents).toBe(base);
      expect(p.ivaCents).toBe(iva);
      expect(p.netRevenueCents).toBe(base);
      expect(p.totalChargedCents).toBe(total);
    },
  );

  it('⭐⭐ `IVA-1` — el arranque es NEUTRO: con el dial en 100 el margen no se movió (neto 10000)', () => {
    // El candado de la feature y del criterio 185: es una IGUALDAD CONTRA EL PASADO. Hoy, sobre
    // MX$100.00, el cliente paga 12469 y la plataforma se queda 10000. **Rojo con 12468 o 12470.**
    const p = ivaTransferPosition(10_000, 100, 16, FEE);
    expect(p.totalChargedCents).toBe(12_469);
    expect(p.netRevenueCents).toBe(10_000);
  });

  it('⭐ el delta del criterio 188: pasar de 100 a 50 cuesta **−690** por unidad', () => {
    const pv = ivaTransferPreview({
      currentPct: 100,
      proposedPct: 50,
      ivaRatePct: 16,
      samplePriceCents: 10_000,
      fee: FEE,
    });
    expect(pv.netDeltaPerUnitCents).toBe(-690);
    // Y el signo IMPORTA: negativo = margen cedido. Un delta positivo al BAJAR el dial significaría
    // que alguien invirtió la resta y la pantalla diría que absorber IVA gana dinero.
    expect(pv.netDeltaPerUnitCents).toBeLessThan(0);
    expect(pv.current.netRevenueCents).toBe(10_000);
    expect(pv.proposed.netRevenueCents).toBe(9_310);
  });

  it('⭐ `IVA-8(a)` — el IVA registrado ⛔ JAMÁS es 0, ni con el dial en 0 %', () => {
    // *Mover el dial reduce el NETO, nunca el IVA registrado.* Con el dial en 0 el exhibido es
    // 10000 y el IVA sigue siendo 1379: el impuesto no bajó, bajó el precio.
    for (const t of [0, 1, 37, 50, 99, 100]) {
      const p = ivaTransferPosition(10_000, t, 16, FEE);
      expect(p.ivaCents).toBeGreaterThan(0);
      expect(p.ivaCents).toBeLessThan(p.displayPriceCents);
    }
    expect(ivaTransferPosition(10_000, 0, 16, FEE).ivaCents).toBe(1_379);
  });

  it('⭐ `base + IVA == exhibido` es una IDENTIDAD, no una coincidencia (el IVA sale por RESTA)', () => {
    // Rojo si alguien «arregla» el residual calculándolo como `round(P × r)`: ahí la suma se
    // descuadra un centavo en cuanto el redondeo cae del otro lado.
    for (const L of [1, 7, 103, 250, 999, 7_777, 12_345, 8_888, 1_000_000]) {
      for (const t of [0, 1, 37, 50, 99, 100]) {
        const p = ivaTransferPosition(L, t, 16, FEE);
        expect(p.taxBaseCents + p.ivaCents).toBe(p.displayPriceCents);
        expect(p.netRevenueCents).toBe(p.taxBaseCents);
      }
    }
  });

  it('⭐ la aritmética ENTERA reproduce `round(L × (1 + t·r))` — ⛔ sin meter `1.16` en el camino', () => {
    // `IVA-4(d)`: `round(L×(1+t·r)) = L + round(L×t·r)`, y con `r = 16` no hay empate en `.5` para
    // ningún `t` ni ningún `L`. Se comprueba sobre el dominio, no sobre un ejemplo.
    for (let L = 1; L <= 2_000; L++) {
      for (const t of [0, 37, 50, 100]) {
        expect(displayPriceCentsOf(L, t, 16)).toBe(Math.round(L * (1 + (t / 100) * 0.16)));
      }
    }
    // El caso nombrado del contrato: una pieza de 103 con el dial en 100 ⇒ 119, idéntico a hoy.
    expect(displayPriceCentsOf(103, 100, 16)).toBe(119);
    expect(taxBaseCentsOf(119, 16)).toBe(103);
  });

  it('el total cobrado es el MISMO gross-up de siempre sobre el exhibido (⛔ ningún cuarto sumando)', () => {
    for (const t of [0, 50, 100]) {
      const p = ivaTransferPosition(10_000, t, 16, FEE);
      expect(p.totalChargedCents).toBe(grossUpTotal(p.displayPriceCents, FEE));
    }
  });
});

describe('⭐⭐ `PUT /admin/settings/iva-transfer` — el ACUSE es la puerta (`IVA-8(c)`)', () => {
  const ackOk = { samplePriceCents: 10_000, previewedNetDeltaCents: -690 };

  it('⭐ con acuse correcto: escribe, audita con `before`/`after` y devuelve el preview', async () => {
    const h = harness();
    const res = await h.svc.setIvaTransferPct({ ivaTransferPct: 50, acknowledgement: ackOk }, 'u1', auditWithin);
    expect(res.ivaTransferPct).toBe(50);
    expect(res.preview.netDeltaPerUnitCents).toBe(-690);
    expect(h.dial()).toBe(50);
    expect(h.audited).toHaveLength(1);
    expect(h.audited[0]).toMatchObject({
      action: 'settings.update',
      entityId: 'iva_transfer_pct',
      before: { ivaTransferPct: 100 },
      after: { ivaTransferPct: 50 },
    });
  });

  it('⭐⭐ SIN acuse y cambiando el valor ⇒ `422 IVA_TRANSFER_ACK_REQUIRED` y ⛔ la fila sigue en 100', async () => {
    const h = harness();
    const err = await h.svc.setIvaTransferPct({ ivaTransferPct: 50 }, 'u1', auditWithin).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('IVA_TRANSFER_ACK_REQUIRED');
    expect((err as BusinessException).getStatus()).toBe(422);
    expect(h.dial()).toBe(100);
    expect(h.audited).toHaveLength(0);
  });

  it.each([
    ['sin `previewedNetDeltaCents`', { samplePriceCents: 10_000 }],
    ['sin `samplePriceCents`', { previewedNetDeltaCents: -690 }],
  ])('⭐ un acuse A MEDIAS (%s) es NO-acuse ⇒ `422 IVA_TRANSFER_ACK_REQUIRED`, sin escribir', async (_n, ack) => {
    const h = harness();
    const err = await h.svc
      .setIvaTransferPct({ ivaTransferPct: 50, acknowledgement: ack }, 'u1', auditWithin)
      .catch((e) => e);
    expect((err as BusinessException).code).toBe('IVA_TRANSFER_ACK_REQUIRED');
    expect(h.dial()).toBe(100);
  });

  it('⭐⭐ con un delta que NO cuadra ⇒ `409 IVA_TRANSFER_ACK_STALE` + `expectedNetDeltaCents`, sin escribir', async () => {
    const h = harness();
    const err = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 10_000, previewedNetDeltaCents: -689 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('IVA_TRANSFER_ACK_STALE');
    expect((err as BusinessException).getStatus()).toBe(409);
    expect((err as BusinessException).details).toEqual({ expectedNetDeltaCents: -690 });
    expect(h.dial()).toBe(100);
    expect(h.audited).toHaveLength(0);
  });

  it('⭐⭐ el acuse es del MOVIMIENTO, no del destino: el mismo −690 ya no vale si el vigente es 50', async () => {
    // *Es la mitad que hace que el acuse signifique algo.* Con el dial ya en 50, ir a 0 cuesta
    // −689, no −690: confirmar la cifra vieja es confirmar una cifra que ya no es la suya.
    const h = harness({ [SettingKey.IVA_TRANSFER_PCT]: 50 });
    const err = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 0, acknowledgement: { samplePriceCents: 10_000, previewedNetDeltaCents: -690 } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect((err as BusinessException).code).toBe('IVA_TRANSFER_ACK_STALE');
    expect((err as BusinessException).details).toEqual({ expectedNetDeltaCents: -689 });
    expect(h.dial()).toBe(50);
  });

  it('⭐⭐ `D-ACUSE-1` — el acuse ⛔ YA NO se valida contra SU `samplePriceCents`: `L = 50 000` es `422`', async () => {
    // ⚠️⚠️ **ESTE TEST ESTÁ INVERTIDO A PROPÓSITO, y la versión anterior era el hallazgo `REL-A`.**
    // Decía *«el acuse se valida contra SU `samplePriceCents`, no contra el de por defecto»* y
    // afirmaba un `200`. Esa frase **era** el agujero: si el `L` contra el que se compara lo elige
    // quien firma, basta elegirlo diminuto para que el delta redondee a `0` y el acuse cuadre con
    // MX$0.00 — que es lo que el pentester hizo en vivo, moviendo el dial `100 → 50`.
    // `L = 50 000` solo era su versión respetable; el mecanismo es el mismo.
    // Desde v1.76 el `L` lo fija el SERVIDOR (`ARCHITECTURE §4.56.1`, `§M10-IVA.2` punto 3).
    // La batería entera vive en `settings.iva-transfer-ack-canonical.spec.ts` (candado `IVA-14`).
    const h = harness();
    // La aritmética NO cambió: a `L = 50 000` el movimiento sigue costando −3448 por unidad. Lo que
    // cambió es que ese número **ya no puede autorizar una escritura**.
    const esperado = ivaTransferPreview({
      currentPct: 100,
      proposedPct: 50,
      ivaRatePct: 16,
      samplePriceCents: 50_000,
      fee: FEE,
    }).netDeltaPerUnitCents;
    expect(esperado).toBe(-3_448);
    const err = await h.svc
      .setIvaTransferPct(
        { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 50_000, previewedNetDeltaCents: esperado } },
        'u1',
        auditWithin,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('VALIDATION_ERROR');
    expect((err as BusinessException).getStatus()).toBe(422);
    expect((err as BusinessException).details).toMatchObject({
      field: 'acknowledgement.samplePriceCents',
    });
    expect(h.dial()).toBe(100);
    expect(h.audited).toHaveLength(0);
    // ⭐ Y la lectura conserva su eje: preguntar por `L = 50 000` sigue estando permitido.
    expect((await h.svc.previewIvaTransfer(50, 50_000)).netDeltaPerUnitCents).toBe(-3_448);
  });

  it('⭐ IDEMPOTENTE: el mismo valor vigente no pide acuse, no escribe y ⛔ no deja bitácora', async () => {
    // *No hay margen que ceder ⇒ no hay nada que acusar. Y una entrada que dice «cambió de 100 a
    // 100» es ruido que compite con las que sí importan.*
    const h = harness();
    const res = await h.svc.setIvaTransferPct({ ivaTransferPct: 100 }, 'u1', auditWithin);
    expect(res.ivaTransferPct).toBe(100);
    expect(res.preview.netDeltaPerUnitCents).toBe(0);
    expect(h.audited).toHaveLength(0);
    expect(h.dial()).toBe(100);
  });

  it('⭐⭐ el candado se toma ANTES de leer el vigente (orden `S-FX-1`: candado → releer → validar)', async () => {
    const h = harness();
    await h.svc.setIvaTransferPct({ ivaTransferPct: 50, acknowledgement: ackOk }, 'u1', auditWithin);
    // Se tomó, y con SU clave — no la del FX (`63_120_863`): compartirla serializaría dos diales
    // que no comparten ningún invariante.
    expect(h.locks).toEqual([IVA_TRANSFER_GATE_LOCK_KEY]);
    expect(IVA_TRANSFER_GATE_LOCK_KEY).not.toBe(63_120_863);
    // ⭐⭐ Y el ORDEN, que es la mitad que hace que el candado sirva: `lock` ANTES de la lectura del
    // vigente, y la ESCRITURA después de las dos. Con la lectura fuera del candado, la transacción
    // que espera su turno entra y valida el acuse contra el estado que vio **antes** de esperar.
    const lock = h.traza.indexOf(`lock:${IVA_TRANSFER_GATE_LOCK_KEY}`);
    const lee = h.traza.indexOf('read:iva_transfer_pct', lock);
    const escribe = h.traza.indexOf('write:iva_transfer_pct');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lee).toBeGreaterThan(lock);
    expect(escribe).toBeGreaterThan(lee);
    // ⛔ Y ninguna lectura del dial DENTRO de la transacción precede al candado.
    expect(h.traza.slice(0, lock)).not.toContain('read:iva_transfer_pct');
  });

  it('⛔ si la BITÁCORA revienta, el dial REVIERTE (efecto y registro commitean o revierten juntos)', async () => {
    const h = harness();
    const err = await h.svc
      .setIvaTransferPct({ ivaTransferPct: 50, acknowledgement: ackOk }, 'u1', async () => {
        throw new Error('boom en la bitácora');
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(h.dial()).toBe(100);
  });
});

describe('⭐ `IVA-8(d)` — la validación del valor, y el `message` nombra LOS DOS EXTREMOS', () => {
  it.each([37.5, -1, 101, 1_000, '50', null, true, NaN, Infinity, {}])(
    '`%p` ⇒ `422 VALIDATION_ERROR` y ⛔ la fila sigue en 100',
    async (v) => {
      const h = harness();
      const err = await h.svc.setIvaTransferPct({ ivaTransferPct: v }, 'u1', auditWithin).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessException);
      expect((err as BusinessException).code).toBe('VALIDATION_ERROR');
      expect((err as BusinessException).getStatus()).toBe(422);
      expect((err as BusinessException).message).toContain('0');
      expect((err as BusinessException).message).toContain('100');
      expect(h.dial()).toBe(100);
      expect(h.audited).toHaveLength(0);
    },
  );

  it('⛔ ni siquiera se toma el candado cuando el VALOR es inválido (se rechaza antes de la transacción)', async () => {
    const h = harness();
    await h.svc.setIvaTransferPct({ ivaTransferPct: 37.5 }, 'u1', auditWithin).catch(() => undefined);
    expect(h.locks).toEqual([]);
  });

  it.each([0, 1, 37, 50, 99, 100])('acepta el entero %i (criterio 187)', async (v) => {
    const h = harness();
    const pv = ivaTransferPreview({
      currentPct: 100,
      proposedPct: v,
      ivaRatePct: 16,
      samplePriceCents: 10_000,
      fee: FEE,
    });
    const res = await h.svc.setIvaTransferPct(
      {
        ivaTransferPct: v,
        acknowledgement: { samplePriceCents: 10_000, previewedNetDeltaCents: pv.netDeltaPerUnitCents },
      },
      'u1',
      auditWithin,
    );
    expect(res.ivaTransferPct).toBe(v);
  });

  it.each([0, -1, 1, 1.5, '10000', null, 9_999, 10_001])(
    '⛔ `acknowledgement.samplePriceCents = %p` ⇒ `422 VALIDATION_ERROR`, sin escribir',
    async (sample) => {
      // ⚠️ **La lista de esta tabla era `[0, -1, 1.5, '10000', null]` y el `1` NO estaba** — ése es
      // `REL-A` en una línea. `L = 0` daría delta 0 para CUALQUIER par de posiciones, sí; pero
      // **`L = 1` también**, y ése pasaba. *La forma más barata de desactivar una puerta de dinero es
      // encontrarle el argumento que la vuelve trivial — y el validador solo razonó el borde `0`.*
      // Desde `D-ACUSE-1` el único valor legal es el `L` canónico, así que los vecinos `9 999` y
      // `10 001` también entran en la tabla: la puerta ya no es un rango.
      const h = harness();
      const err = await h.svc
        .setIvaTransferPct(
          { ivaTransferPct: 50, acknowledgement: { samplePriceCents: sample, previewedNetDeltaCents: 0 } },
          'u1',
          auditWithin,
        )
        .catch((e) => e);
      expect((err as BusinessException).code).toBe('VALIDATION_ERROR');
      expect(h.dial()).toBe(100);
    },
  );

  it.each([-690.5, '−690', null, NaN])(
    '⛔ `acknowledgement.previewedNetDeltaCents = %p` ⇒ `422 VALIDATION_ERROR`, sin escribir',
    async (delta) => {
      const h = harness();
      const err = await h.svc
        .setIvaTransferPct(
          { ivaTransferPct: 50, acknowledgement: { samplePriceCents: 10_000, previewedNetDeltaCents: delta } },
          'u1',
          auditWithin,
        )
        .catch((e) => e);
      expect((err as BusinessException).code).toBe('VALIDATION_ERROR');
      expect(h.dial()).toBe(100);
    },
  );
});

describe('⛔⛔ `IVA-7` — mover un PRECIO no mueve una COMISIÓN, y D56 no lo roza', () => {
  it('⭐ mover `iva_transfer_pct` de 100 a 0 deja `getStripeFee()` IDÉNTICA', async () => {
    const h = harness();
    const antes = await h.svc.getStripeFee();
    await h.svc.setIvaTransferPct(
      { ivaTransferPct: 0, acknowledgement: { samplePriceCents: 10_000, previewedNetDeltaCents: -1_379 } },
      'u1',
      auditWithin,
    );
    expect(h.dial()).toBe(0);
    expect(await h.svc.getStripeFee()).toEqual(antes);
    expect((await h.svc.getStripeFee()).stripeFeeIvaPct).toBe(0.16);
  });

  it('⭐ el espejo: mover la TASA `iva_pct` ⛔ no toca la fila `iva_transfer_pct`', async () => {
    const h = harness();
    await h.svc.update({ ivaPct: 8 }, 'u1');
    expect(h.rows.get(SettingKey.IVA_PCT)).toBe(8);
    expect(h.dial()).toBe(100);
  });

  it('⭐⭐ POR AUSENCIA, sobre el CÓDIGO: `getStripeFee()` no contiene ninguna referencia al dial', () => {
    // *Rojo en cuanto aparezca, aunque los números cuadren ese día.* Se recorta el cuerpo de la
    // función y se mira dentro: si el dial de traslación entrara ahí, mover un precio movería una
    // comisión para TODO el catálogo, y los números del día del cambio no lo delatarían.
    const src = readFileSync(join(__dirname, '../src/modules/settings/settings.service.ts'), 'utf8');
    const i = src.indexOf('async getStripeFee(');
    expect(i).toBeGreaterThan(-1);
    const cuerpo = src.slice(i, src.indexOf('\n  }', i));
    expect(cuerpo).not.toMatch(/IVA_TRANSFER_PCT|iva_transfer_pct|ivaTransferPct/);
  });
});

describe('⛔ `IVA-8(b)` — LA PUERTA ES UNA, y D56 NO la duplicó', () => {
  it('`PUT /admin/settings { ivaTransferPct: 50 }` ⇒ `422` clave desconocida y la fila sigue en 100', async () => {
    const h = harness();
    const err = await h.svc.update({ ivaTransferPct: 50 }, 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(BusinessException);
    expect((err as BusinessException).code).toBe('VALIDATION_ERROR');
    expect((err as BusinessException).details).toEqual({
      errors: { ivaTransferPct: 'unknown setting key' },
    });
    expect(h.dial()).toBe(100);
  });

  it('tampoco entra con su nombre de FILA (`iva_transfer_pct`) por el `PUT` genérico', async () => {
    const h = harness();
    const err = await h.svc.update({ iva_transfer_pct: 50 }, 'u1').catch((e) => e);
    expect((err as BusinessException).code).toBe('VALIDATION_ERROR');
    expect(h.dial()).toBe(100);
  });
});

describe('la LECTURA del dial (§M10-IVA.1) sale de su propia fila, no del mapa de DTOs', () => {
  it('`getIvaTransferPct()` devuelve el seed 100 cuando la fila no existe', async () => {
    const h = harness();
    h.rows.delete(SettingKey.IVA_TRANSFER_PCT);
    expect(await h.svc.getIvaTransferPct()).toBe(100);
  });

  it('`previewIvaTransfer()` usa la TASA vigente, no una constante: con `iva_pct = 8` el delta cambia', async () => {
    const h = harness({ [SettingKey.IVA_PCT]: 8 });
    const pv = await h.svc.previewIvaTransfer(50);
    expect(pv.ivaRatePct).toBe(8);
    // `P(100) = 10800`, base `10000`; `P(50) = 10400`, base `round(1040000/108) = 9630` ⇒ −370.
    expect(pv.current.netRevenueCents).toBe(10_000);
    expect(pv.proposed.netRevenueCents).toBe(9_630);
    expect(pv.netDeltaPerUnitCents).toBe(-370);
  });
});
