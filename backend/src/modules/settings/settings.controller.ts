import { Body, Controller, Get, Logger, Optional, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { canonicalJson, SettingsService } from './settings.service';
import { ownerOnlyDtoKey, SettingKey } from './settings.constants';
import { isOwnerAccount, OWNER_SELECT } from '../spend-alerts/owner';
import { StaffControlAlertsService } from '../spend-alerts/staff-control.service';
import {
  IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT,
  IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX,
} from './iva-transfer';
import { BusinessException } from '../../common/business.exception';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ¿El valor del cuerpo es el MISMO que el vigente? JSON canónico; `spendAlertsDisabled` es un CONJUNTO (el orden no cuenta: un
 * formulario que lo reordena no está «moviendo» el dial).
 */
function sameSettingValue(dtoKey: string, a: unknown, b: unknown): boolean {
  if (dtoKey === 'spendAlertsDisabled' && Array.isArray(a) && Array.isArray(b)) {
    return canonicalJson([...a].map(String).sort()) === canonicalJson([...b].map(String).sort());
  }
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * M10 — Config (diales) y bitácora global. API_CONTRACT §M10. Solo super_admin.
 *
 * 💰 D2g (§19.29.8): `@Roles(vault_operator, super_admin)` + `@MoneyOut()` de CLASE — los diales mueven topes de dinero; el
 * operador recibe `403 MONEY_OUT_FORBIDDEN` y `MoneyOutGuard` escribe `money_out.blocked` (antes: `403 FORBIDDEN` mudo). Para el
 * operador solo cambia el código del `403`; el súper-admin sigue igual en las seis rutas.
 * 🔒 D2g (§19.30.2 (1), C-21 (a)): los diales del DUEÑO (`OWNER_ONLY_SETTING_KEYS`) solo los mueve el dueño — ver `updateSettings`.
 */
@Controller('admin')
@Roles(Role.vault_operator, Role.super_admin)
@MoneyOut()
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
    // `@Optional()` solo porque los unitarios construyen el controlador a mano con tres argumentos; en DI siempre está
    // (`SettingsModule` importa `SpendAlertsModule`).
    @Optional() private readonly staffControl?: StaffControlAlertsService,
  ) {}

  @Get('settings')
  async getSettings() {
    return this.settings.getAllDto();
  }

  /**
   * 🔒 D2g (§19.30.2 (1), C-21 (a), SDX-Z-2) — **el vigilado no apaga su vigilancia.** ANTES de `settings.update`:
   *  1. la validación por clave de siempre (`422` para cualquiera: un cuerpo inválido no cambia de respuesta por quién lo manda);
   *  2. actor NO dueño (`isOwnerAccount` leído de la BASE, ⛔ nunca del JWT) y alguna clave de `OWNER_ONLY_SETTING_KEYS` con valor
   *     DISTINTO del vigente ⇒ `403 OWNER_ONLY_SETTING {keys}` (DTO, ordenadas), NADA se escribe (tampoco las otras claves del
   *     cuerpo), bitácora `settings.owner_only_denied {keys}` y AG-22 🔴 `owner_setting_denied`;
   *  3. actor no dueño y esas claves IGUALES a lo vigente ⇒ se QUITAN del cuerpo (⛔ un no dueño nunca escribe una de ellas: un
   *     formulario viejo no pisa un cambio reciente del dueño). El resto se escribe como siempre.
   * Sin dueño (nadie cumple `isOwnerAccount`) ⇒ todos reciben el `403` en esas claves (falla cerrado, §19.30.1 (4)).
   */
  @Put('settings')
  async updateSettings(
    @Body() body: Record<string, unknown>,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    this.settings.validatePayload(body ?? {});
    const before = await this.settings.getAllDto();
    // Solo se pregunta «¿es el dueño?» si el cuerpo trae alguna clave del dueño: el resto de diales no cambia de conducta.
    const ownerKeys = Object.keys(body).filter((k) => ownerOnlyDtoKey(k));
    const actor = ownerKeys.length > 0 ? await this.prisma.user.findUnique({ where: { id: userId }, select: OWNER_SELECT }) : null;
    if (ownerKeys.length > 0 && !isOwnerAccount(actor)) {
      const changed = ownerKeys.filter((k) => !sameSettingValue(k, body[k], before[k])).sort();
      if (changed.length > 0) {
        try {
          await this.audit.log({
            actorUserId: userId,
            actorRole: role,
            action: 'settings.owner_only_denied',
            entityType: 'ConfigSetting',
            after: { keys: changed },
          });
        } catch (e) {
          // El rechazo no depende de la bitácora (mismo patrón que `audited-super-admin.guard.ts`).
          this.logger.error(`settings.owner_only_denied: bitácora falló (${e instanceof Error ? e.message : String(e)})`);
        }
        await this.staffControl?.report(userId, 'owner_setting_denied', null, changed);
        throw BusinessException.forbidden('OWNER_ONLY_SETTING', 'Only the owner can change these settings', { keys: changed });
      }
      body = Object.fromEntries(Object.entries(body).filter(([k]) => !ownerKeys.includes(k)));
      if (Object.keys(body).length === 0) return before;
    }
    // v2.1.6 (P48-B1, fase de seguridad) — la bitácora se escribe DENTRO de la transacción que
    // persiste los diales, no después de que `update()` retorne.
    //
    // Antes, una excepción a mitad **saltaba** este `audit.log`: el dial que sí se había persistido
    // no dejaba entrada en la bitácora — en el endpoint que gobierna IVA, comisiones, topes AML y el
    // umbral de INE. Con el `auditWithin`, efecto y bitácora **commitean o revierten juntos**: es
    // imposible que exista uno sin el otro, en cualquier orden de fallo.
    await this.settings.update(body, userId, async (tx, applied, extra) => {
      await this.audit.log(
        {
          actorUserId: userId,
          actorRole: role,
          action: 'settings.update',
          entityType: 'ConfigSetting',
          before,
          after: applied,
        },
        tx,
      );
      // ⭐ v1.63 (§M2-F.4, candado FX-13) — si esta escritura MATERIALIZÓ o CAMBIÓ `fx_rate_mode`
      // (I-FX2: escribir la tasa manual pinnea el modo), deja ADEMÁS la entrada `fx.mode.change`,
      // en esta MISMA transacción. Sin ella, auditar por `action=fx.mode.change` no sería completo:
      // los cambios de modo entrados por esta puerta quedarían escondidos dentro de un
      // `settings.update`, y habría que saber por dónde entró el cambio para encontrarlo.
      if (extra?.fxPin?.materialized) {
        await this.audit.log(
          {
            actorUserId: userId,
            actorRole: role,
            action: 'fx.mode.change',
            entityType: 'ConfigSetting',
            entityId: SettingKey.FX_RATE_MODE,
            before: extra.fxPin.before,
            after: extra.fxPin.after,
          },
          tx,
        );
      }
    });
    return this.settings.getAllDto();
  }

  /**
   * ⭐ `GET /api/v1/admin/settings/iva-transfer` — **la LECTURA del dial** (§M10-IVA.1, fila
   * «Lectura»). `super_admin`. Sin efectos.
   *
   * Devuelve el dial vigente, la **TASA** (que ⛔ no es el dial) y la **posición actual** en la forma
   * `IvaTransferPositionDTO` que el contrato ya define — ⛔ **sin inventar nombres de campo nuevos**.
   *
   * ⚠️ **Lo que este endpoint NO es:** no es `GET /admin/settings/iva-transfer/preview`, que lleva
   * `?ivaTransferPct=&samplePriceCents=`. ✅ **`N-IVA9-1` RESUELTO en `API_CONTRACT` v1.75**: los dos
   * ejes quedan **autorizados**, fuera de §0-Q punto 4 (son rangos numéricos, no dominios de tokens)
   * y **dentro del censo de `C-EQ-1`** como no-enums por ruta. El `/preview` está justo debajo.
   *
   * ⛔ **Criterio 209:** esta ruta es `/admin/*` y el dial **no viaja a ninguna superficie de
   * cliente**, ni a ningún correo.
   */
  @Get('settings/iva-transfer')
  async getIvaTransfer() {
    const pct = await this.settings.getIvaTransferPct();
    // Preview de `pct → pct`: `current` y `proposed` coinciden y el delta es 0 por construcción.
    // Se reutiliza el mismo cómputo en vez de escribir una segunda cuenta para la misma cifra.
    const preview = await this.settings.previewIvaTransfer(pct);
    return {
      ivaTransferPct: preview.current.ivaTransferPct,
      ivaRatePct: preview.ivaRatePct,
      samplePriceCents: preview.samplePriceCents,
      current: preview.current,
    };
  }

  /**
   * ⭐⭐ `GET /api/v1/admin/settings/iva-transfer/preview` — **LO QUE COSTARÍA MOVER EL DIAL, EN
   * PESOS, CALCULADO POR EL SERVIDOR** (§M10-IVA.2 punto 2, criterio **188**). `super_admin`.
   * **READ-ONLY, sin efectos, no cacheable.**
   *
   * `?ivaTransferPct=<0..100>` (**OBLIGATORIO**) `&samplePriceCents=<1..100000000>` (opcional, por
   * defecto `10000`).
   *
   * ### ⛔ `ivaTransferPct` ausente NO es «no filtres»: es `400`
   * La fila 1 de §0-Q («vacío ⇒ no filtra») **no aplica aquí, y por eso se dice**: este eje **no es un
   * filtro, es LA PREGUNTA**. Un preview sin posición propuesta no tiene respuesta que dar, y
   * devolver la vigente sería **contestar otra pregunta**.
   *
   * ### ⭐ `400` aquí y `422` en el `PUT`, para el MISMO valor inválido, es CORRECTO
   * Es doctrina de §0-Q punto 2: *«es query, no cuerpo»*. ⛔ No se «armoniza».
   *
   * ### ⭐⭐ LA COTA SUPERIOR NO ES HIGIENE: SIN ELLA LA RUTA ES UN `500` DESDE LA BARRA DE
   * DIRECCIONES
   * `totalChargedCents` sale de `grossUpTotal`, que **LANZA** por encima de `MAX_CENTS`, y ese
   * `Error` **no lo mapea el filtro global**. Ver `IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX`.
   *
   * ⛔ **Criterio 209:** ruta `/admin/*`. El dial **no viaja a ninguna superficie de cliente**.
   */
  @Get('settings/iva-transfer/preview')
  async previewIvaTransfer(
    @Query('ivaTransferPct') ivaTransferPct?: string,
    @Query('samplePriceCents') samplePriceCents?: string,
  ) {
    const proposedPct = parseRequiredIntQuery(
      'ivaTransferPct',
      ivaTransferPct,
      0,
      100,
      'percentage points of IVA TRANSFERRED to the displayed price',
    );
    // ⭐ OPCIONAL: ausente, vacío o **solo espacios** ⇒ el default. Es la fila 1 de §0-Q aplicada
    // donde sí corresponde — un `?samplePriceCents=` que manda un input vacío no es un error.
    const sample =
      samplePriceCents == null || samplePriceCents.trim() === ''
        ? IVA_TRANSFER_SAMPLE_PRICE_CENTS_DEFAULT
        : parseRequiredIntQuery(
            'samplePriceCents',
            samplePriceCents,
            1,
            IVA_TRANSFER_SAMPLE_PRICE_CENTS_MAX,
            'cents of the sample list price `L`',
          );
    return this.settings.previewIvaTransfer(proposedPct, sample);
  }

  /**
   * ⭐⭐ `PUT /api/v1/admin/settings/iva-transfer` — **LA PUERTA ÚNICA DEL DIAL** (§M10-IVA.2,
   * criterio **213**). `super_admin`, auditado, **transaccional**.
   *
   * `Req: { ivaTransferPct, acknowledgement: { samplePriceCents, previewedNetDeltaCents } }`
   * `Res 200: { ivaTransferPct, preview }`
   *
   * **Por qué endpoint propio y ⛔ no una clave más de `PUT /admin/settings`:** porque el criterio
   * **188** dice *«falla si el dial se puede guardar sin que esa cifra se haya mostrado»*, y **una
   * norma que solo vive en la UI no se puede poner roja desde el servidor**. `iva_transfer_pct`
   * **sigue fuera de `SETTING_DTO_MAP`** ⇒ enviarlo al `PUT` genérico sigue siendo `422` clave
   * desconocida (`IVA-8(b)`, **intacto tras D56**). *La puerta es UNA.*
   *
   * ⚠️ El body entra como `Record<string, unknown>` y se valida **a mano**, igual que
   * `updateSettings`: el `ValidationPipe` global responde `400` y el contrato exige `422`.
   */
  @Put('settings/iva-transfer')
  async updateIvaTransfer(
    @Body() body: Record<string, unknown>,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    return this.settings.setIvaTransferPct(
      { ivaTransferPct: body?.ivaTransferPct, acknowledgement: body?.acknowledgement },
      userId,
      // La bitácora va DENTRO de la transacción que escribe el dial: efecto y registro commitean o
      // revierten juntos (misma doctrina que `PUT /admin/settings`, P48-B1). `settings.update` con
      // `before`/`after` es lo que §M10-IVA.1 exige en su fila «Auditoría».
      async (tx, change) => {
        await this.audit.log(
          {
            actorUserId: userId,
            actorRole: role,
            action: 'settings.update',
            entityType: 'ConfigSetting',
            entityId: SettingKey.IVA_TRANSFER_PCT,
            before: { ivaTransferPct: change.before },
            after: { ivaTransferPct: change.after },
          },
          tx,
        );
      },
    );
  }

  @Get('audit-log')
  async auditLog(
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const where: Record<string, unknown> = {};
    if (actorUserId) where.actorUserId = actorUserId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        select: {
          id: true,
          actorUserId: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, page: p, pageSize: ps, total };
  }
}

/**
 * ⭐ **El parser de los dos ejes enteros de `GET …/iva-transfer/preview`** (§M10-IVA.2).
 *
 * ⛔ **`400`, no `422`** — es QUERY, no cuerpo (§0-Q punto 2, doctrina vigente). Y el `message`
 * **nombra los DOS extremos**: un rechazo que no dice el rango obliga a adivinar, y adivinar en un
 * dial de dinero es cómo se acaba probando valores hasta que uno pasa.
 *
 * ⚠️ **`Number(v)` NO basta y por eso se valida el TEXTO.** `Number(' ')` es `0` y `Number('50.0')`
 * es `50`: los dos colarían una entrada que no es un entero escrito como entero. Se exige
 * `/^-?\d+$/` sobre el texto **antes** de convertir.
 */
function parseRequiredIntQuery(
  field: string,
  raw: string | undefined,
  min: number,
  max: number,
  what: string,
): number {
  const text = (raw ?? '').trim();
  const n = /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw BusinessException.badRequest(
      'VALIDATION_ERROR',
      `${field} must be an integer in [${min}, ${max}] (${what})`,
      { field },
    );
  }
  return n;
}
