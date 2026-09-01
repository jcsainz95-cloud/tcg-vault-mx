import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import {
  offerTermsCopy,
  sellOfferTemplate,
} from '../src/modules/buylist/buylist-mail.templates';
import * as fs from 'fs';
import * as path from 'path';

/**
 * v1.51.15 (§11 `SellItemDTO`, criterios 118/161(d)) — **EL BLOQUE DE OFERTA DE LA LÍNEA, PARTIDO
 * POR AUDIENCIA.**
 *
 * El defecto que cierra: §11 declara desde v1.51 que la línea del CLIENTE lleva `offerDecision`,
 * `offeredPriceCents` y `condition`, y la proyección **no emitía ninguno de los tres**. El portal del
 * vendedor recibía una oferta **sin desglose**: no podía decir *qué* compramos (criterio 118), ni *a
 * cuánto*, ni **qué está aceptando** (criterio 161(d)) — así que pintaba «oferta incompleta» y no
 * ofrecía aceptar. Un ciclo de compra cuyo último paso es *«acepta»* no puede tener esa pantalla en
 * blanco.
 *
 * Las cinco propiedades que estos tests fijan:
 *  1. **Los tres campos llegan al CLIENTE** — en `items[]`, en `offer.lines[]` y en `offer-response`.
 *  2. **`condition` es EL MISMO STRING que el correo**, no uno igualito. Se asevera contra el texto
 *     REAL del correo renderizado, no contra un literal copiado en el test — un test que repite el
 *     literal solo verifica que el test y el código se copiaron bien.
 *  3. **Los CINCO admin-only NUNCA viajan al cliente** (`offerDerivedPriceCents`,
 *     `offerOverrideReason`, `offerPriceBasis`, `offerMarketMxnCents`, `offerMarketBracket`), y
 *     `condition` **no viaja al ADMIN**: se asevera por **AUSENCIA DE CLAVE**, no por valor falsy —
 *     un `undefined` emitido y una clave inexistente se ven igual en un `expect(...).toBeFalsy()` y
 *     son cosas distintas en el JSON.
 *  4. **`skip` se muestra SIN monto** (criterio 118): `offeredPriceCents: null`, **jamás `0`**, y
 *     **sin** la condición de compra pegada — *no prometemos NM sobre una carta que no compramos*.
 *  5. **El locale es el del VENDEDOR**, y es el mismo en las dos superficies donde lee la misma
 *     oferta. Aceptar en español una oferta que se leyó en inglés rompe el «palabra por palabra».
 */

const pii = new PiiCryptoService(new ConfigService({}));

interface LineOpts {
  id: string;
  offerDecision?: 'buy' | 'skip' | null;
  offeredPriceCents?: number | null;
}

interface Opts {
  lines?: LineOpts[];
  locale?: string | null;
  offerState?: string | null;
  status?: string;
}

/**
 * Fila con **el bloque admin-only POBLADO a propósito**: si la proyección lo leyera, se vería. Un
 * test de fuga con la columna vacía no prueba nada.
 */
