import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';
import { ADDRESS_DTO_KEYS } from '../src/modules/users/address-dto';

/**
 * ⭐⭐ **`R-1` (techlead, 2026-09-12) — EL CANDADO QUE CIERRA LA CLASE: IGUALDAD DE CONJUNTO DE
 * CLAVES, no de valores.** `GET /admin/users/:id` · API_CONTRACT §11 (`AdminUserDetailDTO`,
 * `AdminUserDetailOperatorDTO`, `AdminKycProfileDTO`, `AdminKycProfileOperatorDTO`,
 * `AdminBillingProfileDTO`).
 *
 * ### Por qué este fichero existe, dicho con la historia
 * Esta puerta ha filtrado PII **tres veces por el mismo motivo**: `clabeSnapshotEnc` (S49-M1-R),
 * `legalName` (D51) y las **object keys del INE** (P-78). Las tres eran la misma clase: la ficha se
 * derivaba **por sustracción** (lista negra + spread de resto), y *lo que se proyecta por resto se
 * publica por omisión*.
 *
 * **Y el candado que cazó la tercera —K-2— no cierra la clase:** comprueba que el JSON no contenga
 * `kyc_ine/`, o sea **la forma del VALOR**. Una columna futura `curp` o `ineSelfieUrl` no casa con
 * ese patrón y **pasaría con el candado en verde**.
 *
 * **Éste sí la cierra:** compara `Object.keys(...)` contra la lista del contrato, para los **DOS**
 * roles, y falla **si sobra o si falta** una clave. Se pone rojo **el día que alguien añade una
 * columna**, no el día que alguien lee un JSON.
 */

const pii = new PiiCryptoService(new ConfigService({}));
const CLABE = '012345678901234567';
const RFC = 'XAXX010101000';

/** `AdminUserDetailDTO` (§11) — `super_admin`. */
const SUPER_KEYS = [
  'id', 'email', 'name', 'nameSource', 'phone', 'locale', 'role', 'status', 'emailVerified',
  'authProvider', 'avatarUrl', 'mustChangePassword', 'deletedAt', 'anonymizedAt', 'createdAt',
  'updatedAt', 'recentShipmentRecipients', 'kycProfile', 'billingProfile', 'addresses', 'orders',
  'sellRequests', 'disputes', 'ownedItems',
].sort();

/**
 * `AdminUserDetailOperatorDTO` (§11) — `vault_operator`.
 * ⛔ **Cuatro claves MENOS que el `super_admin`**, y las cuatro a propósito: `authProvider`,
 * `avatarUrl`, `mustChangePassword` y `anonymizedAt`. §11 es explícito: *«el rol es parte de la
 * forma — DOS DTOs, no uno con opcionales»*. ⛔ Y **nunca** `recentShipmentRecipients`: un perfil de
 * movimientos por persona no es de su rol.
 */
const OPERATOR_KEYS = [
  'id', 'email', 'name', 'nameSource', 'phone', 'locale', 'role', 'status', 'emailVerified',
  'deletedAt', 'createdAt', 'updatedAt', 'kycProfile', 'billingProfile', 'addresses', 'orders',
  'sellRequests', 'disputes', 'ownedItems',
].sort();

/** `AdminKycProfileDTO` (§11). `rejectionReason` solo aparece en `rejected` (§M6-K.7): aquí no. */
const KYC_SUPER_KEYS = [
  'id', 'userId', 'kycStatus', 'clabeMasked', 'rfcMasked', 'ineOnFile', 'reviewedAt', 'reviewedBy',
  'capPerMonthCents', 'verifiedBy', 'verifiedAt', 'createdAt', 'updatedAt',
].sort();

/** `AdminKycProfileOperatorDTO` (§11) — siete claves. */
const KYC_OPERATOR_KEYS = [
  'id', 'userId', 'kycStatus', 'clabeMasked', 'ineOnFile', 'capPerMonthCents', 'verifiedAt',
].sort();

/** `AdminBillingProfileDTO` (§11) — diez claves. */
const BILLING_KEYS = [
  'id', 'userId', 'rfcMasked', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'postalCode', 'email',
  'createdAt', 'updatedAt',
].sort();

