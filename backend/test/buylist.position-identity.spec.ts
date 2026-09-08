import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { variantKey, variantPositionKey } from '../src/common/variant-key';
import { IncompleteGradeIdentityError } from '../src/modules/pricing/pricing.types';
import {
  InventoryPositionPort,
  VariantPositionRef,
} from '../src/modules/inventory/inventory-position.port';

/**
 * v1.51.22 · **B-3 — LOS DOS PUERTOS NO ACUERDAN QUÉ ES UNA VARIANTE.**
 *
 * ### El hallazgo, con los números
 * - `sealedProductId` aparece **2 veces** en `inventory-publish.port.ts` y **0** en
 *   `inventory-position.port.ts`.
 * - `onHandCountsFor` agrupa por `(cardId, productType, rawCondition, gradingCompany, gradeValue,
 *   finish, cardProductId)` — **sin `sealedProductId`** ⇒ **dos `SealedProduct` de la misma `Card`
 *   colapsan en UN bucket**.
 * - **Y en graduado era peor:** el adaptador deriva `gradeKey` de `(productType, rawCondition,
 *   gradingCompany, gradeValue)`; **`buylist` llama `gradeKeyFor({ productType, rawCondition })`** —
 *   **dos** campos. Como `SellRequestItem` **no tiene columnas de graduación**, todo caía a los
 *   defaults de `buildGradeKey` ⇒ **toda línea graduada se llaveaba `graded:PSA:10`**. El puerto
 *   entonces solo emparejaba stock PSA 10; el resto era **invisible**.
 *
 * Consecuencia: **la mesa de decisión le enseñaba al operador una posición falsa, y él compraba
 * contra ella.** Las dos direcciones del error a la vez: un CGC 9.5 en la caja no se veía, y un
 * PSA 10 ajeno se contaba como si fuera de esta línea.
 *
 * ⚠️ **La norma de `variant-key.ts` NO lo atrapa** —y por eso hace falta este spec—: guarda **el
 * FORMATO del string** y deja libre **la DERIVACIÓN**. El drift ocurre una capa por debajo.
 *
 * ### El cierre elegido, y el que NO se eligió
 * De las dos vías, se toma la que **no cambia la forma del ref**: `buylist` devuelve
 * `positionUnavailable` para graded/sealed — el mecanismo honesto que esta misma pantalla ya tiene y
 * que el contrato ordena usar cuando el conteo no se puede obtener (*«PROHIBIDO devolver `0`»*).
 * La otra vía —que **el ref cargue la identidad completa** (`gradingCompany`, `gradeValue`,
 * `sealedProductId`)— **cambia la interfaz de un puerto que declara y provee `inventory`**, o sea un
 * cambio entre streams: **lo decide el arquitecto** (regla 9), y está escalado.
 *
 * ---
 * ## ⚠️ v1.53 — POR QUÉ ESTE SPEC SIGUE EN PIE, Y QUÉ CAMBIÓ DE ÉL
 *
 * v1.53 tapió la puerta por la que estas líneas ENTRABAN: la guarda **raw-only** (`422
 * BUYLIST_RAW_ONLY`, §4.40.3) rechaza `graded`/`sealed` en las tres superficies del buylist, y
 * `buildGradeKey` **perdió sus defaults** (§4.40.4) — el `graded:PSA:10` silencioso ya no existe.
 *
 * **Lo que NO cambió es la base de datos.** La guarda es una validación de ESCRITURA, no una
 * constraint: las `SellRequestItem` no-raw **creadas antes de v1.53 siguen ahí**, y la mesa de
 * decisión es precisamente la pantalla que el operador abre sobre solicitudes viejas. Este spec pasa
 * a guardar **eso**: que esa pantalla se abra, no reviente y no invente un conteo.
 *
 * Dos aserciones cambian de contenido, y conviene saber cuál es cuál:
 * 1. **§(0) ya no mide el default** —no hay default que medir—: mide que el constructor de claves
 *    **se niega** a producir una para dos campos, que es lo que hace obligatoria la degradación.
 * 2. **§(2) ya no espera `derivedPriceCents` en una línea graduada.** Antes salía con monto porque
 *    el buylist cotizaba graduadas; hoy **no las compra**, así que sale `null` (`SIN PRECIO`). La
 *    cláusula del contrato que dice *«estos campos son válidos aun con `positionUnavailable`»* sigue
 *    guardada, pero **donde de verdad aplica**: una línea **raw** con el puerto de posición caído.
 *    *No es la misma afirmación con otro fixture: es que la afirmación vieja dejó de ser cierta y la
 *    que la sustituye prueba lo que la cláusula siempre quiso decir.*
 */

