import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * ⭐ **v1.69 (P-78, BK-5) — la ficha de M6 como PANTALLA DE COTEJO.**
 * API_CONTRACT §M6-K.3, §11 (`AdminUserDetailDTO`, `AdminShipmentRecipientRef`) — candado **K-2**.
 *
 * Decisión (d) del dueño: la revisión enseña la INE **junto al nombre y las direcciones**. Se
 * AMPLÍA la ficha con dos campos en vez de crear un DTO de revisión, porque un DTO nuevo sería una
 * **segunda proyección de las mismas columnas de PII** — y este contrato ya pagó ese error dos veces
 * (S49-M1-R y `toAdminUserAddressRef`).
 */

const pii = new PiiCryptoService(new ConfigService({}));

/** El snapshot COMPLETO que guarda `ShipmentRequest` (nueve campos, §5). */
const FULL_SNAPSHOT = {
  recipientName: 'María Pérez López',
  line1: 'Calle Secreta 123, int. 4',
  line2: 'Depto 4B',
  neighborhood: 'Roma Norte',
  city: 'CDMX',
  state: 'CDMX',
  postalCode: '06700',
  country: 'MX',
  phone: '5512345678',
};

function buildService(over: Record<string, unknown> = {}) {
  const prisma = {
    priceReference: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'cliente@example.com',
        name: 'Jcsainz95',
        // ⭐ El nombre está FABRICADO del correo (P-73). Sin `nameSource`, el revisor lo compara
        // contra un INE que dice «María Pérez López» y concluye que no coinciden.
        nameSource: 'derived',
        role: 'customer',
        status: 'active',
        locale: 'es',
        emailVerified: true,
        authProvider: 'local',
        phone: null,
        avatarUrl: null,
        mustChangePassword: false,
        deletedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
        passwordHash: 'HASH',
        kycProfile: {
          id: 'k1',
          userId: 'u1',
          legalName: null,
          rfcEnc: null,
          clabeEnc: null,
          clabeHmac: null,
          // ⛔ Las object keys del INE: la fila CRUDA las trae (el `include` no filtra).
          ineFrontKey: 'kyc_ine/2026-09-11/front.png',
          ineBackKey: 'kyc_ine/2026-09-11/back.png',
          kycStatus: 'pending',
          capPerRequestCentsOverride: null,
          capPerMonthCentsOverride: null,
          verifiedBy: null,
          verifiedAt: null,
          rejectionReason: null,
          reviewedAt: null,
          reviewedBy: null,
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
        },
        billingProfile: null,
        addresses: [],
        orders: [],
        sellRequests: [],
        disputes: [],
        ownedItems: [],
        shipmentRequests: [
          { id: 'ship-1', addressSnapshot: FULL_SNAPSHOT, requestedAt: new Date('2026-09-01T00:00:00Z') },
          {
            // Envío ANTERIOR a M-52: sin destinatario capturado.
            id: 'ship-0',
            addressSnapshot: { line1: 'Otra calle 9', city: 'Monterrey', state: 'NL', postalCode: '64000' },
            requestedAt: new Date('2026-05-01T00:00:00Z'),
          },
        ],
        ...over,
      }),
    },
  };
  return new AdminService(
    prisma as unknown as PrismaService,
    { fxSnapshotSafe: jest.fn().mockResolvedValue(null) } as unknown as PricingService,
    pii,
    {} as UploadsService,
  );
}

describe('§M6-K.3 · `nameSource` — el campo que hace LEGIBLE el cotejo', () => {
  it.each([[Role.super_admin], [Role.vault_operator]])('va en la ficha de %s (los DOS DTOs)', async (role) => {
    const res = (await buildService().getUser('u1', role)) as { nameSource: string };
    expect(res.nameSource).toBe('derived');
  });
});

