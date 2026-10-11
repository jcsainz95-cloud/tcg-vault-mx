/**
 * spend-db.ts — 💰 el arnés de D2g (la base de avisos al dueño) contra Postgres REAL. Propiedad: backend (helper PROPIO de D2g,
 * §19.32.9: ⛔ no toca los helpers compartidos).
 *
 * - La app Nest real con: el reloj del módulo `spend-alerts` por uno MANUAL (`SPEND_ALERTS_CLOCK`), el puerto de correo por uno
 *   que CAPTURA (y puede fallar a demanda), y el proveedor de guías por el DOBLE (⛔ nunca la red: PS-99).
 * - Personas propias de la corrida (⛔ no las del seed): la DUEÑA (súper-admin con correo y MARCA), V (súper-admin SIN correo,
 *   vigilado), W (súper-admin CON correo y SIN marca: también vigilado, C-20), un operador y un cliente. La marca se pone por SQL
 *   (como PS-160: ⛔ ningún código de `src/` la escribe) y `close()` devuelve la marca a quien la tenía antes.
 * - `neutralizeOtherAlerts()`: los avisos que otras suites dejaron `pending|failed|sending|batched` pasan a `not_applicable`
 *   para que el despacho de esta suite no los cuente en el cupo de la hora (el estado de la base es compartido).
 */
import { randomBytes } from 'crypto';
import { Role } from '@prisma/client';
import { E2EHarness } from './e2e-app';
import { AuthService } from '../../../src/modules/auth/auth.service';
import { MAIL_PORT, MailMessage, MailPort } from '../../../src/modules/mail/mail.port';
import { SPEND_ALERTS_CLOCK, SpendClock } from '../../../src/modules/spend-alerts/spend-alerts.constants';
import { FakeShippingProvider } from '../../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../../src/modules/shipping-provider/shipping-provider.factory';

