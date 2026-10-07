/**
 * bsd-b5.units.spec.ts — 💰 errata BSD-1.4 (`API_CONTRACT §BSD.18`; `ARCHITECTURE §4.BSD (n)`): las pruebas UNITARIAS nuevas
 * de la errata. Propiedad: backend. Deterministas (N=1, dicho como tal).
 *
 * | ID | Qué afirma | Mutación que la pone roja |
 * |---|---|---|
 * | BSD-B44 (punto 6) | `GET /buylist/requests/:id/label.pdf` lleva `@Throttle` propio de 10/min (el guard se salta en `NODE_ENV=test`: se leen los metadatos, como `buylist.quote-throttle.spec.ts`) | quitar el decorador |
 * | BSD-B45 (punto 1) | doble de Prisma: el `create` de la fila de entrada lanza `P2002` y la relectura devuelve la fila ⇒ `{created:false}` con ESA fila; ⛔ nunca lanza (`500`) | quitar el manejo de `P2002` en `InboundShipmentService.open` |
 * | BSD-B40 (a) (punto 4) | en `backend/src`, un `where` sobre `sellRequest` con `guideNoticeSentAt: null` solo aparece en `buylist/sell-request-guide.ts` (`guideNoticeSealWhere`) | volver a escribir el sello en línea en `inbound-guide-notice.service.ts` |
 */
import 'reflect-metadata';
import { Prisma } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as ts from 'typescript';
import { SellerInboundLabelController } from '../src/modules/shipments/inbound-shipment.controller';
import { InboundShipmentService } from '../src/modules/shipments/inbound-shipment.service';

describe('💰 BSD-B44 — la descarga del vendedor tiene su propio límite (10/min)', () => {
  const limit = (fn: unknown) => Reflect.getMetadata('THROTTLER:LIMITdefault', fn as object);
  const ttl = (fn: unknown) => Reflect.getMetadata('THROTTLER:TTLdefault', fn as object);

  it('`GET /buylist/requests/:id/label.pdf` ⇒ `@Throttle({default:{ttl:60_000, limit:10}})`', () => {
    expect(limit(SellerInboundLabelController.prototype.labelPdf)).toBe(10);
    expect(ttl(SellerInboundLabelController.prototype.labelPdf)).toBe(60_000);
  });
});

describe('💰 BSD-B45 — `P2002` en la apertura de la fila de entrada ⇒ `200 {created:false}` (determinista, N=1)', () => {
  /** El `@unique` de `ShipmentRequest.sellRequestId`, tal y como lo lanza Prisma. */
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`sellRequestId`)', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target: ['sellRequestId'] },
    });

  function world() {
    const create = jest.fn().mockRejectedValue(p2002());
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'sr-1' }]),
      sellRequest: {
        // Abierta y SIN fila de entrada: el candado (que aquí no serializa) no la vio ⇒ intenta crear.
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          status: 'aceptada',
          closedAt: null,
          sellerShippedDeclaredAt: null,
          shipmentTrackingNumber: null,
          pickupAddressSnapshot: { recipientName: 'V', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500000000' },
          inboundShipment: null,
        }),
      },
      shipmentRequest: { create },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      // La relectura tras el choque: la fila que creó la otra apertura.
      shipmentRequest: { findUnique: jest.fn().mockResolvedValue({ id: 'shr-otra' }) },
    };
    const quotes = { assertProviderOn: jest.fn().mockResolvedValue(undefined) };
    const labels = { labelOptionsFor: jest.fn() };
    const shipments = { adminGet: jest.fn(async (id: string) => ({ id, kind: 'buylist_inbound' })) };
    const svc = new InboundShipmentService(prisma as never, quotes as never, labels as never, shipments as never, {} as never);
    return { svc, create, prisma, shipments };
  }

  it('el `create` lanza `P2002` y la relectura trae la fila ⇒ `{created:false, shipment: esa fila}`; ⛔ no lanza', async () => {
    const w = world();
    const res = await w.svc.open('sr-1', {}, { id: 'op-1', role: 'vault_operator' as never });
    expect(w.create).toHaveBeenCalledTimes(1);
    expect(w.prisma.shipmentRequest.findUnique).toHaveBeenCalledWith({ where: { sellRequestId: 'sr-1' }, select: { id: true } });
    expect(res).toEqual({ created: false, shipment: { id: 'shr-otra', kind: 'buylist_inbound' } });
    expect(w.shipments.adminGet.mock.calls[0][0]).toBe('shr-otra');
  });

  it('CONTROL: un error que NO es ese `P2002` se propaga (el manejo no se traga todo)', async () => {
    const w = world();
    w.create.mockRejectedValueOnce(new Error('otra cosa'));
    await expect(w.svc.open('sr-1', {}, { id: 'op-1', role: 'vault_operator' as never })).rejects.toThrow('otra cosa');
  });
});

describe('💰 BSD-B40 (a) — UN predicado del sello de AV-7: `guideNoticeSentAt: null` como filtro solo en `sell-request-guide.ts`', () => {
  const BACKEND = join(__dirname, '..');
  const HOME = 'src/modules/buylist/sell-request-guide.ts';
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
  /** Cada `guideNoticeSentAt: null` de `src` que NO está dentro de un `data:` (es decir: un filtro), y cada `IS NULL` en SQL. */
  function filters(): { file: string; line: number }[] {
    const out: { file: string; line: number }[] = [];
    for (const abs of walk(join(BACKEND, 'src'))) {
      const file = relative(BACKEND, abs).replace(/\\/g, '/');
      const text = readFileSync(abs, 'utf8');
      if (!text.includes('guideNoticeSentAt')) continue;
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if (ts.isPropertyAssignment(n) && n.name.getText(sf) === 'guideNoticeSentAt' && n.initializer.kind === ts.SyntaxKind.NullKeyword) {
          let p: ts.Node | undefined = n.parent;
          let inData = false;
          while (p) {
            if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'data') inData = true;
            p = p.parent;
          }
          if (!inData) out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
        }
        if ((ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isStringLiteral(n)) && /"guideNoticeSentAt"\s+IS\s+NULL/i.test(n.text)) {
          out.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    return out;
  }

  it('CONTROL: el candado ve el predicado donde vive, y los DOS sellos lo importan', () => {
    expect(filters().filter((f) => f.file === HOME)).toHaveLength(1);
    for (const f of ['src/modules/buylist/buylist.service.ts', 'src/modules/shipments/inbound-guide-notice.service.ts']) {
      expect(readFileSync(join(BACKEND, f), 'utf8')).toMatch(/where:\s*guideNoticeSealWhere\(/);
    }
  });

  it('fuera de `sell-request-guide.ts` ningún `where` (ni SQL) filtra por `guideNoticeSentAt` nulo', () => {
    expect(filters().filter((f) => f.file !== HOME)).toEqual([]);
  });
});
