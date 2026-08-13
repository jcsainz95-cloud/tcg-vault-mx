import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
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

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
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
    const data = await this.prisma.address.findMany({ where: { userId } });
    return { data };
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
    return this.prisma.address.create({ data: { ...dto, userId } });
  }

  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    if (dto.country) this.assertMx(dto.country);
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw BusinessException.notFound();
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return this.prisma.address.update({ where: { id }, data: dto });
  }

  async deleteAddress(userId: string, id: string) {
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw BusinessException.notFound();
    await this.prisma.address.delete({ where: { id } });
    return;
  }

  // ---------------- Billing profile (CFDI) ----------------

  async getBillingProfile(userId: string) {
    return this.prisma.billingProfile.findUnique({ where: { userId } });
  }

  async putBillingProfile(userId: string, dto: BillingProfileDto) {
    return this.prisma.billingProfile.upsert({
      where: { userId },
      create: { ...dto, userId },
      update: dto,
    });
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
      clabe: kyc?.clabe ?? undefined,
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
    if (dto.clabe) data.clabe = dto.clabe;
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
