/**
 * GeoModule — el catálogo de CP y colonias (fase C, M-64). Vive en `shipping-provider/` (§19.5: «puerto
 * `PostalCodePort`, en el mismo módulo») pero es un módulo Nest APARTE: no arrastra el adaptador de guías (D1/D2) a
 * `users`/`orders`/`shipments`, que solo necesitan validar una dirección.
 */
import { Module } from '@nestjs/common';
import { GeoController } from './geo.controller';
import { LocalPostalCodeSource, POSTAL_CODE_SOURCES, PostalCodeService } from './postal-code';

@Module({
  providers: [
    LocalPostalCodeSource,
    // Precedencia de fuentes (§19.5): local primero. Skydropx (2) se añade aquí cuando PS-SBX-9 la mida.
    { provide: POSTAL_CODE_SOURCES, inject: [LocalPostalCodeSource], useFactory: (local: LocalPostalCodeSource) => [local] },
    PostalCodeService,
  ],
  controllers: [GeoController],
  exports: [PostalCodeService],
})
export class GeoModule {}
