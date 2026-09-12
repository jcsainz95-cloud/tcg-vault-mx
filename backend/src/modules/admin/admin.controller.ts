import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Ip,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { ActorThrottlerGuard } from './actor-throttler.guard';
import { AuditService } from '../audit/audit.service';
import { UserAuditScope } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';

export class UpdateKycDto {
  @IsIn(['none', 'pending', 'verified', 'rejected']) kycStatus!: string;
  @IsOptional() @IsInt() @Min(0) capPerRequestCents?: number;
  @IsOptional() @IsInt() @Min(0) capPerMonthCents?: number;
  /**
   * ⭐ v1.69 (P-78, §M6-K.4) — el motivo que **le llega al cliente** (`GET /users/me/kyc`).
   *
   * Aquí solo se declara la ESTRUCTURA (`@IsString`), para sobrevivir al `whitelist` del
   * `ValidationPipe` global. **La regla vive en `AdminService.updateUserKyc`** y es semántica, no
   * estructural: obligatorio **si y solo si** `kycStatus === 'rejected'`, 3–500 **tras `trim()`**.
   * El pipe global solo sabe dar `400`; el contrato exige `422` (`KYC_REJECTION_REASON_REQUIRED` /
   * `VALIDATION_ERROR`) — mismo patrón que `CreateAdminUserDto`.
   * ⚠️ Sin `@IsNotEmpty()`: `''` tiene que llegar al servicio para que la respuesta sea
   * `KYC_REJECTION_REASON_REQUIRED` (motivo vacío = motivo ausente) y no un `400` estructural.
   */
  @IsOptional() @IsString() rejectionReason?: string;
}

/**
 * `PATCH /admin/users/:id/status` — **la lista `['active','blocked']` es una DECISIÓN DE PRODUCTO,
 * no un espejo del schema. NO la derives de `UserStatus`.** (T-3, techlead — v2.1.9.)
 *
 * `UserStatus` tiene TRES valores: `active | blocked | deleted`. Aquí se aceptan dos **a propósito**:
 * `deleted` lo fija **exclusivamente** `DELETE /admin/users/:id` (`AdminService.deleteUser`), que hace
 * mucho más que cambiar una columna — **anonimiza la PII**, pone `passwordHash: null`, **incrementa
 * `tokenVersion`** (revoca los JWT vivos) y borra direcciones/KYC.
 *
 * El riesgo concreto que este comentario existe para evitar: el candado de residuo de
 * `enum-values-parity.spec.ts` marca las listas de enums escritas a mano como infractoras. El día que
 * alguien «termine» esa derivación y cambie esto por `@IsIn(USER_STATUS_VALUES)`, `PATCH /status`
 * podría poner `deleted` **saltándose todo `deleteUser`**: quedaría un usuario «eliminado» con su PII
 * intacta y su sesión viva. Por eso `enum-values.ts` excluye `UserStatus` explícitamente, y por eso
 * el porqué vive AQUÍ, en el call-site, y no sólo allá donde nadie lo va a leer.
 *
 * Fijado por test: `test/admin.user-status-enum.spec.ts` (rechaza `deleted` en este DTO).
 */
export class UpdateStatusDto {
  @IsIn(['active', 'blocked']) status!: 'active' | 'blocked';
}

/**
 * Alta de usuario por admin (E1, v1.7-admin-users). API_CONTRACT §M6.
 * Solo se declara la ESTRUCTURA (@IsString) para sobrevivir al whitelist del ValidationPipe;
 * la validación SEMÁNTICA (email/rol/locale/longitud de password) vive en `AdminService.createUser`
 * y lanza `422 VALIDATION_ERROR` (el contrato exige 422; el pipe global solo da 400 estructural).
 */
class CreateAdminUserDto {
  @IsString() email!: string;
  @IsString() name!: string;
  @IsString() role!: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() locale?: string;
}