const pii = new PiiCryptoService(new ConfigService({}));

const DIALS: Record<string, number> = {
  [SettingKey.BUYLIST_SHIPPING_FEE_CENTS]: 18000,
  // v1.58 · §M5-A (BL-38) — los tres diales AML/INE que `adminOffer` lee desde v1.58. Van con sus
  // DEFAULTS reales (`settings.constants.ts`): sin ellos el doble devuelve `0` para las tres claves y
  // **toda** oferta rebotaría con `422 BUYLIST_LIMIT_EXCEEDED`.
  [SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS]: 300000,
  [SettingKey.BUYLIST_CAP_PER_MONTH_CENTS]: 1000000,
  [SettingKey.INE_THRESHOLD_CENTS]: 300000,
  [SettingKey.BUYLIST_MINIMUM_OFFER_NET_CENTS]: 20000,
  [SettingKey.BUYLIST_OPERATOR_OFFER_CAP_CENTS]: 150000,
  [SettingKey.BUYLIST_VARIANT_POSITION_CAP]: 10,
};

interface FakeLine {
  id: string;
  productType?: 'raw' | 'graded' | 'sealed';
  cardId?: string;
  rawCondition?: string | null;
}

interface OtherLine {
  productType?: 'raw' | 'graded' | 'sealed';
  cardId?: string;
  status: string;
}

function build(opts: {
  lines: FakeLine[];
  onHand?: Record<string, number>;
  otherLines?: OtherLine[];
  /** v1.53: el puerto REVIENTA ⇒ `positionUnavailable` en una línea **raw**, que es donde la
   *  cláusula del contrato («estos campos son válidos aun con `positionUnavailable`») aplica. */
  portThrows?: boolean;
}) {
  const cardOf = (id: string) => ({
    id,
    externalId: `ext-${id}`,
    name: 'Charizard VMAX',
    number: '020',
    numberSort: 20,
    numberPrefix: '',
    rarity: 'Rare Holo',
    rarityCanonical: 'rare',
    supertype: 'Pokémon',
    subtypes: null,
    setId: 'swsh3',
    set: { id: 'swsh3', name: 'Darkness Ablaze' },
    imageSmallUrl: null,
    imageLargeUrl: null,
    availableFinishes: ['normal', 'holofoil', 'reverse_holo'],
  });

  const prisma: any = {
    // v1.58 · §M5-A.8 (BL-38) — la mesa lee el archivo de INE del VENDEDOR para `sellerIneOnFile`.
    // `null` = sin INE en archivo, que es el caso por defecto de estos fixtures.
    kycProfile: { findUnique: jest.fn(async () => null) },
    sellRequest: {
      findUnique: jest.fn(async () => ({
        id: 'sr-1',
        userId: 'u-1',
        user: { id: 'u-1', name: 'Ash Ketchum', email: 'ash@example.com' },
        status: 'cotizada',
        quotedTotalCents: 90000,
        pickupAddressSnapshot: { line1: 'Calle 1' },
        items: opts.lines.map((l) => ({
          id: l.id,
          cardId: l.cardId ?? 'card-1',
          card: cardOf(l.cardId ?? 'card-1'),
          productType: l.productType ?? 'raw',
          // ⚠️ Ni `gradingCompany` ni `gradeValue` ni `sealedProductId`: NO EXISTEN en
          // `SellRequestItem`. Ésa es la raíz del hallazgo, y el fixture la reproduce fielmente.
          rawCondition: l.rawCondition ?? (l.productType && l.productType !== 'raw' ? null : 'NM'),
          finish: 'normal',
          cardProductId: null,
          quotedPriceCents: 90000,
        })),
      })),
    },
    sellRequestItem: {
      findMany: jest.fn(async () =>
        (opts.otherLines ?? []).map((o) => ({
          cardId: o.cardId ?? 'card-1',
          productType: o.productType ?? 'raw',
          rawCondition: o.productType && o.productType !== 'raw' ? null : 'NM',
          finish: 'normal',
          cardProductId: null,
          sellRequest: { status: o.status },
        })),
      ),
    },
  };

  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getReferencesBatch: jest.fn(async (items: any[]) => {
      const m = new Map<string, unknown>();
      for (const i of items ?? []) m.set(variantKey(i), { status: 'priced', referenceMxnCents: 200000 });
      return m;
    }),
    findCardProductsByTcgIds: jest.fn(async () => new Map()),
    getReferencesByCardProductBatch: jest.fn(async () => new Map()),
  };

  const settings = { getNumber: jest.fn(async (key: any) => DIALS[key as string] ?? 0) };

  const seenRefs: VariantPositionRef[][] = [];
  const port: InventoryPositionPort = {
    onHandCountsFor: jest.fn(async (refs: VariantPositionRef[]) => {
      seenRefs.push(refs);
      if (opts.portThrows) throw new Error('inventory position port down');
      const m = new Map<string, number>();
      for (const r of refs) {
        const n = (opts.onHand ?? {})[variantPositionKey(r)];
        if (n != null) m.set(variantPositionKey(r), n);
      }
      return m;
    }),
  };

  const svc = new BuylistService(
    prisma as unknown as PrismaService,
    pricing as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    undefined,
    port,
  );
  return { svc, seenRefs, port };
}

