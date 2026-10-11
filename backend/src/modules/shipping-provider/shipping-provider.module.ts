/**
 * ShippingProviderModule — provee `SHIPPING_PROVIDER_PORT` (API_CONTRACT §M4-SHIP.19.4; ARCHITECTURE §4.60 (c):
 * fuera de `common/`, mismo patrón que `mail/`). La selección es `selectShippingProvider` (pura, probada aparte).
 *
 * ⚠️ D1 lo deja construido pero SIN importar en `AppModule`: lo importa `shipments` cuando lo inyecte (D2), para no
 * tocar el árbol de módulos de otro work stream desde aquí.
 */
import { Logger, Module } from '@nestjs/common';
import { SHIPPING_PROVIDER_PORT } from './shipping-provider.port';
import { selectShippingProvider, ShippingProviderSelection } from './shipping-provider.factory';

export const SHIPPING_PROVIDER_SELECTION = 'SHIPPING_PROVIDER_SELECTION';

@Module({
  providers: [
    {
      provide: SHIPPING_PROVIDER_SELECTION,
      // `process.env` (ConfigModule ya cargó `.env` en él): las claves se leen en UN sitio, la fábrica.
      useFactory: (): ShippingProviderSelection => {
        const selection = selectShippingProvider(process.env);
        new Logger('ShippingProviderModule').log(`Proveedor de guías: ${selection.kind}`);
        return selection;
      },
    },
    {
      provide: SHIPPING_PROVIDER_PORT,
      inject: [SHIPPING_PROVIDER_SELECTION],
      useFactory: (selection: ShippingProviderSelection) => selection.port,
    },
  ],
  exports: [SHIPPING_PROVIDER_PORT, SHIPPING_PROVIDER_SELECTION],
})
export class ShippingProviderModule {}
