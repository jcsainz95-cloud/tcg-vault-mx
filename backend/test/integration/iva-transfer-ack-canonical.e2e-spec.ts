import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

/**
 * iva-transfer-ack-canonical.e2e-spec.ts — ⭐⭐ **`REL-A`, EL POC DEL PENTESTER, CONTRA HTTP Y
 * POSTGRES REALES.** (`ARCHITECTURE §4.56.1` `D-ACUSE-1`, `API_CONTRACT §M10-IVA.2` punto 3,
 * candado `IVA-14`, criterios **188** / **213**.)
 *
 * ### Por qué AQUÍ y no solo en unitarios
 * La batería aritmética y de conducta vive en `test/settings.iva-transfer-ack-canonical.spec.ts`,
 * que es donde se puede barrer `r × t` al centavo sin levantar nada. Lo que **solo** esta suite puede
 * decir son las tres afirmaciones que el pentester midió sobre el sistema vivo y que un doble no
 * sostiene:
 *
 *  1. Que el `422` sale **por HTTP**, con el sobre de error del contrato, y con el `super_admin`
 *     real autenticado — no que una función lance.
 *  2. ⭐⭐ Que **la FILA de `ConfigSetting` no se mueve**. *El estado de la base es el hecho; el
 *     código de estado es solo cómo se cuenta.* Su PoC se cerró midiendo la fila, y así se cierra.
 *  3. Que el camino **legítimo** sigue abierto de punta a punta: `/preview` → acuse con el `L`
 *     canónico → `200` → fila movida → entrada en la bitácora.
 *
 * ### ⚠️ Este fichero MUEVE EL DIAL, y lo restaura — dicho aquí porque el pentester tuvo que decirlo
 * El caso legítimo mueve `iva_transfer_pct` de `100` a `50` contra la base real. El `afterAll`
 * **restaura `100` por SQL y lo vuelve a leer para comprobarlo**, y además cada `it` que escribe
 * deja el dial donde lo encontró. *Un test de una puerta de dinero que deja la puerta abierta es un
 * defecto, no un test.*
 */
