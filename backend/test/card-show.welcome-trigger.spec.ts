import { CardShowService } from '../src/modules/card-show/card-show.service';
import { CardShowLeadType } from '@prisma/client';

/**
 * §CARDSHOW.6/.9 — la BIENVENIDA C3-W se dispara EXACTAMENTE 1 vez al confirmar un lead (PENDING→`new`),
 * de la variante correcta; ⛔ nunca a PENDING; reconfirmar ⇒ 0 bienvenidas nuevas; una carrera perdida
 * (updateMany count:0) ⇒ 0 bienvenidas. Se prueba la ORQUESTACIÓN (prisma/caps/budget/webhook mockeados).
 */

type Lead = {
  id: string;
  type: CardShowLeadType;
  email: string;
  mailboxHmac: string;
  confirmedAt: Date | null;
  createdAt: Date;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

function makeService(lead: Lead, opts?: { forceRaceLost?: boolean }) {
  const welcomeCalls: { type: CardShowLeadType }[] = [];
  const internalCalls: { type: string }[] = [];

  const prisma = {
    cardShowLead: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => (id === lead.id ? { ...lead } : null),
      updateMany: async ({ where, data }: { where: { id: string; confirmedAt: null }; data: Partial<Lead> }) => {
        if (opts?.forceRaceLost) return { count: 0 }; // otra tx confirmó entre el read y el update
        if (where.id === lead.id && lead.confirmedAt === null) {
          Object.assign(lead, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };
  const tokens = { issueLinkToken: () => 'tok' };
  const budget = { tryReserve: async () => ({ allowed: true, failClosed: false, hour: 1, day: 1, crossed50: false, cut: false }) };
  const caps = {
    reserveDomainSend: async () => true,
    reserveConfirmedSend: async () => true,
    reserveInternalNotice: async () => true,
  };
  const mail = {
    sendWelcome: async (p: { type: CardShowLeadType }) => {
      welcomeCalls.push({ type: p.type });
      return true;
    },
    sendInternalNotice: async (p: { type: string }) => {
      internalCalls.push({ type: p.type });
      return true;
    },
  };
  const webhook = { isCut: async () => false };
  const audit = { log: async () => undefined };
  const config = { get: () => undefined };

  const svc = new CardShowService(
    prisma as never,
    {} as never,
    tokens as never,
    budget as never,
    caps as never,
    mail as never,
    webhook as never,
    audit as never,
    config as never,
  );
  return { svc, welcomeCalls, internalCalls };
}

const baseLead = (over: Partial<Lead> = {}): Lead => ({
  id: 'L1',
  type: 'merchant',
  email: 'm@dominio.mx',
  mailboxHmac: 'hmac',
  confirmedAt: null,
  createdAt: new Date('2026-10-16T18:00:00Z'),
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  ...over,
});

describe('CARDSHOW · disparo de la bienvenida C3-W (PENDING→new)', () => {
  it('confirmar un lead merchant ⇒ exactamente 1 bienvenida merchant + 1 aviso interno', async () => {
    const { svc, welcomeCalls, internalCalls } = makeService(baseLead({ type: 'merchant' }));
    const r = await (svc as any).confirmLead('L1', Date.now());
    expect(r).toEqual({ outcome: 'ok', state: 'new' });
    expect(welcomeCalls).toEqual([{ type: 'merchant' }]);
    expect(internalCalls).toEqual([{ type: 'merchant' }]);
  });

  it('visitor ⇒ 1 bienvenida visitor y 0 avisos internos (el aviso es solo merchant/sponsor)', async () => {
    const { svc, welcomeCalls, internalCalls } = makeService(baseLead({ type: 'visitor' }));
    await (svc as any).confirmLead('L1', Date.now());
    expect(welcomeCalls).toEqual([{ type: 'visitor' }]);
    expect(internalCalls).toEqual([]);
  });

  it('sponsor ⇒ 1 bienvenida sponsor + 1 aviso interno', async () => {
    const { svc, welcomeCalls, internalCalls } = makeService(baseLead({ type: 'sponsor' }));
    await (svc as any).confirmLead('L1', Date.now());
    expect(welcomeCalls).toEqual([{ type: 'sponsor' }]);
    expect(internalCalls).toEqual([{ type: 'sponsor' }]);
  });

  it('reconfirmar (2.º POST del mismo token) ⇒ 410 y 0 bienvenidas nuevas', async () => {
    const lead = baseLead();
    const { svc, welcomeCalls } = makeService(lead);
    await (svc as any).confirmLead('L1', Date.now()); // 1.ª ⇒ pasa a new, 1 bienvenida
    expect(welcomeCalls).toHaveLength(1);
    // 2.º POST: la fila ya tiene confirmedAt ⇒ 410 antes de tocar updateMany, 0 bienvenidas nuevas.
    await expect((svc as any).confirmLead('L1', Date.now())).rejects.toMatchObject({ code: 'LINK_ALREADY_USED' });
    expect(welcomeCalls).toHaveLength(1);
  });

  it('carrera perdida (updateMany count:0) ⇒ 410 y 0 bienvenidas (el gatillo es la transición atómica)', async () => {
    const { svc, welcomeCalls, internalCalls } = makeService(baseLead(), { forceRaceLost: true });
    await expect((svc as any).confirmLead('L1', Date.now())).rejects.toMatchObject({ code: 'LINK_ALREADY_USED' });
    expect(welcomeCalls).toHaveLength(0);
    expect(internalCalls).toHaveLength(0);
  });

  it('⛔ a PENDING: sin confirmar, createLead/confirm no disparan bienvenida (0 sendWelcome)', async () => {
    // confirmLead NO se llama ⇒ la bienvenida vive SOLO tras la transición a new.
    const { welcomeCalls } = makeService(baseLead());
    expect(welcomeCalls).toHaveLength(0);
  });
});
