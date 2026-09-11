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
  recipientName: string | null;
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
    // v1.67 (M-52): `null` SOLO en filas anteriores a la migración (contrato §11 `AddressDTO`).
    recipientName: a.recipientName,
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
   * El `data` se construye a mano: nunca `data: dto` (un campo nuevo del DTO no debe escribirse solo).
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

  async listAddresses(userId: string) {
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
    return toAddressDTO(
      await this.prisma.address.create({ data: { ...dto, recipientName, userId } }),
    ); // S49-R4
  }

  /**
   * v1.67: `recipientName?` con la misma validación si viene; ⛔ **no vaciable** (ni `null` ni `""`):
   * una dirección que ya tiene destinatario no vuelve a no tenerlo. Es el remedio de
   * `422 RECIPIENT_NAME_REQUIRED` (`PATCH { recipientName }` y reintentar el retiro).
   */
  async updateAddress(userId: string, id: string, dto: UpdateAddressDto) {
    const data: Prisma.AddressUpdateInput = { ...dto };
    if (dto.recipientName !== undefined) {
      data.recipientName = assertPersonName(dto.recipientName, 'recipientName');
    }
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
