import { SettingsController } from '../src/modules/settings/settings.controller';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import {
  IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT,
  IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX,
} from '../src/modules/settings/iva-transfer';
import { BusinessException } from '../src/common/business.exception';
import { MAX_CENTS, grossUpTotal } from '../src/common/money';

/**
 * ⭐⭐ **`GET /api/v1/admin/settings/iva-transfer/preview` — LOS DOS EJES, SUS COTAS, Y EL `500` QUE
 * LA COTA CIERRA.** (`API_CONTRACT §M10-IVA.2` punto 2, `N-IVA9-1` resuelto en v1.75, criterio
 * **188**; `ARCHITECTURE §9 · D-IVA-13`.)
 *
 * ### ⭐⭐ `N-IVA9-7` — LO QUE EL ARQUITECTO MARCÓ «NO MEDIDO», MEDIDO
 * El contrato dice, literal: *«⚠️ **NO MEDIDO por mí que hoy produzca un `500`: el endpoint no existe
 * todavía.** Esto es una **norma sobre código por escribir**… la medición que la cierra es un
 * `GET …?samplePriceCents=2000000000` una vez construido»*.
 *
 * **Medido en este pase, y el resultado tiene un matiz que el contrato no anticipó:**
 *  1. **La norma era CORRECTA**: sin cota, `grossUpTotal` **LANZA** un `Error` pelado
 *     (*«total exceeds MAX_CENTS»*) que el filtro global ⛔ **no mapea** ⇒ `500` desde la barra de
 *     direcciones con sesión `super_admin`. Se reproduce abajo, llamando a la aritmética sin cota.
 *  2. ⚠️ **Y NO era solo del `/preview`.** `validateSamplePriceCents` —el validador del **acuse del
 *     `PUT`**, que ya existía— admitía hasta `MAX_CENTS`, así que **el `PUT` tenía el mismo `500`
 *     antes de que el `/preview` existiera**. La cota se aplicó a **las dos puertas**.
 *
 * ### El contrato de query, y por qué `400` y no `422`
 * **Es QUERY, no cuerpo** (§0-Q punto 2). `400` aquí y `422` en el cuerpo del `PUT` **para el mismo
 * valor inválido es CORRECTO y ya es doctrina**. ⛔ No se «armoniza».
 *
 * ### ⛔ Y `ivaTransferPct` ausente NO es «no filtres»: es `400`
 * La fila 1 de §0-Q («vacío ⇒ no filtra») **no aplica aquí**: este eje **no es un filtro, es LA
 * PREGUNTA**. Un preview sin posición propuesta no tiene respuesta que dar, y devolver la vigente
 * sería **contestar otra pregunta**.
 */

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };

function controller(dialVigente = 100, tasa = 16) {
  const rows = new Map<string, unknown>([
    [SettingKey.IVA_PCT, tasa],
    [SettingKey.IVA_TRANSFER_PCT, dialVigente],
    [SettingKey.STRIPE_FEE_PCT, 0.036],
    [SettingKey.STRIPE_FEE_FIXED_CENTS, 300],
  ]);
  const prisma = {
    configSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        rows.has(where.key) ? { key: where.key, valueJson: rows.get(where.key) } : null,
    },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  return new SettingsController(settings, {} as AuditService, prisma);
}

