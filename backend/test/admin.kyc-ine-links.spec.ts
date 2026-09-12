import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminUsersController } from '../src/modules/admin/admin.controller';
import { AdminService } from '../src/modules/admin/admin.service';
import { ActorThrottlerGuard } from '../src/modules/admin/actor-throttler.guard';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * ⭐⭐ **v1.69 (P-78, BK-1) — `GET /admin/users/:id/kyc/ine-links`.**
 * API_CONTRACT §M6-K.2 (candados **K-2, K-3, K-4, K-9, K-10**) · ARCHITECTURE §3.4.c/§4.49.
 *
 * **Qué NO puede probar este fichero, y hay que decirlo en vez de fingirlo:**
 * - **K-1 (`vault_operator` ⇒ `403`)** se verifica **llamando al endpoint con un token de
 *   operador**, no leyendo el decorador — aquí solo se afirma que el metadato `@Roles` existe y dice
 *   `super_admin`, que es **necesario y NO suficiente**. La medición real vive en
 *   `test/integration/kyc-ine-links.e2e-spec.ts` (la corre QA).
 * - **K-9 con `KYC_INE_VIEW_URL_TTL_SECONDS=3600`** se mide en `uploads.ine-view-url.spec.ts`, que
 *   es donde vive el dial.
 */

const FRONT_KEY = 'kyc_ine/2026-09-11/front-uuid.png';
const BACK_KEY = 'kyc_ine/2026-09-11/back-uuid.png';

/** Doble de `UploadsService`: firma local, sin red. Devuelve una URL con la key dentro (como R2). */
function buildUploads(ttl = 120) {
  return {
    resolveIneViewUrlTtl: () => ({ seconds: ttl, clamped: false }),
    presignGet: jest.fn(
      async (key: string) => `https://bucket.example/${key}?X-Amz-Signature=deadbeef`,
    ),
  } as unknown as UploadsService & { presignGet: jest.Mock };
}

function buildService(
  kycRow: { ineFrontKey: string | null; ineBackKey: string | null } | null,
  opts: { userExists?: boolean; uploads?: ReturnType<typeof buildUploads> } = {},
) {
  const uploads = opts.uploads ?? buildUploads();
  const prisma = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(kycRow) },
    user: {
      findUnique: jest.fn().mockResolvedValue(opts.userExists === false ? null : { id: 'u1' }),
    },
  };
  const svc = new AdminService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    {} as PiiCryptoService,
    uploads,
  );
  return { svc, prisma, uploads };
}

