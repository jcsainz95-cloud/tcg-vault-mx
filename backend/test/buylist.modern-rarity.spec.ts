import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.3.1 (AcquisitionPricer por RAREZA) · ⛔ SUPERSEDED por v2.0 (P-48, ARCHITECTURE §4.36).
 *
 * Este spec nació para blindar el bug de dinero de Fase 0.1: una rareza PREMIUM en holofoil que caía
 * al bin fijo barato de bulk («Holo» $1.50) porque el ACABADO seleccionaba la regla. **v2.0 elimina la
 * clase entera de bugs**: no hay reglas que resolver, no hay ejes que se pisen y no hay rarezas sin
 * mapear — el monto sale SOLO de la curva sobre el valor de mercado (criterio 84), y ni `rarity` ni
 * `finish` están en la firma de la función de dinero.
 *
 * Se conserva el spec (no se borra) porque su PREGUNTA sigue siendo la correcta: «¿puede una chase
 * cotizar a precio de bulk?». La respuesta ahora es estructural: **no, porque el precio ni siquiera
 * mira la rareza**. Los casos se re-expresan contra ese invariante.
 */

const pii = new PiiCryptoService(new ConfigService({}));

function svcWith(
  referenceMxnCents: number | null,
  cardRarity: string | null = 'Illustration Rare',
): { svc: BuylistService; escalatePending: jest.Mock } {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity: cardRarity,
        // v1.6-finish: acabados disponibles para poder cotizar en holofoil en los tests.
        availableFinishes: ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'],
      }),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
      // (`this` = este objeto `card`), para no duplicar datos ni criterios.
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
  };
  const escalatePending = jest.fn().mockResolvedValue(undefined);
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn().mockResolvedValue(
      referenceMxnCents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents },
    ),
    escalatePending,
    // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
  const settings = {
    getRaw: jest.fn(),
    getNumber: jest.fn().mockResolvedValue(0),
  } as unknown as SettingsService;
  const svc = new BuylistService(prisma as PrismaService, pricing, settings, {} as UsersService, pii);
  return { svc, escalatePending };
}

describe('BuylistService.publicQuote — el monto sale de la CURVA, no de la rareza (v2.0, criterio 84)', () => {
  it('rareza moderna CON referencia → cotiza por la curva de compra', async () => {
    const { svc } = svcWith(12500, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.rarity).toBe('Illustration Rare'); // dato de display; NO entra al monto
    expect(q.priceBasis).toBe('market');
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(5079); // $125 × 40.63 % interpolado
  });

  it('SIN referencia → precio_pendiente: el BIN no gana (decisión LOCKED §4.36.0)', async () => {
    const { svc } = svcWith(null, 'Special Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.priceBasis).toBe('pending');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('v2.0: una Common SIN referencia YA NO cotiza al bin de bulk — queda pendiente', async () => {
    // Antes: `fixed $0.50` cotizaba sin mercado. Ahora el precio jamás se inventa sin dato (§N.1).
    const { svc } = svcWith(null, 'Common');
    const q = await svc.publicQuote('c1', 'raw', 'NM');
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });
});

/**
 * Fase 0.1 (bug de dinero) — RESUELTO POR CONSTRUCCIÓN en v2.0. La trampa era una regla «Holo» fija
 * barata que el eje de ACABADO seleccionaba para una chase. Ya no existe: el acabado solo elige de qué
 * variante se lee el mercado, y con el mismo mercado todos los acabados cotizan idéntico.
 */
describe('Fase 0.1 — una chase ya NO puede cotizar a precio de bulk (estructural, no por gate)', () => {
  it('Illustration Rare en holofoil con mercado $5,000 cotiza por la curva, no a $1.50', async () => {
    const { svc } = svcWith(500000, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(250000); // 50 % (tramo plano final, mercado > $500)
  });

  it('CUATRO rarezas distintas con el MISMO mercado cotizan EXACTAMENTE lo mismo (criterio 83)', async () => {
    const rarities = ['Common', 'Rare Holo', 'Double Rare', 'Secret Rare'];
    const quotes = await Promise.all(
      rarities.map((r) => svcWith(500000, r).svc.publicQuote('c1', 'raw', 'NM', 'holofoil')),
    );
    const amounts = quotes.map((q) => q.quote.quotedPriceCents);
    expect(new Set(amounts).size).toBe(1);
    expect(amounts[0]).toBe(250000);
  });

  it('el MISMO mercado en los CUATRO acabados cotiza igual (el acabado perdió su regla propia)', async () => {
    const finishes = ['normal', 'reverse_holo', 'holofoil', 'first_edition_holofoil'] as const;
    const quotes = await Promise.all(
      finishes.map((f) => svcWith(800000, 'Rare Holo VMAX').svc.publicQuote('c1', 'raw', 'NM', f as never)),
    );
    expect(new Set(quotes.map((q) => q.quote.quotedPriceCents)).size).toBe(1);
    expect(quotes[0].quote.quotedPriceCents).toBe(400000); // 50 % de $8,000
  });
});

/**
 * v1.12-catalog-pricing (§4.13b) — `publicQuote` vuelve a READ-ONLY (cierra BE-16, supersede la
 * Fase 0.2). Un endpoint público/anónimo NO debe escribir en la cola de trabajo del dueño: con el
 * catálogo completo ya priceado durante el `catalog-sync` (§4.13a), el quote LEE la referencia y,
 * si el acabado sigue `precio_pendiente`, lo REPORTA sin encolar `PendingPriceEntry`. La escalada
 * queda SOLO en el flujo autenticado `createRequest` (POST /buylist/requests).
 */
describe('BuylistService.publicQuote — v1.12: read-only, NO crea PendingPriceEntry (cierra BE-16)', () => {
  it('precio_pendiente → NO llama escalatePending (endpoint anónimo no escribe la cola)', async () => {
    const { svc, escalatePending } = svcWith(null, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('precio_pendiente');
    // El quote reporta el pendiente pero NO lo persiste (read-only).
    expect(escalatePending).not.toHaveBeenCalled();
  });

  it('cotizada (con referencia) → tampoco encola pendiente', async () => {
    const { svc, escalatePending } = svcWith(500000, 'Illustration Rare');
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil');
    expect(q.quote.status).toBe('cotizada');
    expect(escalatePending).not.toHaveBeenCalled();
  });
});
