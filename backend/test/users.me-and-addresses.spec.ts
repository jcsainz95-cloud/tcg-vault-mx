import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersService } from '../src/modules/users/users.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { ConfigService } from '@nestjs/config';
import { AddressDto, BillingProfileDto, UpdateAddressDto, UpdateMeDto } from '../src/modules/users/dto/users.dto';
import { ADDRESS_DTO_KEYS } from '../src/modules/users/address-dto';

/**
 * v1.67 (Stream A · B4, contrato §1 `GET/PATCH /users/me` + «Direcciones», ARCHITECTURE §4.47.4/5).
 * Cierra D-CTA-2 (`""` pasaba y el PATCH devolvía 6 campos) y la mitad `users` de D-CTA-3.
 */

/** Las 14 claves de `GET /users/me` (contrato §1, v1.67). El PATCH devuelve EXACTAMENTE las mismas. */
const ME_KEYS = [
  'id', 'email', 'name', 'nameSource', 'phone', 'role', 'locale', 'kycStatus', 'status',
  'authProvider', 'emailVerified', 'avatarUrl', 'hasPassword', 'mustChangePassword',
].sort();

function baseUser(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'ana@example.com',
    name: 'Ana',
    nameSource: 'user',
    phone: '5511112222',
    role: 'customer',
    locale: 'es',
    status: 'active',
    authProvider: 'local',
    emailVerified: true,
    avatarUrl: null,
    passwordHash: '$argon2id$fake',
    mustChangePassword: false,
    kycProfile: null,
    ...over,
  };
}

function build(user: Record<string, unknown>, addresses: Record<string, unknown>[] = []) {
  const prisma: any = {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn(async ({ data }: any) => ({ ...user, ...data })),
    },
    address: {
      findMany: jest.fn().mockResolvedValue(addresses),
      findUnique: jest.fn(async ({ where }: any) => addresses.find((a) => a.id === where.id) ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(async ({ data }: any) => ({ id: 'addr-new', line2: null, neighborhood: null, isDefault: false, ...data })),
      update: jest.fn(async ({ where, data }: any) => ({ ...addresses.find((a) => a.id === where.id), ...data })),
    },
  };
  const svc = new UsersService(prisma as PrismaService, {} as SettingsService, {} as PiiCryptoService);
  return { svc, prisma };
}

describe('UsersService.me — +hasPassword, +nameSource, +mustChangePassword (v1.67)', () => {
  it('hasPassword = passwordHash != null (true con hash)', async () => {
    const { svc } = build(baseUser());
    const me = await svc.me('u1');
    expect(me.hasPassword).toBe(true);
    expect(me.nameSource).toBe('user');
    expect(me.mustChangePassword).toBe(false);
    expect(Object.keys(me).sort()).toEqual(ME_KEYS);
  });

  it('cuenta solo-Google (passwordHash null) ⇒ hasPassword=false aunque authProvider=google', async () => {
    const { svc } = build(baseUser({ passwordHash: null, authProvider: 'google', nameSource: 'derived' }));
    const me = await svc.me('u1');
    expect(me.hasPassword).toBe(false);
    expect(me.nameSource).toBe('derived');
  });

  it('cuenta Google CON hash (reset admin / forgot-password) ⇒ hasPassword=true: la heurística v1.1 era falsa', async () => {
    const { svc } = build(baseUser({ passwordHash: '$argon2id$x', authProvider: 'google' }));
    expect((await svc.me('u1')).hasPassword).toBe(true);
  });

  it('el hash NUNCA viaja: solo el booleano', async () => {
    const { svc } = build(baseUser());
    const me = await svc.me('u1');
    expect(JSON.stringify(me)).not.toContain('argon2');
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('mustChangePassword=true se refleja (banner persistente de la pantalla de cambio)', async () => {
    const { svc } = build(baseUser({ mustChangePassword: true }));
    expect((await svc.me('u1')).mustChangePassword).toBe(true);
  });
});

describe('UsersService.updateMe — trim, 1..120, nameSource=user, misma forma que el GET (v1.67)', () => {
  it('escribe el nombre RECORTADO y nameSource=user, y responde la forma del GET', async () => {
    const { svc, prisma } = build(baseUser({ nameSource: 'derived', name: 'jcsainz95' }));
    const res = await svc.updateMe('u1', { name: '  Juan Carlos  ' });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { name: 'Juan Carlos', nameSource: 'user' },
        include: { kycProfile: true },
      }),
    );
    expect(res.name).toBe('Juan Carlos');
    expect(res.nameSource).toBe('user');
    expect(Object.keys(res).sort()).toEqual(ME_KEYS);
  });

  it('sin `name` en el body NO toca nameSource (phone/locale solos)', async () => {
    const { svc, prisma } = build(baseUser({ nameSource: 'google' }));
    const res = await svc.updateMe('u1', { phone: '5599990000', locale: 'en' });
    const data = prisma.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ phone: '5599990000', locale: 'en' });
    expect(data).not.toHaveProperty('nameSource');
    expect(res.nameSource).toBe('google');
  });

  it.each([['vacío', ''], ['solo espacios', '   '], ['121 chars', 'x'.repeat(121)]])(
    'name %s ⇒ 400 VALIDATION_ERROR details.field=name y NO escribe',
    async (_l, name) => {
      const { svc, prisma } = build(baseUser());
      await expect(svc.updateMe('u1', { name })).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        details: expect.objectContaining({ field: 'name' }),
      });
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it('`nameSource` en el body es DESCARTADO por el whitelist del DTO (nunca lo decide el cliente)', async () => {
    const dto = plainToInstance(UpdateMeDto, { name: ' Ana ', nameSource: 'google' });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto).not.toHaveProperty('nameSource');
    // El @Transform recorta ANTES de validar.
    expect(dto.name).toBe('Ana');
  });

  it('UpdateMeDto: name no-string ⇒ error del pipe (IsString)', async () => {
    const dto = plainToInstance(UpdateMeDto, { name: 42 });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((e) => e.property)).toEqual(['name']);
  });
});

