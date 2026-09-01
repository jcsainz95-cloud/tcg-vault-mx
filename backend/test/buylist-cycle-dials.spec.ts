import {
  BUYLIST_CROSS_DIAL_RULE,
  SETTING_DEFAULTS,
  SETTING_DTO_MAP,
  SETTING_VALIDATORS,
  SettingKey,
  validateBuylistCrossDials,
  validateBuylistMinimumOfferNetCents,
} from '../src/modules/settings/settings.constants';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * v1.51 (M-46, ARCHITECTURE §4.39l / API_CONTRACT §M10) — **LOS DIEZ DIALES DEL CICLO DE ADQUISICIÓN**
 * y la **validación CRUZADA BLOQUEANTE** de tres términos.
 *
 * Mismo patrón que `sealed-settings.spec.ts`: seeds, validadores, exposición en el DTO de M10 y —lo
 * que aquel no necesitaba— **la relación ENTRE diales**, que es la única de las tres que puede
 * romperse mandando **una** clave.
 */

// ============================================================================================
describe('M-46 §4.39l — los DIEZ diales: seeds', () => {
  it('los diez seeds son EXACTAMENTE los de PROJECT §P.10', () => {
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS]).toBe(2);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS]).toBe(3);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS]).toBe(50000); // MX$500
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS]).toBe(7);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]).toBe(150000); // MX$1,500
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_VARIANT_POSITION_CAP]).toBe(10);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_SHIPPING_FEE_CENTS]).toBe(18000); // MX$180
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS]).toBe(5);
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]).toBe(20000); // MX$200
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT]).toBe(2);
  });

  it('la SECUENCIA DE PLAZOS se lee sola: emitir (7) → aceptar (2) → enviar (3)', () => {
    // No es decoración: es lo que hace defendible que el dial de D33 se llame `…OfferIssueDeadline…`
    // El primero es NUESTRO y es el más largo; los dos del vendedor son cortos y van después.
    const emitir = SETTING_DEFAULTS[SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS] as number;
    const aceptar = SETTING_DEFAULTS[
      SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS
    ] as number;
    const enviar = SETTING_DEFAULTS[SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS] as number;
    expect(emitir).toBeGreaterThan(aceptar);
    expect(emitir).toBeGreaterThan(enviar);
  });

  it('la SECUENCIA DE MONTOS también: 500 (cotizar) / 180 (descuento) / 200 (cobrar) ⇒ 380 derivado', () => {
    const minimo = SETTING_DEFAULTS[SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS] as number;
    const tarifa = SETTING_DEFAULTS[SettingKey.BUYLIST_SHIPPING_FEE_CENTS] as number;
    const piso = SETTING_DEFAULTS[SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS] as number;
    // ⚠️ `requiredGrossCents` SE CALCULA, no se configura: NO es un décimo dial. Si alguien lo
    // vuelve una clave propia, habrá DOS fuentes del mismo número y la primera vez que se mueva la
    // tarifa sin moverlo el sistema bloqueará ofertas por una aritmética que ya no cuadra.
    expect(tarifa + piso).toBe(38000); // MX$380 de bruto mínimo OFERTABLE
    const claves = Object.keys(SETTING_DEFAULTS);
    expect(claves).not.toContain('buylist_required_gross_cents');
    expect(tarifa + piso).toBeLessThanOrEqual(minimo); // los DEFAULTS guardan, con $120 de holgura
  });

  it('⚠️ el dial 7 (buylist, MX$180) NO es el dial de retiro (MX$175): son DOS diales distintos', () => {
    // Se parecen y NO son el mismo número: uno es lo que le COBRAMOS al comprador por mandarle su
    // carta; el otro, lo que NOS DESCONTAMOS por traer la del vendedor. Unificarlos «porque se
    // parecen» rompería dos flujos a la vez (criterio 127, última línea).
    expect(SETTING_DEFAULTS[SettingKey.BUYLIST_SHIPPING_FEE_CENTS]).not.toBe(
      SETTING_DEFAULTS[SettingKey.SHIPPING_FEE_CENTS],
    );
    expect(SETTING_DEFAULTS[SettingKey.SHIPPING_FEE_CENTS]).toBe(17500);
  });

  it('⚠️ POR LO NEGATIVO — los DOS diales RETIRADOS no existen: ni seed, ni validador, ni DTO', () => {
    // D28 (recorte material, 20%) quedó SIN OBJETO con D30. D31 retiró el umbral de guía (una sola
    // banda). A los dos se les aplica la misma doctrina: **no se apagan, no quedan en 0, DEJAN DE
    // EXISTIR** — y eso se verifica por lo negativo (criterio 127). *Un dial que se queda en la
    // tabla «por si acaso» es una banda que alguien va a reactivar sin querer, y esa banda mueve
    // dinero: un monto en el correo en vez de tres.*
    const retirados = ['buylist_shipping_threshold_cents', 'buylist_material_haircut_pct'];
    for (const key of retirados) {
      expect(Object.keys(SETTING_DEFAULTS)).not.toContain(key);
      expect(Object.keys(SETTING_VALIDATORS)).not.toContain(key);
      expect(Object.values(SETTING_DTO_MAP)).not.toContain(key);
      expect(Object.values(SettingKey)).not.toContain(key);
    }
    // Y por su nombre de DTO, que es como lo buscaría el frontend o QA en M10:
    expect(Object.keys(SETTING_DTO_MAP)).not.toContain('buylistShippingThresholdCents');
  });
});

