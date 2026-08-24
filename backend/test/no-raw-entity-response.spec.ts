import { readFileSync, readdirSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * v2.1.9 · S49-M1 / R1 / R4 — **ningún endpoint devuelve una entidad Prisma cruda.**
 *
 * ### Por qué este archivo existe (y por qué NO basta con «arreglar los cinco sitios»)
 * El release anterior declaró esta norma **universal** y la aplicó a **dos** sitios. En el MISMO
 * archivo que citaba el contrato («nunca el snapshot cifrado») quedaban cinco `return` que devolvían
 * la fila `SellRequest` entera —con `clabeSnapshotEnc`, el blob AES-256-GCM de la CLABE del
 * vendedor— y dos de ellos ivan **al propio cliente**. Y `PATCH /admin/users/:id/kyc` devolvía la
 * entidad `KycProfile` con `clabeHmac`, el *blind index* determinista que existe **para no salir
 * jamás del servidor**.
 *
 * Lo instructivo no es la lista de sitios: es que la norma vivía en la memoria de quien editaba. Este
 * archivo la mueve a la máquina, en dos capas:
 *
 *  1. **Comportamiento** — se llama al servicio con una fila que SÍ trae el secreto y se afirma que
 *     la respuesta no lo contiene. Un mock de Prisma **ignora los `select`**, así que este test sólo
 *     pasa si la proyección es explícita en el código (que es justamente el punto: un `select` solo
 *     no se puede verificar sin BD, y una lista negra no protege de la columna de mañana).
 *  2. **Estructura** — un barrido estático que prohíbe el patrón `return prisma.<modelo>.<op>(…)` en
 *     `src/`. Lo que no se puede proyectar (helpers privados, returns DENTRO de una `$transaction`
 *     cuyo caller sí proyecta) se marca con `PROJECTION-EXEMPT: <motivo>` en el propio código: la
 *     excepción deja de ser invisible y pasa a ser una frase que alguien tuvo que escribir.
 */

const pii = new PiiCryptoService(new ConfigService({}));
const CLABE_ENC = pii.encrypt('012345678901234567');

/** Fila `SellRequest` COMPLETA — con el snapshot cifrado y `closedAt` dentro, como la devuelve la BD. */
function sellRequestRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    userId: 'u1',
    status: 'aprobada',
    quotedTotalCents: 5000,
    approvedTotalCents: 5000,
    clabeSnapshotEnc: CLABE_ENC,
    ineRequired: false,
    ineProvided: false,
    speiReference: null,
    paidBy: null,
    paidAt: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    receivedAt: null,
    verifiedAt: new Date('2026-08-02T00:00:00Z'),
    approvedAt: null,
    adjustmentSentAt: null,
    deadlineAt: null,
    closedAt: new Date('2026-08-03T00:00:00Z'),
    ...over,
  };
}

