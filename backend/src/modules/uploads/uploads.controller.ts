import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { UploadsService } from './uploads.service';

class PresignDto {
  @IsIn(['kyc_ine', 'dispute_claim', 'inventory_photo'])
  purpose!: 'kyc_ine' | 'dispute_claim' | 'inventory_photo';
  @IsString() contentType!: string;
}

@Controller('uploads')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  @HttpCode(200)
  presign(@Body() dto: PresignDto) {
    return this.uploads.presign(dto.purpose, dto.contentType);
  }
}