export class ManualSpendClock implements SpendClock {
  private t: number;
  constructor(start: Date) {
    this.t = start.getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(d: Date): void {
    this.t = d.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** El puerto de correo que captura. `failNext` = cuántos envíos siguientes lanzan. */
export class CaptureMail implements MailPort {
  sent: MailMessage[] = [];
  failNext = 0;
  delayMs = 0;
  async send(msg: MailMessage): Promise<{ id?: string }> {
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('fallo del puerto de correo (prueba)');
    }
    this.sent.push(msg);
    return { id: `m-${this.sent.length}` };
  }
  reset(): void {
    this.sent = [];
    this.failNext = 0;
    this.delayMs = 0;
  }
}

export interface Person {
  id: string;
  name: string;
  email: string | null;
  token: string;
}

export interface SpendWorld {
  h: E2EHarness;
  clock: ManualSpendClock;
  mail: CaptureMail;
  fake: FakeShippingProvider;
  run: string;
  /** El instante en que arrancó el reloj de esta corrida. */
  start: Date;
  owner: Person;
  v: Person;
  w: Person;
  op: Person;
  customer: Person;
  previousOwnerId: string | null;
  close(): Promise<void>;
}

/** Una hora fija y lejana (no se cruza con lo que otras suites dejaron con `mailedAt` real). */
export const BASE_NOW = new Date('2031-03-10T16:05:00.000Z'); // 10:05 en CDMX

export async function createSpendWorld(): Promise<SpendWorld> {
  const run = randomBytes(4).toString('hex');
  // El reloj arranca en una hora PROPIA de la corrida (BASE + 0…~114 años, en horas enteras): el cupo de correos es por HORA
  // de reloj y la base es persistente — los `sent` de una corrida anterior no pueden caer en las horas de ésta.
  const start = new Date(BASE_NOW.getTime() + (randomBytes(4).readUInt32BE(0) % 1_000_000) * 3600_000);
  const clock = new ManualSpendClock(start);
  const mail = new CaptureMail();
  const fake = new FakeShippingProvider();
  const sel: ShippingProviderSelection = { port: fake, kind: 'fake', urlHosts: ['pro.skydropx.com'], client: null };
  const h = await E2EHarness.create((b) =>
    b.overrideProvider(SPEND_ALERTS_CLOCK).useValue(clock).overrideProvider(MAIL_PORT).useValue(mail).overrideProvider(SHIPPING_PROVIDER_SELECTION).useValue(sel),
  );
  const auth = h.app.get(AuthService);
  const mk = async (role: Role, name: string, email: string | null, username: string | null): Promise<Person> => {
    const u = await h.prisma.user.create({
      data: { role, name, email, username, emailVerified: email !== null, phone: '5512340000', locale: 'es' },
    });
    const { accessToken } = await auth.issueTokens(u);
    return { id: u.id, name: u.name, email: u.email, token: accessToken };
  };
  const owner = await mk(Role.super_admin, `Dueña D2G ${run}`, `d2g-owner-${run}@e2e.local`, null);
  const v = await mk(Role.super_admin, `Vigilado ${run}`, null, `d2g-v-${run}`);
  const w = await mk(Role.super_admin, `Heredado ${run}`, `d2g-w-${run}@e2e.local`, null);
  const op = await mk(Role.vault_operator, `Operador ${run}`, null, `d2g-op-${run}`);
  const customer = await mk(Role.customer, `Cliente Canario ${run}`, `d2g-c-${run}@e2e.local`, null);
  const prev = await h.prisma.user.findFirst({ where: { isOwner: true }, select: { id: true } });
  await markOwner(h, owner.id);
  return {
    h,
    clock,
    mail,
    fake,
    run,
    start,
    owner,
    v,
    w,
    op,
    customer,
    previousOwnerId: prev?.id ?? null,
    async close() {
      await h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = false WHERE "isOwner"`);
      if (prev) await h.prisma.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, prev.id);
      await h.close();
    },
  };
}

/** Pone la marca de dueño en `id` (o la quita a todos con `null`), en una tx, como `set-owner.ts`. */
export async function markOwner(h: E2EHarness, id: string | null): Promise<void> {
  await h.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = false WHERE "isOwner"`);
    if (id) await tx.$executeRawUnsafe(`UPDATE "User" SET "isOwner" = true WHERE id = $1`, id);
  });
}

/** Avisos ajenos sin despachar ⇒ `not_applicable` (ver cabecera). */
export async function neutralizeOtherAlerts(h: E2EHarness): Promise<void> {
  await h.prisma.$executeRawUnsafe(
    `UPDATE "SpendAlert" SET "mailStatus" = 'not_applicable' WHERE "mailStatus" IN ('pending','failed','sending','batched')`,
  );
}

/** Un envío de Skydropx con guía comprada, dirección CANARIA y su guía pagada (`ShipmentPaidLabel`). */
export async function mkSkydropxShipment(
  w: SpendWorld,
  over: { labelPurchasedAt?: Date; status?: 'guia' | 'enviado'; carrierStatus?: 'created' | 'in_transit' | null; chargedCents?: number } = {},
): Promise<{ shipmentId: string; folio: string; paidLabelId: string; providerShipmentId: string }> {
  const providerShipmentId = `sdx-d2g-${w.run}-${randomBytes(3).toString('hex')}`;
  const at = over.labelPurchasedAt ?? w.clock.now();
  const s = await w.h.prisma.shipmentRequest.create({
    data: {
      userId: w.customer.id,
      addressSnapshot: CANARY_ADDRESS,
      status: over.status ?? 'guia',
      shippingFeeCents: 0,
      priceConvention: 'IVA_EXCLUSIVE',
      carrier: 'DHL',
      labelSource: 'skydropx',
      providerShipmentId,
      providerRateId: 'rate-d2g',
      chosenRateJson: { priceCents: over.chargedCents ?? 15000 },
      rateChosenByUserId: w.op.id,
      rateChosenAt: at,
      labelPurchasedAt: at,
      packageCode: '4G',
      declaredValueCents: 0,
      insuredValueCents: 0,
      ...(over.carrierStatus ? { carrierStatus: over.carrierStatus, carrierStatusAt: at } : {}),
    },
    select: { id: true, folio: true },
  });
  const p = await w.h.prisma.shipmentPaidLabel.create({
    data: { providerShipmentId, shipmentRequestId: s.id, origin: 'response', chargedCents: over.chargedCents ?? 15000 },
    select: { id: true },
  });
  return { shipmentId: s.id, folio: s.folio, paidLabelId: p.id, providerShipmentId };
}

/** Datos del CLIENTE que ⛔ nunca pueden salir en un correo al dueño (PS-153, GAS-2). */
export const CANARY = {
  name: 'Canaria Ximena Quintanilla',
  line1: 'Calle Canario 777',
  postalCode: '09876',
  phone: '5599887766',
  clabe: '012180001234567897',
  email: 'canario.cliente@ejemplo.mx',
};
export const CANARY_ADDRESS = {
  recipientName: CANARY.name,
  line1: CANARY.line1,
  line2: 'Int. 9',
  neighborhood: 'Colonia Canaria',
  city: 'Canarias',
  state: 'Ciudad de México',
  postalCode: CANARY.postalCode,
  country: 'MX',
  phone: CANARY.phone,
  references: `CLABE ${CANARY.clabe} ${CANARY.email}`,
};
