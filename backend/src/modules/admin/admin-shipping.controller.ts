/**
 * admin-shipping.controller.ts — 💰 D2f: M10 «Envíos» (API_CONTRACT §19.13, §19.19.6, §19.20.3, §19.22.3; PS-90, PS-110).
 *
 *  - `GET  /admin/shipping/packages` — **operador+** (lo usa «Cambiar empaque» de la ventana, A-3); ⛔ sin dinero ni secretos.
 *  - `PUT  /admin/shipping/packages` — `super_admin`; reemplazo entero; bitácora antes/después.
 *  - `GET  /admin/shipping/catalogs` — `super_admin`; `{packagings, consignmentNote, addressTemplates}` (sin PII).
 *  - `GET  /admin/shipping/catalogs/consignment-notes?description=` — `super_admin`; una página, `hasMore`.
 *  - `GET  /admin/shipping/balance` — `super_admin`; en vivo, `Cache-Control: no-store`, ⛔ no se persiste (el caché del
 *    tablero se refresca con lo leído). El operador ⛔ nunca ve la cifra (T.11): `403`.
 */
import { Body, Controller, Get, Header, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShippingConfigService } from './shipping-config.service';

@Controller('admin/shipping')
@Roles(Role.super_admin)
export class AdminShippingController {
  constructor(private readonly config: ShippingConfigService) {}

  @Get('packages')
  @Roles(Role.vault_operator, Role.super_admin)
  packages() {
    return this.config.listPackages();
  }

  @Put('packages')
  replacePackages(@Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    return this.config.replacePackages(body, user);
  }

  @Get('catalogs')
  catalogs() {
    return this.config.catalogs();
  }

  @Get('catalogs/consignment-notes')
  consignmentNotes(@Query('description') description?: string) {
    return this.config.searchConsignmentNotes(description);
  }

  @Header('Cache-Control', 'no-store')
  @Get('balance')
  balance() {
    return this.config.liveBalance();
  }
}