// ============================================================================================
describe('M-46 §4.39l — los DIEZ diales: validadores por dial', () => {
  const v = (k: (typeof SettingKey)[keyof typeof SettingKey]) => SETTING_VALIDATORS[k];

  it('los tres PLAZOS y los dos CONTEOS son entero >= 1 (el 0 no es un plazo)', () => {
    const enteroPositivo = [
      SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS,
      SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS,
      SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS,
      SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS,
      SettingKey.BUYLIST_VARIANT_POSITION_CAP,
      SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT,
    ] as const;
    for (const k of enteroPositivo) {
      expect(v(k)(1)).toBeNull();
      expect(v(k)(7)).toBeNull();
      expect(v(k)(0)).toMatch(/>= 1/);
      expect(v(k)(-1)).toMatch(/>= 1/);
      expect(v(k)(2.5)).toMatch(/integer/);
      expect(v(k)('7')).toMatch(/integer/);
      expect(v(k)(null)).toMatch(/integer/);
    }
  });

  it('los MONTOS (mínimo, tope de operador, tarifa) son entero >= 0 en centavos', () => {
    const montos = [
      SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS,
      SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS,
      SettingKey.BUYLIST_SHIPPING_FEE_CENTS,
    ] as const;
    for (const k of montos) {
      expect(v(k)(0)).toBeNull();
      expect(v(k)(50000)).toBeNull();
      expect(v(k)(-1)).toMatch(/>= 0/);
      expect(v(k)(1.5)).toMatch(/integer/);
    }
  });

  it('⚠️ dial 9 — el `0` NO es legal, y ésa es toda la razón de que tenga validador propio', () => {
    // Con el piso en 0, la guarda de emisión `net < 0` NUNCA dispara y vuelve a ser emitible la
    // oferta que anuncia MX$0 — el agujero que (o.12) cerró. Con el piso en 1 centavo la regla
    // degenera EXACTAMENTE en la de v1.51.1 (`net < 1` ⇔ `net <= 0`): **la guarda vieja no se
    // perdió, se convirtió en el suelo del dial**, y por eso el suelo no puede bajar más.
    expect(validateBuylistMinimumOfferNetCents(0)).toMatch(/0 is NOT legal/);
    expect(SETTING_VALIDATORS[SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS](0)).toMatch(/NOT legal/);
    expect(validateBuylistMinimumOfferNetCents(1)).toBeNull(); // el suelo legal
    expect(validateBuylistMinimumOfferNetCents(20000)).toBeNull(); // el default
    expect(validateBuylistMinimumOfferNetCents(-1)).toMatch(/>= 1/);
    expect(validateBuylistMinimumOfferNetCents(200.5)).toMatch(/integer/);
  });

  it('los DIEZ tienen validador Y seed (ninguno entra a M10 a medias)', () => {
    const diez = [
      SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS,
      SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS,
      SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS,
      SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS,
      SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS,
      SettingKey.BUYLIST_VARIANT_POSITION_CAP,
      SettingKey.BUYLIST_SHIPPING_FEE_CENTS,
      SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS,
      SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS,
      SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT,
    ] as const;
    expect(diez).toHaveLength(10); // ⚠️ ANCLA: eran nueve; son DIEZ (v1.51.4)
    for (const k of diez) {
      expect(SETTING_VALIDATORS[k]).toBeInstanceOf(Function);
      expect(SETTING_DEFAULTS[k]).toBeDefined();
      // Y el seed pasa su propio validador: un default que no se puede escribir por el PUT sería
      // una configuración que el sistema arranca teniendo y el operador no puede reponer.
      expect(SETTING_VALIDATORS[k](SETTING_DEFAULTS[k])).toBeNull();
    }
  });
});

