import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe, maskRfc } from '../../common/crypto/pii-mask';
import {
  AddressDto,
  BillingProfileDto,
  UpdateAddressDto,
  UpdateKycDto,
  UpdateMeDto,
} from './dto/users.dto';

/** Valida CLABE mexicana (18 dígitos numéricos). Validación estructural. */
export function isValidClabe(clabe: string): boolean {
  return /^\d{18}$/.test(clabe);
}

/**
 * v2.1.9 (S49-R4) — **`Address` se proyecta al `AddressDTO` del contrato (§DTOs).**
 *
 * Tres rutas devolvían la fila cruda (`GET/POST /users/me/addresses`, `PATCH .../:id`), o sea también
 * `userId`, `createdAt` y `updatedAt`. No hay secreto ahí — la dirección es del propio usuario que
 * pregunta — pero la norma «ningún endpoint devuelve una entidad Prisma» sólo vale si es universal:
 * mientras la respuesta SEA la fila, cualquier columna futura (una geocodificación, un flag de
 * verificación, un id de proveedor logístico) viaja al cliente sin que nadie lo decida.
 */
function toAddressDTO(a: {
  id: string;
  line1: string;
  line2: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string;
  isDefault: boolean;
}) {
  return {
    id: a.id,
    line1: a.line1,
    line2: a.line2,
    neighborhood: a.neighborhood,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,
    country: a.country,
    phone: a.phone,
    isDefault: a.isDefault,
  };
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pii: PiiCryptoService,
  ) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { kycProfile: true },
    });
    if (!user) throw BusinessException.notFound();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      locale: user.locale,
      kycStatus: user.kycProfile?.kycStatus ?? 'none',
      status: user.status,
      // v1.1: el front oculta "cambiar contraseña" cuando authProvider=google sin passwordHash.
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl ?? undefined,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const user = await this.prisma.user.update({ where: { id: userId }, data: dto });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      locale: user.locale,
    };
  }

  // ---------------- Addresses (solo MX) ----------------

  async listAddresses(userId: string) {
    const rows = await this.prisma.address.findMany({ where: { userId } });
    return { data: rows.map(toAddressDTO) }; // S49-R4
  }

  private assertMx(country: string) {
    if (country !== 'MX') {
      throw BusinessException.validation('ADDRESS_NOT_MX', 'Only Mexican (MX) addresses are allowed');
    }
  }

  async createAddress(userId: string, dto: AddressDto) {
    this.assertMx(dto.country);
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return toAddressDTO(await this.prisma.address.create({ data: { ...dto, userId } })); // S49-R4
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    if (dto.country) this.assertMx(dto.country);
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw BusinessException.notFound();
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return toAddressDTO(await this.prisma.address.update({ where: { id }, data: dto })); // S49-R4
  }

  async deleteAddress(userId: string, id: string) {
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw BusinessException.notFound();
    await this.prisma.address.delete({ where: { id } });
    return;
  }

  // ---------------- Billing profile (CFDI) ----------------

  async getBillingProfile(userId: string) {
    const bp = await this.prisma.billingProfile.findUnique({ where: { userId } });
    if (!bp) return null;
    // El RFC va cifrado en reposo; en la vista se devuelve ENMASCARADO (nunca en claro).
    const { rfcEnc, ...rest } = bp;
    return { ...rest, rfc: maskRfc(this.pii.decryptOptional(rfcEnc)) };
  }

  async putBillingProfile(userId: string, dto: BillingProfileDto) {
    const { rfc, ...rest } = dto;
    const rfcEnc = this.pii.encrypt(rfc);
    await this.prisma.billingProfile.upsert({
      where: { userId },
      create: { ...rest, rfcEnc, userId },
      update: { ...rest, rfcEnc },
    });
    return this.getBillingProfile(userId);
  }

  // ---------------- KYC ----------------

  async getKyc(userId: string) {
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId } });
    const capPerRequestCents =
      kyc?.capPerRequestCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_REQUEST_CENTS));
    const capPerMonthCents =
      kyc?.capPerMonthCentsOverride ??
      (await this.settings.getNumber(SettingKey.BUYLIST_CAP_PER_MONTH_CENTS));
    const monthUsedCents = await this.monthUsedCents(userId);
    return {
      kycStatus: kyc?.kycStatus ?? 'none',
      // CLABE cifrada en reposo → se devuelve ENMASCARADA (`****1234`), nunca en claro.
      // Contrato GET /users/me/kyc: la clave es `clabeMasked` (el resto del sistema —
      // contrato, admin.service, frontend— usa ese nombre; `clabe` rompía clabeOnFile).
      clabeMasked: maskClabe(this.pii.decryptOptional(kyc?.clabeEnc)),
      // v1.15 (§4.16c): booleano LIMPIO y simétrico a `ineOnFile`. Habilita el atajo del cotizador
      // "usar mi CLABE ****1234" (= omitir `clabe` en POST /buylist/requests, resuelto server-side).
      // Sin PII nueva (la CLABE sigue enmascarada en `clabeMasked`).
      clabeOnFile: Boolean(kyc?.clabeEnc),
      ineOnFile: Boolean(kyc?.ineFrontKey && kyc?.ineBackKey),
      capPerRequestCents,
      capPerMonthCents,
      monthUsedCents,
    };
  }

  /** Suma de solicitudes de buylist del mes en curso (no rechazadas/abandonadas). */
  async monthUsedCents(userId: string): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const agg = await this.prisma.sellRequest.aggregate({
      where: {
        userId,
        createdAt: { gte: start },
        status: { notIn: ['rechazada', 'abandonada'] },
      },
      _sum: { quotedTotalCents: true },
    });
    return agg._sum.quotedTotalCents ?? 0;
  }

  async putKyc(userId: string, dto: UpdateKycDto) {
    if (dto.clabe && !isValidClabe(dto.clabe)) {
      throw BusinessException.validation('CLABE_INVALID', 'CLABE must be 18 digits');
    }
    const data: Record<string, unknown> = {};
    if (dto.clabe) {
      // Cifra la CLABE en reposo y guarda su blind index (para el match a nombre propio).
      data.clabeEnc = this.pii.encrypt(dto.clabe);
      data.clabeHmac = this.pii.clabeBlindIndex(dto.clabe);
    }
    if (dto.ineFrontUploadKey) data.ineFrontKey = dto.ineFrontUploadKey;
    if (dto.ineBackUploadKey) data.ineBackKey = dto.ineBackUploadKey;
    await this.prisma.kycProfile.upsert({
      where: { userId },
      create: { userId, ...data, kycStatus: 'pending' },
      update: { ...data, kycStatus: 'pending' },
    });
    return this.getKyc(userId);
  }
}