describe('UsersService direcciones — recipientName obligatorio al crear, no vaciable al editar (v1.67)', () => {
  const body = {
    line1: 'Av. Siempre Viva 742',
    city: 'CDMX',
    state: 'CDMX',
    postalCode: '01000',
    country: 'MX',
    phone: '5555555555',
  };

  it('crea con recipientName recortado y lo devuelve en el AddressDTO', async () => {
    const { svc, prisma } = build(baseUser());
    const res = await svc.createAddress('u1', { ...body, recipientName: '  Mamá de Ana  ' } as AddressDto);
    expect(prisma.address.create.mock.calls[0][0].data.recipientName).toBe('Mamá de Ana');
    expect(res.recipientName).toBe('Mamá de Ana');
    expect(res).not.toHaveProperty('userId'); // S49-R4 se conserva
  });

  it.each([['ausente', undefined], ['vacío', ''], ['solo espacios', '  '], ['null', null]])(
    'crear sin destinatario (%s) ⇒ 400 VALIDATION_ERROR details.field=recipientName, sin escribir y SIN fallback a User.name',
    async (_l, recipientName) => {
      const { svc, prisma } = build(baseUser({ name: 'Ana' }));
      await expect(
        svc.createAddress('u1', { ...body, recipientName } as unknown as AddressDto),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'recipientName' } });
      expect(prisma.address.create).not.toHaveBeenCalled();
      // El servidor ni siquiera consulta al usuario para "rellenar" el nombre.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    },
  );

  it('recipientName se valida ANTES que el país (una dirección US sin nombre falla por el nombre)', async () => {
    const { svc } = build(baseUser());
    await expect(
      svc.createAddress('u1', { ...body, country: 'US', recipientName: '' } as AddressDto),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      svc.createAddress('u1', { ...body, country: 'US', recipientName: 'X' } as AddressDto),
    ).rejects.toMatchObject({ code: 'ADDRESS_NOT_MX' });
  });

  it('AddressDto: recipientName ausente ⇒ error del pipe (IsString) — no llega al servicio', async () => {
    const dto = plainToInstance(AddressDto, { ...body });
    const errors = await validate(dto, { whitelist: true });
    expect(errors.map((e) => e.property)).toContain('recipientName');
  });

  const old = { id: 'a-old', userId: 'u1', recipientName: null, ...body, line2: null, neighborhood: null, isDefault: true };

  it('lista/proyecta `recipientName: null` en filas anteriores a M-52 (contrato §11)', async () => {
    const { svc } = build(baseUser(), [old]);
    const { data } = await svc.listAddresses('u1');
    expect(data[0]).toHaveProperty('recipientName', null);
    expect(Object.keys(data[0]).sort()).toEqual(
      ['id', 'recipientName', 'line1', 'line2', 'neighborhood', 'city', 'state', 'postalCode', 'country', 'phone', 'isDefault'].sort(),
    );
  });

  it('PATCH con recipientName válido lo escribe recortado (remedio de RECIPIENT_NAME_REQUIRED)', async () => {
    const { svc, prisma } = build(baseUser(), [old]);
    const res = await svc.updateAddress('u1', 'a-old', { recipientName: ' Ana Pérez ' });
    expect(prisma.address.update.mock.calls[0][0].data).toEqual({ recipientName: 'Ana Pérez' });
    expect(res.recipientName).toBe('Ana Pérez');
  });

  it.each([['""', ''], ['null', null], ['121 chars', 'x'.repeat(121)]])(
    'PATCH con recipientName %s ⇒ 400 VALIDATION_ERROR y NO escribe (no vaciable)',
    async (_l, recipientName) => {
      const named = { ...old, id: 'a-named', recipientName: 'Ana Pérez' };
      const { svc, prisma } = build(baseUser(), [named]);
      await expect(
        svc.updateAddress('u1', 'a-named', { recipientName } as unknown as UpdateAddressDto),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', details: expect.objectContaining({ field: 'recipientName' }) });
      expect(prisma.address.update).not.toHaveBeenCalled();
    },
  );

  it('PATCH sin recipientName no lo toca (la key ni aparece en `data`)', async () => {
    const named = { ...old, id: 'a-named', recipientName: 'Ana Pérez' };
    const { svc, prisma } = build(baseUser(), [named]);
    await svc.updateAddress('u1', 'a-named', { phone: '5544443333' });
    expect(prisma.address.update.mock.calls[0][0].data).toEqual({ phone: '5544443333' });
  });

  it('UpdateAddressDto: `null` pasa el pipe (@IsOptional) — por eso el servicio lo rechaza', async () => {
    const dto = plainToInstance(UpdateAddressDto, { recipientName: null });
    const errors = await validate(dto, { whitelist: true });
    expect(errors).toHaveLength(0);
    expect(dto.recipientName).toBeNull();
  });
});

