import { CardShowService } from '../src/modules/card-show/card-show.service';
import { BusinessException } from '../src/common/business.exception';
import { renderLeadsSummary } from '../src/modules/card-show/card-show-internal.templates';
import { ENV } from '../src/modules/card-show/card-show.constants';

/**
 * ⭐M-84 (API_CONTRACT §CARDSHOW.1b/.12/.15) — validación CONDICIONAL por tipo (lead) y por juego (torneo),
 * confirmación FORMAL/LIGERA y los conteos del correo-resumen (0 PII). Mide el SERVICIO: la validación corre
 * ANTES del token (gates silenciosos), así que las rechazadas lanzan sin tocar BD/correo; el camino VÁLIDO se
 * corta en `too_fast` (silencioso) sin BD.
 */

const DAY = 24 * 60 * 60 * 1000;

function makeService(overrides: {
  prisma?: unknown;
  tokens?: Record<string, unknown>;
  config?: Record<string, unknown>;
  caps?: Record<string, unknown>;
  mail?: Record<string, unknown>;
} = {}): CardShowService {
  const tokens = {
    verifyFormToken: jest.fn().mockReturnValue({ status: 'too_fast' }), // camino válido ⇒ silencioso, 0 BD
    verifyLinkToken: jest.fn(),
    issueLinkToken: jest.fn().mockReturnValue('tok'),
    ...overrides.tokens,
  };
  const pii = { blindIndex: (s: string) => `bi:${s}` };
  const config = { get: jest.fn().mockReturnValue(undefined), ...overrides.config };
  const caps = { reserveInternalNotice: jest.fn().mockResolvedValue(true), ...overrides.caps };
  const mail = { sendLeadsSummary: jest.fn().mockResolvedValue(true), ...overrides.mail };
  return new CardShowService(
    (overrides.prisma ?? {}) as never,
    pii as never,
    tokens as never,
    {} as never,
    caps as never,
    mail as never,
    {} as never,
    {} as never,
    config as never,
  );
}

const svc = makeService();

async function leadField(dto: Record<string, unknown>): Promise<string> {
  try {
    await svc.createLead(dto as never);
    return 'OK';
  } catch (e) {
    return (e as BusinessException).details?.field as string;
  }
}
async function playerField(dto: Record<string, unknown>): Promise<string> {
  try {
    await svc.createPlayer(dto as never);
    return 'OK';
  } catch (e) {
    return (e as BusinessException).details?.field as string;
  }
}

const baseLead = { name: 'Ana', email: 'a@dominio.mx', source: 'cta_hero', consent: true, formToken: 't' };
const basePlayer = { day: 'sat', playerName: 'Ash', email: 'a@dominio.mx', isMinor: false, consent: true, formToken: 't' };

