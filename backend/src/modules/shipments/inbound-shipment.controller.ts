/**
 * inbound-shipment.controller.ts — 💰 rev BSD-1, paso B-2: las DOS rutas nuevas de la guía de entrada del buylist
 * (API_CONTRACT §BSD.4.1 y §BSD.4.4). Viven en `shipments/` (el motor de la guía) con el prefijo de su recurso; Nest suma
 * sus rutas a las de `admin/buylist` y `buylist` sin pisarlas (segmentos distintos: `:id/inbound-shipment`,
 * `requests/:id/label.pdf`).
 *
 * Límite: ninguna lleva `@Throttle` propio — el mismo que la ruta admin `GET /admin/shipments/:id/label.pdf` (que no lo
 * tiene) ⇒ el global (`ThrottlerModule.forRoot`, 300/min, `app.module.ts`).
 */
import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InboundShipmentService } from './inbound-shipment.service';

/** `POST /api/v1/admin/buylist/:id/inbound-shipment` — operador+ (⛔ no `@MoneyOut`: no gasta). */
@Controller('admin/buylist')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminInboundShipmentController {
  constructor(private readonly inbound: InboundShipmentService) {}

  @Post(':id/inbound-shipment')
  @HttpCode(200)
  open(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.inbound.open(id, body, user);
  }
}

/** `GET /api/v1/buylist/requests/:id/label.pdf` — el vendedor dueño (los roles de las demás rutas de `buylist/requests`). */
@Controller('buylist')
export class SellerInboundLabelController {
  constructor(private readonly inbound: InboundShipmentService) {}

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Get('requests/:id/label.pdf')
  async labelPdf(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }, @Res() res: Response) {
    const pdf = await this.inbound.sellerLabelPdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(pdf.body.length));
    res.send(pdf.body);
  }
}
