import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BuylistService } from './buylist.service';
import { CreateRequestDto, PublicQuoteDto, RespondDto } from './dto/buylist.dto';

@Controller('buylist')
export class BuylistController {
  constructor(private readonly buylist: BuylistService) {}

  @Public()
  @Post('quote')
  @HttpCode(200)
  quote(@Body() dto: PublicQuoteDto) {
    return this.buylist.publicQuote(dto.cardId, dto.productType, dto.rawCondition);
  }

  @Roles(Role.customer, Role.vault_operator, Role.super_admin)
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