// ============================================================================================
describe('M-46 §4.39l — exposición en el DTO de M10 (los DIEZ, y nada más)', () => {
  it('los diez se exponen con su nombre camelCase del contrato', () => {
    expect(SETTING_DTO_MAP.buylistOfferAcceptDeadlineBusinessDays).toBe(
      SettingKey.BUYLIST_OFFER_ACCEPT_DEADLINE_BUSINESS_DAYS,
    );
    expect(SETTING_DTO_MAP.buylistShipDeadlineBusinessDays).toBe(
      SettingKey.BUYLIST_SHIP_DEADLINE_BUSINESS_DAYS,
    );
    expect(SETTING_DTO_MAP.buylistMinimumRequestCents).toBe(SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS);
    expect(SETTING_DTO_MAP.buylistOfferIssueDeadlineBusinessDays).toBe(
      SettingKey.BUYLIST_OFFER_ISSUE_DEADLINE_BUSINESS_DAYS,
    );
    expect(SETTING_DTO_MAP.buylistOperatorOfferCapCents).toBe(
      SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS,
    );
    expect(SETTING_DTO_MAP.buylistVariantPositionCap).toBe(SettingKey.BUYLIST_VARIANT_POSITION_CAP);
    expect(SETTING_DTO_MAP.buylistShippingFeeCents).toBe(SettingKey.BUYLIST_SHIPPING_FEE_CENTS);
    expect(SETTING_DTO_MAP.buylistShipmentConfirmAlertBusinessDays).toBe(
      SettingKey.BUYLIST_SHIPMENT_CONFIRM_ALERT_BUSINESS_DAYS,
    );
    expect(SETTING_DTO_MAP.buylistMinimumOfferNetCents).toBe(
      SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS,
    );
    expect(SETTING_DTO_MAP.buylistOfferReissueAlertCount).toBe(
      SettingKey.BUYLIST_OFFER_REISSUE_ALERT_COUNT,
    );
  });

  it('exactamente DIEZ claves `buylist*` del ciclo en el DTO (un onceavo rompe aquí, a propósito)', () => {
    // ANCLA, del mismo tipo que las de `enum-values-parity`: si alguien añade un dial del ciclo sin
    // pasar por el arquitecto, este número deja de cuadrar y hay que decidirlo a propósito.
    // Se excluyen los DOS `buylistCap*` de AML, que son de v1.1 y no pertenecen al ciclo.
    const delCiclo = Object.keys(SETTING_DTO_MAP).filter(
      (k) => k.startsWith('buylist') && !k.startsWith('buylistCap'),
    );
    expect(delCiclo.sort()).toEqual(
      [
        'buylistMinimumOfferNetCents',
        'buylistMinimumRequestCents',
        'buylistOfferAcceptDeadlineBusinessDays',
        'buylistOfferIssueDeadlineBusinessDays',
        'buylistOfferReissueAlertCount',
        'buylistOperatorOfferCapCents',
        'buylistShipDeadlineBusinessDays',
        'buylistShipmentConfirmAlertBusinessDays',
        'buylistShippingFeeCents',
        'buylistVariantPositionCap',
      ].sort(),
    );
    expect(delCiclo).toHaveLength(10);
  });
});