describe('K.2 — resolución de las keys y códigos de error (AdminService.ineLinksUnaudited)', () => {
  it('200: dos URLs firmadas, `expiresInSeconds` y ⛔ NI UNA object key en la respuesta (K-2)', async () => {
    const { svc, uploads } = buildService({ ineFrontKey: FRONT_KEY, ineBackKey: BACK_KEY });
    const { links: res, ttl } = await svc.ineLinksUnaudited('u1');
    expect(ttl).toEqual({ seconds: 120, clamped: false });

    expect(res.userId).toBe('u1');
    expect(res.expiresInSeconds).toBe(120);
    expect(res.front.url).toContain('X-Amz-Signature=');
    expect(res.back.url).toContain('X-Amz-Signature=');
    // El servidor resolvió las keys desde `:id`: el cliente nunca las mandó ni las recibe.
    expect(uploads.presignGet).toHaveBeenCalledWith(FRONT_KEY, 120);
    expect(uploads.presignGet).toHaveBeenCalledWith(BACK_KEY, 120);

    // ⛔ Invariante K.1.1 — las keys NO son campos de la respuesta, con ningún nombre.
    expect(res).not.toHaveProperty('ineFrontKey');
    expect(res).not.toHaveProperty('ineBackKey');
    // ⚠️ Y la forma es CERRADA: cuatro claves, ni una más (un `...rest` futuro se ve aquí).
    expect(Object.keys(res).sort()).toEqual(['back', 'expiresInSeconds', 'front', 'userId']);
    expect(Object.keys(res.front).sort()).toEqual(['expiresAt', 'url']);
    // ⚠️ **Matiz de K-2, medido y declarado:** el ÚNICO sitio donde el prefijo `kyc_ine/` aparece es
    // DENTRO de la URL firmada — es el path del objeto y no se puede firmar sin él. Lo que el
    // candado prohíbe de verdad es la key como DATO ESTRUCTURADO (§M6-K.2.3). Se afirma así:
    const withoutUrls = JSON.stringify({ ...res, front: { ...res.front, url: '' }, back: { ...res.back, url: '' } });
    expect(withoutUrls).not.toMatch(/kyc_ine\//);
    // …y tampoco viaja el nombre del bucket como campo.
    expect(res).not.toHaveProperty('bucket');
  });

  it('`expiresAt` es coherente con el TTL (≈ ahora + 120 s) y es el MISMO para los dos documentos', async () => {
    const { svc } = buildService({ ineFrontKey: FRONT_KEY, ineBackKey: BACK_KEY });
    const before = Date.now();
    const { links: res } = await svc.ineLinksUnaudited('u1');
    const delta = new Date(res.front.expiresAt).getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(119_000);
    expect(delta).toBeLessThanOrEqual(125_000);
    expect(res.back.expiresAt).toBe(res.front.expiresAt);
  });

  it('404 NOT_FOUND cuando el usuario NO existe (paridad con `AuditService.listForUser`)', async () => {
    const { svc } = buildService(null, { userExists: false });
    await expect(svc.ineLinksUnaudited('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('K-10 · 422 INE_NOT_ON_FILE sin `KycProfile`: el usuario existe, la respuesta es accionable', async () => {
    const { svc } = buildService(null, { userExists: true });
    await expect(svc.ineLinksUnaudited('u1')).rejects.toMatchObject({
      code: 'INE_NOT_ON_FILE',
      details: { frontOnFile: false, backOnFile: false },
    });
  });

  it.each([
    ['solo el FRENTE', { ineFrontKey: FRONT_KEY, ineBackKey: null }, { frontOnFile: true, backOnFile: false }],
    ['solo el REVERSO', { ineFrontKey: null, ineBackKey: BACK_KEY }, { frontOnFile: false, backOnFile: true }],
  ])('K-10 · 422 INE_NOT_ON_FILE con %s, y `details` dice CUÁL falta', async (_n, row, details) => {
    const { svc, uploads } = buildService(row);
    await expect(svc.ineLinksUnaudited('u1')).rejects.toMatchObject({ code: 'INE_NOT_ON_FILE', details });
    // ⛔ Y no se firma NADA en esa rama: media identidad no se enseña «por si sirve».
    expect(uploads.presignGet).not.toHaveBeenCalled();
  });

  it('⛔ el `select` a la BD es una lista blanca de DOS columnas: la CLABE cifrada ni se lee', async () => {
    const { svc, prisma } = buildService({ ineFrontKey: FRONT_KEY, ineBackKey: BACK_KEY });
    await svc.ineLinksUnaudited('u1');
    const select = prisma.kycProfile.findUnique.mock.calls[0][0].select;
    expect(Object.keys(select).sort()).toEqual(['ineBackKey', 'ineFrontKey']);
  });

  it('con `KycProfile` presente NO se consulta `User`: la FK ya garantiza que existe', async () => {
    const { svc, prisma } = buildService({ ineFrontKey: FRONT_KEY, ineBackKey: BACK_KEY });
    await svc.ineLinksUnaudited('u1');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('K.2.4 — ⛔⛔ FALLO CERRADO: si la bitácora no escribe, los enlaces NO salen (K-3)', () => {
  /**
   * Monta el controller REAL con un `AuditService` REAL sobre un Prisma cuyo `auditLog.create`
   * **revienta a propósito**. Es la única forma de distinguir «falla cerrado» de «falla abierto y
   * nadie lo vio»: un test que solo comprueba que la fila se escribe **no ve la diferencia**.
   */
  function buildController(auditExplodes: boolean) {
    const calls: string[] = [];
    const links = {
      userId: 'u1',
      front: { url: `https://bucket.example/${FRONT_KEY}?X-Amz-Signature=deadbeef`, expiresAt: 'X' },
      back: { url: `https://bucket.example/${BACK_KEY}?X-Amz-Signature=deadbeef`, expiresAt: 'X' },
      expiresInSeconds: 120,
    };
    const admin = {
      ineLinksUnaudited: jest.fn(async () => {
        calls.push('sign');
        return { links, ttl: { seconds: 120, clamped: false } };
      }),
    } as unknown as AdminService;
    const create: jest.Mock = jest.fn(async (_args: { data: Record<string, unknown> }) => {
      calls.push('audit');
      if (auditExplodes) throw new Error('DB down: relation "AuditLog" is unavailable');
      return {};
    });
    const audit = new AuditService({ auditLog: { create } } as unknown as PrismaService);
    return { ctrl: new AdminUsersController(admin, audit), calls, create, links };
  }

  const actor = { id: 'admin-1', role: Role.super_admin };

  it('la escritura de `AuditLog` revienta ⇒ 500 AUDIT_WRITE_FAILED y el cuerpo NO contiene ninguna `url`', async () => {
    const { ctrl, create } = buildController(true);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    try {
      const err = await ctrl.ineLinks('u1', actor, '10.0.0.1').then(
        (ok) => ({ threw: false, value: ok }),
        (e) => ({ threw: true, value: e }),
      );
      expect(err.threw).toBe(true);
      expect(err.value).toMatchObject({ code: 'AUDIT_WRITE_FAILED' });
      expect((err.value as { getStatus(): number }).getStatus()).toBe(500);
      // ⭐ LO QUE DE VERDAD SE MIDE: la URL firmada **no llegó a ningún cuerpo**. Se serializa el
      // error entero —que es lo único que el cliente va a recibir— y se busca cualquier rastro.
      const serialized = JSON.stringify((err.value as { getResponse(): unknown }).getResponse());
      expect(serialized).not.toContain('X-Amz-Signature');
      expect(serialized).not.toContain('kyc_ine/');
      expect(serialized).not.toMatch(/https?:\/\//);
      // El intento de escribir SÍ ocurrió (no es que nos saltáramos la bitácora).
      expect(create).toHaveBeenCalledTimes(1);
      // Y queda rastro en el log del servidor para diagnosticarlo.
      expect(errorSpy).toHaveBeenCalled();
      expect(String(errorSpy.mock.calls[0][0])).toContain('AUDIT_WRITE_FAILED');
      expect(String(errorSpy.mock.calls[0][0])).not.toContain('X-Amz-Signature');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('el ORDEN es normativo: firmar → auditar → responder (nunca auditar una mirada que no ocurre)', async () => {
    const { ctrl, calls, links } = buildController(false);
    const res = await ctrl.ineLinks('u1', actor, '10.0.0.1');
    expect(calls).toEqual(['sign', 'audit']);
    expect(res).toBe(links);
  });

  it('K-4 · una fila por emisión: `user.kyc.reveal_ine` sobre el usuario MIRADO, sin keys ni URLs en `after`', async () => {
    const { ctrl, create } = buildController(false);
    await ctrl.ineLinks('u-mirado', actor, '203.0.113.9');
    expect(create).toHaveBeenCalledTimes(1);
    const data = (create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      actorUserId: 'admin-1',
      // Redundante a propósito: la fila vieja sigue diciendo con qué autoridad se miró.
      actorRole: Role.super_admin,
      action: 'user.kyc.reveal_ine',
      // ⚠️ `'User'` y NO `'KycProfile'`: así sale en `GET /admin/users/:id/audit?scope=target`.
      entityType: 'User',
      entityId: 'u-mirado',
      ip: '203.0.113.9',
      after: { documents: ['front', 'back'], expiresInSeconds: 120 },
    });
    // ⛔ Una URL prefirmada es una CREDENCIAL PORTADORA: guardarla en la BD es guardar la llave
    // junto a la puerta. Ni ella, ni la key, ni el bucket.
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('X-Amz-Signature');
    expect(serialized).not.toContain('kyc_ine/');
    expect(serialized).not.toContain('bucket.example');
  });

  it('tres llamadas ⇒ TRES filas (K-4): la bitácora contesta «¿cuántas veces se miró esta identidad?»', async () => {
    const { ctrl, create } = buildController(false);
    await ctrl.ineLinks('u1', actor, '10.0.0.1');
    await ctrl.ineLinks('u1', actor, '10.0.0.1');
    await ctrl.ineLinks('u1', actor, '10.0.0.1');
    expect(create).toHaveBeenCalledTimes(3);
  });
});

describe('K-1 (parcial) — el metadato de rol. ⚠️ NECESARIO, NO SUFICIENTE', () => {
  it('`@Roles(super_admin)` está puesto en el handler, por encima del `vault_operator` de la clase', () => {
    const roles = Reflect.getMetadata('roles', AdminUsersController.prototype.ineLinks);
    expect(roles).toEqual([Role.super_admin]);
    // El de la CLASE sí incluye al operador: por eso el del handler tiene que existir y ganar.
    expect(Reflect.getMetadata('roles', AdminUsersController)).toContain(Role.vault_operator);
  });

  it('`@Throttle` 10/min en el handler (§M6-K.2: control de VOLUMEN, no solo anti-abuso)', () => {
    // @nestjs/throttler v6 guarda un metadato POR LIMITADOR: `THROTTLER:LIMIT` + nombre.
    const handler = AdminUsersController.prototype.ineLinks;
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(10);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });

  it('⭐ el tope cuelga del ACTOR: el handler lleva `ActorThrottlerGuard` (hallazgo de seguridad)', () => {
    const guards = Reflect.getMetadata('__guards__', AdminUsersController.prototype.ineLinks) as
      | unknown[]
      | undefined;
    expect(guards).toBeDefined();
    expect(guards).toContain(ActorThrottlerGuard);
  });

  it('⭐ `Cache-Control: no-store` en la respuesta: lleva DOS credenciales portadoras', () => {
    const headers = Reflect.getMetadata('__headers__', AdminUsersController.prototype.ineLinks) as
      | { name: string; value: string }[]
      | undefined;
    expect(headers).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'no-store' },
        { name: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ]),
    );
  });
});

describe('Hallazgos de `seguridad` sobre §M6-K (SECURITY_NOTES, 2026-09-11)', () => {
  /**
   * **(3) La bitácora graba el TTL EFECTIVO, no una constante.** Si el `after` dijera `120` fijo
   * mientras el TTL sale de un dial de entorno, el registro **mentiría** el día que alguien mueva el
   * dial — y mentiría justo en el dato que explica cuánta vida tuvo la credencial que se emitió.
   */
  it('`after.expiresInSeconds` = el valor con el que SE FIRMÓ, aunque el dial no sea el default', async () => {
    const create: jest.Mock = jest.fn(async (_args: { data: Record<string, unknown> }) => ({}));
    const admin = {
      // El servicio ya resolvió el dial (aquí, clampado a 300): el controller NO lo re-deriva.
      ineLinksUnaudited: jest.fn(async () => ({
        links: {
          userId: 'u1',
          front: { url: 'https://bucket.example/a?X-Amz-Signature=x', expiresAt: 'X' },
          back: { url: 'https://bucket.example/b?X-Amz-Signature=x', expiresAt: 'X' },
          expiresInSeconds: 300,
        },
        // El dial pedía 3600 y el servidor recortó a 300: la fila tiene que contar LAS DOS cosas.
        ttl: { seconds: 300, clamped: true, requested: 3600 },
      })),
    } as unknown as AdminService;
    const audit = new AuditService({ auditLog: { create } } as unknown as PrismaService);
    const ctrl = new AdminUsersController(admin, audit);

    await ctrl.ineLinks('u1', { id: 'admin-1', role: Role.super_admin }, '10.0.0.1');
    const data = (create.mock.calls[0][0] as { data: { after: Record<string, unknown> } }).data;
    expect(data.after.expiresInSeconds).toBe(300);
    // ⭐ C10(c): y la fila dice que hubo recorte, y de qué valor — sin esto, la bitácora afirmaría
    // un 300 sin historia y nadie sabría que alguien pidió 3600.
    expect(data.after.ttlClamped).toBe(true);
    expect(data.after.ttlRequested).toBe(3600);
  });

  /**
   * **(1) El tope cuelga del ACTOR, no de la IP.** La amenaza es una **sesión de `super_admin`
   * abusada** —que cambia de IP cuando quiere—, y el eje de IP es el que `P-RL-1` (ALTA, abierto)
   * esquiva falsificando `X-Forwarded-For`.
   */
  describe('ActorThrottlerGuard.getTracker', () => {
    /** Acceso al método protegido: el candado mide CONDUCTA, no visibilidad de TypeScript. */
    const tracker = (req: Record<string, unknown>) =>
      (
        ActorThrottlerGuard.prototype as unknown as {
          getTracker(r: Record<string, unknown>): Promise<string>;
        }
      ).getTracker(req);

    it('dos IPs distintas, el MISMO actor ⇒ el MISMO cubo (cambiar de IP no renueva la cuota)', async () => {
      const a = await tracker({ ip: '10.0.0.1', user: { id: 'admin-1' } });
      const b = await tracker({ ip: '198.51.100.7', user: { id: 'admin-1' } });
      expect(a).toBe(b);
      expect(a).toBe('actor:admin-1');
    });

    it('la MISMA IP, dos actores ⇒ cubos distintos (un admin no consume la cuota del otro)', async () => {
      const a = await tracker({ ip: '10.0.0.1', user: { id: 'admin-1' } });
      const b = await tracker({ ip: '10.0.0.1', user: { id: 'admin-2' } });
      expect(a).not.toBe(b);
    });

    it('⛔ sin actor NO se degrada a la IP en silencio: cubo `anon` compartido y estrecho', async () => {
      const a = await tracker({ ip: '10.0.0.1' });
      const b = await tracker({ ip: '198.51.100.7' });
      expect(a).toBe('actor:anon');
      expect(b).toBe('actor:anon');
      // Y jamás lleva la IP dentro: un `X-Forwarded-For` falsificado no puede abrir un cubo nuevo.
      expect(a).not.toContain('10.0.0.1');
    });
  });
});
