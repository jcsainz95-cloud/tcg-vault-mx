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
  AdminPickupAddressDto,
  ConfirmShipmentDto,
  ConvertToInventoryDto,
  DeclineDto,
  GuideCancellationDoneDto,
  GuideDto,
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
    // v1.51.1 · D31 — `awaitingGuide`: la vista del pendiente NUESTRO (una `aceptada` sin guía no
    // corre reloj y no expira nunca, así que sin esta vista se queda quieta para siempre).
    @Query('awaitingGuide') awaitingGuide?: string,
    // ⚠️ v1.51.20 · **I1** (§M5, v1.51.9) — `offerReissueAlert` era el TERCER parámetro
    // declarado-y-ausente: se aceptaba y **devolvía el superconjunto**, que es peor que ignorarlo
    // con un error — la cola parecía filtrada y no lo estaba. Sin él, la alerta anti-bucle obliga a
    // paginar la cola entera para encontrar las tres filas que importan (lección de **P-5**).
    @Query('offerReissueAlert') offerReissueAlert?: string,
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
      // Mismo parsing tri-estado ratificado (v1.51.9 D) que `live`, `guest` y `needsManual`.
      awaitingGuide:
        awaitingGuide === 'true' ? true : awaitingGuide === 'false' ? false : undefined,
      // Mismo parsing tri-estado. El contrato solo declara `=true`; `=false` llega al servicio y
      // éste lo trata como «sin filtro», igual que `awaitingGuide`.
      offerReissueAlert:
        offerReissueAlert === 'true' ? true : offerReissueAlert === 'false' ? false : undefined,
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

  // ======================= v1.51 · LAS CUATRO COLAS DEL CICLO (§M5) =======================
  // ⚠️⚠️ **TODAS LAS RUTAS LITERALES VAN AQUÍ, ANTES DE `@Get(':id')`, Y ESO NO ES ESTILO.**
  // Nest resuelve **por orden de declaración**: `@Get(':id')` casa con CUALQUIER segmento único, así
  // que una literal de un solo segmento declarada después **es inalcanzable** — el handler de detalle
  // se la come y responde `404 NOT_FOUND` (la solicitud `live-sellers` no existe).
  //
  // **BL-28 (v1.51.20) — esto pasó de verdad y estuvo vivo:** `live-sellers` y
  // `pending-shipment-confirmation` estaban **después** de `@Get(':id')` y devolvían **404** en
  // producción, tumbando los criterios 129/130 y 156 con el frontend ya llamándolas. Las de **dos**
  // segmentos (`offers/…`, `guides/…`) se salvaban por accidente de forma, no por diseño. Peor: dos
  // comentarios **afirmaban** que la declaración iba antes de `@Get(':id')`, y era **falso** — *un
  // comentario que promete una propiedad que el código no tiene es peor que no tener comentario,
  // porque el siguiente lector deja de comprobarla.*
  //
  // ⇒ **Las cuatro se agrupan aquí, juntas, encima del detalle.** Si añades otra cola: **va en este
  // bloque**, no debajo.
  /**
   * v1.51 (D24, criterios 143/147) — **cola de ofertas por autorizar** (`super_admin` la trabaja; la
   * lectura la comparte el back-office).
   *
   * ⚠️ **Estas filas se mueren solas:** la `cotizada` que sostiene la oferta caduca a los 7 días
   * hábiles y el barrido **anula la oferta**, así que autorizar después devuelve `409`. Por eso
   * `caducityAt` viaja en la fila.
   */
  @Get('offers/pending-authorization')
  pendingOfferAuthorization(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const f = parseAdminListFilters({ page, pageSize });
    return this.buylist.adminPendingOfferAuthorization(f.page, f.pageSize);
  }

  /**
   * v1.51 (D12, criterios 129/130) — **«la lista de gente a la que le debemos una respuesta»**:
   * vendedores con solicitudes **vivas**, cuántas, la más antigua y su **teléfono**, para poder
   * llamar sin abrir la ficha. «Viva» = todo lo que **NO** es terminal, **por exclusión**.
   * ⚠️ El teléfono es back-office por rol y **prohibido en toda superficie pública**.
   */
  @Get('live-sellers')
  liveSellers(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const f = parseAdminListFilters({ page, pageSize });
    return this.buylist.adminLiveSellers(f.page, f.pageSize);
  }

  /**
   * v1.51 (criterio 156) — cola **«por confirmar envío»**: el vendedor ya cumplió y el pendiente es
   * NUESTRO. `alert` es derivado; **no expira, no cancela, no mueve nada.**
   *
   * ⚠️ v1.51.20 · **BL-28** — este docblock estaba **suelto**, pegado varias rutas más arriba, y
   * afirmaba *«Ruta literal declarada ANTES de `@Get(':id')`»* cuando la ruta estaba **60 líneas
   * DESPUÉS**: la afirmación era falsa y el endpoint devolvía **404** (lo capturaba `:id`). Ahora el
   * comentario está donde dice estar, y el bloque entero está donde el comentario promete.
   */
  @Get('pending-shipment-confirmation')
  pendingShipmentConfirmation(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('onlyAlerts') onlyAlerts?: string,
  ) {
    const f = parseAdminListFilters({ page, pageSize });
    // Tri-estado ratificado (v1.51.9 D): solo `'true'`/`'false'` filtran; cualquier otra cosa no
    // filtra y NO falla — un query param mal escrito no puede convertir una cola de trabajo en 400.
    return this.buylist.adminPendingShipmentConfirmation(
      f.page,
      f.pageSize,
      onlyAlerts === 'true' ? true : undefined,
    );
  }

  /**
   * v1.51 (D22, criterio 139) — cola **«cancelar guía no usada»**. *Una etiqueta comprada y olvidada
   * es dinero tirado que nadie ve.* **NO desaparece sola:** sale únicamente por
   * `POST :id/guide/cancellation-done`.
   */
  @Get('guides/pending-cancellation')
  pendingGuideCancellation(@Query('page') page = '1', @Query('pageSize') pageSize = '20') {
    const f = parseAdminListFilters({ page, pageSize });
    return this.buylist.adminPendingGuideCancellation(f.page, f.pageSize);
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

  /**
   * v1.51 (D19/D21/D22, criterios 122/123/137) — **capturar la guía.** Congela el plazo de envío la
   * PRIMERA vez; una re-captura corrige el número **sin mover la fecha ya comunicada** (criterio
   * 157). Auditado `buylist.tracking.capture`.
   */
  @Post(':id/guide')
  async guide(
    @Param('id') id: string,
    @Body() dto: GuideDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.adminGuide(id, dto.carrier, dto.trackingNumber);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.tracking.capture',
      entityType: 'SellRequest',
      entityId: id,
      after: {
        carrier: res.shipmentCarrier,
        trackingNumber: res.shipmentTrackingNumber,
        shipDeadlineAt: res.shipDeadlineAt,
      },
    });
    return res;
  }

  /**
   * v1.51 (D20, criterios 114/122/138) — **LO ÚNICO que mueve a `en_transito`.**
   *
   * Ni la compra de la guía ni el «ya lo mandé» del vendedor mueven este estado por sí solos: el
   * primero es papel y el segundo es **su palabra, todavía sin confirmar**.
   * `guideMissing` va a la bitácora **sin bloquear**: si el paquete llegó sin guía capturada, negar
   * la confirmación no devuelve el paquete — pero el caso queda contado (fail-visible).
   */
  @Post(':id/confirm-shipment')
  async confirmShipment(
    @Param('id') id: string,
    @Body() dto: ConfirmShipmentDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const { response, audit } = await this.buylist.adminConfirmShipment(
      id,
      user,
      dto.guideActualCostCents,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.shipment.confirm',
      entityType: 'SellRequest',
      entityId: id,
      after: {
        guideMissing: audit.guideMissing,
        guideActualCostCents: audit.guideActualCostCents ?? null,
      },
    });
    return response;
  }

  /**
   * v1.51.1 (D22) — cierra la tarea y **captura el costo REAL de la etiqueta que murió sin usarse**.
   * Es el único momento en que se conoce: `0` si la paquetería la reembolsó, el importe si no.
   * ⚠️ **No toca `payoutNetCents`**: es reporte, no pago.
   */
  @Post(':id/guide/cancellation-done')
  async guideCancellationDone(
    @Param('id') id: string,
    @Body() dto: GuideCancellationDoneDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.adminGuideCancellationDone(id, user, dto.guideActualCostCents);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.guide.cancellation_done',
      entityType: 'SellRequest',
      entityId: id,
      after: { note: dto.note, guideActualCostCents: dto.guideActualCostCents ?? null },
    });
    return res;
  }

  /**
   * v1.51.3 (D39) — **«declinar ahora»**: cierra hoy una solicitud que no vamos a ofertar, en vez de
   * dejar al vendedor esperando siete días a que un cron diga lo que el operador ya sabe.
   *
   * **Mismo desenlace que la regla 7 del barrido** (`expirada`/`no_offer`, **mismo correo 4**); la
   * única diferencia es `declinedBy`. **No es dinero saliente ⇒ sin `@MoneyOut`.**
   * ⚠️ El `reason` es **INTERNO**: va a la bitácora y **jamás** al correo — el 4 tiene prohibido
   * explicar por qué no ofertamos.
   */
  /**
   * v1.51.4 (**BL-13**, §4.39t) — **corregir la dirección de origen DESPUÉS de la guía.**
   *
   * Existe porque el remedio que quedaba **acusaba al vendedor**: sin esta ruta, un typo NUESTRO en
   * la etiqueta solo se «arreglaba» dejando vencer el plazo de envío, y eso le manda el correo de
   * *«aceptaste y el paquete no salió»*.
   *
   * **No es dinero saliente ⇒ sin `@MoneyOut`.** ⚠️ **Auditado SIN PII**: en `before`/`after` van
   * **solo los `addressId`**, nunca el domicilio — misma norma que la ruta de cliente.
   */
  @Patch(':id/pickup-address')
  async pickupAddress(
    @Param('id') id: string,
    @Body() dto: AdminPickupAddressDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const { auditAddressIds, ...res } = await this.buylist.adminUpdatePickupAddress(id, dto.addressId);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.pickup_address.admin_update',
      entityType: 'SellRequest',
      entityId: id,
      // ⚠️ SOLO los ids. Un domicilio en la bitácora es PII que nadie va a purgar.
      before: { addressId: auditAddressIds.before },
      after: { addressId: auditAddressIds.after, guideReissued: res.guideCancellationPendingAt != null },
    });
    return res;
  }

  @Post(':id/decline')
  async decline(
    @Param('id') id: string,
    @Body() dto: DeclineDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.adminDecline(id, user);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.request.decline',
      entityType: 'SellRequest',
      entityId: id,
      after: { reason: dto.reason },
    });
    return res;
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
    // v1.51.18 (fase 8, §4.39m.3): `locationId` OPCIONAL — se ofrece, no se exige. Body vacío `{}`
    // sigue siendo válido, así que el llamador de hoy no se rompe.
    @Body() dto: ConvertToInventoryDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.convertToInventory(itemId, user.id, dto?.locationId);
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
