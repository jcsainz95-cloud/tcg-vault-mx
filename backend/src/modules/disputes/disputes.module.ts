import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { AdminDisputesController, DisputesController } from './disputes.controller';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  providers: [DisputesService],
  controllers: [DisputesController, AdminDisputesController],
  exports: [DisputesService],
})
export class DisputesModule {}
