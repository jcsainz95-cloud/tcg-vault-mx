import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { parseAdminListFilters } from '../../common/admin-list-filters';
import { BuylistService } from './buylist.service';
import { AuditService } from '../audit/audit.service';
import {
  ItemDecisionDto,
  OfferCancelDto,
  OfferDto,
  PaySpeiDto,
  RejectedItemsQueryDto,
  RejectRequestDto,
} from './dto/buylist.dto';

/**
 * M5 — Buylist admin. vault_operator hasta verificación; super_admin pago SPEI.
 * API_CONTRACT §M5.
 */
@Controller('admin/buylist')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminBuylistController {
  constructor(
    private readonly buylist: BuylistService,
    private readonly audit: AuditService,
  ) {}

  /**
   * v1.25-buylist-orders-pagination (§M5): paginación server-side + filtros para la pestaña
   * «Cerradas». Params NUEVOS (`q`, `from`, `to`, `minCents`, `maxCents`) TODOS opcionales; omitirlos
   * = comportamiento de HOY. `status` pasa a aceptar CSV (`pagada,rechazada,abandonada`). Validación
   * (paginación/fecha/monto/`q`) → 400 VALIDATION_ERROR vía `parseAdminListFilters`; token de `status`
   * inválido → 400 en el servicio (`details.invalidStatus`). `pageSize` default 20 (máx 100).
   */
  @Get()
  list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('minCents') minCents?: string,
    @Query('maxCents') maxCents?: string,
    // v1.51.8 · **BL-18** (§M5, D12/criterio 129) — `live?` estaba **declarado en el contrato y
    // ausente del código**. Es la contraparte server-side de `isTerminal`: mientras faltaba, la
    // pestaña «Cerradas» tenía que mandar un CSV **enumerando los cuatro terminales**.
    @Query('live') live?: string,
  ) {
    const f = parseAdminListFilters({ page, pageSize, q, from, to, minCents, maxCents });
    return this.buylist.adminList(status, f.page, f.pageSize, userId, {
      q: f.q,
      dateRange: f.dateRange,
      centsRange: f.centsRange,
      // Solo los DOS valores explícitos filtran; cualquier otra cosa (incluido omitirlo) deja el
      // listado EXACTAMENTE como estaba. Mismo criterio y mismo precedente que `guest`/`needsManual`
      // en `GET /admin/orders`: un query param mal escrito **no puede** convertir una cola de
      // trabajo en un 400 — el modo seguro de un filtro ausente es «no filtrar», no «fallar».
      live: live === 'true' ? true : live === 'false' ? false : undefined,
    });
  }

  /**
   * v1.18-buylist-rejects (§M5): pestaña «Rechazadas» — listado paginado TRANSVERSAL de ítems
   * `itemStatus='rechazada'` con seller, carta, motivo y plazos derivados; orden `rejectedAt` desc.
   * Mismo guard de roles que el resto de M5 (vault_operator/super_admin, heredado de la clase).
   * DECLARADO ANTES de `@Get(':id')` para que la ruta literal no la capture el parámetro.
   * Paginación inválida → 400 VALIDATION_ERROR (DTO).
   */
  @Get('rejected-items')
  rejectedItems(@Query() query: RejectedItemsQueryDto) {
    return this.buylist.adminRejectedItems(query.page ?? 1, query.pageSize ?? 20, query.userId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.buylist.adminGet(id);
  }

  /**
   * v1.51 (M-46, D6 · API_CONTRACT §M5 · criterios 115/116/117/144/153) — **la MESA DE DECISIÓN**.
   * Por línea: qué pidió vender, cuánto se cotizó, el precio derivado por la **curva vigente**, la
   * **posición con sus cuatro sumandos** y una **sugerencia que NUNCA bloquea** y que dice qué regla
   * disparó. Roles heredados de la clase (`vault_operator`/`super_admin`) ⇒ `403` fuera de ellos.
   *
   * **`requiresAuthorization` depende del ACTOR** (D24: el tope es del operador, no de la solicitud),
   * por eso el usuario baja al servicio.
   *
   * ⚠️ **NO se audita** (ARCHITECTURE §4.39, tabla de auditoría): *«la mesa decide qué comprar, no
   * cómo nos hemos portado»*. Es una LECTURA; lo que se audita es la **emisión** de la oferta. Sin
   * `@MoneyOut`: no sale dinero, se previsualiza.
   */
  @Get(':id/decision-table')
  decisionTable(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.buylist.adminDecisionTable(id, user);
  }

  /**
   * Reveal on-demand de la CLABE COMPLETA (18 dígitos) para copiarla a la banca al hacer
   * el SPEI. SOLO `super_admin` (@MoneyOut) y AUDITADO en AuditLog (quién/cuándo/qué
   * solicitud). Es el ÚNICO endpoint que devuelve la CLABE en claro; el resto enmascara.
   * Solicitud de contrato al arquitecto (ver docs/BACKEND_NOTES.md).
   */
  @Get(':id/reveal-clabe')
  @Roles(Role.super_admin)
  @MoneyOut()
  async revealClabe(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.revealClabe(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.reveal_clabe',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  /**
   * v1.51 (D1/D2/D13/D24/D26, criterios 143/147/148) — **EMITIR (o PREPARAR) la oferta.**
   *
   * ⚠️ **DOS CÓDIGOS DE ÉXITO DISTINTOS, y la diferencia es la que importa:** dentro del tope del
   * operador ⇒ **`200`** y **sale el correo**; por encima ⇒ **`202`**, `offerState =
   * pending_authorization`, **el correo NO se manda** y la solicitud **sigue `cotizada`**. *Una
   * oferta que espera autorización no existe para el vendedor.* El `202` **es un estado real, no un
   * error**: el operador puede prepararla; lo que no puede es que salga sola.
   *
   * El código se fija con `@Res({ passthrough: true })` porque **depende del resultado**, no de la
   * ruta: `@HttpCode` es estático y aquí mentiría en la mitad de los casos.
   *
   * **NO lleva `@MoneyOut`**: no sale dinero: se COMPROMETE. El SPEI sigue siendo del súper-admin.
   * Auditado `buylist.offer.send` (o `buylist.offer.prepare` cuando queda esperando), más un
   * `buylist.offer.override` **por línea** con quién / derivado / fijado a mano / por qué.
   */
  @Post(':id/offer')
  async offer(
    @Param('id') id: string,
    @Body() dto: OfferDto,
    @CurrentUser() user: { id: string; role: Role },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { response, audit } = await this.buylist.adminOffer(id, user, dto.lines);
    res.status(audit.requiresAuthorization ? HttpStatus.ACCEPTED : HttpStatus.OK);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      // El nombre distingue los dos desenlaces: «se preparó» no es «se envió», y la bitácora tiene
      // que poder contestar cuál fue sin releer montos.
      action: audit.requiresAuthorization ? 'buylist.offer.prepare' : 'buylist.offer.send',
      entityType: 'SellRequest',
      entityId: id,
      after: {
        grossCents: audit.grossCents,
        shippingFeeCents: audit.shippingFeeCents,
        netCents: audit.netCents,
        // El dial vigente AL EMITIR: la pregunta «¿por qué se permitió esta oferta?» es de
        // auditoría, no de cálculo — por eso el piso NO lleva columna congelada.
        minimumOfferNetCents: audit.minimumOfferNetCents,
        operatorCapCents: audit.operatorCapCents,
        requiresAuthorization: audit.requiresAuthorization,
        buyLineCount: audit.buyLineCount,
        skipLineCount: audit.skipLineCount,
      },
    });
    // Un asiento POR LÍNEA con override (§4.39h): sin él, un número puesto a mano sería una cifra
    // huérfana y el criterio 148 no sería verificable.
    for (const o of audit.overrides) {
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'buylist.offer.override',
        entityType: 'SellRequestItem',
        entityId: o.itemId,
        after: {
          derivedPriceCents: o.derivedPriceCents,
          offeredPriceCents: o.offeredPriceCents,
          reason: o.reason,
        },
      });
    }
    return response;
  }

  /**
   * v1.51 (D24, criterios 143/147) — **`super_admin`**: autoriza **LO GUARDADO** y **manda el
   * correo**. No acepta líneas ni montos: aceptar cambios aquí convertiría la autorización en una
   * segunda edición y el «quién preparó / quién autorizó» dejaría de significar nada.
   * La bitácora registra los dos **por separado** (criterio 147).
   */
  @Post(':id/offer/authorize')
  @Roles(Role.super_admin)
  async offerAuthorize(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const { response } = await this.buylist.adminOfferAuthorize(id, user);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.offer.authorize',
      entityType: 'SellRequest',
      entityId: id,
      after: {
        offerGrossCents: response.offerGrossCents,
        offerNetCents: response.offerNetCents,
        offerAcceptDeadlineAt: response.offerAcceptDeadlineAt,
      },
    });
    return response;
  }

  /**
   * v1.51 (criterio 145, D38) — **la ÚNICA vía para corregir una oferta equivocada.** No existe
   * «corregir un número» sobre una oferta que el vendedor ya tiene en su bandeja: se **cancela y se
   * emite otra**.
   *
   * La oferta anterior **sobrevive íntegra en la bitácora** (`before` completo) — que es lo que
   * `PROJECT.md` exige y lo que hace revisable la corrección.
   */
  @Post(':id/offer/cancel')
  async offerCancel(
    @Param('id') id: string,
    @Body() dto: OfferCancelDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const { response, audit } = await this.buylist.adminOfferCancel(id, user, dto.reason);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.offer.cancel',
      entityType: 'SellRequest',
      entityId: id,
      before: audit.before,
      // `wasSent` es el discriminador de los TRES efectos de D38 (reloj, conteo y correo 5): queda
      // en la bitácora para que se pueda auditar cuál de las dos ramas corrió.
      after: { wasSent: audit.wasSent, reason: audit.reason },
    });
    return response;
  }

  @Post(':id/receive')
  async receive(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.receive(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.receive',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  @Post(':id/verify')
  async verify(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.verify(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.verify',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  /**
   * v1.24-buylist-request-reject (§M5, §4.18g): botón «Rechazar solicitud» — cierre EXPLÍCITO de una
   * solicitud a terminal `rechazada`+`closedAt`. Roles heredados de la clase (vault_operator/
   * super_admin); NO es dinero saliente → SIN @MoneyOut. Auditado `action: 'buylist.reject'` (el
   * `reason?` interno, NO PII, va en `after`). Ruta literal `:id/reject` (POST) sin colisión con las
   * demás. Cierra SÓLO si todos los ítems ya están `rechazada`; si no → 422; terminal distinto → 409.
   * Idempotente: ya `rechazada` → 200 sin re-auditar como cambio (`transitioned=false`).
   */
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // `dto.reason` es SOLO material de auditoría (abajo): el servicio no lo persiste ni lo usa.
    const { request, transitioned } = await this.buylist.rejectRequest(id);
    // Idempotencia: no se re-audita como cambio si la solicitud ya estaba `rechazada`.
    if (transitioned) {
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'buylist.reject',
        entityType: 'SellRequest',
        entityId: id,
        // Motivo interno del cierre a nivel solicitud (NO PII); ausente si no se envió.
        after: { reason: dto.reason },
      });
    }
    return request;
  }

  @Patch('items/:itemId/decision')
  async decision(
    @Param('itemId') itemId: string,
    @Body() dto: ItemDecisionDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // v1.18-buylist-rejects: `reason` obligatorio con reject (DTO valida 3–500 → 400); para
    // approve/adjust se ignora (no se persiste ni se audita).
    const res = await this.buylist.itemDecision(
      itemId,
      dto.decision,
      dto.approvedPriceCents,
      dto.reason,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: `buylist.item.${dto.decision}`,
      entityType: 'SellRequestItem',
      entityId: itemId,
      // El motivo del rechazo va al AuditLog en `after` (§M5); no contiene PII (texto del operador).
      after:
        dto.decision === 'reject'
          ? { reason: dto.reason }
          : { approvedPriceCents: dto.approvedPriceCents },
    });
    return res;
  }

  @Post('items/:itemId/convert-to-inventory')
  async convert(
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.convertToInventory(itemId, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.convert_to_inventory',
      entityType: 'SellRequestItem',
      entityId: itemId,
      after: res,
    });
    return res;
  }

  @Post(':id/pay-spei')
  @MoneyOut()
  async paySpei(
    @Param('id') id: string,
    @Body() dto: PaySpeiDto,
    @CurrentUser() user: { id: string; role: Role },
    @Headers('idempotency-key') _idempotencyKey?: string,
  ) {
    const res = await this.buylist.paySpei(id, dto.speiReference, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'sellrequest.pay_spei',
      entityType: 'SellRequest',
      entityId: id,
      after: { speiReference: dto.speiReference },
    });
    return res;
  }
}
