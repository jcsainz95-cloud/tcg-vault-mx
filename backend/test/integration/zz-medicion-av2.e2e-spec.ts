import { SellRequestStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { MAIL_PORT, MailMessage, MailPort } from '../../src/modules/mail/mail.port';

/**
 * ⚠️ FICHERO TEMPORAL DE MEDICIÓN — NO SE COMMITEA.
 * Mide la proporción del defecto `D-AVISO-2` desde `NULL` con N alto, imprimiendo el histograma.
 */

const RUN = Date.now().toString(36);
const N = Number(process.env.AV2_TRIALS ?? '25');
const C = Number(process.env.AV2_CONC ?? '8');

describe(`MEDICION D-AVISO-2 desde NULL (N=${N}, concurrentes=${C})`, () => {
  let h: E2EHarness;
  let adminToken: string;
  let customer2Id: string;
  let bandeja: MailMessage[];
  let spy: jest.SpyInstance;
  const envios: string[] = [];
  const solicitudes: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const u = await h.prisma.user.findUniqueOrThrow({
      where: { email: E2E_USERS.customer2.email },
      select: { id: true },
    });
    customer2Id = u.id;
    const port = h.app.get<MailPort>(MAIL_PORT);
    bandeja = [];
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (envios.length > 0) {
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: { in: envios } } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id: { in: envios } } });
    }
    if (solicitudes.length > 0) {
      await h.prisma.sellRequest.deleteMany({ where: { id: { in: solicitudes } } });
    }
    await h?.close();
  });

  it(`ENVIOS — ${N} tiradas de ${C} capturas simultáneas partiendo de sello NULL`, async () => {
    const hist: number[] = [];
    for (let i = 0; i < N; i++) {
      const id = `med-av2-${RUN}-s${i}`;
      await h.prisma.shipmentRequest.create({
        data: {
          id,
          userId: customer2Id,
          addressSnapshot: {},
          status: 'picking',
          shippingFeeCents: 20300,
          ivaCents: 2800,
          processingFeeCents: 0,
          totalCents: 20300,
          priceConvention: 'IVA_INCLUSIVE',
          pickingAt: new Date(),
        },
      });
      envios.push(id);
      bandeja.length = 0;
      const res = await Promise.all(
        Array.from({ length: C }, () =>
          h.api('POST', `/admin/shipments/${id}/tracking`, {
            token: adminToken,
            json: { carrier: 'DHL', trackingNumber: `TRK-${RUN}-S${i}` },
          }),
        ),
      );
      for (const r of res) {
        if (r.status !== 201) throw new Error(`status inesperado ${r.status}: ${r.text}`);
      }
      // Da tiempo a que cualquier envío post-commit rezagado aterrice.
      await new Promise((r) => setTimeout(r, 150));
      hist.push(bandeja.length);
    }
    const rojas = hist.filter((n) => n !== 1).length;
    // eslint-disable-next-line no-console
    console.log(`[MEDICION][ENVIOS] correos por tirada: ${hist.join(',')}`);
    // eslint-disable-next-line no-console
    console.log(`[MEDICION][ENVIOS] ROJAS ${rojas}/${N}  VERDES ${N - rojas}/${N}`);
  }, 900000);

  it(`BUYLIST — ${N} tiradas de ${C} capturas simultáneas partiendo de sello NULL`, async () => {
    const hist: number[] = [];
    for (let i = 0; i < N; i++) {
      const sr = await h.prisma.sellRequest.create({
        data: {
          userId: customer2Id,
          status: SellRequestStatus.aceptada,
          quotedTotalCents: 100000,
          ineRequired: false,
          ineProvided: false,
        },
        select: { id: true },
      });
      solicitudes.push(sr.id);
      bandeja.length = 0;
      const res = await Promise.all(
        Array.from({ length: C }, () =>
          h.api('POST', `/admin/buylist/${sr.id}/guide`, {
            token: adminToken,
            json: { carrier: 'FedEx', trackingNumber: `BL-${RUN}-B${i}` },
          }),
        ),
      );
      for (const r of res) {
        if (![200, 409].includes(r.status)) throw new Error(`status inesperado ${r.status}: ${r.text}`);
      }
      await new Promise((r) => setTimeout(r, 150));
      hist.push(bandeja.length);
    }
    const rojas = hist.filter((n) => n !== 1).length;
    // eslint-disable-next-line no-console
    console.log(`[MEDICION][BUYLIST] correos por tirada: ${hist.join(',')}`);
    // eslint-disable-next-line no-console
    console.log(`[MEDICION][BUYLIST] ROJAS ${rojas}/${N}  VERDES ${N - rojas}/${N}`);
  }, 900000);
});

