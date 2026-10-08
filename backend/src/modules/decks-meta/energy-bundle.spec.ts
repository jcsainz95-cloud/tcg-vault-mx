import { ConfigService } from '@nestjs/config';
import { EnergyType, MetaMatchStatus } from '@prisma/client';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { DECK_PULL_TTL_SECONDS, signPullToken } from './deck-pull-token';
import {
  DeckFact,
  DeckListFact,
  DeckListLine,
  EnergyProduct,
  EvaluateDeckPullsContext,
  accessoryPhotoOf,
  computeEnergyBundleOffer,
  evaluateDeckPulls,
} from './energy-bundle';

/**
 * 💰 AC-B30 (oferta del paquete, §AC.8 «offered») y la parte PURA de AC-B32 (validador de `deckPulls` que el
 * stream B llama en `quote`/`session`, §AC.8 «En quote/session» pasos 1–6).
 */

const ALL_TYPES = Object.values(EnergyType);

function products(over: Partial<Record<EnergyType, Partial<EnergyProduct> | null>> = {}): Map<EnergyType, EnergyProduct> {
  const m = new Map<EnergyType, EnergyProduct>();
  for (const t of ALL_TYPES) {
    if (over[t] === null) continue; // sin producto activo de ese tipo
    m.set(t, { accessoryId: `acc-${t}`, energyType: t, priceCents: 500, availableQty: 40, photoVersion: `ver${t}`, ...(over[t] ?? {}) });
  }
  return m;
}

const card = (quantity: number, rawName = 'Dragapult ex'): DeckListLine => ({ rawName, quantity, matchStatus: MetaMatchStatus.matched });
const energy = (quantity: number, rawName: string): DeckListLine => ({ rawName, quantity, matchStatus: MetaMatchStatus.unmatched_basic_energy });

/** 50 copias no-energía (30 + 20) + 6 Psíquica + 4 Oscura. */
const DECK: DeckListLine[] = [card(30), card(20, 'Iono'), energy(6, 'Basic {P} Energy'), energy(4, 'Basic Darkness Energy')];