/** M6 Usuarios: lista/ficha para vault_operator (limitado) + super_admin. */
@Controller('admin/users')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminUsersController {
  /** v1.69 (P-78): deja rastro del `AUDIT_WRITE_FAILED` en los logs del servidor — el que se come
   * el 500 tiene que poder saber POR QUÉ no escribió la bitácora. ⛔ Nunca URLs ni keys. */
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.admin.listUsers(
      q,
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    );
  }

  /**
   * Alta de usuario por rol (E1, v1.7-admin-users). super_admin-only, auditado `user.create`,
   * NO money-out. API_CONTRACT §M6. La contraseña (autogen o provista) NUNCA entra al AuditLog.
   */
  @Post()
  @HttpCode(201)
  @Roles(Role.super_admin)
  async createUser(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.admin.createUser(dto);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.create',
      entityType: 'User',
      entityId: res.user.id,
      // SEGURIDAD: NUNCA la contraseña (temp o provista). Solo metadatos no sensibles.
      after: {
        role: res.user.role,
        emailVerified: res.user.emailVerified,
        authProvider: res.user.authProvider,
        mustChangePassword: res.mustChangePassword,
      },
    });
    return res;
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser('role') role: Role) {
    // SEC-A4: la proyección de PII depende del rol (operador recibe ficha reducida).
    return this.admin.getUser(id, role);
  }

  /**
   * Actividad / auditoría por usuario (F1, v1.7-admin-users). API_CONTRACT §M6.
   * Roles: super_admin (completo, con `ip`) y vault_operator (reducido, sin `ip`) — cubierto por
   * el guard de clase. `scope` default `target`. NUNCA expone before/after. 404 si no existe.
   */
  @Get(':id/audit')
  userAudit(
    @Param('id') id: string,
    @CurrentUser('role') role: Role,
    @Query('scope') scope = 'target',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const normalizedScope: UserAuditScope = (['target', 'actor', 'both'] as const).includes(
      scope as UserAuditScope,
    )
      ? (scope as UserAuditScope)
      : 'target';
    return this.audit.listForUser({
      userId: id,
      scope: normalizedScope,
      role,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  @Patch(':id/kyc')
  @Roles(Role.super_admin)
  async updateKyc(
    @Param('id') id: string,
    @Body() dto: UpdateKycDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.admin.updateUserKyc(
      id,
      dto.kycStatus,
      dto.capPerRequestCents,
      dto.capPerMonthCents,
      user.id,
      dto.rejectionReason,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.kyc.update',
      entityType: 'User',
      entityId: id,
      // ⭐ v1.69 (P-78, §M6-K.4): **el motivo va en el `after`**, y ya NO se vuelca el DTO crudo.
      // El motivo lo escribe un admin sobre un documento: es la DECISIÓN DE NEGOCIO, no PII del
      // cliente — precedente idéntico en `buylist.item.reject`, que mete `reason` en su `after`.
      // Se toma de `res` (la fila persistida) y no de `dto`: así la bitácora guarda el valor
      // **normalizado** (`trim()`) que el cliente va a leer, no el que llegó por el cable. Los
      // topes se conservan cuando el admin los tocó: son una decisión comercial auditada (§M6).
      after: {
        kycStatus: dto.kycStatus,
        ...(dto.capPerRequestCents !== undefined
          ? { capPerRequestCents: dto.capPerRequestCents }
          : {}),
        ...(dto.capPerMonthCents !== undefined ? { capPerMonthCents: dto.capPerMonthCents } : {}),
        ...(res.rejectionReason ? { rejectionReason: res.rejectionReason } : {}),
      },
    });
    return res;
  }

  /**
   * ⭐⭐ **v1.69 (P-78, BK-1) — `GET /admin/users/:id/kyc/ine-links`. `super_admin` ÚNICAMENTE.**
   * API_CONTRACT §M6-K.2 · ARCHITECTURE §3.4.c/§4.49.
   *
   * Dos enlaces prefirmados de **vida corta** (frente y reverso del INE), **auditados con fallo
   * cerrado**. ⛔ `vault_operator` ⇒ `403`: la decisión (a) del dueño es literal —*«las imágenes solo
   * yo las veo»*— y **el candado se verifica LLAMANDO con un token de operador**, no leyendo este
   * decorador (candado K-1).
   *
   * **`@Throttle` 10/min** y no el global de 300: 10 llamadas por minuto es un ritmo **humano** de
   * revisión. No es solo anti-abuso — junto con la bitácora es el **control de volumen**: un volcado
   * masivo de identidades deja una fila por acto, es ruidoso y es consultable. *No impedimos que el
   * dueño mire a sus clientes; hacemos que mirar deje huella.*
   * ⭐ **Y el tope cuelga del ACTOR, no de la IP** (`ActorThrottlerGuard`, hallazgo de `seguridad`):
   * la amenaza es **una sesión de `super_admin` abusada**, que cambia de IP cuando quiere — y el eje
   * de IP es justo el que `P-RL-1` (ALTA, abierto) esquiva falsificando `X-Forwarded-For`.
   *
   * **`Cache-Control: no-store`** (hallazgo de `seguridad`): esta respuesta transporta **dos
   * credenciales portadoras** —quien tenga las URLs tiene las imágenes, sin sesión—, así que no puede
   * quedarse en una caché intermedia, en un proxy corporativo ni en el disco del navegador. El
   * contrato ya exige `no-store` para `orders/guest/track`, que transporta **menos** que esto.
   *
   * ⛔ **SIN `@MoneyOut()`**, y es deliberado: aquí no sale dinero. Colgarlo del guard de dinero
   * sería tomar prestada una autoridad que no le toca y **ensuciar la señal** que ese guard existe
   * para marcar.
   *
   * ### ⛔⛔ FALLO CERRADO — el orden de estas cuatro líneas ES la norma (§M6-K.2.4)
   * `firmar → await audit.log → responder`. Firmar **no es el acto auditable** (es local, no toca
   * R2, no deja huella), así que auditar antes registraría miradas que quizá no ocurran. **Lo que
   * hace cerrado el fallo es que el `await` está en el camino de la respuesta:** si la fila no se
   * escribe, `res` **nunca se devuelve** — y una URL prefirmada que nadie recibió no es una fuga.
   *
   * **El `try/catch` de aquí NO traga, y por eso está permitido.** §M6-K.2.4 prohíbe el `try/catch`
   * que se come el error, el `void` y el `.catch(() => {})`. Éste **convierte** el fallo en el
   * código estable que el contrato exige (`500 AUDIT_WRITE_FAILED`) y **vuelve a lanzar**: el 200 es
   * inalcanzable si la bitácora falló. *Auditoría «best effort» en una superficie de PII es
   * auditoría opcional, y una auditoría opcional se apaga sola el día que la BD va lenta.*
   * ⚠️ Un test que solo comprueba que la fila se escribe **no distingue** «falla cerrado» de «falla
   * abierto y nadie lo vio»: el candado K-3 fuerza el fallo de `auditLog.create` y exige `500` **y**
   * un cuerpo **sin ninguna `url`**.
   */
  @Get(':id/kyc/ine-links')
  @Roles(Role.super_admin)
  @UseGuards(ActorThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async ineLinks(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; role: Role },
    @Ip() ip: string,
  ) {
    const { links, ttl } = await this.admin.ineLinksUnaudited(id);
    try {
      await this.audit.log({
        actorUserId: user.id,
        // Redundante a propósito: si mañana el rol de esta persona cambia, la fila vieja sigue
        // diciendo CON QUÉ AUTORIDAD se miró.
        actorRole: user.role,
        action: 'user.kyc.reveal_ine',
        // ⚠️ `'User'` y NO `'KycProfile'`: así la fila aparece en
        // `GET /admin/users/:id/audit?scope=target`, que es LA pantalla donde alguien va a preguntar
        // «¿quién ha mirado la identidad de esta persona?».
        entityType: 'User',
        entityId: id,
        ip,
        // ⛔ Ni keys, ni URLs firmadas, ni bucket: una URL prefirmada es una CREDENCIAL PORTADORA, y
        // guardarla en una fila de BD es guardar la llave junto a la puerta. Solo QUÉ documentos se
        // emitieron y CON QUÉ VIDA.
        // ⭐ v1.70 (C10(c)): `expiresInSeconds` es el TTL **EFECTIVO** (el que rigió tras el clamp),
        // tomado de la MISMA resolución con la que se firmaron las URLs — nunca la constante 120.
        // Y cuando hubo recorte, la fila lo dice: `ttlClamped`/`ttlRequested` solo viajan entonces
        // (sin recorte la fila no engorda). *Un log rota; una fila no.*
        after: {
          documents: ['front', 'back'],
          expiresInSeconds: ttl.seconds,
          ...(ttl.clamped ? { ttlClamped: true, ttlRequested: ttl.requested } : {}),
        },
      });
    } catch (err) {
      this.logger.error(
        `AUDIT_WRITE_FAILED on user.kyc.reveal_ine (actor=${user.id}, target=${id}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw BusinessException.internal(
        'AUDIT_WRITE_FAILED',
        'Could not record the INE access in the audit log; the links were discarded',
      );
    }
    return links;
  }

  @Patch(':id/status')
  @Roles(Role.super_admin)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.admin.updateUserStatus(id, dto.status);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.status.update',
      entityType: 'User',
      entityId: id,
      after: { status: dto.status },
    });
    return res;
  }

  /**
   * Reset de contraseña por admin (M6, super_admin) — SIN correo. API_CONTRACT §M6.
   * La contraseña temporal se devuelve UNA vez y NUNCA se registra en el AuditLog (solo el
   * hecho: quién reseteó a quién y cuándo). No es dinero saliente.
   */
  @Post(':id/reset-password')
  @HttpCode(200)
  @Roles(Role.super_admin)
  async resetPassword(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.admin.resetPassword(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.reset_password',
      entityType: 'User',
      entityId: id,
      // SEGURIDAD: NUNCA se guarda la contraseña temporal en el before/after.
    });
    return res;
  }

  /**
   * Borrado híbrido hard/soft (M6, super_admin). API_CONTRACT §M6. Auditado con `mode`
   * (sin volcar PII). 409 CANNOT_DELETE_SELF.
   */
  @Delete(':id')
  @Roles(Role.super_admin)
  async deleteUser(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.admin.deleteUser(id, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      after: { mode: res.mode },
    });
    return res;
  }
}

/** M7 Finanzas: solo super_admin. */
@Controller('admin/finance')
@Roles(Role.super_admin)
export class AdminFinanceController {
  constructor(private readonly admin: AdminService) {}

  @Get('pnl')
  pnl(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.pnl(from, to);
  }

  @Get('inventory-value')
  inventoryValue() {
    return this.admin.inventoryValue();
  }

  @Get('custody-value')
  custodyValue() {
    return this.admin.custodyValue();
  }

  @Get('iva')
  iva(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.ivaReport(from, to);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('report') report = 'pnl',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.admin.exportCsv(report, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="${report}.csv"`);
    res.send(csv);
  }
}

/** M9 Reportes: solo super_admin. */
@Controller('admin/reports')
@Roles(Role.super_admin)
export class AdminReportsController {
  constructor(private readonly admin: AdminService) {}

  @Get('launch-metrics')
  launchMetrics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.launchMetrics(from, to);
  }

  /**
   * v2.0 (P-48, §4.36.7c / PROJECT §N.8, criterio 95) — INSTRUMENTACIÓN de la curva: agrega las
   * operaciones CONSUMADAS por eje × `MarketBracket` (escala FIJA, independiente de la curva). Es lo
   * que evita que la calibración vuelva a ser una corazonada. v2.0 RECOLECTA; NO CALIBRA (§N.10).
   */
  @Get('pricing-brackets')
  pricingBrackets(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('axis') axis?: string,
  ) {
    if (axis !== undefined && axis !== 'sale' && axis !== 'buy') {
      throw BusinessException.validation('VALIDATION_ERROR', `invalid axis '${axis}'`, {
        field: 'axis',
        allowed: ['sale', 'buy'],
      });
    }
    return this.admin.pricingBrackets(from, to, axis);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('report') report = 'pnl',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.admin.exportCsv(report, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="${report}.csv"`);
    res.send(csv);
  }
}

/** Dashboard (~8 tarjetas): vault_operator+ (dinero solo super_admin). */
@Controller('admin/dashboard')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminDashboardController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  dashboard(
    @CurrentUser('role') role: Role,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.dashboard(role, from, to);
  }
}
