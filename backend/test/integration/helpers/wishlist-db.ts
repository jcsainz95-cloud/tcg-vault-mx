/**
 * wishlist-db.ts — el arnés de §WSH (lista de deseos) contra Postgres REAL. Propiedad: backend (helper PROPIO de §WSH; ⛔ no
 * toca los helpers compartidos).
 *
 * - La app Nest real con: el reloj de la lista de deseos (`'WISHLIST_CLOCK'`, token por NOMBRE para que este fichero no
 *   dependa de `src/modules/wishlist` y las pruebas compilen —y fallen por conducta— antes de que el módulo exista), y el
 *   puerto de correo por uno que CAPTURA (el de `spend-db.ts`, reusado por import).
 * - Mundo PROPIO de la corrida (⛔ nada del seed salvo el súper-admin y el operador para los diales): un set, cartas con
 *   `availableFinishes` [normal, reverse_holo], referencias de mercado `raw:NM` por acabado y cuentas cliente con correo
 *   verificado. El `run` aleatorio aísla las filas de corridas anteriores (la BD es persistente).
 * - Diales: `setDial(key, value)` escribe la fila de `ConfigSetting` (como el seed); `resetDials()` deja los de §WSH en su
 *   valor de prueba (lista ENCENDIDA, el resto en su seed) y los de IVA en el neutro (100/16).
 */
import { randomBytes } from 'crypto';
import { Finish, Prisma, Role } from '@prisma/client';
import { E2EHarness } from './e2e-app';
import { CaptureMail, ManualSpendClock } from './spend-db';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { MAIL_PORT } from '../../../src/modules/mail/mail.port';
import { E2E_USERS } from '../../../prisma/e2e-fixtures';

export { CaptureMail, ManualSpendClock };

/** Una hora fija y lejana (mediodía en CDMX) para que el «día de México» del tope diario sea determinista. */
export const WSH_BASE_NOW = new Date('2032-05-12T18:00:00.000Z'); // 12:00 en CDMX

export interface WshPerson {
  id: string;
  email: string;
  token: string;
}

export interface WshCard {
  id: string;
  name: string;
  number: string;
}

export interface WshWorld {
  h: E2EHarness;
  clock: ManualSpendClock;
  mail: CaptureMail;
  run: string;
  setId: string;
  setName: string;
  adminToken: string;
  operatorToken: string;
  /** Cuenta cliente nueva (correo verificado por defecto). */
  customer(opts?: { verified?: boolean; locale?: 'es' | 'en'; role?: Role }): Promise<WshPerson>;
  /** Carta nueva del set de la corrida (`Common`, acabados normal + reverse_holo salvo que se pidan otros). */
  card(opts?: { finishes?: Finish[]; imageSmallUrl?: string | null; rarity?: string }): Promise<WshCard>;
  /** Referencia de mercado vigente `raw:NM` del acabado (fecha = hoy UTC del reloj de pared; sobrescribe). */
  market(cardId: string, finish: Finish, cents: number, capturedDate?: Date): Promise<void>;
  /** Pieza de PLATAFORMA. Por defecto `raw` NM `listed` con precio manual `L` = `listCents` (P = L × 1.16 con diales neutros). */
  piece(cardId: string, opts?: Partial<Prisma.InventoryItemUncheckedCreateInput> & { listCents?: number | null }): Promise<string>;
  setDial(key: string, value: unknown): Promise<void>;
  resetDials(): Promise<void>;
  /** Corre el job por el disparo manual (súper-admin) y devuelve el cuerpo. */
  runNotify(): Promise<{ status: number; body: any }>;
  /** Correos capturados para un destinatario. */
  mailsTo(email: string): { subject: string; text: string; html: string }[];
  close(): Promise<void>;
}

/** Diales de §WSH en su valor de prueba: la lista ENCENDIDA (seed `off`), lo demás = seed. */
export const WSH_TEST_DIALS: Record<string, unknown> = {
  wishlist_enabled: 'on',
  wishlist_max_per_account: 20,
  wishlist_max_iva_mode: 'with_iva',
  wishlist_daily_mail_cap: 3,
  wishlist_mail_window_min: 30,
  wishlist_target_margin_pct: 15,
  wishlist_margin_basis: 'cost',
  sealed_restock_max_pending_per_email: 5,
  iva_pct: 16,
  iva_transfer_pct: 100,
};

let folioSeq = 0;

