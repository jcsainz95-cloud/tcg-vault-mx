import { Module } from '@nestjs/common';
import { DisputesService } from './disputes.service';
import { AdminDisputesController, DisputesController } from './disputes.controller';

@Module({
  // v1.2: ya no depende de UploadsModule (la evidencia de disputa va por correo a soporte).
  providers: [DisputesService],
  controllers: [DisputesController, AdminDisputesController],
  exports: [DisputesService],
})
export class DisputesModule {}
