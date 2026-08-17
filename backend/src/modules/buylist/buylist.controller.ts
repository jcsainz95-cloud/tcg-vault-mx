import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireEmailVerified } from '../../common/decorators/require-email-verified.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BuylistService } from './buylist.service';
import { BatchQuoteDto, CreateRequestDto, PublicQuoteDto, RespondDto } from './dto/buylist.dto';

@Controller('buylist')
export class BuylistController {
  constructor(private readonly buylist: BuylistService) {}

  @Public()
  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: PublicQuoteDto) {
    return this.buylist.publicQuote(dto.cardId, dto.productType, dto.rawCondition, dto.finish);
  }

  // v1.15 (§4.16b): batch quote — cotiza N cartas en 1 request (mata el fan-out FE-12). Público y
  // READ-ONLY como el quote por-carta (anónimo, no se bloquea por emailVerified). Errores por-ítem:
  // HTTP global 200; el cap 50 / vacío lo impone el DTO (400 VALIDATION_ERROR).
  @Public()
  @Post('quote/batch')
  @HttpCode(200)
  quoteBatch(@Body() dto: BatchQuoteDto) {
    return this.buylist.batchQuote(dto.items);
  }

  // v1.5: vender (crear SellRequest) es acción sensible → requiere emailVerified. El cotizador
  // público `POST /buylist/quote` (arriba) queda abierto (es anónimo, no se bloquea).
  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @RequireEmailVerified()
  @Post('requests')
  @HttpCode(201)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateRequestDto) {
    return this.buylist.createRequest(userId, dto.items, dto.clabe, dto.ineUploadKeys);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Get('requests')
  list(@CurrentUser('id') userId: string) {
    return this.buylist.listMine(userId);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Get('requests/:id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.buylist.getMine(userId, id);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
  @Post('requests/:id/respond')
  @HttpCode(200)
  respond(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: RespondDto,
  ) {
    return this.buylist.respond(userId, id, dto.decision);
  }
}
