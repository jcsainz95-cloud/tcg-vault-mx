import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { BusinessException } from '../../common/business.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AllowPasswordChangeRequired } from '../../common/decorators/allow-password-change-required.decorator';
import {
  AcceptInviteDto, AdminRespondDto, ChangeSupplierPasswordDto, CreateSupplyOfferDto, CreateSupplyRequestDto, InviteSupplierDto, PatchSupplierDto,
  PatchSupplyRequestDto, PatchSupplySettingsDto, PayDto, ReceiveDto, SupplierRespondDto, VerifyDto,
} from './supply.dto';
import { SUPPLY_SETTINGS_ID } from './supply.constants';
import { SupplierAccessService } from './supplier-access.service';
import { SupplyRequestService } from './supply-request.service';
import { SupplyOfferService } from './supply-offer.service';
import { SupplyPurchaseService } from './supply-purchase.service';

type Q = Record<string, string | undefined>;
const idemKey = (h?: string) => (h && h.trim() ? h.trim().slice(0, 200) : undefined);

/** POST /auth/supplier/accept-invite — público (la invitación es el control de acceso); no hay registro abierto. */
@Controller('auth/supplier')
export class SupplierAuthController {
  constructor(private readonly access: SupplierAccessService) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  accept(@Body() dto: AcceptInviteDto) {
    return this.access.acceptInvite(dto);
  }
}

/** Todo `/supplier/*`. `supplierId` sale SIEMPRE del token (userId → Supplier), jamás de ruta ni cuerpo. */
@Roles(Role.supplier)
@Controller('supplier')
export class SupplierPortalController {
  constructor(
    private readonly access: SupplierAccessService,
    private readonly requests: SupplyRequestService,
    private readonly offers: SupplyOfferService,
    private readonly purchases: SupplyPurchaseService,
  ) {}

  private sid(userId: string): Promise<string> {
    return this.access.supplierIdOfUser(userId);
  }

  @Get('me') me(@CurrentUser('id') uid: string) { return this.access.me(uid); }

  // Única ruta permitida con `mustChangePassword` (sesión restringida): por eso lleva AllowPasswordChangeRequired.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @AllowPasswordChangeRequired()
  @Post('me/password')
  @HttpCode(204)
  async password(@CurrentUser('id') uid: string, @Body() dto: ChangeSupplierPasswordDto): Promise<void> {
    await this.access.changePassword(uid, dto);
  }

  @Get('requests') async listRequests(@CurrentUser('id') uid: string, @Query() q: Q) { return this.requests.listForSupplier(await this.sid(uid), q); }
  @Get('requests/:id') async getRequest(@CurrentUser('id') uid: string, @Param('id') id: string) { return this.requests.getForSupplier(await this.sid(uid), id); }

  @Post('requests/:id/offers')
  create(@CurrentUser('id') uid: string, @Param('id') id: string, @Body() dto: CreateSupplyOfferDto, @Headers('idempotency-key') key?: string) {
    return this.offers.create(uid, id, dto, idemKey(key));
  }

  @Get('offers') listOffers(@CurrentUser('id') uid: string, @Query() q: Q) { return this.offers.listForSupplier(uid, q); }
  @Get('offers/:id') getOffer(@CurrentUser('id') uid: string, @Param('id') id: string) { return this.offers.getForSupplier(uid, id); }
  @Post('offers/:id/respond') @HttpCode(200)
  respond(@CurrentUser('id') uid: string, @Param('id') id: string, @Body() dto: SupplierRespondDto) { return this.offers.supplierRespond(uid, id, dto); }

  @Get('purchases') listPurchases(@CurrentUser('id') uid: string, @Query() q: Q) { return this.purchases.listSupplier(uid, q); }
  @Get('purchases/:id') getPurchase(@CurrentUser('id') uid: string, @Param('id') id: string) { return this.purchases.getSupplier(uid, id); }
}

const STAFF = [Role.vault_operator, Role.super_admin] as const;

@Controller('admin')
export class AdminSupplyController {
  constructor(
    private readonly access: SupplierAccessService,
    private readonly requests: SupplyRequestService,
    private readonly offers: SupplyOfferService,
    private readonly purchases: SupplyPurchaseService,
    private readonly prisma: PrismaService,
  ) {}