function buildBuylist(row: Record<string, unknown>) {
  const prisma: any = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    sellRequest: {
      // El mock devuelve la fila CRUDA a propósito: si el servicio la reenviara tal cual, el
      // secreto saldría. Es exactamente el fallo que se está fijando.
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async (args: any) => ({ ...row, ...args.data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    sellRequestItem: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(async (cb: any) => cb(prisma)),
  };
  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma };
}

/** El secreto no puede aparecer NI como campo NI dentro del JSON serializado de la respuesta. */
function expectNoClabeSnapshot(res: unknown) {
  expect((res as Record<string, unknown>).clabeSnapshotEnc).toBeUndefined();
  expect(JSON.stringify(res)).not.toContain(CLABE_ENC);
  // El prefijo del formato `v1:iv:tag:ct` delataría un blob aunque cambiara el ciphertext.
  expect(JSON.stringify(res)).not.toMatch(/"v1:[^"]+"/);
}

describe('S49-M1 · buylist — `clabeSnapshotEnc` no sale por NINGUNA ruta salvo reveal-clabe', () => {
  it('POST /buylist/requests/:id/respond {decline} — al CLIENTE, sin snapshot y sin closedAt', async () => {
    const { svc } = buildBuylist(sellRequestRow());
    const res: any = await svc.respond('u1', 'sr-1', 'decline');
    expectNoClabeSnapshot(res);
    expect(res.status).toBe('rechazada');
    // SEC-D2: `closedAt` es interno («NO se expone en DTOs de cliente», schema M-19) y esta rama
    // ACABA de escribirlo — es el caso donde más fácil se escapa.
    expect(res.closedAt).toBeUndefined();
    // `paidBy` es la identidad del staff que liquida: tampoco es del vendedor.
    expect(res.paidBy).toBeUndefined();
  });

  it('POST /buylist/requests/:id/respond {accept} — al CLIENTE, sin snapshot ni closedAt', async () => {
    const { svc } = buildBuylist(sellRequestRow({ status: 'ajustada' }));
    const res: any = await svc.respond('u1', 'sr-1', 'accept');
    expectNoClabeSnapshot(res);
    expect(res.status).toBe('aprobada');
    expect(res.closedAt).toBeUndefined();
  });

  it('GET /buylist/requests/:id — el detalle propio tampoco filtra snapshot ni closedAt', async () => {
    const { svc, prisma } = buildBuylist(sellRequestRow());
    prisma.sellRequest.findUnique.mockResolvedValue({ ...sellRequestRow(), items: [] });
    const res: any = await svc.getMine('u1', 'sr-1');
    expectNoClabeSnapshot(res);
    expect(res.closedAt).toBeUndefined();
    expect(res.sellRequestId).toBe('sr-1');
  });

  it('POST /admin/buylist/:id/receive — alcanzable por `vault_operator`, sin snapshot', async () => {
    const { svc, prisma } = buildBuylist(sellRequestRow());
    prisma.sellRequest.findUnique.mockResolvedValue({ ...sellRequestRow(), items: [] });
    const res: any = await svc.receive('sr-1');
    expectNoClabeSnapshot(res);
    expect(res.status).toBe('recibida');
  });

  it('POST /admin/buylist/:id/verify — alcanzable por `vault_operator`, sin snapshot', async () => {
    const { svc, prisma } = buildBuylist(sellRequestRow());
    prisma.sellRequest.findUnique.mockResolvedValue({ ...sellRequestRow(), items: [] });
    const res: any = await svc.verify('sr-1');
    expectNoClabeSnapshot(res);
    expect(res.status).toBe('verificacion');
  });

  it('POST /admin/buylist/:id/pay-spei — la transición NO devuelve el snapshot', async () => {
    const { svc, prisma } = buildBuylist(sellRequestRow());
    prisma.sellRequest.findUnique
      .mockResolvedValueOnce(sellRequestRow())
      .mockResolvedValue(sellRequestRow({ status: 'pagada', paidBy: 'admin-1' }));
    const res: any = await svc.paySpei('sr-1', 'SPEI-REF', 'admin-1');
    expectNoClabeSnapshot(res);
  });

  it('POST /admin/buylist/:id/pay-spei — la salida IDEMPOTENTE (ya `pagada`) tampoco', async () => {
    // Es el camino MÁS fácil de alcanzar: basta re-postear el pago. Antes devolvía el `findUnique`
    // crudo, sin pasar por ninguna transición.
    const { svc } = buildBuylist(sellRequestRow({ status: 'pagada', paidBy: 'admin-1' }));
    const res: any = await svc.paySpei('sr-1', 'SPEI-REF', 'admin-1');
    expectNoClabeSnapshot(res);
    expect(res.status).toBe('pagada');
  });

  it('`reveal-clabe` SIGUE siendo el único punto que devuelve la CLABE (en claro, @MoneyOut + auditado)', async () => {
    const { svc } = buildBuylist(sellRequestRow());
    const res = await svc.revealClabe('sr-1');
    expect(res).toEqual({ sellRequestId: 'sr-1', clabe: '012345678901234567' });
  });
});

describe('S49-R1 · PATCH /admin/users/:id/kyc — no devuelve la entidad `KycProfile`', () => {
  function buildAdmin() {
    const row = {
      id: 'kyc-1',
      userId: 'u1',
      legalName: 'Persona Ejemplo',
      rfcEnc: pii.encrypt('XAXX010101000'),
      clabeEnc: CLABE_ENC,
      // Blind index determinista: diseñado para NO salir jamás del servidor.
      clabeHmac: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      ineFrontKey: 'kyc_ine/u1-front.jpg',
      ineBackKey: 'kyc_ine/u1-back.jpg',
      kycStatus: 'verified',
      capPerRequestCentsOverride: 300_000,
      capPerMonthCentsOverride: 1_000_000,
      verifiedBy: 'admin-1',
      verifiedAt: new Date('2026-08-01T00:00:00Z'),
      createdAt: new Date('2026-07-01T00:00:00Z'),
      updatedAt: new Date('2026-08-01T00:00:00Z'),
    };
    const prisma: any = { kycProfile: { upsert: jest.fn().mockResolvedValue(row) } };
    const svc = new AdminService(
      prisma as PrismaService,
      {} as PricingService,
      pii,
      {} as UploadsService,
    );
    return { svc, prisma, row };
  }

  it('omite rfcEnc, clabeEnc, clabeHmac y las object keys del INE; reduce el INE a `ineOnFile`', async () => {
    const { svc, row } = buildAdmin();
    const res: any = await svc.updateUserKyc('u1', 'verified', 300_000, 1_000_000, 'admin-1');
    for (const forbidden of ['rfcEnc', 'clabeEnc', 'clabeHmac', 'ineFrontKey', 'ineBackKey']) {
      expect(res[forbidden]).toBeUndefined();
    }
    const json = JSON.stringify(res);
    expect(json).not.toContain(row.clabeHmac);
    expect(json).not.toContain(row.ineFrontKey);
    expect(json).not.toContain(CLABE_ENC);
    // La decisión que ya existía en `getUser`: el INE se reporta como booleano.
    expect(res.ineOnFile).toBe(true);
  });

  it('conserva lo que M6 necesita, con los nombres del contrato (§M6 AdminKycProfileDTO)', async () => {
    const { svc } = buildAdmin();
    const res: any = await svc.updateUserKyc('u1', 'verified', 300_000, 1_000_000, 'admin-1');
    expect(res).toMatchObject({
      userId: 'u1',
      kycStatus: 'verified',
      capPerRequestCents: 300_000,
      capPerMonthCents: 1_000_000,
      ineOnFile: true,
    });
  });

  it('pide a Prisma un `select` (lista blanca): la PII cifrada ni siquiera se LEE de la BD', async () => {
    const { svc, prisma } = buildAdmin();
    await svc.updateUserKyc('u1', 'pending');
    const select = prisma.kycProfile.upsert.mock.calls[0][0].select;
    expect(select).toBeDefined();
    expect(select.rfcEnc).toBeUndefined();
    expect(select.clabeEnc).toBeUndefined();
    expect(select.clabeHmac).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------
 * Capa 2 — barrido ESTRUCTURAL. Cierra la CLASE, no los casos.
 * ---------------------------------------------------------------------------------------------- */

describe('S49-R4 · barrido — ningún `return` entrega una fila Prisma sin proyectar', () => {
  const SRC = join(__dirname, '..', 'src');

  /** Operaciones que devuelven FILA(S). `count`/`aggregate`/`groupBy`/`*Many` de escritura no. */
  const ROW_OPS = [
    'findUnique',
    'findUniqueOrThrow',
    'findFirst',
    'findFirstOrThrow',
    'findMany',
    'create',
    'update',
    'upsert',
    'delete',
  ].join('|');

  /**
   * Marca de exención EXPLÍCITA. Va en un comentario en las 3 líneas previas al `return`, con el
   * motivo. Existe para que una excepción legítima (helper privado, return dentro de una
   * `$transaction` cuyo caller sí proyecta) sea **una frase que alguien escribió**, y no un silencio.
   */
  const EXEMPT = 'PROJECTION-EXEMPT';

  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = join(dir, e.name);
      if (e.isDirectory()) return walk(full);
      return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
    });
  }

  /** Texto del statement desde `return` hasta que los paréntesis se equilibran (máx 60 líneas). */
  function statementFrom(lines: string[], start: number): string {
    let depth = 0;
    let out = '';
    for (let i = start; i < Math.min(start + 60, lines.length); i++) {
      out += lines[i] + '\n';
      for (const ch of lines[i]) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
      }
      if (i > start || depth <= 0) {
        if (depth <= 0) break;
      }
    }
    return out;
  }

  function offenders(): string[] {
    const re = new RegExp(
      `return\\s+(?:await\\s+)?(?:this\\.)?(?:prisma|tx|db|client)\\.[A-Za-z_$][\\w$]*\\.(?:${ROW_OPS})\\s*\\(`,
    );
    const hits: string[] = [];
    for (const f of walk(SRC)) {
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        // Exento si lleva la marca en las 3 líneas previas (o en la propia línea).
        const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
        if (window.includes(EXEMPT)) continue;
        // Un `select:` dentro del propio statement YA es lista blanca a nivel de BD.
        if (/\bselect\s*:/.test(statementFrom(lines, i))) continue;
        hits.push(`${f.replace(SRC, 'src')}:${i + 1} :: ${lines[i].trim().slice(0, 100)}`);
      }
    }
    return hits;
  }

  it('cero `return prisma.<modelo>.<op>(…)` sin proyección, `select` ni exención razonada', () => {
    expect(offenders()).toEqual([]);
  });

  /**
   * El barrido de arriba sólo vale si el patrón que busca EXISTE en la base. Si un refactor cambiara
   * el acceso a datos (repositorios, otro nombre de cliente) el regex dejaría de encontrar nada y
   * pasaría verde midiendo el vacío — el mismo fallo tautológico que tenía el candado de enums.
   */
  it('el barrido no es vacío: el patrón que vigila existe (marcado como exento) en la base', () => {
    const marked = walk(SRC).filter((f) => readFileSync(f, 'utf8').includes(EXEMPT));
    expect(marked.length).toBeGreaterThan(0);
  });
});