// ============================================================================================
describe('M-46 §4.39l — VALIDACIÓN CRUZADA de TRES términos (criterio 127)', () => {
  /**
   * Los bordes verificables del contrato, RE-DERIVADOS por D34. `(tarifa, piso, mínimo)`.
   * **Tres bordes de dinero, un solo test parametrizado** (D40).
   */
  const BORDES: [number, number, number, boolean, string][] = [
    [18000, 20000, 50000, true, 'los DEFAULTS, con $120 de holgura'],
    [18000, 32000, 50000, true, 'LA IGUALDAD ES LEGAL: el neto mínimo cae JUSTO en el piso'],
    [18000, 32001, 50000, false, 'un centavo más y la solicitud mínima deja de ser ofertable'],
    [20000, 35000, 50000, false, 'TRES diales legales por separado, combinación ILEGAL'],
    [50000, 20000, 50000, false, 'cubre el borde viejo `tarifa = mínimo`'],
    [60000, 20000, 50000, false, 'cubre el borde viejo `tarifa > mínimo`'],
    [49999, 1, 50000, true, 'con el piso en su suelo legal, la regla nueva reproduce EXACTAMENTE la vieja'],
  ];

  it.each(BORDES)(
    '(%i, %i, %i) ⇒ guarda=%s — %s',
    (shippingFeeCents, minimumOfferNetCents, minimumRequestCents, guarda) => {
      const problem = validateBuylistCrossDials({
        shippingFeeCents,
        minimumOfferNetCents,
        minimumRequestCents,
      });
      expect(problem === null).toBe(guarda);
    },
  );

  it('⚠️ SUSTITUYE a la regla vieja de DOS términos, no se apila: la contiene', () => {
    // Con `piso >= 1`, `tarifa + piso <= mínimo` IMPLICA `tarifa < mínimo`. Conservar las dos dejaría
    // una regla que no puede disparar nunca — y una regla que no dispara es la que el primer
    // refactor borra «porque no hace nada». Se verifica la implicación en el borde exacto.
    for (const piso of [1, 100, 20000]) {
      for (const tarifa of [0, 1000, 49999, 50000, 60000]) {
        const minimo = 50000;
        const nuevaGuarda =
          validateBuylistCrossDials({
            shippingFeeCents: tarifa,
            minimumOfferNetCents: piso,
            minimumRequestCents: minimo,
          }) === null;
        if (nuevaGuarda) expect(tarifa).toBeLessThan(minimo); // la vieja también guardaba
      }
    }
  });

  it('el `details.rule` es el NUEVO nombre (cambió por SEGUNDA vez) y lleva los TRES montos', () => {
    // ⚠️ QA debe asertar el nombre nuevo: los anteriores describen relaciones de DOS términos que ya
    // no son la regla, y un `details.rule` que miente es peor que uno ausente.
    expect(BUYLIST_CROSS_DIAL_RULE).toBe('buylist_fee_plus_min_net_le_min_request');
    const problem = validateBuylistCrossDials({
      shippingFeeCents: 20000,
      minimumOfferNetCents: 35000,
      minimumRequestCents: 50000,
    });
    expect(problem).toMatchObject({
      rule: 'buylist_fee_plus_min_net_le_min_request',
      shippingFeeCents: 20000,
      minimumOfferNetCents: 35000,
      minimumRequestCents: 50000,
    });
    // Y el mensaje dice POR QUÉ, no un «valor inválido» seco.
    expect(problem?.message).toMatch(/minimum OFFERABLE gross/i);
    // Los dos nombres SUPERSEDED no pueden reaparecer.
    expect(BUYLIST_CROSS_DIAL_RULE).not.toBe('buylist_shipping_fee_lt_threshold');
    expect(BUYLIST_CROSS_DIAL_RULE).not.toBe('buylist_shipping_fee_lt_minimum');
  });

  it('⚠️ el DÉCIMO dial NO entra en la validación cruzada (cuenta actos, no centavos)', () => {
    // Meterlo «por simetría» sería inventar una relación entre un número de veces y un monto.
    const keys = Object.keys(
      validateBuylistCrossDials({
        shippingFeeCents: 60000,
        minimumOfferNetCents: 20000,
        minimumRequestCents: 50000,
      }) ?? {},
    );
    expect(keys).not.toContain('offerReissueAlertCount');
    expect(keys.sort()).toEqual(
      ['message', 'minimumOfferNetCents', 'minimumRequestCents', 'rule', 'shippingFeeCents'].sort(),
    );
  });
});

