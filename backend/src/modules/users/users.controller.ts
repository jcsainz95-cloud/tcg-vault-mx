import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import {
  AddressDto,
  BillingProfileDto,
  UpdateAddressDto,
  UpdateKycDto,
  UpdateMeDto,
} from './dto/users.dto';

@Controller('users/me')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser('id') userId: string) {
    return this.users.me(userId);
  }

  @Patch()
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(userId, dto);
  }

  @Get('addresses')
  listAddresses(@CurrentUser('id') userId: string) {
    return this.users.listAddresses(userId);
  }

  @Post('addresses')
  @HttpCode(201)
  createAddress(@CurrentUser('id') userId: string, @Body() dto: AddressDto) {
    return this.users.createAddress(userId, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.users.updateAddress(userId, id, dto);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  deleteAddress(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.users.deleteAddress(userId, id);
  }

  @Get('billing-profile')
  getBilling(@CurrentUser('id') userId: string) {
    return this.users.getBillingProfile(userId);
  }

  @Put('billing-profile')
  putBilling(@CurrentUser('id') userId: string, @Body() dto: BillingProfileDto) {
    return this.users.putBillingProfile(userId, dto);
  }

  @Get('kyc')
  getKyc(@CurrentUser('id') userId: string) {
    return this.users.getKyc(userId);
  }

  @Put('kyc')
  putKyc(@CurrentUser('id') userId: string, @Body() dto: UpdateKycDto) {
    return this.users.putKyc(userId, dto);
  }
}