/** Captura el error de una promesa, sin `rejects` (para poder inspeccionar código y `details`). */
async function capturar(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

describe('⭐⭐ `/preview` — el camino feliz devuelve las cifras del criterio 188', () => {
  it('con `?ivaTransferPct=50` (vigente 100) devuelve el delta de **−690** en pesos', async () => {
    const res: any = await controller().previewIvaTransfer('50');
    expect(res.ivaRatePct).toBe(16);
    expect(res.samplePriceCents).toBe(10_000);
    expect(res.current.ivaTransferPct).toBe(100);
    expect(res.current.displayPriceCents).toBe(11_600);
    expect(res.current.netRevenueCents).toBe(10_000);
    expect(res.proposed.ivaTransferPct).toBe(50);
    expect(res.proposed.displayPriceCents).toBe(10_800);
    expect(res.proposed.netRevenueCents).toBe(9_310);
    // ⭐ **La cifra que el criterio 188 exige mostrar antes de guardar.**
    expect(res.netDeltaPerUnitCents).toBe(-690);
  });

  it('⭐ el `samplePriceCents` es OPCIONAL: ausente, vacío o SOLO ESPACIOS ⇒ 10000', async () => {
    for (const raw of [undefined, '', '   ']) {
      const res: any = await controller().previewIvaTransfer('0', raw);
      expect(res.samplePriceCents).toBe(IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT);
    }
    // *Un `?samplePriceCents=` que manda un input vacío no es un error*: es la fila 1 de §0-Q
    // aplicada donde SÍ corresponde.
  });

  it('⭐ y cuando SÍ viene, gobierna: el preview se calcula sobre ESE `L`', async () => {
    const res: any = await controller().previewIvaTransfer('50', '200000');
    expect(res.samplePriceCents).toBe(200_000);
    expect(res.current.displayPriceCents).toBe(232_000);
    expect(res.proposed.displayPriceCents).toBe(216_000);
    // Es la pregunta que el requisito contempla —*«¿y sobre una pieza de MX$2 000?»*— y la razón por
    // la que el eje no se congeló en el servidor.
    expect(res.netDeltaPerUnitCents).toBe(res.proposed.netRevenueCents - res.current.netRevenueCents);
  });

  it('⛔ READ-ONLY: el preview NO escribe el dial (es una pregunta, no una decisión)', async () => {
    const c = controller();
    await c.previewIvaTransfer('0');
    const despues: any = await c.getIvaTransfer();
    expect(despues.ivaTransferPct).toBe(100);
  });
});

describe('⛔ `/preview` — el contrato de query: `400`, con `details.field` y los DOS extremos', () => {
  it('⭐⭐ `ivaTransferPct` AUSENTE ⇒ `400`, ⛔ no «devuelve la vigente»', async () => {
    const e: any = await capturar(controller().previewIvaTransfer(undefined));
    expect(e).toBeInstanceOf(BusinessException);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.getStatus()).toBe(400);
    expect(e.details).toMatchObject({ field: 'ivaTransferPct' });
  });

  it.each(['-1', '101', '37.5', 'abc', '', '   ', '1e2', '050abc'])(
    '`?ivaTransferPct=%s` ⇒ `400` y el mensaje NOMBRA los dos extremos',
    async (valor) => {
      const e: any = await capturar(controller().previewIvaTransfer(valor));
      expect(e.getStatus()).toBe(400);
      expect(e.details).toMatchObject({ field: 'ivaTransferPct' });
      expect(e.message).toContain('[0, 100]');
    },
  );

  it('⭐ `37.5` cae por ENTERO, no por rango — es la columna la que no lo admite', async () => {
    const e: any = await capturar(controller().previewIvaTransfer('37.5'));
    expect(e.message).toMatch(/integer/i);
    // *`Order.ivaTransferPct` es `Int`, y un decimal se truncaría en silencio mientras el precio se
    // calculó con él.* Mismo defecto que ya cerraron `validateIvaPct` y `validateAportacionPct`.
  });

  it.each(['0', '100'])('los extremos `%s` SÍ son válidos (la cota es CERRADA)', async (valor) => {
    const res: any = await controller().previewIvaTransfer(valor);
    expect(res.proposed.ivaTransferPct).toBe(Number(valor));
  });

  it.each(['0', '-1', '100000001', '2000000000', '1.5', 'x'])(
    '`?samplePriceCents=%s` ⇒ `400` con `details.field` propio',
    async (valor) => {
      const e: any = await capturar(controller().previewIvaTransfer('50', valor));
      expect(e.getStatus()).toBe(400);
      expect(e.details).toMatchObject({ field: 'samplePriceCents' });
      expect(e.message).toContain(`[1, ${IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX}]`);
    },
  );

  it('los extremos de `samplePriceCents` (`1` y `100 000 000`) SÍ pasan', async () => {
    expect((await controller().previewIvaTransfer('50', '1') as any).samplePriceCents).toBe(1);
    expect(
      (await controller().previewIvaTransfer('50', String(IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX)) as any)
        .samplePriceCents,
    ).toBe(IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX);
  });
});

/**
 * ⭐⭐ **`N-IVA9-7` — LA MEDICIÓN QUE EL ARQUITECTO PIDIÓ, HECHA.**
 */
