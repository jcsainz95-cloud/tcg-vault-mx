import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AdminService } from '../src/modules/admin/admin.service';
import { UsersService } from '../src/modules/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { ADDRESS_DTO_KEYS, toAddressDTO } from '../src/modules/users/address-dto';

/**
 * v1.67.1 (techlead F2-2, `D-CTA-8`, contrato §M6 / §11 `AddressDTO`) — **UNA sola proyección de
 * `Address` en todo el backend.** `GET /users/me/addresses` (§1) y `GET /admin/users/:id` (§M6, los
 * DOS roles) emiten **la misma función** (`users/address-dto.ts`), con `recipientName`. Antes
 * `admin.service.ts` llevaba su propia copia de la lista blanca y omitía `recipientName`, así que la
 * ficha 360° no servía como remedio del retiro «sin destinatario».
 */

/** Fila `Address` como la trae Prisma: con las columnas que el DTO NO debe dejar pasar. */
const ROWS = [
  {
    id: 'a1',
    userId: 'u1',
    recipientName: 'Mamá de Ana',
    line1: 'Av. Siempre Viva 742',
    line2: 'Depto 3',
    neighborhood: 'Roma',
    city: 'CDMX',
    state: 'CDMX',
    postalCode: '06700',
    country: 'MX',
    phone: '5555555555',
    isDefault: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  },
  {
    // Anterior a M-52: `recipientName` NULL, y la clave tiene que viajar igual (contrato §11).
    id: 'a0',
    userId: 'u1',
    recipientName: null,
    line1: 'Calle Vieja 1',
    line2: null,
    neighborhood: null,
    city: 'CDMX',
    state: 'CDMX',
    postalCode: '01000',
    country: 'MX',
    phone: '5544443333',
    isDefault: false,
    createdAt: new Date('2025-12-01T00:00:00Z'),
    updatedAt: new Date('2025-12-01T00:00:00Z'),
  },
];

const pii = new PiiCryptoService(new ConfigService({}));

function buildAdmin() {
  const prisma: any = {
    priceReference: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'u1',
        email: 'ana@example.com',
        name: 'Ana',
        role: 'customer',
        passwordHash: 'HASH',
        kycProfile: null,
        billingProfile: null,
        addresses: ROWS,
        orders: [],
        sellRequests: [],
        disputes: [],
        // v1.69 (P-78, §M6-K.3): el `include` de `getUser` trae los 5 últimos envíos para el cotejo.
        shipmentRequests: [],
        ownedItems: [],
      }),
    },
  };
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    tryGradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    fxSnapshotSafe: jest.fn().mockResolvedValue(null),
    liveMxnCents: (ref: { priceMxnCents: number }) => ref.priceMxnCents,
  } as unknown as PricingService;
  return new AdminService(prisma as PrismaService, pricing, pii, {} as never);
}

function buildUsers() {
  const prisma: any = { address: { findMany: jest.fn().mockResolvedValue(ROWS) } };
  return new UsersService(prisma as PrismaService, {} as SettingsService, pii, {} as never);
}

describe('AddressDTO — paridad users ↔ admin (una sola proyección, v1.67.1)', () => {
  const expected = ROWS.map(toAddressDTO);

  it('toAddressDTO: exactamente las claves del contrato §11, con recipientName (string o null) y sin userId/fechas', () => {
    for (const dto of expected) {
      expect(Object.keys(dto)).toEqual([...ADDRESS_DTO_KEYS]);
      expect(dto).not.toHaveProperty('userId');
      expect(dto).not.toHaveProperty('createdAt');
      expect(dto).not.toHaveProperty('updatedAt');
    }
    expect(expected[0].recipientName).toBe('Mamá de Ana');
    expect(expected[1].recipientName).toBeNull();
  });

  it('GET /users/me/addresses emite toAddressDTO(row) tal cual', async () => {
    const { data } = await buildUsers().listAddresses('u1');
    expect(data).toEqual(expected);
  });

  it.each([Role.super_admin, Role.vault_operator])(
    'GET /admin/users/:id como %s emite EXACTAMENTE la misma AddressDTO (con recipientName)',
    async (role) => {
      const res = (await buildAdmin().getUser('u1', role)) as { addresses: unknown[] };
      expect(res.addresses).toEqual(expected);
      for (const a of res.addresses as Record<string, unknown>[]) {
        expect(Object.keys(a)).toEqual([...ADDRESS_DTO_KEYS]);
        expect(a).toHaveProperty('recipientName');
      }
    },
  );

  it('admin.service.ts ya no lleva su propia copia de la lista blanca (toAdminUserAddressRef no existe)', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'modules', 'admin', 'admin.service.ts'), 'utf8');
    expect(src).not.toContain('toAdminUserAddressRef');
    expect(src).toContain("from '../users/address-dto'");
  });
});