/**
 * Fila CRUDA tal y como la devolvería una BD que **ignorara el `select`**, y con **dos columnas
 * intrusas** (`curp`, `ineSelfieUrl`) que hoy no existen en el schema.
 *
 * ⭐ Ese es el punto del fixture: simula «el schema ganó una columna de PII mañana». Con proyección
 * por resta, las dos intrusas **saldrían solas**; con lista blanca, no pueden.
 */
function buildService() {
  const prisma = {
    priceReference: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'cliente@example.com',
        name: 'Cliente',
        nameSource: 'user',
        role: 'customer',
        status: 'active',
        locale: 'es',
        emailVerified: true,
        authProvider: 'local',
        phone: '5511110000',
        avatarUrl: null,
        mustChangePassword: false,
        deletedAt: null,
        anonymizedAt: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        // ⛔ Columnas que JAMÁS pueden viajar (la BD las devuelve aquí a propósito).
        passwordHash: 'HASH',
        tokenVersion: 7,
        googleId: 'google-sub-123',
        kycProfile: {
          id: 'k1',
          userId: 'u1',
          kycStatus: 'verified',
          legalName: 'Nombre Legal Muerto',
          rfcEnc: pii.encrypt(RFC),
          clabeEnc: pii.encrypt(CLABE),
          clabeHmac: pii.clabeBlindIndex(CLABE),
          ineFrontKey: 'kyc_ine/2026/front.jpg',
          ineBackKey: 'kyc_ine/2026/back.jpg',
          capPerRequestCentsOverride: 300000,
          capPerMonthCentsOverride: 1000000,
          verifiedBy: 'admin-1',
          verifiedAt: new Date('2026-02-01T00:00:00Z'),
          rejectionReason: null,
          reviewedAt: new Date('2026-02-01T00:00:00Z'),
          reviewedBy: 'admin-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-02-01T00:00:00Z'),
          // ⭐ LAS INTRUSAS: la columna de PII que el schema gane mañana.
          curp: 'XAXX010101HDFAAA09',
          ineSelfieUrl: 'https://storage.example/selfie-de-la-persona.jpg',
        },
        billingProfile: {
          id: 'b1',
          userId: 'u1',
          rfcEnc: pii.encrypt(RFC),
          razonSocial: 'ACME SA de CV',
          regimenFiscal: '601',
          usoCfdi: 'G03',
          postalCode: '06700',
          email: 'facturas@example.com',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          // ⭐ INTRUSA también aquí: `billingProfile` cuadraba con el contrato POR COINCIDENCIA.
          cuentaBancaria: '0123456789',
        },
        addresses: [
          {
            id: 'a1',
            recipientName: 'Quien Recibe',
            line1: 'Calle 1',
            line2: null,
            neighborhood: 'Centro',
            city: 'CDMX',
            state: 'CDMX',
            postalCode: '06000',
            country: 'MX',
            phone: '5555555555',
            isDefault: true,
            // Columnas internas de `Address` que el DTO no declara.
            userId: 'u1',
            createdAt: new Date('2026-01-01T00:00:00Z'),
          },
        ],
        orders: [],
        sellRequests: [],
        disputes: [],
        ownedItems: [],
        shipmentRequests: [],
      }),
    },
  };
  const svc = new AdminService(
    prisma as unknown as PrismaService,
    { fxSnapshotSafe: jest.fn().mockResolvedValue(null) } as unknown as PricingService,
    pii,
    {} as UploadsService,
  );
  return { svc, prisma };
}

describe('R-1 · la lista blanca vive en el `select` de la CONSULTA', () => {
  it('`getUser` NO usa `include`: pide un `select` y las relaciones van acotadas una por una', async () => {
    const { svc, prisma } = buildService();
    await svc.getUser('u1', Role.super_admin);
    const args = prisma.user.findUnique.mock.calls[0][0];
    // Lo que no está enumerado NI SE LEE de la base: es la diferencia entre «filtrar» y «no tener».
    expect(args.include).toBeUndefined();
    expect(args.select).toBeDefined();
    for (const prohibida of ['passwordHash', 'tokenVersion', 'googleId']) {
      expect(args.select[prohibida]).toBeUndefined();
    }
    // Ni el blind index de la CLABE ni el campo muerto se leen del `KycProfile`.
    expect(args.select.kycProfile.select.clabeHmac).toBeUndefined();
    expect(args.select.kycProfile.select.legalName).toBeUndefined();
    // `sellRequests` acotado: el `clabeSnapshotEnc` de S49-M1-R ya no puede ni leerse.
    expect(args.select.sellRequests.select.clabeSnapshotEnc).toBeUndefined();
    expect(Object.keys(args.select.sellRequests.select).sort()).toEqual(
      ['id', 'status', 'quotedTotalCents', 'createdAt'].sort(),
    );
    // Las direcciones se piden con EXACTAMENTE las 11 columnas del `AddressDTO`.
    expect(Object.keys(args.select.addresses.select).sort()).toEqual([...ADDRESS_DTO_KEYS].sort());
  });
});