const OPERATOR = { id: 'op-1', role: 'vault_operator' as const };

const K_RAW = variantPositionKey({
  cardId: 'card-1',
  productType: 'raw',
  gradeKey: 'raw:NM',
  finish: 'normal',
  cardProductId: null,
});

// =============================================================================================
describe('B-3 (0) — el DRIFT existe, y se mide antes de taparlo', () => {
  it('⚠️ con DOS campos no hay llave que decir: el constructor se NIEGA (y antes decía `graded:PSA:10`)', () => {
    // `buylist` solo puede pasar DOS campos porque `SellRequestItem` no tiene los otros dos.
    // Hasta v1.52 eso producía `graded:PSA:10` para un PSA 10, un CGC 9.5 y un BGS 8 por igual
    // —*un conteo que mezcla piezas que valen distinto es peor que no mostrar nada, porque se ve
    // confiable* (§P.8)—. v1.53 retiró el default: hoy la MISMA llamada **lanza**.
    const g = PricingService.prototype.gradeKeyFor;
    expect(() => g({ productType: 'graded' } as never)).toThrow(IncompleteGradeIdentityError);
    // Y la variante de LECTURA no lanza: devuelve `null`, que es «no hay clave», no «PSA 10».
    expect(PricingService.prototype.tryGradeKeyFor({ productType: 'graded' })).toBeNull();
    // ⚠️ Ninguna de las dos respuestas sirve para pintar la mesa: una la tumba, la otra no llavea.
    // POR ESO la degradación de B-3 sigue siendo necesaria para las filas legacy.
    // Y así lo llavea el otro lado cuando la pieza SÍ tiene identidad: sólo casan las PSA 10.
    expect(g({ productType: 'graded', gradingCompany: 'PSA', gradeValue: '10' })).toBe('graded:PSA:10');
    expect(g({ productType: 'graded', gradingCompany: 'CGC', gradeValue: '9.5' })).toBe('graded:CGC:9.5');
  });

  it('⚠️ y en SELLADO la llave no tiene dónde poner `sealedProductId`', () => {
    // El `groupBy` del adaptador tampoco lo agrupa ⇒ dos `SealedProduct` de la misma `Card` caen en
    // UN bucket. La llave que existe no puede separarlos ni queriendo.
    const a = variantPositionKey({
      cardId: 'card-1', productType: 'sealed', gradeKey: 'sealed', finish: 'normal', cardProductId: null,
    });
    const b = variantPositionKey({
      cardId: 'card-1', productType: 'sealed', gradeKey: 'sealed', finish: 'normal', cardProductId: null,
    });
    expect(a).toBe(b); // dos productos sellados distintos, una sola clave
  });
});