// ============================================================================================
describe('M-46 §4.39l — la cruzada se evalúa sobre el ESTADO RESULTANTE, no sobre el body', () => {
  let prisma: any;
  let service: SettingsService;
  /** Filas VIGENTES en `ConfigSetting` para este caso. */
  function boot(vigentes: Record<string, unknown>) {
    prisma = {
      configSetting: {
        upsert: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(async ({ where }: any) =>
          Object.entries(vigentes)
            .filter(([k]) => (where?.key?.in as string[]).includes(k))
            .map(([key, valueJson]) => ({ key, valueJson })),
        ),
        findUnique: jest.fn(async () => null),
      },
    };
    prisma.$transaction = jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma));
    service = new SettingsService(prisma as unknown as PrismaService);
  }

  const DEFAULTS_VIGENTES = {
    [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
    [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
    [SettingKey.BUYLIST_MINIMUM_REQUEST_CENTS]: 50000,
  };

  it('⚠️ EL AGUJERO QUE TAPA — UNA sola clave en el body basta para romper el invariante', async () => {
    // `PUT /admin/settings` es PARCIAL. Validar solo lo que viene permitiría romper la regla mandando
    // UNA de las TRES. Aquí el body trae **solo la tarifa**: con las otras dos VIGENTES en su
    // default, 60000 + 20000 = 80000 > 50000 ⇒ se rechaza.
    boot(DEFAULTS_VIGENTES);
    await expect(service.update({ buylistShippingFeeCents: 60000 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { rule: 'buylist_fee_plus_min_net_le_min_request' },
    });
    expect(prisma.configSetting.upsert).not.toHaveBeenCalled(); // BLOQUEANTE, no advertencia
  });

  it('aplica en LOS TRES SENTIDOS: subir la tarifa, subir el piso, o BAJAR el mínimo', async () => {
    // *Eran dos sentidos; con tres términos son tres.*
    for (const body of [
      { buylistShippingFeeCents: 40000 }, // 40000 + 20000 = 60000 > 50000
      { buylistMinimumOfferNetCents: 40000 }, // 18000 + 40000 = 58000 > 50000
      { buylistMinimumRequestCents: 30000 }, // 18000 + 20000 = 38000 > 30000
    ]) {
      boot(DEFAULTS_VIGENTES);
      await expect(service.update(body)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { rule: 'buylist_fee_plus_min_net_le_min_request' },
      });
      expect(prisma.configSetting.upsert).not.toHaveBeenCalled();
    }
  });

  it('un cambio COMPENSADO en el mismo body pasa (se juzga el resultado, no cada clave)', async () => {
    // Subir la tarifa a MX$400 sería ilegal a solas; con el mínimo subido a MX$700 en el MISMO PUT,
    // el estado resultante cumple ⇒ debe pasar. Validar clave por clave lo habría rechazado.
    boot(DEFAULTS_VIGENTES);
    const applied = await service.update({
      buylistShippingFeeCents: 40000,
      buylistMinimumRequestCents: 70000,
    });
    expect(applied).toEqual({ buylistShippingFeeCents: 40000, buylistMinimumRequestCents: 70000 });
    expect(prisma.configSetting.upsert).toHaveBeenCalledTimes(2);
  });

  it('la ausencia de fila en `ConfigSetting` resuelve al DEFAULT (no a `undefined`/0)', async () => {
    // Un entorno recién migrado puede no tener las filas todavía. Si el resolutor cayera a 0/undefined,
    // la regla pasaría siempre (0 + 0 <= 0 es falso… o NaN) y el invariante no protegería nada.
    boot({}); // NINGUNA fila vigente
    await expect(service.update({ buylistShippingFeeCents: 60000 })).rejects.toMatchObject({
      details: {
        rule: 'buylist_fee_plus_min_net_le_min_request',
        minimumOfferNetCents: 20000, // ← default de código
        minimumRequestCents: 50000, // ← default de código
      },
    });
  });

  it('la IGUALDAD es legal (por qué `<=` y no `<`)', async () => {
    // Con `tarifa + piso = mínimo`, la solicitud mínima aprobada entera produce un neto EXACTAMENTE
    // igual al piso, y la guarda de emisión es `net < piso` ⇒ la oferta SALE. Rechazar la igualdad
    // prohibiría una configuración que funciona.
    boot(DEFAULTS_VIGENTES);
    await expect(service.update({ buylistMinimumOfferNetCents: 32000 })).resolves.toEqual({
      buylistMinimumOfferNetCents: 32000,
    });
  });

  it('un PUT que no toca ninguna de las tres NO paga la lectura (corto circuito)', async () => {
    boot(DEFAULTS_VIGENTES);
    await service.update({ ivaPct: 16 });
    expect(prisma.configSetting.findMany).not.toHaveBeenCalled();
  });

  it('el dial 10 se puede mover a cualquier valor legal sin tocar la cruzada', async () => {
    boot(DEFAULTS_VIGENTES);
    await expect(service.update({ buylistOfferReissueAlertCount: 5 })).resolves.toEqual({
      buylistOfferReissueAlertCount: 5,
    });
    expect(prisma.configSetting.findMany).not.toHaveBeenCalled();
  });

  it('la validación POR DIAL sigue corriendo ANTES que la cruzada (un 0 en el piso no llega)', async () => {
    boot(DEFAULTS_VIGENTES);
    await expect(service.update({ buylistMinimumOfferNetCents: 0 })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { errors: { buylistMinimumOfferNetCents: expect.stringMatching(/NOT legal/) } },
    });
  });

  it('un fallo de la cruzada es una BusinessException 422, como cualquier otro rechazo de M10', async () => {
    boot(DEFAULTS_VIGENTES);
    await expect(service.update({ buylistShippingFeeCents: 60000 })).rejects.toBeInstanceOf(
      BusinessException,
    );
  });
});
