import { Injectable } from '@nestjs/common';
import { AuthProvider, KycStatus, NameSource, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe, maskRfc } from '../../common/crypto/pii-mask';
import { monthCommittedGrossCents } from '../../common/buylist-aml';
import {
  AddressDto,
  BillingProfileDto,
  UpdateAddressDto,
  UpdateKycDto,
  UpdateMeDto,
} from './dto/users.dto';
import { assertPersonName } from './person-name';
import { AddressDTO, toAddressDTO } from './address-dto';

/** `BillingProfileDTO` del contrato §11 (v1.67.1): seis campos, `rfcMasked` y nada más. */
export interface BillingProfileDTO {
  rfcMasked: string;
  razonSocial: string;
  regimenFiscal: string;
  usoCfdi: string;
  postalCode: string;
  email: string;
}

/** Valida CLABE mexicana (18 dígitos numéricos). Validación estructural. */
export function isValidClabe(clabe: string): boolean {
  return /^\d{18}$/.test(clabe);
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pii: PiiCryptoService,
  ) {}

  /**
   * v1.67 (contrato §1 `GET /users/me`) — la ÚNICA proyección del perfil propio; `GET` y `PATCH`
   * devuelven exactamente esta forma (D-CTA-2: el PATCH respondía 6 campos y el front necesitaba
   * `nameSource`/`hasPassword` de vuelta sin segunda llamada).
   *
   * - `hasPassword = passwordHash != null`. ⛔ Retira la heurística de v1.1 («ocultar "cambiar
   *   contraseña" cuando `authProvider=google`»): es falsa tras un reset admin o un `forgot-password`
   *   sobre una cuenta Google, y falsa al revés para una cuenta `local` enlazada a Google. Es lo único
   *   que decide la sección de contraseña del perfil.
   * - `nameSource`: `user` | `google` | `derived` (§4.47.5). Con `derived` el front pinta «Revisa tu
   *   nombre»; el dato se sigue mostrando.
   * - `mustChangePassword`: banner persistente de la pantalla de cambio. `GET /users/me` está en la
   *   allowlist del `PasswordChangeRequiredGuard`; el `PATCH` no.
   * El hash NUNCA sale: se reduce a un booleano aquí mismo.
   */
  private toMeDTO(user: {
    id: string;
    email: string;
    name: string;
    nameSource: NameSource;
    phone: string | null;
    role: Role;
    locale: string;
    status: UserStatus;
    authProvider: AuthProvider;
    emailVerified: boolean;
    avatarUrl: string | null;
    passwordHash: string | null;
    mustChangePassword: boolean;
    kycProfile: { kycStatus: KycStatus } | null;
  }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      nameSource: user.nameSource,
      phone: user.phone,
      role: user.role,
      locale: user.locale,
      kycStatus: user.kycProfile?.kycStatus ?? 'none',
      status: user.status,
      authProvider: user.authProvider,
      emailVerified: user.emailVerified,
      avatarUrl: user.avatarUrl ?? undefined,
      hasPassword: user.passwordHash != null,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { kycProfile: true },
    });
    if (!user) throw BusinessException.notFound();
    return this.toMeDTO(user);
  }

  /**
   * v1.67 (contrato §1 `PATCH /users/me`): `name` editable por el propio usuario, cualquier rol.
   * Trim + 1..120 (`assertPersonName`, 400 `VALIDATION_ERROR` `details.field='name'`) y, SIEMPRE
   * que venga `name`, `nameSource='user'` server-side — es la cura del nombre fabricado (P-73-A).
   * El `data` se construye a mano: nunca `data: dto` ni `{ ...dto }` (un campo nuevo del DTO no debe
   * escribirse solo). Es la norma de TODO este servicio (`createAddress`/`updateAddress` la cumplen
   * igual, campo a campo); `test/users.me-and-addresses.spec.ts` la exige con un campo intruso.
   */
  async updateMe(userId: string, dto: UpdateMeDto) {
    const data: Prisma.UserUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = assertPersonName(dto.name, 'name');
      data.nameSource = NameSource.user;
    }
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.locale !== undefined) data.locale = dto.locale;
    const user = await this.prisma.user.update({
      where: { id: userId },
      data,
      include: { kycProfile: true },
    });
    return this.toMeDTO(user);
  }

  // ---------------- Addresses (solo MX) ----------------

  async listAddresses(userId: string): Promise<{ data: AddressDTO[] }> {
    const rows = await this.prisma.address.findMany({ where: { userId } });
    return { data: rows.map(toAddressDTO) }; // S49-R4
  }

  private assertMx(country: string) {
    if (country !== 'MX') {
      throw BusinessException.validation('ADDRESS_NOT_MX', 'Only Mexican (MX) addresses are allowed');
    }
  }

  /**
   * v1.67 (M-52, contrato §1 «Direcciones»): `recipientName` OBLIGATORIO al crear (trim, 1..120;
   * 400 `VALIDATION_ERROR` `details.field='recipientName'`). ⛔ El servidor NO lo deriva de
   * `User.name` (puede ser fabricado, y «cómo te llamas» ≠ «a nombre de quién va el paquete»); el
   * pre-relleno es cosa del front y solo con `nameSource !== 'derived'` (ARCHITECTURE §4.47.4).
   */
  async createAddress(userId: string, dto: AddressDto) {
    const recipientName = assertPersonName(dto.recipientName, 'recipientName');
    this.assertMx(dto.country);
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    // Lista blanca explícita (misma norma que `updateMe`): un campo nuevo del DTO no se escribe solo.
    const data: Prisma.AddressUncheckedCreateInput = {
      userId,
      recipientName,
      line1: dto.line1,
      line2: dto.line2,
      neighborhood: dto.neighborhood,
      city: dto.city,
      state: dto.state,
      postalCode: dto.postalCode,
      country: dto.country,
      phone: dto.phone,
      isDefault: dto.isDefault,
    };
    return toAddressDTO(await this.prisma.address.create({ data })); // S49-R4
  }

  /**
   * v1.67: `recipientName?` con la misma validación si viene; ⛔ **no vaciable** (ni `null` ni `""`):
   * una dirección que ya tiene destinatario no vuelve a no tenerlo. Es el remedio de
   * `422 RECIPIENT_NAME_REQUIRED` (`PATCH { recipientName }` y reintentar el retiro).
   */
  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    // Lista blanca explícita, campo a campo y SOLO los presentes (un PATCH no debe escribir `undefined`
    // sobre lo que no vino; y un campo nuevo del DTO no se escribe solo — misma norma que `updateMe`).
    const data: Prisma.AddressUpdateInput = {};
    if (dto.recipientName !== undefined) {
      data.recipientName = assertPersonName(dto.recipientName, 'recipientName');
    }
    if (dto.line1 !== undefined) data.line1 = dto.line1;
    if (dto.line2 !== undefined) data.line2 = dto.line2;
    if (dto.neighborhood !== undefined) data.neighborhood = dto.neighborhood;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.postalCode !== undefined) data.postalCode = dto.postalCode;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.country) this.assertMx(dto.country);
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw BusinessException.notFound();
    if (dto.isDefault) {
      await this.prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return toAddressDTO(await this.prisma.address.update({ where: { id }, data })); // S49-R4
  }

  async deleteAddress(userId: string, id: string) {
    const existing = await this.prisma.address.findUnique({ where: { id } });
    if (!existing || existing.userId !== userId) throw BusinessException.notFound();
    await this.prisma.address.delete({ where: { id } });
    return;
  }

  // ---------------- Billing profile (CFDI) ----------------

  /**
   * v1.67.1 (contrato §1 «Perfil de facturación», §11 `BillingProfileDTO`; ARCHITECTURE §4.47.10;
   * D-CTA-7) — **la ÚNICA proyección del perfil de facturación del cliente**: exactamente seis
   * campos `{ rfcMasked, razonSocial, regimenFiscal, usoCfdi, postalCode, email }`.
   *  - `rfcMasked` = 3 primeros caracteres + un `*` por carácter restante (`maskRfc`). El RFC va
   *    cifrado en reposo; **nunca** sale en claro ni sale `rfcEnc`.
   *  - SIN `id`/`userId`/`createdAt`/`updatedAt`: el recurso es singular por usuario y ninguna ruta
   *    acepta su id. (`AdminBillingProfileDTO` de M6 sí los lleva: son dos DTOs a propósito.)
   */
  private toBillingProfileDTO(bp: {
    rfcEnc: string;
    razonSocial: string;
    regimenFiscal: string;
    usoCfdi: string;
    postalCode: string;
    email: string;
  }): BillingProfileDTO {
    return {
      rfcMasked: maskRfc(this.pii.decrypt(bp.rfcEnc)) ?? '',
      razonSocial: bp.razonSocial,
      regimenFiscal: bp.regimenFiscal,
      usoCfdi: bp.usoCfdi,
      postalCode: bp.postalCode,
      email: bp.email,
    };
  }

  /** `GET /users/me/billing-profile`: **sin perfil guardado ⇒ `404 NOT_FOUND`** (nunca `200 null`). */
  async getBillingProfile(userId: string): Promise<BillingProfileDTO> {
    const bp = await this.prisma.billingProfile.findUnique({ where: { userId } });
    if (!bp) throw BusinessException.notFound();
    return this.toBillingProfileDTO(bp);
  }

  /**
   * `PUT /users/me/billing-profile`: UPSERT que reemplaza el perfil entero (los seis campos viajan
   * siempre) y responde `200` con **la misma forma que el GET** desde la fila que devuelve el upsert
   * (sin segunda consulta). El `data` se construye a mano (norma del servicio: nunca `{ ...dto }`).
   */
  async putBillingProfile(userId: string, dto: BillingProfileDto): Promise<BillingProfileDTO> {
    const fields = {
      rfcEnc: this.pii.encrypt(dto.rfc),
      razonSocial: dto.razonSocial,
      regimenFiscal: dto.regimenFiscal,
      usoCfdi: dto.usoCfdi,
      postalCode: dto.postalCode,
      email: dto.email,
    };
    const bp = await this.prisma.billingProfile.upsert({
      where: { userId },
      create: { ...fields, userId },
      update: fields,
    });
    return this.toBillingProfileDTO(bp);
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

  /**
   * Acumulado mensual de COMPROMISO (brutos) del vendedor — la base del tope AML por mes.
   *
   * v1.51 (M-46, §4.39c **SITIO 2**): este cuerpo era **un duplicado literal** de
   * `BuylistService.monthUsedCentsTx` (sitio 3), con su propio `notIn ['rechazada','abandonada']`.
   * Los dos **colapsan en uno solo** en `common/buylist-aml.ts`; la variante transaccional no es otra
   * función, es **la misma con otro cliente**. Ahí están documentados los dos cambios de conducta:
   * `expirada` deja de quemar cuota, y el monto pasa a ser `offerGrossCents ?? quotedTotalCents`.
   */
  async monthUsedCents(userId: string): Promise<number> {
    return monthCommittedGrossCents(this.prisma, userId);
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
