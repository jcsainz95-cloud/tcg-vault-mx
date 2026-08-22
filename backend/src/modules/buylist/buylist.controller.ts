import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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

  // Rate-limit dedicado (60/min por IP) alineado con los controllers públicos hermanos
  // (`buylist-catalog.controller.ts`). El cotizador por-carta es anónimo (@Public) y READ-ONLY;
  // se acota para no depender solo del throttler global (300/min) — B-C1 (seguridad).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: PublicQuoteDto) {
    return this.buylist.publicQuote(
      dto.cardId,
      dto.productType,
      dto.rawCondition,
      dto.finish,
      dto.productId,
    );
  }

  // v1.15 (§4.16b): batch quote — cotiza N cartas en 1 request (mata el fan-out FE-12). Público y
  // READ-ONLY como el quote por-carta (anónimo, no se bloquea por emailVerified). Errores por-ítem:
  // HTTP global 200; el cap 50 / vacío lo impone el DTO (400 VALIDATION_ERROR).
  // Rate-limit MÁS restrictivo (12/min) que el quote por-carta: cada request amplifica hasta 50×
  // el trabajo, así que 12 req/min ≈ el mismo techo de cotizaciones/min que 60/min por-carta.
  // Cierra la amplificación DoS anónima — B-C1 (seguridad).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 12 } })
  @Post('quote/batch')
  @HttpCode(200)
  quoteBatch(@Body() dto: BatchQuoteDto) {
    return this.buylist.batchQuote(dto.items);
  }

  // v1.28 (P-22, §6): vitrina pública «Top Bounties» — bounties ACTIVOS, orden precio desc, cap
  // 50, sin query params. READ-ONLY estricto (doctrina v1.12 de anónimos: no persiste, no escala
  // pendientes, no mueve dinero). Mismo rate-limit dedicado que el quote por-carta (60/min).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('bounties')
  bounties() {
    return this.buylist.publicBounties();
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
