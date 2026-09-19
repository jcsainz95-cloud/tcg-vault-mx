import { PrismaService } from '../../prisma/prisma.service';
import { DeckMatcherService } from './deck-matcher.service';
import { parseDeckList } from './deck-list.parser';

/**
 * DECKS-META §3.2 (Fase 1) — el CORAZÓN: emparejado por `CardSet.ptcgoCode` + `Card.number`,
 * NUNCA por nombre. Lo que no casa se marca (matchStatus) y NO se inventa. Casos que fijan el
 * contrato del matcher, con Prisma mockeado (una lectura de sets + una de cartas, sin N+1).
 */
describe('DeckMatcherService (DECKS-META §3.2) — empareja por ptcgoCode + número', () => {
  // Universo de prueba: dos sets, uno de ellos colisiona en ptcgoCode con otro (para `ambiguous`).
  const sets = [
    { id: 'set-twm', ptcgoCode: 'TWM', name: 'Twilight Masquerade' },
    { id: 'set-svi', ptcgoCode: 'SVI', name: 'Scarlet & Violet' },
    // Colisión deliberada de ptcgoCode 'PR' entre dos sets promo:
    { id: 'set-pr-a', ptcgoCode: 'PR', name: 'Promo A' },
    { id: 'set-pr-b', ptcgoCode: 'PR', name: 'Promo B' },
  ];
  const cards = [
    { id: 'card-dragapult', setId: 'set-twm', number: '130', name: 'Dragapult ex', supertype: 'Pokémon',
      regulationMark: 'H', legalStandardRaw: 'Legal', numberPrefix: '', externalId: 'twm-130' },
    { id: 'card-research', setId: 'set-svi', number: '189', name: "Professor's Research", supertype: 'Trainer',
      regulationMark: 'G', legalStandardRaw: 'Legal', numberPrefix: '', externalId: 'svi-189' },
    // carta con número con ceros a la izquierda en BD:
    { id: 'card-budew', setId: 'set-twm', number: '004', name: 'Budew', supertype: 'Pokémon',
      regulationMark: 'H', legalStandardRaw: 'Legal', numberPrefix: '', externalId: 'twm-004' },
    // dos cartas homónimas de número en sets que colisionan en ptcgoCode 'PR':
    { id: 'card-pr-a-1', setId: 'set-pr-a', number: '1', name: 'Pikachu', supertype: 'Pokémon',
      regulationMark: 'H', legalStandardRaw: 'Legal', numberPrefix: '', externalId: 'pra-1' },
    { id: 'card-pr-b-1', setId: 'set-pr-b', number: '1', name: 'Pikachu', supertype: 'Pokémon',
      regulationMark: 'H', legalStandardRaw: 'Legal', numberPrefix: '', externalId: 'prb-1' },
  ];

  function makePrisma() {
    return {
      cardSet: {
        findMany: jest.fn(async () => sets),
      },
      card: {
        // Query real: acotada por setId; el número se normaliza en memoria (no en el `where`).
        findMany: jest.fn(async ({ where }: any) => {
          const setIds: string[] = where.setId.in;
          return cards.filter((c) => setIds.includes(c.setId));
        }),
      },
    } as unknown as PrismaService;
  }

  function svc() {
    return new DeckMatcherService(makePrisma());
  }

  it('línea que casa por set+número ⇒ matched + matchedCard + group del supertype', async () => {
    const { lines } = parseDeckList('4 Dragapult ex TWM 130');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('matched');
    expect(out[0].matchedCard?.id).toBe('card-dragapult');
    expect(out[0].group).toBe('pokemon');
    expect(out[0].rawSetCode).toBe('TWM');
    expect(out[0].rawNumber).toBe('130');
    expect(out[0].quantity).toBe(4);
  });

  it('el group se REFINA del supertype de la carta casada, no del parser', async () => {
    // Escrito bajo la sección Pokémon a propósito, pero la carta es Trainer:
    const { lines } = parseDeckList("Pokémon: 1\n4 Professor's Research SVI 189");
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('matched');
    expect(out[0].group).toBe('trainer');
  });

  it('empareja por SET+NÚMERO, no por nombre: un nombre equivocado con set+número correcto CASA', async () => {
    const { lines } = parseDeckList('4 Nombre Totalmente Inventado TWM 130');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('matched');
    expect(out[0].matchedCard?.id).toBe('card-dragapult');
  });

  it('número con ceros a la izquierda: "4 Budew TWM 4" casa contra number "004" (normalizado)', async () => {
    const { lines } = parseDeckList('4 Budew TWM 4');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('matched');
    expect(out[0].matchedCard?.id).toBe('card-budew');
  });

  it('set desconocido ⇒ unmatched_set, matchedCard null (NO se inventa)', async () => {
    const { lines } = parseDeckList('4 Charizard ex ZZZ 100');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('unmatched_set');
    expect(out[0].matchedCard).toBeNull();
    expect(out[0].rawSetCode).toBe('ZZZ');
  });

  it('set conocido pero número inexistente ⇒ unmatched_number, matchedCard null', async () => {
    const { lines } = parseDeckList('4 Dragapult ex TWM 999');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('unmatched_number');
    expect(out[0].matchedCard).toBeNull();
  });

  it('colisión de ptcgoCode con varias candidatas ⇒ ambiguous, matchedCard null (no auto-resuelve)', async () => {
    const { lines } = parseDeckList('1 Pikachu PR 1');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('ambiguous');
    expect(out[0].matchedCard).toBeNull();
  });

  it('energía básica sin set/número ⇒ unmatched_basic_energy, matchedCard null, rawSetCode/número vacíos', async () => {
    const { lines } = parseDeckList('Energy: 1\n8 Basic Fire Energy');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('unmatched_basic_energy');
    expect(out[0].matchedCard).toBeNull();
    expect(out[0].rawSetCode).toBe('');
    expect(out[0].rawNumber).toBe('');
    expect(out[0].group).toBe('energy');
  });

  it('ptcgoCode case-insensitive: "twm" minúsculas casa igual', async () => {
    const { lines } = parseDeckList('4 Dragapult ex twm 130');
    const out = await svc().matchLines(lines);
    expect(out[0].matchStatus).toBe('matched');
  });

  it('lee sets y cartas en LOTE: una llamada a cardSet.findMany y una a card.findMany por lista', async () => {
    const prisma = makePrisma();
    const service = new DeckMatcherService(prisma);
    const { lines } = parseDeckList('4 Dragapult ex TWM 130\n2 Budew TWM 4\n4 Professor\'s Research SVI 189');
    await service.matchLines(lines);
    expect((prisma.cardSet.findMany as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((prisma.card.findMany as jest.Mock)).toHaveBeenCalledTimes(1);
  });

  it('lista vacía ⇒ sin lecturas, sin líneas', async () => {
    const prisma = makePrisma();
    const out = await new DeckMatcherService(prisma).matchLines([]);
    expect(out).toHaveLength(0);
    expect((prisma.card.findMany as jest.Mock)).not.toHaveBeenCalled();
  });
});
