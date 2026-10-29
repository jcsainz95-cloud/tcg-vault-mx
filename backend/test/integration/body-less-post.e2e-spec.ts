/**
 * body-less-post.e2e-spec.ts — TL-DYN3-4 (`docs/TECH_DEBT.md`, veredicto del techlead sobre `d1b96eca`): el frontend dejó de
 * mandar `Content-Type` en las peticiones SIN cuerpo (`frontend/src/lib/api-client.ts`). Un `POST` así funciona hoy solo
 * porque body-parser 1.x / Express 4 dejan `req.body = {}`; con Express 5 (Nest 11) un `@Body()` recibiría `undefined`.
 *
 * Candado: un `POST` sin cuerpo y sin `Content-Type` a un endpoint con `@Body()` da el MISMO status que con la cabecera. El
 * endpoint elegido lee un campo del cuerpo SIN `?.` (`POST /admin/jobs/price-ingest`, `dto.setId`), así que si el cuerpo
 * llegara `undefined` respondería `500` — el canario de abajo lo demuestra llamando al controlador con `undefined`.
 */
import { Role } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { PriceIngestService } from '../../src/modules/pricing/price-ingest.service';
import { AdminJobsController } from '../../src/jobs/admin-jobs.controller';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';

describe('E2E — TL-DYN3-4: POST sin cuerpo y sin Content-Type', () => {
  let h: E2EHarness;
  let admin: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    // Sin red: el barrido de precios no sale al proveedor.
    jest.spyOn(h.app.get(PriceIngestService), 'ingestAll').mockResolvedValue(undefined as never);
    jest.spyOn(h.app.get(PriceIngestService), 'ingestGradedEstimates').mockResolvedValue({} as never);
  });

  afterAll(async () => {
    await h?.app.get(ListingPriceService).idle();
    jest.restoreAllMocks();
    await h?.close();
  });

  it('sin cuerpo y sin `Content-Type` ⇒ el mismo status que con `Content-Type: application/json` (2xx)', async () => {
    const sin = await h.api('POST', '/admin/jobs/price-ingest', { token: admin }); // el arnés no manda cabecera sin `json`
    await h.app.get(ListingPriceService).idle();
    const con = await h.api('POST', '/admin/jobs/price-ingest', {
      token: admin,
      headers: { 'content-type': 'application/json', 'content-length': '0' },
    });
    expect({ sin: sin.status, con: con.status }).toEqual({ sin: 202, con: 202 });
  });

  it('🐤 canario: el endpoint SÍ depende de que el cuerpo no llegue `undefined` (si llegara, sería un 500)', async () => {
    const ctrl = h.app.get(AdminJobsController);
    await expect(ctrl.runPriceIngest(undefined as never, { id: 'x', role: Role.super_admin })).rejects.toThrow(TypeError);
  });
});