describe('⭐⭐ `REL-A` / `D-ACUSE-1` — el acuse del dial, sobre HTTP y Postgres reales', () => {
  let h: E2EHarness;
  let adminToken: string;

  /** El dial, leído de la FILA. Es el único hecho que cuenta aquí. */
  async function dial(): Promise<unknown> {
    const fila = await h.prisma.configSetting.findUnique({ where: { key: 'iva_transfer_pct' } });
    return fila?.valueJson;
  }

  /** Devuelve el dial a `100` (el NEUTRO sembrado) sin pasar por la puerta. */
  async function restaurarDial(): Promise<void> {
    await h.prisma.configSetting.update({
      where: { key: 'iva_transfer_pct' },
      data: { valueJson: 100 },
    });
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    await restaurarDial();
  });

  afterAll(async () => {
    // ⚠️ Restaurar **y VERIFICAR**: un `update` que no se relee es una intención, no una medición.
    await restaurarDial();
    const final = await dial();
    if (final !== 100) {
      throw new Error(
        `el dial iva_transfer_pct quedó en ${String(final)} y debía quedar en 100 — ` +
          'esta suite mueve una puerta de dinero y tiene que devolverla donde estaba',
      );
    }
    await h.close();
  });

  beforeEach(async () => {
    await restaurarDial();
    expect(await dial()).toBe(100);
  });

  it('control positivo — el `super_admin` llega a la puerta y el dial arranca en 100 (el NEUTRO)', async () => {
    expect(await dial()).toBe(100);
    const res = await h.api('GET', '/admin/settings/iva-transfer', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.ivaTransferPct).toBe(100);
    expect(res.body.samplePriceCents).toBe(10000);
  });

  it('⭐⭐ EL POC LITERAL DEL PENTESTER ⇒ `422`, y ⛔ LA FILA SIGUE EN 100', async () => {
    // El cuerpo exacto de `PENTEST_NOTES · REL-A`. En su medición esto devolvió **`200`** y el dial
    // **se movió a 50** habiendo «mostrado» MX$0.00, cuando el costo real a MX$100 es −690
    // centavos/unidad (~7 %).
    const res = await h.api('PUT', '/admin/settings/iva-transfer', {
      token: adminToken,
      json: {
        ivaTransferPct: 50,
        acknowledgement: { samplePriceCents: 1, previewedNetDeltaCents: 0 },
      },
    });
    expect(res.status).toBe(422);
    expect(res.status).not.toBe(200);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toMatchObject({ field: 'acknowledgement.samplePriceCents' });
    // ⭐ El `message` nombra el valor canónico: un rechazo que no lo dice enseña a probar valores.
    expect(res.body.error.message).toContain('10000');
    // ⭐⭐ EL HECHO: la fila no se movió.
    expect(await dial()).toBe(100);
  });

  it('⭐ el PoC repetido N=10 veces ⇒ 10 rechazos y la fila sigue en 100 (⛔ no es una tirada con suerte)', async () => {
    const estados: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await h.api('PUT', '/admin/settings/iva-transfer', {
        token: adminToken,
        json: {
          ivaTransferPct: 50,
          acknowledgement: { samplePriceCents: 1, previewedNetDeltaCents: 0 },
        },
      });
      estados.push(res.status);
    }
    expect(estados).toEqual(Array(10).fill(422));
    expect(await dial()).toBe(100);
  });

  it.each([0, 1, 10, 30, 9999, 10001, 50000, 100000000, 2000000000, 1.5, '10000', null, true])(
    '⛔ `samplePriceCents: %p` ⇒ `422` sobre HTTP y la fila sigue en 100',
    async (sample) => {
      const res = await h.api('PUT', '/admin/settings/iva-transfer', {
        token: adminToken,
        json: {
          ivaTransferPct: 50,
          // El delta que el servidor recalcularía al `L` canónico: así el `422` no se puede
          // confundir con un `409`, y se ve que el rechazo llega ANTES de comparar.
          acknowledgement: { samplePriceCents: sample, previewedNetDeltaCents: -690 },
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toMatchObject({ field: 'acknowledgement.samplePriceCents' });
      expect(await dial()).toBe(100);
    },
  );

  it('⭐⭐ EL CAMINO LEGÍTIMO, ENTERO: `/preview` → acuse canónico → `200` → fila en 50 → bitácora', async () => {
    // *`O-4`: que exista el `422` no significa que el dueño pueda seguir moviendo su dial.* Este `it`
    // recorre el ciclo como lo recorre la pantalla: pregunta el costo, firma **la cifra que el
    // servidor le devolvió**, y comprueba el efecto en la fila y en la bitácora.
    const prev = await h.api('GET', '/admin/settings/iva-transfer/preview?ivaTransferPct=50', {
      token: adminToken,
    });
    expect(prev.status).toBe(200);
    expect(prev.body.samplePriceCents).toBe(10000);
    expect(prev.body.netDeltaPerUnitCents).toBe(-690);

    const antes = await h.prisma.auditLog.count({ where: { entityId: 'iva_transfer_pct' } });
    const res = await h.api('PUT', '/admin/settings/iva-transfer', {
      token: adminToken,
      json: {
        ivaTransferPct: 50,
        acknowledgement: {
          // ⛔ Tal cual lo devolvió el preview, no recompuesto — igual que hace la pantalla.
          samplePriceCents: prev.body.samplePriceCents,
          previewedNetDeltaCents: prev.body.netDeltaPerUnitCents,
        },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.ivaTransferPct).toBe(50);
    expect(res.body.preview.netDeltaPerUnitCents).toBe(-690);
    expect(await dial()).toBe(50);
    expect(await h.prisma.auditLog.count({ where: { entityId: 'iva_transfer_pct' } })).toBe(antes + 1);

    await restaurarDial();
    expect(await dial()).toBe(100);
  });

  it('⭐ el `409 IVA_TRANSFER_ACK_STALE` sigue vivo con el `L` canónico (el `422` no se lo comió)', async () => {
    const res = await h.api('PUT', '/admin/settings/iva-transfer', {
      token: adminToken,
      json: {
        ivaTransferPct: 50,
        acknowledgement: { samplePriceCents: 10000, previewedNetDeltaCents: -689 },
      },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IVA_TRANSFER_ACK_STALE');
    expect(res.body.error.details).toMatchObject({ expectedNetDeltaCents: -690 });
    expect(await dial()).toBe(100);
  });

  it('⭐⭐ COROLARIO — ⛔ el eje del `/preview` NO se tocó: explorar sigue siendo libre y SIN efectos', async () => {
    // `samplePriceCents` conserva su dominio entero `[1, 100 000 000]`: la pregunta *«¿y sobre una
    // pieza de MX$2 000?»* es legítima y el dueño tiene derecho a hacérsela.
    for (const sample of [1, 200000, 100000000]) {
      const res = await h.api(
        'GET',
        `/admin/settings/iva-transfer/preview?ivaTransferPct=50&samplePriceCents=${sample}`,
        { token: adminToken },
      );
      expect(res.status).toBe(200);
      expect(res.body.samplePriceCents).toBe(sample);
    }
    // Y el `L = 1` del PoC sigue respondiendo `0` — que es una VERDAD sobre un `L` diminuto. Lo que
    // se cerró no es la lectura: es que esa lectura pudiera autorizar una escritura.
    const uno = await h.api(
      'GET',
      '/admin/settings/iva-transfer/preview?ivaTransferPct=50&samplePriceCents=1',
      { token: adminToken },
    );
    expect(uno.body.netDeltaPerUnitCents).toBe(0);
    // ⛔ Preguntar no mueve el dial.
    expect(await dial()).toBe(100);
  });

  it('⛔ `IVA-8(b)` INTACTO: `PUT /admin/settings { ivaTransferPct }` sigue siendo `422` clave desconocida', async () => {
    const res = await h.api('PUT', '/admin/settings', {
      token: adminToken,
      json: { ivaTransferPct: 50 },
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await dial()).toBe(100);
  });

  it('⛔ `IVA-8(f)` INTACTO: el dial no sale en `GET /admin/settings`', async () => {
    const res = await h.api('GET', '/admin/settings', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('ivaTransferPct');
    expect(Object.keys(res.body).filter((k) => /transfer/i.test(k))).toEqual([]);
  });
});