// =============================================================================================
describe('B-3 (1) — graded y sealed salen por `positionUnavailable`, no por un número falso', () => {
  it.each([['graded' as const], ['sealed' as const]])(
    'una línea `%s` ⇒ `position: null` + `positionUnavailable: true` + `verdict: "none"`',
    async (productType) => {
      const { svc } = build({ lines: [{ id: 'it-1', productType }] });
      const res = await svc.adminDecisionTable('sr-1', OPERATOR);
      const line = res.lines[0];

      // ⚠️ Literal, no `toBeFalsy()`: `toBeFalsy()` pasaría con `0`, que es el valor PROHIBIDO.
      expect(line.position).toBeNull();
      expect(line.position).not.toBe(0);
      expect(line.positionUnavailable).toBe(true);
      expect(line.suggestion).toMatchObject({ verdict: 'none', rule: null, thresholdQty: null });
    },
  );

  it('⚠️ EL NÚCLEO: al puerto NO se le pregunta por una variante que la llave no sabe decir', async () => {
    // No basta con tirar la respuesta: preguntar y descartar dejaría la llave equivocada viva en el
    // seam y el siguiente lector la creería. **La pregunta no se hace.**
    const { svc, seenRefs } = build({
      lines: [
        { id: 'it-raw', productType: 'raw' },
        { id: 'it-grd', productType: 'graded' },
        { id: 'it-sld', productType: 'sealed' },
      ],
    });
    await svc.adminDecisionTable('sr-1', OPERATOR);

    expect(seenRefs).toHaveLength(1);
    expect(seenRefs[0].map((r) => r.productType)).toEqual(['raw']);
    expect(seenRefs[0].map((r) => r.gradeKey)).not.toContain('graded:PSA:10');
    expect(seenRefs[0].map((r) => r.gradeKey)).not.toContain('sealed');
  });

  it('el ref, estructuralmente, NO puede cargar la identidad — y por eso no se le pide que la cargue', async () => {
    // Aserción de FORMA: si algún día el ref gana los campos que faltan (vía arquitecto), este test
    // cae y obliga a revisar la degradación en vez de dejarla puesta «por si acaso».
    const { svc, seenRefs } = build({ lines: [{ id: 'it-1', productType: 'raw' }] });
    await svc.adminDecisionTable('sr-1', OPERATOR);
    const campos = Object.keys(seenRefs[0][0]).sort();
    expect(campos).toEqual(['cardId', 'cardProductId', 'finish', 'gradeKey', 'productType']);
    expect(campos).not.toContain('gradingCompany');
    expect(campos).not.toContain('gradeValue');
    expect(campos).not.toContain('sealedProductId');
  });
});