describe('§M6-K.3 · `recentShipmentRecipients` — «¿a nombre de quién salen sus paquetes?»', () => {
  it('SOLO `super_admin`, últimos 5, LISTA BLANCA de cinco campos', async () => {
    const res = (await buildService().getUser('u1', Role.super_admin)) as {
      recentShipmentRecipients: Record<string, unknown>[];
    };
    expect(res.recentShipmentRecipients).toHaveLength(2);
    expect(res.recentShipmentRecipients[0]).toEqual({
      shipmentId: 'ship-1',
      recipientName: 'María Pérez López',
      city: 'CDMX',
      state: 'CDMX',
      createdAt: new Date('2026-09-01T00:00:00Z'),
    });
  });

  it('⛔ el snapshot ENTERO no viaja: ni calle, ni interior, ni teléfono, ni CP', async () => {
    const res = await buildService().getUser('u1', Role.super_admin);
    const json = JSON.stringify((res as { recentShipmentRecipients: unknown }).recentShipmentRecipients);
    for (const pii of [FULL_SNAPSHOT.line1, FULL_SNAPSHOT.line2, FULL_SNAPSHOT.phone, FULL_SNAPSHOT.postalCode, FULL_SNAPSHOT.neighborhood]) {
      expect(json).not.toContain(pii);
    }
  });

  it('⛔ `recipientName: null` en un envío anterior a M-52 — NO se deriva de `User.name`', async () => {
    const res = (await buildService().getUser('u1', Role.super_admin)) as {
      recentShipmentRecipients: { recipientName: string | null }[];
    };
    // Derivarlo sería inventar exactamente el dato que el cotejo intenta comprobar.
    expect(res.recentShipmentRecipients[1].recipientName).toBeNull();
    expect(JSON.stringify(res.recentShipmentRecipients[1])).not.toContain('Jcsainz95');
  });

  it('⛔ el `vault_operator` NO recibe la clave (ni vacía): un perfil de movimientos no es de su rol', async () => {
    const res = await buildService().getUser('u1', Role.vault_operator);
    expect(res).not.toHaveProperty('recentShipmentRecipients');
  });

  it('la consulta pide `take: 5`, ordenado por el alta del envío', async () => {
    const svc = buildService();
    await svc.getUser('u1', Role.super_admin);
    const findUnique = (
      svc as unknown as { prisma: { user: { findUnique: jest.Mock } } }
    ).prisma.user.findUnique;
    // ⭐ R-1: la consulta pasó de `include` a `select` (lista blanca en la BD).
    const include = findUnique.mock.calls[0][0].select.shipmentRequests;
    expect(include.take).toBe(5);
    expect(include.orderBy).toEqual({ requestedAt: 'desc' });
    // `select` y no fila entera: de `ShipmentRequest` salen TRES columnas.
    expect(Object.keys(include.select).sort()).toEqual(['addressSnapshot', 'id', 'requestedAt']);
  });
});

describe('K-2 · ⛔⛔ las object keys del INE NO salen por la ficha 360° (invariante K.1.1)', () => {
  /**
   * **Fuga REAL, encontrada llamando al endpoint** (`test/integration/kyc-ine-links.e2e-spec.ts`) y
   * no leyendo el código: `GET /admin/users/:id` con `super_admin` devolvía `ineFrontKey` /
   * `ineBackKey` en el cuerpo. La medición 2 de §4.49.0 daba por hecho que «ninguna ruta las
   * expone» mirando `ADMIN_KYC_SELECT` + `toAdminKycDTO`, que son el camino del `PATCH`; esta rama
   * **no usa ninguno de los dos** y proyecta con `...rest` sobre la fila cruda del `include`.
   *
   * Tercera vez que esta misma puerta filtra por el mismo motivo (`clabeSnapshotEnc` en S49-M1-R,
   * `legalName` en D51, ahora las keys del INE). Por eso el candado se queda escrito aquí también:
   * la integración necesita BD, y esta clase de defecto tiene que romper el `npm test` de cualquiera.
   */
  it.each([[Role.super_admin], [Role.vault_operator]])('con rol %s el JSON no matchea /kyc_ine\\//', async (role) => {
    const res = await buildService().getUser('u1', role);
    expect(JSON.stringify(res)).not.toMatch(/kyc_ine\//);
    const kyc = (res as { kycProfile: Record<string, unknown> }).kycProfile;
    expect(kyc).not.toHaveProperty('ineFrontKey');
    expect(kyc).not.toHaveProperty('ineBackKey');
    // Lo ÚNICO que el contrato autoriza a salir del INE: el booleano.
    expect(kyc.ineOnFile).toBe(true);
  });
});
