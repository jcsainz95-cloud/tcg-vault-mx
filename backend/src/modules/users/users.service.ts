import { Injectable, Logger } from '@nestjs/common';
import { AuthProvider, KycStatus, NameSource, Prisma, Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { maskClabe, maskRfc } from '../../common/crypto/pii-mask';
import { monthCommittedGrossCents } from '../../common/buylist-aml';
import { UploadsService } from '../uploads/uploads.service';
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly pii: PiiCryptoService,
    // ⭐ v1.69 (P-78, BK-4 · §M6-K.4.1): borrar del bucket la imagen de INE **sustituida**, en el
    // mismo flujo que la sustituye. Sin esto, cada re-subida deja PII que ninguna purga alcanza.
    private readonly uploads: UploadsService,
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
    id: string;
    userId: string;
    rfcEnc: string;
    razonSocial: string;
    regimenFiscal: string;
    usoCfdi: string;
    postalCode: string;
    email: string;
  }): BillingProfileDTO {
    // N2 (2026-09-11): un `rfcEnc` que NO descifra, o que descifra a vacío, es una fila que este
    // proceso no puede servir. NO se convierte en `''` en silencio: se lanza (⇒ 500) para que se vea
    // y se repare — pero CON diagnóstico (id, userId y motivo) en el log, porque el 500 al cliente no
    // dice nada. Causa medida el 2026-09-11 en el stack nativo: `PII_ENCRYPTION_KEY` sin definir ⇒
    // clave EFÍMERA por proceso ⇒ una fila escrita por el proceso anterior no descifra en el actual
    // («Unsupported state or unable to authenticate data»). El seed E2E borra estas filas (E2E-1).
    let rfc: string;
    try {
      rfc = this.pii.decrypt(bp.rfcEnc);
    } catch (e) {
      const cause = e instanceof Error ? e.message : String(e);
      const msg =
        `BillingProfile ${bp.id} (userId ${bp.userId}): rfcEnc does not decrypt with this process's PII key ` +
        `(${cause}). Likely PII_ENCRYPTION_KEY differs from the one that encrypted it (ephemeral per-process ` +
        'key in a local harness, or a rotated key) or the row is corrupt. Not serving it.';
      this.logger.error(msg);
      throw new Error(msg);
    }
    const rfcMasked = maskRfc(rfc);
    if (!rfcMasked) {
      const msg = `BillingProfile ${bp.id} (userId ${bp.userId}): rfcEnc decrypts to an empty RFC (corrupt row); refusing to project it`;
      this.logger.error(msg);
      throw new Error(msg);
    }
    return {
      rfcMasked,
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

  /**
   * `GET /users/me/kyc` (contrato §1, §M6-K.5/K.7).
   *
   * ⛔⛔ **v1.69 (P-78) — LOS TRES NÚMEROS DE POLÍTICA SALIERON DE ESTA RESPUESTA.** Decisión (c) del
   * dueño, literal: *«los topes dejan de mostrarse al cliente — pantalla y mensaje de error»*. Se
   * retiran `capPerRequestCents`, `capPerMonthCents` y `monthUsedCents`. ⛔ **No se dejan alias ni se
   * marcan «no expuestos»: se retiran.** Son **política interna**; publicarlos es publicar el manual
   * de cómo quedarse justo por debajo.
   *
   * ⭐ **Y la capacidad no se pierde, cambia de lado:** el front ya no compara, **pregunta**. Con
   * `?quotedTotalCents=N` la respuesta trae **`ineRequiredForTotal: boolean`** — un **veredicto, no
   * un dial**. Eso es lo que conserva §P.2.2 de `PROJECT.md` (pedir el INE **en el mismo paso de la
   * dirección**), que manda sobre el contrato y por tanto no podía perderse.
   * ⛔ El umbral **no se revela en ninguna forma**, ni en `details`. **Residual conocido y aceptado**
   * (§1): un vendedor autenticado puede *acotar* el umbral repitiendo la llamada — estrictamente
   * **menos** de lo que v1.68.1 le entregaba impreso, autenticado y con el rate limit general.
   * ⛔ **No hay booleano equivalente para el tope MENSUAL**: ése rechaza y no se remedia subiendo
   * nada, así que un booleano solo serviría para inferirlo.
   *
   * ⭐ **`rejectionReason` — presente SI Y SOLO SI `kycStatus === 'rejected'`.** Es lo que cierra el
   * ciclo (decisión (b) del dueño): sin él el cliente ve «rechazada» y no sabe qué corregir.
   */
  async getKyc(userId: string, quotedTotalCents?: number) {
    const kyc = await this.prisma.kycProfile.findUnique({ where: { userId } });
    const kycStatus = kyc?.kycStatus ?? 'none';
    // El umbral se lee SOLO si hay algo que comparar: sin `?quotedTotalCents` no se toca `Setting`.
    const ineRequiredForTotal =
      quotedTotalCents === undefined
        ? undefined
        : quotedTotalCents >= (await this.settings.getNumber(SettingKey.INE_THRESHOLD_CENTS));
    return {
      kycStatus,
      // CLABE cifrada en reposo → se devuelve ENMASCARADA (`****1234`), nunca en claro.
      // Contrato GET /users/me/kyc: la clave es `clabeMasked` (el resto del sistema —
      // contrato, admin.service, frontend— usa ese nombre; `clabe` rompía clabeOnFile).
      clabeMasked: maskClabe(this.pii.decryptOptional(kyc?.clabeEnc)),
      // v1.15 (§4.16c): booleano LIMPIO y simétrico a `ineOnFile`. Habilita el atajo del cotizador
      // "usar mi CLABE ****1234" (= omitir `clabe` en POST /buylist/requests, resuelto server-side).
      // Sin PII nueva (la CLABE sigue enmascarada en `clabeMasked`).
      clabeOnFile: Boolean(kyc?.clabeEnc),
      ineOnFile: Boolean(kyc?.ineFrontKey && kyc?.ineBackKey),
      // ⭐ v1.69 (P-78, §M6-K.7): el motivo del rechazo, y SOLO mientras el estado sea `rejected`.
      // ⛔ Nunca `null` residual de un rechazo anterior: la clave **no viaja** en los otros estados.
      // (Una fila `rejected` anterior a M-54 no tiene motivo que enseñar: se omite la clave en vez
      // de fabricar un texto. Es la misma doctrina que `recipientName: null` de M-52.)
      ...(kycStatus === 'rejected' && kyc?.rejectionReason
        ? { rejectionReason: kyc.rejectionReason }
        : {}),
      // ⭐ v1.69 (P-78, §M6-K.5): el VEREDICTO, presente solo si preguntaron por un total.
      ...(ineRequiredForTotal === undefined ? {} : { ineRequiredForTotal }),
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

  /**
   * `PUT /users/me/kyc` (contrato §1, §M6-K.6) — **la vuelta del ciclo**.
   *
   * ### ⭐ El defecto A6, medido y cerrado (`users.service.ts:343-347` de v1.68.1)
   * **Toda** llamada escribía `kycStatus: 'pending'`, también una que solo traía `clabe` ⇒ **un
   * cliente ya verificado que corregía su CLABE se tiraba al suelo su propia verificación de
   * identidad**, que no tiene nada que ver con la CLABE. Norma v1.69, y es la que hace que «volver a
   * subir» signifique algo:
   * - **`kycStatus` pasa a `pending` SI Y SOLO SI la llamada trae al menos una key de INE.** Una
   *   llamada solo con `clabe` **no toca** `kycStatus`, ni `rejectionReason`, ni el sello de
   *   revisión.
   * - Al (re)subir INE: `pending`, **`rejectionReason → null`** y `reviewedAt`/`reviewedBy → null`.
   *   *El motivo de un rechazo anterior no puede sobrevivir a la corrección que lo responde.*
   * - `rejected` **y** `verified` son estados re-subibles (foto vencida). No hay estado terminal ni
   *   límite de reintentos (v1.69).
   *
   * ### ⭐ El objeto HUÉRFANO (§M6-K.4.1, ARCHITECTURE §3.4.d)
   * Sustituir `ineFrontKey` **abandonaba el objeto anterior en el bucket**, donde **ninguna purga lo
   * alcanza**: la retención de D46/BL-42 recorre las keys que están en `KycProfile`, y esa key ya no
   * está en ninguna fila ⇒ **PII sin reloj, para siempre**. Ahora, al sustituir, el objeto viejo se
   * borra en el mismo flujo.
   * - **Se borra DESPUÉS de persistir la nueva key**, nunca antes: si la escritura fallara tras un
   *   borrado, el cliente se quedaría sin INE ninguno.
   * - **Un fallo del borrado NO tumba la petición**: la subida del cliente ya está guardada y él no
   *   puede hacer nada al respecto. Se registra `error` (queda un huérfano, exactamente como antes
   *   de v1.69) en vez de devolverle un `500` por una tarea de limpieza nuestra.
   * - ⛔ **El RECHAZO no borra nada** (la otra mitad, §M6-K.4.1): conservar la imagen rechazada es la
   *   evidencia de **por qué** rechazamos, justo mientras el cliente tiene un rechazo que discutir.
   *   Se borra **cuando llega la sustitución**, que es lo que aquí ocurre.
   */
  /**
   * ⭐⭐ **v1.70 (`C17` / `SEC-PII-3`) — LA ÚNICA RUTINA DE ESCRITURA DE INE, para los DOS caminos.**
   *
   * ### El defecto que cierra (hallazgo de `seguridad`, no del red team)
   * Había **dos** escritores de `ineFrontKey`/`ineBackKey`: éste y el `upsert` del intake
   * (`POST /buylist/requests`). El segundo **pisaba la key vieja sin borrar el objeto** —huérfano
   * invisible para la purga, `BL-42` camino 2— y **su rama `update` no tocaba `kycStatus`** ⇒ un
   * usuario **`verified`** podía cambiar sus imágenes y **conservar la insignia**: la pantalla del
   * revisor mostraría `verified` sobre **un documento que nadie revisó**. Dos invariantes de v1.69
   * (§M6-K.4.1 y A6) rotas en el mismo `upsert`, y el contrato afirmando un cierre más ancho que el
   * código. *La frontera es la API, no la pantalla: que el front oficial no lo haga no es un control.*
   *
   * Devuelve el `data` que hay que fundir en el `upsert` del llamador y **las keys sustituidas**, que
   * el llamador debe borrar **después** de persistir (`purgeSupersededIneObjects`). Se parte en dos
   * porque el intake escribe **dentro de su propio `upsert`** con la CLABE, y un segundo `upsert`
   * aquí dejaría dos escrituras donde el contrato describe una.
   *
   * ⚠️ **Esta función NO valida la key**: eso es `UploadsService.assertOwnedIneKeys` (`C15`), y va
   * **antes**, en los dos caminos. Aquí solo se decide **qué se escribe**.
   */
  async buildIneSubmission(
    userId: string,
    keys: { front?: string | null; back?: string | null },
  ): Promise<{ data: Record<string, unknown>; supersededKeys: string[] }> {
    // ⭐⭐ **C15 VIVE AQUÍ, y aquí es donde tiene que vivir.** Ésta es la ÚNICA rutina que escribe
    // keys de INE, así que validar aquí hace **imposible olvidarlo** en un camino nuevo: quien añada
    // un tercer escritor y no pase por aquí, no escribe. Si la key no salió de un presign de ESTE
    // usuario, o su objeto no existe ⇒ `422 INE_UPLOAD_KEY_INVALID` **antes de tocar la BD**.
    await this.uploads.assertOwnedIneKeys(userId, keys);
    const data: Record<string, unknown> = {};
    // ⚠️ Se lee ANTES de escribir: las keys que van a ser sustituidas solo se conocen aquí.
    const existing = await this.prisma.kycProfile.findUnique({
      where: { userId },
      select: { ineFrontKey: true, ineBackKey: true },
    });
    /** Keys que quedan huérfanas por esta llamada (solo si REALMENTE cambian). */
    const supersededKeys: string[] = [];
    if (keys.front) {
      data.ineFrontKey = keys.front;
      if (existing?.ineFrontKey && existing.ineFrontKey !== keys.front) {
        supersededKeys.push(existing.ineFrontKey);
      }
    }
    if (keys.back) {
      data.ineBackKey = keys.back;
      if (existing?.ineBackKey && existing.ineBackKey !== keys.back) {
        supersededKeys.push(existing.ineBackKey);
      }
    }
    // ⭐ v1.69 (A6): SOLO una subida de INE mueve el estado de la identidad — y ahora **por los dos
    // caminos**. Una llamada sin keys no toca `kycStatus` ni el sello de revisión.
    if (keys.front || keys.back) {
      data.kycStatus = 'pending';
      data.rejectionReason = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    return { data, supersededKeys };
  }

  /**
   * Borra del bucket las imágenes SUSTITUIDAS. Se llama **después** de persistir (si se borrara antes
   * y la escritura fallara, el cliente se queda sin INE ninguno) y **un fallo no tumba la petición**:
   * la subida ya está guardada y él no puede hacer nada al respecto. Se registra `error` — queda un
   * huérfano, exactamente como antes de v1.69, pero **sabiendo que quedó**.
   */
  async purgeSupersededIneObjects(userId: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      try {
        await this.uploads.deleteObject(key);
      } catch (err) {
        this.logger.error(
          `No se pudo borrar la imagen de INE sustituida (queda huérfana en el bucket; user=${userId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  async putKyc(userId: string, dto: UpdateKycDto) {
    if (dto.clabe && !isValidClabe(dto.clabe)) {
      throw BusinessException.validation('CLABE_INVALID', 'CLABE must be 18 digits');
    }
    // ⚠️ La compuerta de `C15` la aplica `buildIneSubmission` (abajo), que es el único escritor de
    // keys: se llama **antes** de persistir la CLABE, así que un `422` no deja escritura a medias.
    const data: Record<string, unknown> = {};
    const ine = await this.buildIneSubmission(userId, {
      front: dto.ineFrontUploadKey,
      back: dto.ineBackUploadKey,
    });
    if (dto.clabe) {
      // Se cifra DESPUÉS de la compuerta: si la key es inválida, no se escribe nada de nada.
      data.clabeEnc = this.pii.encrypt(dto.clabe);
      data.clabeHmac = this.pii.clabeBlindIndex(dto.clabe);
    }

    await this.prisma.kycProfile.upsert({
      where: { userId },
      // En el `create` sin INE el estado se queda en el default del schema (`none` = «nunca subió
      // INE», §M6-K.7): una CLABE no es una identidad y no puede poner nada «en revisión».
      create: { userId, ...data, ...ine.data },
      update: { ...data, ...ine.data },
    });

    await this.purgeSupersededIneObjects(userId, ine.supersededKeys);
    return this.getKyc(userId);
  }
}