// =============================================================================================
describe('B-3 (2) — la degradación es POR LÍNEA, y no se lleva por delante nada más', () => {
  it('la línea `raw` de la MISMA solicitud conserva su posición completa', async () => {
    // Degradar la tabla entera por una línea graduada le quitaría al operador las cuarenta que sí
    // sabe contar. *Se calla lo que no se sabe, no lo que sí.*
    const { svc } = build({
      lines: [
        { id: 'it-raw', productType: 'raw' },
        { id: 'it-grd', productType: 'graded' },
      ],
      onHand: { [K_RAW]: 8 },
      otherLines: [{ status: 'en_transito' }],
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const raw = res.lines.find((l) => l.itemId === 'it-raw')!;
    const grd = res.lines.find((l) => l.itemId === 'it-grd')!;

    expect(raw.position).toEqual({ stock: 8, verifying: 0, inTransit: 1, committed: 0, total: 9 });
    expect(raw.positionUnavailable).toBeUndefined();
    expect(raw.suggestion).toMatchObject({ verdict: 'buy', rule: 'variant_cap' });
    expect(grd.position).toBeNull();
  });

  it('⚠️ el DINERO se sigue emitiendo cuando lo que falla es el CONTEO: línea raw, puerto caído', async () => {
    // El contrato es explícito: «estos campos son válidos aun con `positionUnavailable`: dependen de
    // montos, no del conteo de inventario». **Éste es el fixture donde esa cláusula aplica**: la
    // línea es comprable (raw) y lo único roto es el puerto de posición. Una avería de conteo NO
    // puede apagar el precio ni el aviso del piso.
    const { svc } = build({ lines: [{ id: 'it-1', productType: 'raw' }], portThrows: true });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const line = res.lines[0];
    expect(line.positionUnavailable).toBe(true);
    expect(line.position).toBeNull();
    expect(line.quotedPriceCents).toBe(90000);
    expect(line.derivedPriceCents).not.toBeNull();
    expect(res.totals.buyableGrossCents).toBe(line.derivedPriceCents);
    expect(res.totals.shippingFeeCents).toBe(18000);
  });

  it('⚠️ v1.53 — una línea LEGACY graduada sale SIN precio y SIN conteo, y la mesa igual se abre', async () => {
    // Cambio de conducta deliberado del merge de v1.53, y hay que decirlo con todas las letras: la
    // guarda raw-only (§4.40.3) **no compra graduadas**, así que el precio derivado de una fila
    // histórica sale `null` — el front pinta `SIN PRECIO`, jamás `MX$ 0.00`. Lo que NO se pierde es
    // lo que sí se sabe: el `quotedPriceCents` congelado el día que se cotizó, y los totales.
    const { svc } = build({ lines: [{ id: 'it-1', productType: 'graded' }] });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const line = res.lines[0];
    expect(line.derivedPriceCents).toBeNull();
    expect(line.priceBasis).toBe('pending');
    expect(line.positionUnavailable).toBe(true);
    // El snapshot histórico NO se toca: es lo que se le prometió al vendedor aquel día.
    expect(line.quotedPriceCents).toBe(90000);
    // Contrato §mesa: `buyableGrossCents = Σ derivedPriceCents de las líneas con valor`. Ninguna.
    expect(res.totals.buyableGrossCents).toBe(0);
    expect(res.totals.shippingFeeCents).toBe(18000);
    // ⚠️ Y el neto NUNCA es negativo (invariante i.1, criterio 152).
    expect(res.totals.netCents).toBe(0);
  });

  it('los sumandos de PROMESA tampoco se cuelan: una línea graduada ajena no suma a ningún bucket', async () => {
    // La otra mitad de la misma llave. Antes, una `graded` de otra solicitud caía en el bucket
    // `graded:PSA:10` y se contaba junto a cualquier otra graduación.
    const { svc } = build({
      lines: [
        { id: 'it-raw', productType: 'raw' },
        { id: 'it-grd', productType: 'graded' },
      ],
      otherLines: [
        { status: 'en_transito', productType: 'graded' },
        { status: 'en_transito', productType: 'sealed' },
      ],
    });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    const raw = res.lines.find((l) => l.itemId === 'it-raw')!;
    expect(raw.position).toEqual({ stock: 0, verifying: 0, inTransit: 0, committed: 0, total: 0 });
    expect(res.lines.find((l) => l.itemId === 'it-grd')!.position).toBeNull();
  });

  it('con TODAS las líneas degradadas la mesa sigue respondiendo (no revienta ni inventa)', async () => {
    const { svc } = build({ lines: [{ id: 'it-1', productType: 'sealed' }] });
    const res = await svc.adminDecisionTable('sr-1', OPERATOR);
    expect(res.lines).toHaveLength(1);
    expect(res.lines[0].positionUnavailable).toBe(true);
    expect(res.totals).toBeDefined();
  });
});