function build(opts: Opts = {}) {
  const items = (opts.lines ?? [{ id: 'it-1', offerDecision: 'buy', offeredPriceCents: 42000 }]).map(
    (l) => ({
      id: l.id,
      sellRequestId: 'sr-1',
      cardId: 'card-1',
      card: {
        id: 'card-1',
        name: 'Charizard VMAX',
        number: '020',
        rarity: 'Rare Holo',
        rarityCanonical: 'rare',
        subtypes: null,
        availableFinishes: ['normal'],
        set: { id: 's1', name: 'Darkness Ablaze' },
      },
      productType: 'raw' as const,
      rawCondition: 'NM' as const,
      finish: 'normal' as const,
      cardProductId: null,
      rarity: 'Rare Holo',
      priceBasis: 'curve',
      marketMxnCents: 100000,
      marketBracket: 'mid',
      quotedPriceCents: 40000,
      approvedPriceCents: null,
      itemStatus: 'cotizada',
      inventoryItemId: null,
      rejectedAt: null,
      rejectionReason: null,
      offerDecision: l.offerDecision === undefined ? 'buy' : l.offerDecision,
      offeredPriceCents: l.offeredPriceCents === undefined ? 42000 : l.offeredPriceCents,
      // ⚠️ LOS CINCO ADMIN-ONLY, POBLADOS. Si la proyección de cliente los leyera, se filtrarían.
      offerDerivedPriceCents: 39000,
      offerOverrideReason: 'ajuste por escasez interna',
      offerPriceBasis: 'override',
      offerMarketMxnCents: 111111,
      offerMarketBracket: 'high',
    }),
  );

  const request: Record<string, unknown> = {
    id: 'sr-1',
    userId: 'u-1',
    user: { id: 'u-1', name: 'Ash Ketchum', email: 'ash@example.mx', phone: null, locale: opts.locale ?? 'es' },
    status: opts.status ?? 'ofertada',
    offerState: opts.offerState === undefined ? 'sent' : opts.offerState,
    quotedTotalCents: 80000,
    approvedTotalCents: null,
    ineRequired: false,
    ineProvided: false,
    speiReference: null,
    paidBy: null,
    paidAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    receivedAt: null,
    verifiedAt: null,
    approvedAt: null,
    adjustmentSentAt: null,
    deadlineAt: null,
    closedAt: null,
    clabeSnapshotEnc: null,
    offerSentAt: new Date('2026-08-10T15:00:00Z'),
    offerGrossCents: 42000,
    offerShippingFeeCents: 18000,
    offerNetCents: 24000,
    offerAcceptDeadlineAt: new Date('2100-01-01T00:00:00Z'),
    acceptedAt: null,
    shipDeadlineAt: null,
    sellerShippedDeclaredAt: null,
    shipmentCarrier: null,
    shipmentTrackingNumber: null,
  };

  const row = () => ({ ...request, items: items.map((i) => ({ ...i })) });
  const prisma: any = {
    sellRequest: {
      findUnique: jest.fn(async () => row()),
      findMany: jest.fn(async () => [row()]),
      count: jest.fn(async () => 1),
      updateMany: jest.fn(async ({ data }: any) => {
        Object.assign(request, data);
        return { count: 1 };
      }),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const settings = { getNumber: jest.fn(async () => 7) };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as unknown as PricingService,
    settings as unknown as SettingsService,
    {} as UsersService,
    pii,
    undefined,
  );
  return { svc, prisma, request, items };
}

/** La condición REAL que imprime el correo, extraída del correo renderizado. No un literal del test. */
function conditionFromMail(locale: string | null): string {
  const msg = sellOfferTemplate(
    {
      folio: 'sr-1',
      lines: [
        {
          cardName: 'Charizard VMAX',
          setName: 'Darkness Ablaze',
          cardNumber: '020',
          finish: 'normal',
          offeredPriceCents: 42000,
        },
      ],
      grossCents: 42000,
      shippingFeeCents: 18000,
      netCents: 24000,
      acceptDeadlineAt: new Date('2026-08-12T15:00:00Z'),
      pickupAddressLine: null,
    },
    'Ash Ketchum',
    locale,
  );
  // La línea de texto plano es `- <id> — <condición> — <monto>`.
  const line = msg.text.split('\n').find((x) => x.startsWith('- Charizard VMAX'));
  expect(line).toBeDefined();
  return (line as string).split(' — ')[1];
}

// =============================================================================================
describe('⚠️ (1) los TRES campos de cliente llegan al portal del vendedor', () => {
  it('`GET /buylist/requests/:id` — `items[]` lleva decisión, monto y condición', async () => {
    const { svc } = build();
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.items[0].offerDecision).toBe('buy');
    expect(res.items[0].offeredPriceCents).toBe(42000);
    expect(res.items[0].condition).toBe(offerTermsCopy('es').perLineConditionLabel);
  });

  it('`offer.lines[]` lleva lo mismo que `items[]` — es el mismo desglose para la misma persona', async () => {
    const { svc } = build();
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer).not.toBeNull();
    expect(res.offer.lines[0].offerDecision).toBe('buy');
    expect(res.offer.lines[0].offeredPriceCents).toBe(42000);
    expect(res.offer.lines[0].condition).toBe(res.items[0].condition);
  });

  it('`offer-response` (aceptar) devuelve el desglose con los tres campos', async () => {
    const { svc } = build();
    const res: any = await svc.offerResponse('u-1', 'sr-1', 'accept');
    expect(res.status).toBe('aceptada');
    expect(res.offer.lines[0].offerDecision).toBe('buy');
    expect(res.offer.lines[0].offeredPriceCents).toBe(42000);
    expect(res.offer.lines[0].condition).toBe(offerTermsCopy('es').perLineConditionLabel);
  });
});