describe('CARDSHOW M-84 · validación condicional de lead por tipo (§CARDSHOW.1b)', () => {
  it('visitor con phone ⇒ 400 {phone}', async () => expect(await leadField({ ...baseLead, type: 'visitor', phone: '5512345678' })).toBe('phone'));
  it('merchant sin phone ⇒ 400 {phone}', async () => expect(await leadField({ ...baseLead, type: 'merchant' })).toBe('phone'));
  it('merchant con phone que no reduce a 10 dígitos ⇒ 400 {phone}', async () =>
    expect(await leadField({ ...baseLead, type: 'merchant', phone: '123' })).toBe('phone'));
  it('merchant con phone "55 1234 5678" ⇒ OK (válido)', async () =>
    expect(await leadField({ ...baseLead, type: 'merchant', phone: '55 1234 5678' })).toBe('OK'));
  it('merchant con gameInterest ⇒ 400 {gameInterest}', async () =>
    expect(await leadField({ ...baseLead, type: 'merchant', phone: '5512345678', gameInterest: 'pokemon' })).toBe('gameInterest'));
  it('merchant con raffleOptIn ⇒ 400 {raffleOptIn}', async () =>
    expect(await leadField({ ...baseLead, type: 'sponsor', phone: '5512345678', raffleOptIn: true })).toBe('raffleOptIn'));
  it('visitor raffleOptIn=true sin raffleTermsVersion ⇒ 400 {raffleTermsVersion}', async () =>
    expect(await leadField({ ...baseLead, type: 'visitor', raffleOptIn: true })).toBe('raffleTermsVersion'));
  it('visitor raffleTermsVersion con raffleOptIn ausente ⇒ 400 {raffleTermsVersion}', async () =>
    expect(await leadField({ ...baseLead, type: 'visitor', raffleTermsVersion: 'v1' })).toBe('raffleTermsVersion'));
  it('visitor raffleOptIn=true + raffleTermsVersion ⇒ OK', async () =>
    expect(await leadField({ ...baseLead, type: 'visitor', raffleOptIn: true, raffleTermsVersion: 'v1' })).toBe('OK'));
  it('visitor con sellsWhat ⇒ 400 {sellsWhat}', async () =>
    expect(await leadField({ ...baseLead, type: 'visitor', sellsWhat: 'cartas' })).toBe('sellsWhat'));
  it('merchant con sellsWhat ⇒ OK', async () =>
    expect(await leadField({ ...baseLead, type: 'merchant', phone: '5512345678', sellsWhat: 'cartas' })).toBe('OK'));
  it('visitor con gameInterest=pokemon ⇒ OK', async () =>
    expect(await leadField({ ...baseLead, type: 'visitor', gameInterest: 'pokemon' })).toBe('OK'));
});

describe('CARDSHOW M-84 · validación por juego del torneo (§CARDSHOW.12)', () => {
  it('pokemon sin playerId ⇒ 400 {playerId}', async () => expect(await playerField({ ...basePlayer, game: 'pokemon' })).toBe('playerId'));
  it('riftbound con playerId ⇒ 400 {playerId}', async () =>
    expect(await playerField({ ...basePlayer, game: 'riftbound', playerId: '1234567' })).toBe('playerId'));
  it('riftbound sin playerId ⇒ OK (LIGERA)', async () => expect(await playerField({ ...basePlayer, game: 'riftbound' })).toBe('OK'));
  it('pokemon con playerId ⇒ OK (FORMAL)', async () => expect(await playerField({ ...basePlayer, game: 'pokemon', playerId: '1234567' })).toBe('OK'));
});