describe('UsersService billing-profile — 404 sin perfil y BillingProfileDTO de seis campos (v1.67.1, D-CTA-7)', () => {
  const pii = new PiiCryptoService(new ConfigService({}));
  const RFC = 'XAXX010101000';
  const BILLING_KEYS = ['rfcMasked', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'postalCode', 'email'].sort();

  function row(over: Record<string, unknown> = {}) {
    return {
      id: 'bp1',
      userId: 'u1',
      rfcEnc: pii.encrypt(RFC),
      razonSocial: 'ACME SA DE CV',
      regimenFiscal: '601',
      usoCfdi: 'G03',
      postalCode: '06700',
      email: 'facturas@acme.mx',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      ...over,
    };
  }

  function buildBilling(existing: Record<string, unknown> | null) {
    const prisma: any = {
      billingProfile: {
        findUnique: jest.fn().mockResolvedValue(existing),
        upsert: jest.fn(async ({ create, update }: any) => row(existing ? update : create)),
      },
    };
    const svc = new UsersService(prisma as PrismaService, {} as SettingsService, pii);
    return { svc, prisma };
  }

  it('GET sin perfil ⇒ 404 NOT_FOUND (nunca 200 con null)', async () => {
    const { svc } = buildBilling(null);
    await expect(svc.getBillingProfile('u1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    let status: number | undefined;
    try {
      await svc.getBillingProfile('u1');
    } catch (e) {
      status = (e as { getStatus: () => number }).getStatus();
    }
    expect(status).toBe(404);
  });

  it('GET con perfil ⇒ exactamente las seis claves del contrato, con rfcMasked (3 en claro + `*`) y sin rfc/rfcEnc/id/userId/fechas', async () => {
    const { svc } = buildBilling(row());
    const dto = await svc.getBillingProfile('u1');
    expect(Object.keys(dto).sort()).toEqual(BILLING_KEYS);
    expect(dto.rfcMasked).toBe('XAX**********');
    expect(dto.rfcMasked).not.toContain('010101');
    expect(JSON.stringify(dto)).not.toContain(RFC);
    expect(JSON.stringify(dto)).not.toMatch(/"v1:[^"]+"/);
    expect(dto).toMatchObject({ razonSocial: 'ACME SA DE CV', regimenFiscal: '601', usoCfdi: 'G03', postalCode: '06700', email: 'facturas@acme.mx' });
  });

  it('PUT = upsert que reemplaza entero: cifra el RFC, construye `data` a mano y responde la MISMA forma que el GET', async () => {
    const { svc, prisma } = buildBilling(null);
    const body: BillingProfileDto = {
      rfc: 'ABCD990101XYZ',
      razonSocial: 'Nueva SA',
      regimenFiscal: '612',
      usoCfdi: 'G01',
      postalCode: '01000',
      email: 'nueva@x.mx',
    };
    const dto = await svc.putBillingProfile('u1', { ...body, intruso: 'x' } as unknown as BillingProfileDto);
    const { create, update } = prisma.billingProfile.upsert.mock.calls[0][0];
    // Nunca el RFC en claro en BD; nunca `rfc` como columna; ningún intruso.
    expect(create).not.toHaveProperty('rfc');
    expect(create).not.toHaveProperty('intruso');
    expect(update).not.toHaveProperty('intruso');
    expect(pii.decrypt(create.rfcEnc)).toBe('ABCD990101XYZ');
    expect(Object.keys(create).sort()).toEqual(['userId', 'rfcEnc', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'postalCode', 'email'].sort());
    expect(Object.keys(update).sort()).toEqual(['rfcEnc', 'razonSocial', 'regimenFiscal', 'usoCfdi', 'postalCode', 'email'].sort());
    // Respuesta: la forma del GET, desde la fila del upsert (sin segunda consulta).
    expect(Object.keys(dto).sort()).toEqual(BILLING_KEYS);
    expect(dto.rfcMasked).toBe('ABC**********');
    expect(prisma.billingProfile.findUnique).not.toHaveBeenCalled();
  });
});
