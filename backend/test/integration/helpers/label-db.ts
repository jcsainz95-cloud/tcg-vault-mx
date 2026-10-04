/**
 * label-db.ts — ⭐💰 el arnés de la guía de Skydropx (D2b/D2c) contra Postgres REAL. Propiedad: backend.
 *
 * - La app Nest real con el proveedor sustituido por el DOBLE (`FakeShippingProvider`, ⛔ nunca la red: PS-99) en la
 *   selección `SHIPPING_PROVIDER_SELECTION` (el único punto de inyección de `shipments`), y el reloj de la guía
 *   (`SHIPMENTS_LABEL_CLOCK`) por uno manual (PS-71 «reloj a +24 h», PS-108, PS-137…).
 * - `ready()` deja un envío cotizable: dirección COMPLETA (CP 01000 del catálogo del arnés), líneas `picked`, `preparedAt`.
 * - `dial()` escribe diales y `restoreDials()` los devuelve a su estado previo (fila borrada si no existía).
 */
import { Prisma } from '@prisma/client';
import { E2EHarness } from './e2e-app';
import { ShipPrepDb, R } from './ship-prep-db';
import { FakeShippingProvider } from '../../../src/modules/shipping-provider/fake-shipping-provider';
import { SHIPPING_PROVIDER_SELECTION } from '../../../src/modules/shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../../../src/modules/shipping-provider/shipping-provider.factory';
import { ManualLabelClock, SHIPMENTS_LABEL_CLOCK } from '../../../src/modules/shipments/label-clock';

/** Dirección completa del arnés (CP 01000 · San Ángel, `E2E_POSTAL_CODES`). */
export const READY_ADDRESS = {
  recipientName: 'Ana Gómez Ruiz',
  line1: 'Av. Revolución 1500',
  line2: 'Int. 4',
  neighborhood: 'San Ángel',
  city: 'Álvaro Obregón',
  state: 'Ciudad de México',
  postalCode: '01000',
  country: 'MX',
  phone: '5512345678',
  references: 'Portón negro',
};

export interface LabelWorld {
  h: E2EHarness;
  db: ShipPrepDb;
  fake: FakeShippingProvider;
  clock: ManualLabelClock;
}

export async function createLabelWorld(run: string, selection: Partial<ShippingProviderSelection> = {}): Promise<LabelWorld> {
  const fake = new FakeShippingProvider();
  fake.reuseQuotations = false;
  fake.defaultLabelUrl = 'https://pro.skydropx.com/labels/x.pdf';
  const clock = new ManualLabelClock(new Date());
  const sel: ShippingProviderSelection = { port: fake, kind: 'fake', urlHosts: ['pro.skydropx.com'], client: null, ...selection };
  const h = await E2EHarness.create((b) =>
    b.overrideProvider(SHIPPING_PROVIDER_SELECTION).useValue(sel).overrideProvider(SHIPMENTS_LABEL_CLOCK).useValue(clock),
  );
  const db = new ShipPrepDb(h, run);
  await db.init();
  return { h, db, fake, clock };
}

const touchedDials = new Map<string, Prisma.JsonValue | undefined>();

/** Escribe un dial (y recuerda el valor previo para `restoreDials`). */
export async function dial(h: E2EHarness, key: string, value: unknown): Promise<void> {
  if (!touchedDials.has(key)) {
    const prev = await h.prisma.configSetting.findUnique({ where: { key } });
    touchedDials.set(key, prev ? prev.valueJson : undefined);
  }
  await h.prisma.configSetting.upsert({
    where: { key },
    update: { valueJson: value as Prisma.InputJsonValue, updatedBy: 'e2e' },
    create: { key, valueJson: value as Prisma.InputJsonValue, updatedBy: 'e2e' },
  });
}

export async function restoreDials(h: E2EHarness): Promise<void> {
  for (const [key, prev] of touchedDials) {
    if (prev === undefined) await h.prisma.configSetting.deleteMany({ where: { key } });
    else await h.prisma.configSetting.update({ where: { key }, data: { valueJson: prev as Prisma.InputJsonValue } });
  }
  touchedDials.clear();
}

/** Encendido mínimo para cotizar: proveedor `skydropx` y plantilla de origen. */
export async function providerOn(h: E2EHarness): Promise<void> {
  await dial(h, 'shipping_provider', 'skydropx');
  await dial(h, 'skydropx_origin_address_template_id', 'fake-template-verapaz');
}

/** Deja el envío cotizable: dirección completa, todas las líneas `picked` y `preparedAt` (sin pasar por el verbo). */
export async function ready(db: ShipPrepDb, shipmentId: string, address: Record<string, unknown> = READY_ADDRESS): Promise<void> {
  const p = db.h.prisma;
  await p.shipmentItem.updateMany({
    where: { shipmentRequestId: shipmentId },
    data: { prepStatus: 'picked', prepMarkedAt: new Date(), prepMarkedByUserId: db.operatorId },
  });
  await p.shipmentRequest.update({
    where: { id: shipmentId },
    data: { addressSnapshot: address as Prisma.InputJsonValue, preparedAt: new Date(), preparedByUserId: db.operatorId },
  });
}

export const errCode = (r: R) => (r.status >= 200 && r.status < 300 ? `${r.status}` : `${r.status}:${r.body?.error?.code}`);