describe('CARDSHOW M-84 · confirmación FORMAL vs LIGERA (§CARDSHOW.12)', () => {
  // ⭐M-88: `confirmSignup` deriva la CLAVE DE GRUPO desde la fila del token y confirma TODAS sus `pending`
  // (`findMany` ordenado por `createdAt`) en la misma tx. Para un alta de UN solo día el grupo es de UNA
  // fila (`groupRows ?? [row]`), y el resultado conserva el shape `{ outcome, state }` de hoy (sin `days`).
  function confirmService(
    row: Record<string, unknown>,
    deps: { confirmedCount?: number; activeOther?: unknown; cap?: string; groupRows?: Record<string, unknown>[] } = {},
  ) {
    const update = jest.fn().mockResolvedValue({});
    const tx = {
      cardShowPlayerSignup: {
        findUnique: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue(deps.groupRows ?? [row]),
        findFirst: jest.fn().mockResolvedValue(deps.activeOther ?? null),
        count: jest.fn().mockResolvedValue(deps.confirmedCount ?? 0),
        update,
      },
    };
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    const config = { get: jest.fn((k: string) => (k === ENV.TOURNAMENT_CAP_PER_DAY ? (deps.cap ?? '') : undefined)) };
    const svcC = makeService({ prisma, config, tokens: { verifyLinkToken: jest.fn().mockReturnValue({ status: 'ok', kind: 'signup', id: 'R1' }) } });
    return { svcC, update, tx };
  }

  it('LIGERA (riftbound) ⇒ confirma DIRECTO a confirmed (nunca waitlist)', async () => {
    const { svcC, update, tx } = confirmService({ id: 'R1', game: 'riftbound', day: 'sat', playerId: null, confirmedAt: null }, { cap: '2', confirmedCount: 5 });
    const res = await svcC.confirm('tok');
    expect(res).toEqual({ outcome: 'ok', state: 'confirmed' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'confirmed' }) }));
    // ⛔ LIGERA no mira cupo: no cuenta confirmados ese día.
    expect(tx.cardShowPlayerSignup.count).not.toHaveBeenCalled();
  });

  it('FORMAL (pokemon) con cupo lleno ⇒ waitlist', async () => {
    const { svcC, update } = confirmService({ id: 'R1', game: 'pokemon', day: 'sat', playerId: '1', confirmedAt: null }, { cap: '2', confirmedCount: 2 });
    const res = await svcC.confirm('tok');
    expect(res).toEqual({ outcome: 'ok', state: 'waitlist' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'waitlist' }) }));
  });

  it('FORMAL (pokemon) con cupo libre ⇒ confirmed', async () => {
    const { svcC } = confirmService({ id: 'R1', game: 'pokemon', day: 'sat', playerId: '1', confirmedAt: null }, { cap: '2', confirmedCount: 1 });
    expect(await svcC.confirm('tok')).toEqual({ outcome: 'ok', state: 'confirmed' });
  });

  // ⭐M-88 (BLOQ-A / D-CS-7): confirmar el token de UNA fila del grupo «los dos días» confirma AMBAS
  // (`sat`+`sun`) en la misma tx, y la respuesta incluye el desglose por día `days[]` (aditivo).
  it('M-88 GRUPO FORMAL pokemon «los dos días» + cupo libre ⇒ 2 filas confirmed + days[sat,sun]', async () => {
    const satRow = { id: 'R1', game: 'pokemon', day: 'sat', playerId: '7', mailboxHmac: 'mbox1', confirmedAt: null };
    const sunRow = { id: 'R2', game: 'pokemon', day: 'sun', playerId: '7', mailboxHmac: 'mbox1', confirmedAt: null };
    // El token llega por la fila `sat` (`findUnique` ⇒ R1); el grupo (`findMany`) trae ambas en orden createdAt.
    const { svcC, update, tx } = confirmService(satRow, { cap: '', confirmedCount: 0, groupRows: [satRow, sunRow] });
    const res = await svcC.confirm('tok');
    expect(res).toEqual({
      outcome: 'ok',
      state: 'confirmed', // estado de la fila del token (sat)
      days: [
        { day: 'sat', state: 'confirmed' },
        { day: 'sun', state: 'confirmed' },
      ],
    });
    // Ambas filas se actualizaron a confirmed (⛔ ninguna queda pending colgada).
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'R1' }, data: expect.objectContaining({ status: 'confirmed' }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'R2' }, data: expect.objectContaining({ status: 'confirmed' }) }));
    // La clave de grupo FORMAL ata (mailboxHmac, pokemon, playerId) en la consulta del grupo.
    expect(tx.cardShowPlayerSignup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ mailboxHmac: 'mbox1', game: 'pokemon', playerId: '7', status: 'pending' }) }),
    );
  });

  // ⭐M-88 LIGERA «los dos días»: ambas filas ⇒ confirmed directo (sin cupo/waitlist), con days[].
  it('M-88 GRUPO LIGERA (shardbugs) «los dos días» ⇒ 2 filas confirmed + days[sat,sun]', async () => {
    const satRow = { id: 'R1', game: 'shardbugs', day: 'sat', playerId: null, mailboxHmac: 'mbox2', confirmedAt: null };
    const sunRow = { id: 'R2', game: 'shardbugs', day: 'sun', playerId: null, mailboxHmac: 'mbox2', confirmedAt: null };
    const { svcC, update, tx } = confirmService(satRow, { cap: '2', confirmedCount: 9, groupRows: [satRow, sunRow] });
    const res = await svcC.confirm('tok');
    expect(res).toEqual({
      outcome: 'ok',
      state: 'confirmed',
      days: [
        { day: 'sat', state: 'confirmed' },
        { day: 'sun', state: 'confirmed' },
      ],
    });
    expect(update).toHaveBeenCalledTimes(2);
    // ⛔ LIGERA no mira cupo aunque esté «lleno»: no cuenta confirmados.
    expect(tx.cardShowPlayerSignup.count).not.toHaveBeenCalled();
    // Clave de grupo LIGERA: (mailboxHmac, game) con playerId NULL.
    expect(tx.cardShowPlayerSignup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ mailboxHmac: 'mbox2', game: 'shardbugs', playerId: null, status: 'pending' }) }),
    );
  });
});