// =============================================================================================
describe('⚠️ (2) `condition` es EL MISMO STRING que el correo (criterio 161(d))', () => {
  it.each([['es'], ['en']])(
    'locale=%s: la condición del DTO === la que imprime el correo, palabra por palabra',
    async (locale) => {
      const { svc } = build({ locale });
      const res: any = await svc.getMine('u-1', 'sr-1');
      const fromMail = conditionFromMail(locale);
      expect(fromMail.length).toBeGreaterThan(0);
      expect(res.items[0].condition).toBe(fromMail);
      expect(res.offer.lines[0].condition).toBe(fromMail);
      // Y el bloque legal de la pantalla sale de la MISMA fuente: tres lectores, un cuerpo.
      expect(res.offer.terms.perLineConditionLabel).toBe(fromMail);
    },
  );

  it('el locale del VENDEDOR manda: un vendedor `en` NO recibe la condición en español', async () => {
    const { svc } = build({ locale: 'en' });
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.items[0].condition).toBe('only if it arrives Near Mint');
    expect(res.items[0].condition).not.toBe(offerTermsCopy('es').perLineConditionLabel);
  });

  it('⚠️ REGRESIÓN: aceptar NO cambia de idioma — `offer-response` usa el locale del vendedor', async () => {
    // Antes de v1.51.15 `offerResponse` no cargaba el `locale`: el vendedor leía la oferta en
    // inglés y, al aceptarla, la respuesta le devolvía los términos en español. La misma oferta
    // decía dos cosas distintas en dos pantallas — justo lo que el criterio 161(d) prohíbe.
    const { svc } = build({ locale: 'en' });
    const res: any = await svc.offerResponse('u-1', 'sr-1', 'accept');
    expect(res.offer.lines[0].condition).toBe('only if it arrives Near Mint');
    expect(res.offer.terms.perLineConditionLabel).toBe('only if it arrives Near Mint');
  });

  it('la condición y el bloque legal del correo salen de `offerTermsCopy` (una sola fuente)', async () => {
    for (const locale of ['es', 'en']) {
      const terms = offerTermsCopy(locale);
      expect(conditionFromMail(locale)).toBe(terms.perLineConditionLabel);
      const msg = sellOfferTemplate(
        {
          folio: 'sr-1',
          lines: [
            {
              cardName: 'A',
              setName: 'B',
              cardNumber: '1',
              finish: 'normal',
              offeredPriceCents: 100,
            },
          ],
          grossCents: 100,
          shippingFeeCents: 18000,
          netCents: 0,
          acceptDeadlineAt: new Date('2026-08-12T15:00:00Z'),
          pickupAddressLine: null,
        },
        'Ash',
        locale,
      );
      expect(msg.text).toContain(terms.consequence);
    }
  });
});

// =============================================================================================
describe('⚠️ (3) la frontera de audiencia: lo admin-only NO baja y `condition` NO sube', () => {
  const ADMIN_ONLY = [
    'offerDerivedPriceCents',
    'offerOverrideReason',
    'offerPriceBasis',
    'offerMarketMxnCents',
    'offerMarketBracket',
  ];

  it.each(ADMIN_ONLY)('`%s` NO existe como clave en la línea del cliente', async (field) => {
    const { svc } = build();
    const res: any = await svc.getMine('u-1', 'sr-1');
    // Ausencia de CLAVE, no valor falsy: `{ x: undefined }` y `{}` se ven igual en un toBeFalsy().
    expect(Object.keys(res.items[0])).not.toContain(field);
    expect(Object.keys(res.offer.lines[0])).not.toContain(field);
  });

  it.each(ADMIN_ONLY)('`%s` tampoco baja por `offer-response`', async (field) => {
    const { svc } = build();
    const res: any = await svc.offerResponse('u-1', 'sr-1', 'accept');
    expect(Object.keys(res.offer.lines[0])).not.toContain(field);
  });

  it('⚠️ BL-20 sigue en pie: `isPayable` NO llega al vendedor por el detalle', async () => {
    const { svc } = build();
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(Object.keys(res)).not.toContain('isPayable');
    expect(Object.keys(res)).not.toContain('closedAt');
    expect(Object.keys(res)).not.toContain('paidBy');
  });

  it('el ADMIN ve decisión y monto, pero **no** `condition` (se renderiza en el locale del vendedor)', async () => {
    const { svc } = build();
    const res: any = await svc.adminGet('sr-1');
    expect(res.items[0].offerDecision).toBe('buy');
    expect(res.items[0].offeredPriceCents).toBe(42000);
    expect(Object.keys(res.items[0])).not.toContain('condition');
  });

  it('la LISTA del cliente no lleva oferta, así que tampoco `condition`', async () => {
    const { svc } = build();
    const res: any = await svc.listMine('u-1');
    expect(res.data[0].items[0].offerDecision).toBe('buy');
    expect(Object.keys(res.data[0].items[0])).not.toContain('condition');
    expect(Object.keys(res.data[0])).not.toContain('offer');
  });
});