  // ---- proveedores ----
  @Roles(Role.super_admin) @Post('suppliers/invite')
  async invite(@CurrentUser('id') uid: string, @Body() dto: InviteSupplierDto, @Res({ passthrough: true }) res: Response) {
    const r = await this.access.invite(dto, uid);
    res.status(r.created ? 201 : 200);
    return r.body;
  }
  @Roles(...STAFF) @Get('suppliers') listSuppliers(@Query() q: Q) { return this.access.list(q); }
  @Roles(Role.super_admin) @Patch('suppliers/:id') patchSupplier(@CurrentUser('id') uid: string, @Param('id') id: string, @Body() dto: PatchSupplierDto) { return this.access.patch(id, dto, uid); }

  // ---- solicitudes ----
  @Roles(...STAFF) @Get('supply-requests/market-check')
  marketCheck(@Query('cardId') cardId?: string, @Query('finish') finish?: string) {
    if (!cardId || !finish) throw BusinessException.badRequest('VALIDATION_ERROR', 'cardId and finish are required');
    return this.requests.marketCheck(cardId, finish);
  }
  @Roles(Role.super_admin) @Post('supply-requests') create(@CurrentUser('id') uid: string, @Body() dto: CreateSupplyRequestDto) { return this.requests.create(dto, uid); }
  @Roles(Role.super_admin) @Patch('supply-requests/:id') patchRequest(@Param('id') id: string, @Body() dto: PatchSupplyRequestDto) { return this.requests.patch(id, dto); }
  @Roles(...STAFF) @Get('supply-requests') listRequests(@Query() q: Q) { return this.requests.listAdmin(q); }
  @Roles(...STAFF) @Get('supply-requests/:id')
  async getRequest(@Param('id') id: string) {
    const r = await this.requests.getAdmin(id);
    return { ...r, offers: await this.offers.offersOfRequest(id) };
  }

  // ---- ofertas ----
  @Roles(...STAFF) @Get('supply-offers') listOffers(@Query() q: Q) { return this.offers.listAdmin(q); }
  @Roles(Role.super_admin) @Post('supply-offers/:id/respond') @HttpCode(200)
  respond(@CurrentUser('id') uid: string, @Param('id') id: string, @Body() dto: AdminRespondDto) { return this.offers.adminRespond(id, dto, uid); }

  // ---- acuerdos ----
  @Roles(...STAFF) @Get('supply-purchases') listPurchases(@Query() q: Q) { return this.purchases.listAdmin(q); }
  @Roles(...STAFF) @Get('supply-purchases/:id') getPurchase(@Param('id') id: string) { return this.purchases.getAdmin(id); }
  @Roles(...STAFF) @Post('supply-purchases/:id/receive') @HttpCode(200)
  receive(@CurrentUser() u: { id: string; role: Role }, @Param('id') id: string, @Body() dto: ReceiveDto, @Headers('idempotency-key') key?: string) { return this.purchases.receive(id, dto, idemKey(key), u.id, u.role); }
  @Roles(...STAFF) @Post('supply-purchases/:id/verify') @HttpCode(200)
  verify(@CurrentUser() u: { id: string; role: Role }, @Param('id') id: string, @Body() dto: VerifyDto, @Headers('idempotency-key') key?: string) { return this.purchases.verify(id, dto, idemKey(key), u.id, u.role); }
  @MoneyOut() @Roles(Role.super_admin) @Post('supply-purchases/:id/pay') @HttpCode(200)
  pay(@CurrentUser('id') uid: string, @Param('id') id: string, @Body() dto: PayDto, @Headers('idempotency-key') key?: string) { return this.purchases.pay(id, dto, idemKey(key), uid); }

  // ---- interruptores (APAGADOS al arrancar). autoAccept existe pero es INERTE en F1 (se cablea en F3). ----
  @Roles(Role.super_admin) @Get('supply-settings')
  async settings() {
    const s = await this.prisma.supplySettings.findUniqueOrThrow({ where: { id: SUPPLY_SETTINGS_ID } });
    return { autoPublish: s.autoPublish, autoAccept: s.autoAccept, defaultPctBps: s.defaultPctBps, weeklyBudgetCents: s.weeklyBudgetCents };
  }
  @Roles(Role.super_admin) @Patch('supply-settings')
  async patchSettings(@Body() dto: PatchSupplySettingsDto) {
    const s = await this.prisma.supplySettings.update({ where: { id: SUPPLY_SETTINGS_ID }, data: { ...dto } });
    return { autoPublish: s.autoPublish, autoAccept: s.autoAccept, defaultPctBps: s.defaultPctBps, weeklyBudgetCents: s.weeklyBudgetCents };
  }
}
