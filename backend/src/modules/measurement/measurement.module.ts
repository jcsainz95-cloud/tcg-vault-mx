import { Global, Module } from '@nestjs/common';
import { MeasurementService } from './measurement.service';
import { MeasurementDrainService } from './measurement-drain.service';
import { BannerResponseService } from './banner-response.service';
import { MeasurementController } from './measurement.controller';
import { MEASUREMENT_HTTP, fetchMeasurementHttp } from './measurement-http';
import { BACKEND_ENCENDER_BLOCKERS, MEASUREMENT_ENCENDER_BLOCKERS } from './measurement.config';

/**
 * MeasurementModule — Fase 2 de medición (API_CONTRACT §MKT.H; ARCHITECTURE §14). `@Global` para que lo consuman sin
 * importarlo (y sin ciclo: solo depende de Prisma y de la configuración): los controladores de pedido, pedido de invitado
 * y solicitud de venta (`prepare` + `afterCreate`), `payments` (`enqueuePurchase`), `marketing` (el modo) y el
 * planificador (`MeasurementDrainService`). `MEASUREMENT_MODE` por defecto `off`.
 */
@Global()
@Module({
  providers: [
    MeasurementService,
    MeasurementDrainService,
    BannerResponseService,
    { provide: MEASUREMENT_HTTP, useValue: fetchMeasurementHttp },
    // SEC-MKT-3: con bloqueos abiertos, `MEASUREMENT_MODE=on` arranca con modo efectivo `off` (measurement.config.ts).
    { provide: MEASUREMENT_ENCENDER_BLOCKERS, useValue: BACKEND_ENCENDER_BLOCKERS },
  ],
  controllers: [MeasurementController],
  exports: [MeasurementService, MeasurementDrainService],
})
export class MeasurementModule {}