describe('⭐⭐ la COTA no es higiene: sin ella la ruta es un `500` desde la barra de direcciones', () => {
  it('⭐⭐ MEDIDO: con `samplePriceCents = 2e9` la aritmética SIN cota LANZA un Error pelado', () => {
    // El camino que el endpoint recorrería sin validación: `P = 2e9 × 1.16 = 2.32e9 > MAX_CENTS`.
    const P = 2_000_000_000 + Math.round((2_000_000_000 * 100 * 16) / 10_000);
    expect(P).toBeGreaterThan(MAX_CENTS);
    let error: unknown = null;
    try {
      grossUpTotal(P, FEE);
    } catch (e) {
      error = e;
    }
    // ⛔ Es un `Error` **pelado**, ⛔ no una `BusinessException` ⇒ el filtro global NO lo mapea ⇒
    // `500`. Ésa es exactamente la clase que §0-Q existe para cerrar.
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(BusinessException);
    expect((error as Error).message).toMatch(/MAX_CENTS/);
  });

  it('⭐⭐ y CON la cota, el endpoint responde `400` — nunca llega a la aritmética', async () => {
    const e: any = await capturar(controller().previewIvaTransfer('100', '2000000000'));
    expect(e).toBeInstanceOf(BusinessException);
    expect(e.getStatus()).toBe(400);
    expect(e.details).toMatchObject({ field: 'samplePriceCents' });
  });

  it('⭐ la cota se eligió MEDIDA: en el tope, el gross-up queda ~20× por debajo de `MAX_CENTS`', async () => {
    const res: any = await controller().previewIvaTransfer(
      '100',
      String(IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX),
    );
    expect(res.proposed.displayPriceCents).toBe(116_000_000);
    expect(res.proposed.totalChargedCents).toBeLessThan(MAX_CENTS / 15);
    // ⇒ ningún dial ni ninguna comisión configurable puede acercarlo al techo.
  });

  it('⭐⭐ y el `PUT` del ACUSE tenía el MISMO `500`: la cota cierra las DOS puertas', async () => {
    // ⚠️ Esto es lo que el contrato **no** anticipó (ver la cabecera). El validador del acuse
    // admitía hasta `MAX_CENTS`; con ese `L`, `displayPriceCentsOf` da `2 491 081 030` y
    // `grossUpTotal` lanza ⇒ `500` en la puerta que gobierna el dial.
    //
    // ⭐ **v1.76 · `D-ACUSE-1`:** el `422` de esta línea **ya no lo produce la cota superior**, sino
    // que el acuse sólo admite el `L` CANÓNICO (`validateAckSamplePriceCents`) — cuatro órdenes de
    // magnitud por debajo. *El caso sobrevive porque el CÓDIGO DE ESTADO y la puerta que protege son
    // los mismos; sólo cambió cuál de los dos candados llega primero.* La cota superior sigue siendo
    // la única defensa del `/preview`, que conserva su eje entero, y eso lo miden los `it` de arriba.
    const c = controller();
    const e: any = await capturar(
      c.updateIvaTransfer(
        {
          ivaTransferPct: 50,
          acknowledgement: { samplePriceCents: MAX_CENTS, previewedNetDeltaCents: -1 },
        },
        'u-1',
        'super_admin' as never,
      ),
    );
    expect(e).toBeInstanceOf(BusinessException);
    expect(e.getStatus()).toBe(422); // cuerpo ⇒ 422 (§0-Q punto 2), ⛔ no un 500 crudo
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.details).toMatchObject({ field: 'acknowledgement.samplePriceCents' });
  });
});

/**
 * ⭐ **EL CANARIO** — el parser no es un `Number()` a secas, y se demuestra.
 */
describe('⭐ canario del parser de query: las formas que un `Number()` dejaría pasar', () => {
  it('⭐⭐ `Number(" ")` es `0` y `Number("50.0")` es `50`: el parser mira el TEXTO primero', async () => {
    // Si el parser hiciera `Number(raw)` a secas, `?ivaTransferPct=%20` sería un `0` **válido** —o
    // sea, el dueño pidiendo «absorbe todo el IVA» por haber mandado un espacio. Y `"50.0"` pasaría
    // como entero. Las dos formas se rechazan.
    expect(Number(' ')).toBe(0);
    expect(Number('50.0')).toBe(50);
    for (const raw of [' ', '50.0', '+50', '0x10']) {
      const e: any = await capturar(controller().previewIvaTransfer(raw));
      expect(e?.getStatus?.()).toBe(400);
    }
  });

  it('m2 — y NO se cuela por `samplePriceCents` tampoco', async () => {
    for (const raw of ['10000.0', '+10000', '1e4']) {
      const e: any = await capturar(controller().previewIvaTransfer('50', raw));
      expect(e?.getStatus?.()).toBe(400);
      expect(e.details).toMatchObject({ field: 'samplePriceCents' });
    }
  });
});