/**
 * CANARIO DEL MECANISMO — discrimina «el borrado del sello es la causa» de cualquier otra teoría.
 * Misma carrera, mismo endpoint, mismo sello en NULL; la ÚNICA diferencia es que la fila YA trae el
 * par (carrier, nº) que se va a capturar ⇒ `labelChanged` es false para todas ⇒ nadie borra el sello.
 * Si el mecanismo descrito es cierto, esto tiene que salir 1 correo en TODAS las tiradas.
 */
describe(`CANARIO — mismo par ya escrito (labelChanged=false), sello NULL`, () => {
  let h: E2EHarness;
  let adminToken: string;
  let customer2Id: string;
  let bandeja: MailMessage[];
  let spy: jest.SpyInstance;
  const envios: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const u = await h.prisma.user.findUniqueOrThrow({
      where: { email: E2E_USERS.customer2.email },
      select: { id: true },
    });
    customer2Id = u.id;
    const port = h.app.get<MailPort>(MAIL_PORT);
    bandeja = [];
    spy = jest.spyOn(port, 'send').mockImplementation(async (msg: MailMessage) => {
      bandeja.push(msg);
      return {};
    });
  });

  afterAll(async () => {
    spy?.mockRestore();
    if (envios.length > 0) {
      await h.prisma.shipmentRequest.deleteMany({ where: { id: { in: envios } } });
    }
    await h?.close();
  });

  it(`${N} tiradas de ${C} simultáneas, etiqueta YA igual`, async () => {
    const hist: number[] = [];
    for (let i = 0; i < N; i++) {
      const id = `med-av2c-${RUN}-c${i}`;
      const trk = `TRK-${RUN}-C${i}`;
      await h.prisma.shipmentRequest.create({
        data: {
          id,
          userId: customer2Id,
          addressSnapshot: {},
          status: 'picking',
          shippingFeeCents: 20300,
          ivaCents: 2800,
          processingFeeCents: 0,
          totalCents: 20300,
          priceConvention: 'IVA_INCLUSIVE',
          pickingAt: new Date(),
          carrier: 'DHL',
          trackingNumber: trk,
        },
      });
      envios.push(id);
      bandeja.length = 0;
      const res = await Promise.all(
        Array.from({ length: C }, () =>
          h.api('POST', `/admin/shipments/${id}/tracking`, {
            token: adminToken,
            json: { carrier: 'DHL', trackingNumber: trk },
          }),
        ),
      );
      for (const r of res) {
        if (r.status !== 201) throw new Error(`status inesperado ${r.status}: ${r.text}`);
      }
      await new Promise((r) => setTimeout(r, 150));
      hist.push(bandeja.length);
    }
    const rojas = hist.filter((n) => n !== 1).length;
    // eslint-disable-next-line no-console
    console.log(`[MEDICION][CANARIO] correos por tirada: ${hist.join(',')}`);
    // eslint-disable-next-line no-console
    console.log(`[MEDICION][CANARIO] ROJAS ${rojas}/${N}  VERDES ${N - rojas}/${N}`);
  }, 900000);
});
