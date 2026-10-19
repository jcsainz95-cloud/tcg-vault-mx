import { Global, Module } from '@nestjs/common';
import { MeasurementService } from './measurement.service';
import { MeasurementDrainService } from './measurement-drain.service';
import { BannerResponseService } from './banner-response.service';
import { MeasurementController } from './measurement.controller';
import { MEASUREMENT_HTTP, fetchMeasurementHttp } from './measurement-http';

/**
 * MeasurementModule — Fase 2 de medición (API_CONTRACT §MKT.H; ARCHITECTURE §14). `@Global` para que `payments`,
 * `orders`, `buylist`, `marketing` y el planificador consuman `MeasurementService` sin importar este módulo (y sin ciclo:
 * este módulo solo depende de Prisma y de la configuración). Construido APAGADO: `MEASUREMENT_MODE` por defecto `off`.
 */
@Global()
@Module({
  providers: [
    MeasurementService,
    MeasurementDrainService,
    BannerResponseService,
    { provide: MEASUREMENT_HTTP, useValue: fetchMeasurementHttp },
  ],
  controllers: [MeasurementController],
  exports: [MeasurementService, MeasurementDrainService],
})
export class MeasurementModule {}