describe('CARDSHOW M-84 · correo-resumen: conteos agregados + 0 PII (§CARDSHOW.15)', () => {
  const now = Date.parse('2026-10-17T18:00:00Z'); // CDMX ~12:00 ⇒ medianoche CDMX = 2026-10-17T06:00Z
  const leads = [
    { type: 'visitor', gameInterest: 'pokemon', raffleOptIn: true, confirmedAt: new Date(now - 3600_000) }, // hoy
    { type: 'merchant', gameInterest: null, raffleOptIn: false, confirmedAt: new Date(now - 3 * DAY) }, // 7d
    { type: 'visitor', gameInterest: 'lorcana', raffleOptIn: false, confirmedAt: new Date(now - 10 * DAY) }, // total
  ];
  const players = [
    { game: 'pokemon', day: 'sat', confirmedAt: new Date(now - 3600_000) }, // hoy
    { game: 'riftbound', day: 'sun', confirmedAt: new Date(now - 10 * DAY) }, // total
  ];
  const prisma = {
    cardShowLead: { findMany: jest.fn().mockResolvedValue(leads) },
    cardShowPlayerSignup: { findMany: jest.fn().mockResolvedValue(players) },
  };

  it('conteos por ventana hoy/7d/total', async () => {
    const data = await makeService({ prisma }).buildLeadsSummaryData(now);
    expect(data.total.leadsTotal).toBe(3);
    expect(data.last7d.leadsTotal).toBe(2);
    expect(data.today.leadsTotal).toBe(1);
    expect(data.today.raffleOptIns).toBe(1);
    expect(data.total.gameInterest).toEqual({ pokemon: 1, lorcana: 1 });
    expect(data.total.playersByGame).toEqual({ pokemon: 1, riftbound: 1 });
    expect(data.today.playersTotal).toBe(1);
    expect(data.leadsCsvUrl).toContain('/admin/card-show/leads/export.csv');
    expect(data.playersCsvUrl).toContain('/admin/card-show/players/export.csv');
  });

  it('solo CONFIRMADOS (findMany filtra confirmedAt not null, ⛔ PENDING fuera)', async () => {
    await makeService({ prisma }).buildLeadsSummaryData(now);
    expect(prisma.cardShowLead.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { confirmedAt: { not: null } } }));
    expect(prisma.cardShowPlayerSignup.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { confirmedAt: { not: null } } }));
  });

  it('el cuerpo del resumen ⛔ NO lleva PII: 0 correos, solo cifras + enlaces', async () => {
    const data = await makeService({ prisma }).buildLeadsSummaryData(now);
    const { text } = renderLeadsSummary(data);
    expect(text).not.toContain('@'); // ningún correo en el cuerpo
    expect(text).toContain('Leads confirmados');
    expect(text).toContain('/admin/card-show/leads/export.csv');
    expect(text).toContain('/admin/card-show/players/export.csv');
  });
});