describe('R-1 · IGUALDAD DE CONJUNTO DE CLAVES contra el contrato (§11), por rol', () => {
  it('`super_admin`: ni una clave de más, ni una de menos', async () => {
    const { svc } = buildService();
    const res = (await svc.getUser('u1', Role.super_admin)) as unknown as Record<string, unknown>;
    expect(Object.keys(res).sort()).toEqual(SUPER_KEYS);
    expect(Object.keys(res.kycProfile as object).sort()).toEqual(KYC_SUPER_KEYS);
    expect(Object.keys(res.billingProfile as object).sort()).toEqual(BILLING_KEYS);
  });

  it('`vault_operator`: su propia lista — CUATRO claves menos, y `billingProfile` SIEMPRE `null`', async () => {
    const { svc } = buildService();
    const res = (await svc.getUser('u1', Role.vault_operator)) as unknown as Record<string, unknown>;
    expect(Object.keys(res).sort()).toEqual(OPERATOR_KEYS);
    expect(Object.keys(res.kycProfile as object).sort()).toEqual(KYC_OPERATOR_KEYS);
    // `null`, no «omitido»: el front pinta «sin acceso», no «sin datos».
    expect(res.billingProfile).toBeNull();
    expect(res).not.toHaveProperty('recentShipmentRecipients');
  });

  it('la dirección sale con las 11 claves de `AddressDTO`, ni una interna', async () => {
    const { svc } = buildService();
    for (const role of [Role.super_admin, Role.vault_operator]) {
      const res = (await svc.getUser('u1', role)) as unknown as { addresses: Record<string, unknown>[] };
      expect(Object.keys(res.addresses[0]).sort()).toEqual([...ADDRESS_DTO_KEYS].sort());
    }
  });
});

describe('R-1 · ⭐ LA CLASE: una columna de PII NUEVA no se publica sola', () => {
  it.each([[Role.super_admin], [Role.vault_operator]])(
    'con rol %s, `curp` / `ineSelfieUrl` / `cuentaBancaria` NO aparecen aunque la fila las traiga',
    async (role) => {
      const { svc } = buildService();
      const res = await svc.getUser('u1', role);
      const json = JSON.stringify(res);
      // Éstas son las que un candado de VALOR (`/kyc_ine\//`) nunca habría visto.
      for (const intrusa of ['curp', 'ineSelfieUrl', 'cuentaBancaria', 'XAXX010101HDFAAA09', 'selfie-de-la-persona']) {
        expect(json).not.toContain(intrusa);
      }
      // Y las tres de siempre, que ya costaron una fuga cada una.
      for (const vieja of ['passwordHash', 'tokenVersion', 'googleId', 'clabeHmac', 'legalName', 'ineFrontKey', 'ineBackKey', 'clabeEnc', 'rfcEnc']) {
        expect(json).not.toContain(vieja);
      }
      expect(json).not.toContain(CLABE);
      expect(json).not.toContain(RFC);
    },
  );

  it('lo que SÍ tiene que salir sigue saliendo: enmascarados y `ineOnFile`', async () => {
    const { svc } = buildService();
    const res = (await svc.getUser('u1', Role.super_admin)) as unknown as {
      kycProfile: Record<string, unknown>;
      billingProfile: Record<string, unknown>;
    };
    expect(res.kycProfile.clabeMasked).toBe('**************4567');
    expect(res.kycProfile.rfcMasked).toBe('XAX**********');
    expect(res.kycProfile.ineOnFile).toBe(true);
    expect(res.billingProfile.rfcMasked).toBe('XAX**********');
    expect(res.billingProfile.razonSocial).toBe('ACME SA de CV');
  });
});