// =============================================================================================
describe('⚠️ (4) `skip` se muestra SIN monto y SIN condición (criterio 118)', () => {
  const mixed = {
    lines: [
      { id: 'it-1', offerDecision: 'buy' as const, offeredPriceCents: 42000 },
      { id: 'it-2', offerDecision: 'skip' as const, offeredPriceCents: null },
    ],
  };

  it('la línea `skip` VIAJA: el desglose tiene que decir qué NO compramos', async () => {
    const { svc } = build(mixed);
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer.lines).toHaveLength(2);
    expect(res.offer.lines[1].offerDecision).toBe('skip');
  });

  it('⚠️ `offeredPriceCents` de un `skip` es `null`, **JAMÁS `0`** — cero es un precio', async () => {
    const { svc } = build(mixed);
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer.lines[1].offeredPriceCents).toBeNull();
    expect(res.offer.lines[1].offeredPriceCents).not.toBe(0);
  });

  it('un `skip` NO lleva la condición de compra pegada: no prometemos NM sobre lo que no compramos', async () => {
    const { svc } = build(mixed);
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer.lines[1].condition).toBeNull();
    expect(res.offer.lines[0].condition).toBe(offerTermsCopy('es').perLineConditionLabel);
  });

  it('el correo tampoco pone condición ni monto en el `skip` — DTO y correo coinciden', () => {
    const msg = sellOfferTemplate(
      {
        folio: 'sr-1',
        lines: [
          { cardName: 'Buy', setName: 'S', cardNumber: '1', finish: 'normal', offeredPriceCents: 42000 },
          { cardName: 'Skip', setName: 'S', cardNumber: '2', finish: 'normal', offeredPriceCents: null },
        ],
        grossCents: 42000,
        shippingFeeCents: 18000,
        netCents: 24000,
        acceptDeadlineAt: new Date('2026-08-12T15:00:00Z'),
        pickupAddressLine: null,
      },
      'Ash',
      'es',
    );
    const skipLine = msg.text.split('\n').find((x) => x.startsWith('- Skip')) as string;
    expect(skipLine).toBeDefined();
    expect(skipLine).not.toContain(offerTermsCopy('es').perLineConditionLabel);
    expect(skipLine).not.toMatch(/\$|0\.00/);
  });
});

// =============================================================================================
describe('⚠️ (5) línea PRE-CICLO: `null` honesto, no un cero ni una condición inventada', () => {
  it('sin decisión de oferta, los tres campos son `null` en la superficie de cliente', async () => {
    const { svc } = build({
      lines: [{ id: 'it-1', offerDecision: null, offeredPriceCents: null }],
    });
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.items[0].offerDecision).toBeNull();
    expect(res.items[0].offeredPriceCents).toBeNull();
    expect(res.items[0].condition).toBeNull();
  });

  it('sin oferta emitida (`offerState=null`) `offer` es `null` pero `items[]` sigue siendo honesto', async () => {
    const { svc } = build({
      offerState: null,
      status: 'cotizada',
      lines: [{ id: 'it-1', offerDecision: null, offeredPriceCents: null }],
    });
    const res: any = await svc.getMine('u-1', 'sr-1');
    expect(res.offer).toBeNull();
    expect(res.items[0].offerDecision).toBeNull();
    expect(res.items[0].condition).toBeNull();
  });
});

// =============================================================================================
describe('⚠️ (6) guarda de censo: la condición NM vive en UN solo sitio del código', () => {
  const SRC = path.join(__dirname, '..', 'src');
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return walk(p);
      return e.isFile() && p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });

  it.each([['siempre que llegue en Near Mint'], ['only if it arrives Near Mint']])(
    'el literal «%s» aparece exactamente UNA vez en `src/`',
    (literal) => {
      const hits = walk(SRC).filter((f) => fs.readFileSync(f, 'utf8').includes(literal));
      // Un segundo literal es una copia que hoy coincide y mañana no. El contrato exige que
      // `SellItemDTO.condition` sea «el MISMO string que usó el correo»: eso solo se garantiza
      // con una fuente, y esta guarda es lo que impide que vuelva a haber dos.
      expect(hits.map((f) => path.relative(SRC, f))).toEqual(['modules/buylist/buylist-mail.templates.ts']);
    },
  );
});