export async function createWshWorld(): Promise<WshWorld> {
  const run = randomBytes(4).toString('hex');
  const clock = new ManualSpendClock(WSH_BASE_NOW);
  const mail = new CaptureMail();
  const h = await E2EHarness.create((b) =>
    b.overrideProvider('WISHLIST_CLOCK').useValue(clock).overrideProvider(MAIL_PORT).useValue(mail),
  );
  const auth = h.app.get(AuthService);
  const adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  const operatorToken = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);

  const set = await h.prisma.cardSet.create({
    data: { externalId: `wsh-${run}`, name: `Set Deseos ${run}`, ptcgoCode: `W${run.slice(0, 3).toUpperCase()}` },
  });
  let cardSeq = 0;
  let personSeq = 0;

  const setDial = async (key: string, value: unknown) => {
    await h.prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson: value as Prisma.InputJsonValue, updatedBy: `e2e:wsh:${run}` },
      update: { valueJson: value as Prisma.InputJsonValue, updatedBy: `e2e:wsh:${run}` },
    });
  };

  const world: WshWorld = {
    h,
    clock,
    mail,
    run,
    setId: set.id,
    setName: set.name,
    adminToken,
    operatorToken,
    async customer(opts = {}) {
      personSeq += 1;
      const email = `wsh-${run}-${personSeq}@e2e.local`;
      const u = await h.prisma.user.create({
        data: {
          role: opts.role ?? Role.customer,
          name: `Cliente Deseos ${run} ${personSeq}`,
          email,
          emailVerified: opts.verified ?? true,
          phone: '5512340000',
          locale: opts.locale ?? 'es',
        },
      });
      const { accessToken } = await auth.issueTokens(u);
      return { id: u.id, email, token: accessToken };
    },
    async card(opts = {}) {
      cardSeq += 1;
      const number = String(cardSeq).padStart(3, '0');
      const c = await h.prisma.card.create({
        data: {
          externalId: `wsh-${run}-${number}`,
          setId: set.id,
          name: `Carta Deseada ${run} ${number}`,
          number,
          rarity: opts.rarity ?? 'Common',
          rarityCanonical: opts.rarity ?? 'Common',
          imageSmallUrl: opts.imageSmallUrl === undefined ? `https://images.pokemontcg.io/wsh/${number}.png` : opts.imageSmallUrl,
          availableFinishes: opts.finishes ?? ['normal', 'reverse_holo'],
        },
      });
      return { id: c.id, name: c.name, number };
    },
    async market(cardId, finish, cents, capturedDate) {
      const d = capturedDate ?? new Date(new Date().toISOString().slice(0, 10));
      await h.prisma.priceReference.deleteMany({ where: { cardId, finish, productType: 'raw', gradeKey: 'raw:NM' } });
      await h.prisma.priceReference.create({
        data: {
          cardId,
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish,
          source: 'manual',
          isManualOverride: true,
          priceMxnCents: cents,
          capturedDate: d,
        },
      });
    },
    async piece(cardId, opts = {}) {
      folioSeq += 1;
      const { listCents, ...rest } = opts;
      const it = await h.prisma.inventoryItem.create({
        data: {
          folio: `WSH-${run}-${folioSeq}`,
          cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          ownerType: 'platform',
          status: 'listed',
          acquisitionType: 'compra',
          acquisitionCostCents: 1000,
          listPriceCents: listCents === undefined ? 100000 : listCents,
          ...rest,
        } as Prisma.InventoryItemUncheckedCreateInput,
      });
      return it.id;
    },
    setDial,
    async resetDials() {
      for (const [k, v] of Object.entries(WSH_TEST_DIALS)) await setDial(k, v);
    },
    async runNotify() {
      const r = await h.api('POST', '/admin/jobs/wishlist-notify', { token: adminToken, json: {} });
      return { status: r.status, body: r.body };
    },
    mailsTo(email: string) {
      return mail.sent.filter((m) => m.to === email).map((m) => ({ subject: m.subject, text: m.text ?? '', html: m.html ?? '' }));
    },
    async close() {
      await setDial('wishlist_enabled', 'off');
      await h.close();
    },
  };
  // Estado propio: la lista de deseos es de esta suite (ninguna otra escribe estas tablas) ⇒ se parte de cero.
  await h.prisma.wishlistNotice.deleteMany({});
  await h.prisma.wishlistMail.deleteMany({});
  await h.prisma.wishlistItem.deleteMany({});
  await world.resetDials();
  return world;
}
