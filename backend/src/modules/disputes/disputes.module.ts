import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { AdminDisputesController, DisputesController } from './disputes.controller';

@Module({
  providers: [DisputesService],
  controllers: [DisputesController, AdminDisputesController],
  exports: [DisputesService],
})
export class DisputesModule {}
