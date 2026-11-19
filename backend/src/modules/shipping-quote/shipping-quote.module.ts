import { Module } from '@nestjs/common';
import { GeoModule } from '../shipping-provider/geo/geo.module';
import { ShippingProviderModule } from '../shipping-provider/shipping-provider.module';
import { shipQuoteCacheProvider } from './ship-quote-cache';
import { ShipQuoteCalibrationService } from './ship-quote-calibration.service';
import { ShippingQuoteService } from './shipping-quote.service';

/** §ENV3 — el motor de cotización de envío por CP y carrito. Lo usan `orders` (quote/session) y `shipments` (AG-26). */
@Module({
  imports: [GeoModule, ShippingProviderModule],
  providers: [shipQuoteCacheProvider, ShippingQuoteService, ShipQuoteCalibrationService],
  exports: [ShippingQuoteService, ShipQuoteCalibrationService],
})
export class ShippingQuoteModule {}
