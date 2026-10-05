import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentsService } from './shipments.service';
import { AuditService } from '../audit/audit.service';
import { TrackingDto, UpdateStatusDto } from './dto/shipments.dto';
import { ShipmentPrepService } from './shipment-prep.service';
import { ShipmentAddressService } from './shipment-address.service';
import { ShipmentQuoteService } from './label-quote.service';
import { ShipmentLabelService } from './label-purchase.service';

/**
 * M4 — Retiros / envíos (vault_operator+). API_CONTRACT §M4.
 */
@Controller('admin/shipments')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly audit: AuditService,
    private readonly prep: ShipmentPrepService,
    private readonly address: ShipmentAddressService,
    private readonly quotes: ShipmentQuoteService,
    private readonly labels: ShipmentLabelService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    // v1.21-guest-checkout (§M4): `vault_withdrawal` | `guest_direct_ship`.
    @Query('kind') kind?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    // ⭐ v1.80 (§M4-SHIP.10): búsqueda `q` (gramática de §M3).
    @Query('q') q?: string,
    @CurrentUser() user?: { id: string; role: Role },
  ) {
    return this.shipments.adminList(
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      userId,
      kind,
      q,
      user?.role,
    );
  }

  /**
   * ⭐ v1.80 (§M4-SHIP.11) — el contador DERIVADO de «Pedidos por preparar» (sondeo de 60 s de la pantalla).
   * `manualRefundsPending` solo para `super_admin` (`null` al operador).
   */
  @Header('Cache-Control', 'no-store')
  @Get('picking-list/summary')
  summary(@CurrentUser() user: { id: string; role: Role }) {
    return this.prep.summary(user.role);
  }

  /**
   * «Pedidos a preparar» (API_CONTRACT §M4-PREP, v1.78). **Misma ruta, mismo guard**: lo único que
   * cambió es el DTO proyectado (lista plana de piezas → hoja de trabajo agrupada por pedido).
   *
   * `?date=` se conserva tal cual. `?destination=vault|ship` es nuevo y OPCIONAL: ausente ⇒ ambas
   * cubetas; fuera de dominio ⇒ `400` (§0-Q, lo impone `parseEnumFilter` en el servicio).
   */
  /**
   * ⭐ **`S-M4P-B` (seguridad, BAJA) — `Cache-Control: no-store`.**
   *
   * Esta respuesta transporta, por cada pedido en preparación, el **nombre del cliente y su
   * domicilio COMPLETO** (`shipTo`, 9 campos con la calle). El precedente lo fijó el propio rol
   * seguridad para respuestas **menos** densas que ésta —`admin.controller.ts`, textual: *«ni en el
   * disco del navegador»*— y el contrato ya lo exige para `orders/guest/track`.
   *
   * **Por qué BAJA y no más:** el `Authorization: Bearer` excluye a las cachés **compartidas** (una
   * respuesta con `Authorization` no es cacheable por un intermediario sin `public`), así que el
   * residual es el **disco del navegador del operador** — una terminal de tienda, a menudo
   * compartida por turno. ⛔ No es motivo para omitirlo: *el coste es una cabecera y el beneficio es
   * que la PII de los clientes no sobreviva al turno en un disco que nadie audita.*
   */
  @Header('Cache-Control', 'no-store')
  @Get('picking-list')
  pickingList(@Query('date') date?: string, @Query('destination') destination?: string) {
    return this.shipments.pickingList(date, destination);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    // ⭐💰 v1.81 D2c: el detalle gana `labelOptions` calculado PARA el actor (§19.19.7) y las alertas de guía (§19.20.2).
    return this.shipments.adminGet(id, user, (actor, shipmentId) => this.labels.labelOptionsFor(actor, shipmentId));
  }

  /** ⭐ v1.80 (§M4-SHIP.5) — palomear / marcar faltante (con motivo) / deshacer UNA carta de un envío. */
  @Patch(':id/prep-items/:shipmentItemId')
  markItem(
    @Param('id') id: string,
    @Param('shipmentItemId') shipmentItemId: string,
    @Body() body: unknown,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.prep.markItem(id, shipmentItemId, body, user);
  }

  /** 💰 ⭐ v1.80 (§M4-SHIP.5) — dar por preparado (y reembolsar lo que falta / abrir casos en un retiro). */
  @Post(':id/prepared')
  @HttpCode(200)
  prepare(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.prep.prepare(id, body, user);
  }

  /** ⭐ v1.80 (§M4-SHIP.5) — deshacer «preparado» (🔒 v1.80.5: en un retiro reclama lo que un reembolso total cerró). */
  @Delete(':id/prepared')
  @HttpCode(200)
  unprepare(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.prep.unprepare(id, user);
  }

  /**
   * 💰 ⭐ v1.80.12 (§M4-SHIP.19.20.1) — corregir TODA la dirección del envío (operador+, con Skydropx encendido o
   * apagado). Solo el snapshot del envío; CAS sobre `addressVersion`; bitácora `shipment.address_corrected`.
   */
  @Put(':id/address')
  @HttpCode(200)
  correctAddress(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.address.correct(id, body, user);
  }

  /**
   * 💰 ⭐ v1.81 D2b (§M4-SHIP.19.6 + §19.19.4/.5) — cotizar desde la ventana «Capturar guía» (operador+). Solo inserta la
   * cotización; ⛔ no escribe el envío; ⛔ no pasa por la puerta de compra (solo exige `shipping_provider='skydropx'`).
   */
  @Post(':id/quote')
  @HttpCode(200)
  quote(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.quotes.quote(id, body, user);
  }

  /** ⭐ v1.81 D2b — la cotización vigente (en plazo y de la dirección vigente, §19.20.1) o `404`. */
  @Header('Cache-Control', 'no-store')
  @Get(':id/quote')
  currentQuote(@Param('id') id: string) {
    return this.quotes.current(id);
  }

  /**
   * 💰🔒 ⭐ v1.81 D2c (§M4-SHIP.19.7 con §19.18.3, §19.19.7/.8, §19.20, §19.26–§19.30) — comprar la guía con la tarifa
   * elegida. Operador+ por la ruta; la PUERTA (dial `shipping_label_purchase` + rol con conjunto explícito + env) va en el
   * servicio, antes del reclamo.
   */
  @Post(':id/label')
  @HttpCode(200)
  label(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.labels.purchase(id, body, user);
  }

  @Patch(':id/status')
  async status(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.shipments.updateStatus(id, dto.to);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'shipment.status',
      entityType: 'ShipmentRequest',
      entityId: id,
      after: { to: dto.to },
    });
    return res;
  }

  @Post(':id/tracking')
  async tracking(
    @Param('id') id: string,
    @Body() dto: TrackingDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.shipments.setTracking(
      id,
      dto.carrier,
      dto.trackingNumber,
      dto.shippingCostCents,
      // ⭐ §M10-IVA.8: el IVA acreditable de la factura del carrier, CONGELADO al capturar.
      dto.shippingCostIvaCents,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'shipment.tracking',
      entityType: 'ShipmentRequest',
      entityId: id,
      after: {
        carrier: dto.carrier,
        trackingNumber: dto.trackingNumber,
        shippingCostCents: res.shippingCostCents,
        // La bitácora registra el crédito capturado junto al bruto: son el mismo hecho y la resta
        // del P&L no se puede auditar viendo solo uno de los dos.
        shippingCostIvaCents: res.shippingCostIvaCents,
      },
    });
    return res;
  }
}