describe('AC-B30 computeEnergyBundleOffer (§AC.8 offered)', () => {
  const offer = (lines: DeckListLine[], signedIdsCount: number, prods = products(), priceCents = 2000) =>
    computeEnergyBundleOffer({ lines, signedIdsCount, products: prods, priceCents });

  it('se ofrece: energies por tipo en el orden del enum, looseTotal = Σ need × precio, price = el dial', () => {
    expect(offer(DECK, 50)).toEqual({
      offered: true,
      reason: null,
      priceCents: 2000,
      looseTotalCents: 5000,
      energies: [
        { energyType: 'psychic', quantity: 6, accessoryId: 'acc-psychic' },
        { energyType: 'darkness', quantity: 4, accessoryId: 'acc-darkness' },
      ],
    });
  });

  it('suma por tipo líneas distintas del mismo tipo (símbolo + nombre)', () => {
    const r = offer([card(40), energy(3, 'Basic {R} Energy'), energy(2, 'Fire Energy')], 40);
    expect(r.energies).toEqual([{ energyType: 'fire', quantity: 5, accessoryId: 'acc-fire' }]);
    expect(r.looseTotalCents).toBe(2500);
    expect(r.offered).toBe(true);
  });

  it('el precio de cada energía es el de SU producto (looseTotal con precios distintos)', () => {
    const r = offer(DECK, 50, products({ psychic: { priceCents: 700 } }));
    expect(r.looseTotalCents).toBe(6 * 700 + 4 * 500);
  });

  it('sin energía básica reconocida ⇒ no_basic_energy, energies vacío', () => {
    expect(offer([card(60)], 60)).toEqual({ offered: false, reason: 'no_basic_energy', priceCents: 2000, looseTotalCents: 0, energies: [] });
  });

  it('energía sin tipo (Jet Energy sin set) no aporta tipo ⇒ sola, no_basic_energy', () => {
    expect(offer([card(56), energy(4, 'Jet Energy')], 56).reason).toBe('no_basic_energy');
  });

  it('solo cuenta líneas unmatched_basic_energy: una energía CASADA como carta no entra a energies', () => {
    const matchedEnergy: DeckListLine = { rawName: 'Basic Fire Energy', quantity: 8, matchStatus: MetaMatchStatus.matched };
    expect(offer([card(52), matchedEnergy], 60).reason).toBe('no_basic_energy');
  });

  describe('P-EN-3 (criterio 745): looseTotal > price', () => {
    it('4 × 500 = 2000 ≤ 2000 ⇒ no se ofrece (not_offered)', () => {
      const r = offer([card(56), energy(4, 'Basic {G} Energy')], 56);
      expect(r).toMatchObject({ offered: false, reason: 'not_offered', looseTotalCents: 2000 });
    });
    it('5 × 500 = 2500 > 2000 ⇒ se ofrece', () => {
      expect(offer([card(55), energy(5, 'Basic {G} Energy')], 55)).toMatchObject({ offered: true, reason: null });
    });
    it('el dial manda: con price 2500, 5 × 500 ya no se ofrece', () => {
      expect(offer([card(55), energy(5, 'Basic {G} Energy')], 55, products(), 2500)).toMatchObject({ offered: false, reason: 'not_offered', priceCents: 2500 });
    });
  });

  describe('P-AC-4: copias firmadas ≥ ⌈½ × copias no-energía⌉', () => {
    it('50 no-energía: 25 firmadas ⇒ se ofrece; 24 ⇒ not_offered', () => {
      expect(offer(DECK, 25).offered).toBe(true);
      expect(offer(DECK, 24)).toMatchObject({ offered: false, reason: 'not_offered' });
    });
    it('49 no-energía (impar): ⌈24.5⌉ = 25 ⇒ 24 no, 25 sí', () => {
      const lines = [card(29), card(20, 'Iono'), energy(10, 'Basic {P} Energy')];
      expect(offer(lines, 24).offered).toBe(false);
      expect(offer(lines, 25).offered).toBe(true);
    });
    it('1 carta sola de un deck de 50 ⇒ not_offered (el caso que motivó P-AC-4)', () => {
      expect(offer(DECK, 1)).toMatchObject({ offered: false, reason: 'not_offered' });
    });
    it('las líneas unmatched_basic_energy NO cuentan en el denominador (ni las de tipo desconocido)', () => {
      // 20 no-energía + 30 energía básica (10 sin tipo): mitad = 10.
      const lines = [card(20), energy(20, 'Basic {W} Energy'), energy(10, 'Jet Energy')];
      expect(offer(lines, 10).offered).toBe(true);
      expect(offer(lines, 9).offered).toBe(false);
    });
  });

  describe('regla 5: producto activo con disponible ≥ lo pedido', () => {
    it('un tipo sin producto activo ⇒ not_offered y accessoryId null', () => {
      const r = offer(DECK, 50, products({ darkness: null }));
      expect(r.offered).toBe(false);
      expect(r.reason).toBe('not_offered');
      expect(r.energies).toEqual([
        { energyType: 'psychic', quantity: 6, accessoryId: 'acc-psychic' },
        { energyType: 'darkness', quantity: 4, accessoryId: null },
      ]);
    });
    it('producto sin foto se trata como sin producto (activo ⇒ foto, CHECK)', () => {
      expect(offer(DECK, 50, products({ darkness: { photoVersion: null } })).reason).toBe('not_offered');
    });
    it('existencias cortas ⇒ insufficient_stock (6 pedidas, 5 disponibles); con 6 ⇒ se ofrece', () => {
      expect(offer(DECK, 50, products({ psychic: { availableQty: 5 } }))).toMatchObject({ offered: false, reason: 'insufficient_stock' });
      expect(offer(DECK, 50, products({ psychic: { availableQty: 6 } })).offered).toBe(true);
    });
    it('precedencia: lo estructural (mitad) gana a las existencias', () => {
      expect(offer(DECK, 1, products({ psychic: { availableQty: 0 } })).reason).toBe('not_offered');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const signer = new PiiCryptoService(new ConfigService({ PII_HMAC_KEY: 'k'.repeat(48) }));
const NOW = 1_790_000_000;
const SIGNED_IDS = Array.from({ length: 30 }, (_, i) => `inv-${String(i).padStart(2, '0')}`);

const deck = (over: Partial<DeckFact> = {}): DeckFact => ({ id: 'deck-1', slug: 'dragapult', name: 'Dragapult ex', published: true, pausedByOperator: false, ...over });
const listL1: DeckListFact = { id: 'L1', deckId: 'deck-1', lines: DECK };
/** Lista VIGENTE distinta (otra energía): la validación debe leer la FIRMADA (L1), no esta. */
const listL2: DeckListFact = { id: 'L2', deckId: 'deck-1', lines: [card(50), energy(12, 'Basic {M} Energy')] };

function ctx(over: Partial<EvaluateDeckPullsContext> = {}): EvaluateDeckPullsContext {
  return {
    signer,
    nowSec: NOW,
    requestInventoryItemIds: [...SIGNED_IDS, 'otra-carta'],
    decksBySlug: new Map([['dragapult', deck()]]),
    listsById: new Map([['L1', listL1], ['L2', listL2]]),
    products: products(),
    bundlePriceCents: 2000,
    ...over,
  };
}
const tok = (over: Partial<{ slug: string; listId: string; ids: string[]; iat: number }> = {}) =>
  signPullToken(signer, { slug: 'dragapult', listId: 'L1', ids: SIGNED_IDS, iat: NOW - 60, ...over });

describe('AC-B32 (parte pura) evaluateDeckPulls (§AC.8 «En quote/session»)', () => {
  it('válido con withEnergyBundle:true ⇒ bundle: precio = dial, energías de la lista FIRMADA, foto del producto', () => {
    const [r] = evaluateDeckPulls([{ pullToken: tok(), withEnergyBundle: true }], ctx({ bundlePriceCents: 2300 }));
    expect(r).toEqual({
      index: 0,
      status: 'bundle',
      deckSlug: 'dragapult',
      deckName: 'Dragapult ex',
      metaDeckId: 'deck-1',
      metaDeckListId: 'L1',
      signedInventoryItemIds: SIGNED_IDS,
      bundle: {
        deckSlug: 'dragapult',
        deckName: 'Dragapult ex',
        priceCents: 2300,
        looseTotalCents: 5000,
        energies: [
          { energyType: 'psychic', quantity: 6, accessoryId: 'acc-psychic', photo: accessoryPhotoOf('acc-psychic', 'verpsychic') },
          { energyType: 'darkness', quantity: 4, accessoryId: 'acc-darkness', photo: accessoryPhotoOf('acc-darkness', 'verdarkness') },
        ],
      },
    });
  });

  it('foto: rutas de la API con versión (full y thumb)', () => {
    expect(accessoryPhotoOf('a1', 'abcdef0123456789')).toEqual({
      url: '/api/v1/accessories/a1/photo/abcdef0123456789/full',
      thumbUrl: '/api/v1/accessories/a1/photo/abcdef0123456789/thumb',
    });
  });

  it('válido con withEnergyBundle:false ⇒ offer (misma forma)', () => {
    const [r] = evaluateDeckPulls([{ pullToken: tok(), withEnergyBundle: false }], ctx());
    expect(r).toMatchObject({ index: 0, status: 'offer', deckSlug: 'dragapult' });
  });

  it('1. firma inválida ⇒ invalid_token (slug null); vencido ⇒ expired (con slug)', () => {
    const [a, b] = evaluateDeckPulls(
      [
        { pullToken: tok().slice(0, -2) + 'xx', withEnergyBundle: true },
        { pullToken: tok({ iat: NOW - DECK_PULL_TTL_SECONDS - 1 }), withEnergyBundle: true },
      ],
      ctx(),
    );
    expect(a).toEqual({ index: 0, status: 'invalid', withEnergyBundle: true, deckSlug: null, reason: 'invalid_token' });
    expect(b).toEqual({ index: 1, status: 'invalid', withEnergyBundle: true, deckSlug: 'dragapult', reason: 'expired' });
  });

  it.each([
    ['inexistente', new Map<string, DeckFact>()],
    ['sin publicar', new Map([['dragapult', deck({ published: false })]])],
    ['en pausa', new Map([['dragapult', deck({ pausedByOperator: true })]])],
  ])('2. deck %s ⇒ deck_unpublished', (_n, decksBySlug) => {
    const [r] = evaluateDeckPulls([{ pullToken: tok(), withEnergyBundle: true }], ctx({ decksBySlug }));
    expect(r).toMatchObject({ status: 'invalid', reason: 'deck_unpublished', deckSlug: 'dragapult' });
  });

  it('2. lista firmada que no existe o es de OTRO deck ⇒ deck_unpublished', () => {
    const [a] = evaluateDeckPulls([{ pullToken: tok({ listId: 'L9' }), withEnergyBundle: true }], ctx());
    const [b] = evaluateDeckPulls(
      [{ pullToken: tok(), withEnergyBundle: true }],
      ctx({ listsById: new Map([['L1', { ...listL1, deckId: 'deck-OTRO' }]]) }),
    );
    expect(a).toMatchObject({ status: 'invalid', reason: 'deck_unpublished' });
    expect(b).toMatchObject({ status: 'invalid', reason: 'deck_unpublished' });
  });

  it('2. las energías salen de la lista FIRMADA (L1), no de la vigente (L2)', () => {
    const [onL2] = evaluateDeckPulls([{ pullToken: tok({ listId: 'L2' }), withEnergyBundle: true }], ctx());
    const [onL1] = evaluateDeckPulls([{ pullToken: tok({ listId: 'L1' }), withEnergyBundle: true }], ctx());
    expect(onL1.status === 'bundle' && onL1.bundle.energies.map((e) => e.energyType)).toEqual(['psychic', 'darkness']);
    expect(onL2.status === 'bundle' && onL2.bundle.energies.map((e) => e.energyType)).toEqual(['metal']);
  });

  it('3. P-EN-4: falta UN id firmado en la petición ⇒ deck_incomplete (true y false)', () => {
    const request = SIGNED_IDS.slice(1);
    const r = evaluateDeckPulls(
      [
        { pullToken: tok(), withEnergyBundle: true },
        { pullToken: tok({ slug: 'dragapult' }), withEnergyBundle: false },
      ],
      ctx({ requestInventoryItemIds: request }),
    );
    expect(r[0]).toMatchObject({ status: 'invalid', reason: 'deck_incomplete', deckSlug: 'dragapult' });
    expect(r[1]).toMatchObject({ status: 'invalid', reason: 'deck_incomplete', deckSlug: 'dragapult' });
  });

  it('4. dos deckPulls del mismo slug con withEnergyBundle:true ⇒ el SEGUNDO es duplicate', () => {
    const r = evaluateDeckPulls(
      [
        { pullToken: tok(), withEnergyBundle: true },
        { pullToken: tok({ iat: NOW - 30 }), withEnergyBundle: true },
      ],
      ctx(),
    );
    expect(r[0]).toMatchObject({ index: 0, status: 'bundle' });
    expect(r[1]).toEqual({ index: 1, status: 'invalid', withEnergyBundle: true, deckSlug: 'dragapult', reason: 'duplicate' });
  });

  it('un deck con paquete no se ofrece además (el false del mismo slug ⇒ ignored bundled), sea cual sea el orden', () => {
    const r = evaluateDeckPulls(
      [
        { pullToken: tok(), withEnergyBundle: false },
        { pullToken: tok(), withEnergyBundle: true },
      ],
      ctx(),
    );
    expect(r[0]).toEqual({ index: 0, status: 'ignored', deckSlug: 'dragapult', why: 'bundled' });
    expect(r[1]).toMatchObject({ index: 1, status: 'bundle' });
  });

  it('dos ofertas del mismo slug ⇒ la segunda ignored offer_repeated (se sugiere una vez)', () => {
    const r = evaluateDeckPulls(
      [
        { pullToken: tok(), withEnergyBundle: false },
        { pullToken: tok(), withEnergyBundle: false },
      ],
      ctx(),
    );
    expect(r.map((x) => x.status)).toEqual(['offer', 'ignored']);
    expect(r[1]).toMatchObject({ why: 'offer_repeated' });
  });

  it('5. offered recalculado: mitad (P-AC-4) ⇒ not_offered; P-EN-3 ⇒ not_offered; sin energía ⇒ not_offered; stock ⇒ insufficient_stock', () => {
    const few = SIGNED_IDS.slice(0, 24); // 24 < ⌈50/2⌉
    const [half] = evaluateDeckPulls([{ pullToken: tok({ ids: few }), withEnergyBundle: true }], ctx({ requestInventoryItemIds: few }));
    expect(half).toMatchObject({ status: 'invalid', reason: 'not_offered' });

    const lists4 = new Map([['L1', { ...listL1, lines: [card(50), energy(4, 'Basic {G} Energy')] }]]);
    const [pen3] = evaluateDeckPulls([{ pullToken: tok(), withEnergyBundle: true }], ctx({ listsById: lists4 }));
    expect(pen3).toMatchObject({ status: 'invalid', reason: 'not_offered' });

    const lists0 = new Map([['L1', { ...listL1, lines: [card(60)] }]]);
    const [none] = evaluateDeckPulls([{ pullToken: tok(), withEnergyBundle: true }], ctx({ listsById: lists0 }));
    expect(none).toMatchObject({ status: 'invalid', reason: 'not_offered' });

    const [stock] = evaluateDeckPulls([{ pullToken: tok(), withEnergyBundle: true }], ctx({ products: products({ darkness: { availableQty: 3 } }) }));
    expect(stock).toMatchObject({ status: 'invalid', reason: 'insufficient_stock' });
  });

  it('el resultado sale en el orden de la petición y uno por entrada', () => {
    const r = evaluateDeckPulls(
      [
        { pullToken: 'basura', withEnergyBundle: false },
        { pullToken: tok(), withEnergyBundle: true },
        { pullToken: 'basura2', withEnergyBundle: true },
      ],
      ctx(),
    );
    expect(r.map((x) => x.index)).toEqual([0, 1, 2]);
    expect(r.map((x) => x.status)).toEqual(['invalid', 'bundle', 'invalid']);
  });
});
