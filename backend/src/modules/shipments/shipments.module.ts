import { Module } from '@nestjs/common';
import { ShipmentsService } from './shipments.service';
import { ShipmentsController } from './shipments.controller';
import { AdminShipmentsController } from './admin-shipments.controller';
import { ShipmentPrepService } from './shipment-prep.service';
import { ShipmentAddressService } from './shipment-address.service';
import { GeoModule } from '../shipping-provider/geo/geo.module';
import { ShippingProviderModule } from '../shipping-provider/shipping-provider.module';
import { ShipmentQuoteService } from './label-quote.service';
import { SHIPMENTS_LABEL_CLOCK, systemLabelClock } from './label-clock';
import { LABEL_SPEND_KEY, ShipmentLabelService, purchaseKeyFor } from './label-purchase.service';
import { SHIPPING_PROVIDER_SELECTION } from '../shipping-provider/shipping-provider.module';
import { ShippingProviderSelection } from '../shipping-provider/shipping-provider.factory';
import { DEFAULT_LABEL_VERIFY_CONFIG, LABEL_VERIFY_CONFIG } from './label-verify.constants';
import { SpendAlertsModule } from '../spend-alerts/spend-alerts.module';
import { ShipmentLabelCancelService } from './label-cancel.service';
import { ShipmentLabelRecoveryService } from './label-recovery.service';
import { ShipmentLabelPdfService } from './label-pdf.service';
import { LABEL_AUTO_CLOSE } from './label-auto-close';
import { ShipmentCarrierService } from './carrier-status.service';
import { CARRIER_NOTICES, mailCarrierNotices } from './carrier-notices';
import { ShipmentOrphanService } from './orphan-reconcile.service';
import { ShipmentTrackingPollJob } from './tracking-poll.job';
import { ShipmentLabelProcessingJob } from './label-processing.job';
import { ShipmentExtraChargesJob } from './extra-charges.job';
import { ShipmentDepartureService } from './departure.service';
import { GuestOrderTokensModule } from '../orders/guest-order-tokens.module';
import { ShippingWorkQueueService } from './shipping-work-queue.service';
import { InboundShipmentService } from './inbound-shipment.service';
import { InboundGuideNoticeService } from './inbound-guide-notice.service';
import { AdminInboundShipmentController, SellerInboundLabelController } from './inbound-shipment.controller';

@Module({
  // ⭐ v1.80.12 (M-64): `GeoModule` — la corrección de la dirección valida contra la lista del CP (§M4-SHIP.19.20.1).
  // ⭐💰 v1.81 D2b/D2c (§M4-SHIP.19.4): el proveedor de guías entra AQUÍ (D1 lo dejó sin importar a propósito).
  // 🔒 v1.80.12.16 (§M4-SHIP.19.35.1): `GuestOrderTokensModule` (el módulo MÍNIMO, sin dependencias) para la liga del invitado en
  // los avisos — `OrderAccessTokenService.issue` tal cual, sin rotar.
  imports: [GeoModule, ShippingProviderModule, SpendAlertsModule, GuestOrderTokensModule],
  providers: [
    ShipmentsService,
    ShipmentPrepService,
    ShipmentAddressService,
    ShipmentQuoteService,
    ShipmentLabelService,
    ShipmentLabelCancelService,
    ShipmentLabelRecoveryService,
    ShipmentLabelPdfService,
    // ⭐💰 D2d (§19.3, §19.9, §19.10): el rastreo, los tres jobs, la conciliación de huérfanas y «Salida de hoy».
    ShipmentCarrierService,
    ShipmentOrphanService,
    ShipmentTrackingPollJob,
    ShipmentLabelProcessingJob,
    ShipmentExtraChargesJob,
    ShipmentDepartureService,
    // C-TL-1 (gate techlead sobre 31af0883): `workQueue.shipping` del tablero con el reloj y `tUnknownMs` de ESTE módulo.
    ShippingWorkQueueService,
    // 💰 rev BSD-1 (§BSD.4.1, §BSD.4.4, §BSD.8.2): la guía de ENTRADA del buylist sobre el MISMO motor — abrir la fila,
    // la descarga del vendedor y AV-7 con la etiqueta.
    InboundShipmentService,
    InboundGuideNoticeService,
    // ⭐ D2e (§19.12): los correos AV-17/18/19 al cliente — sello y envío en `ShipmentsService.notifyCarrierNotice`.
    { provide: CARRIER_NOTICES, inject: [ShipmentsService], useFactory: mailCarrierNotices },
    // 💰 §19.8: el post-commit de la cancelación automática, por token (los escritores viven en `payments/`).
    { provide: LABEL_AUTO_CLOSE, useExisting: ShipmentLabelCancelService },
    // 🔒 UN reloj para la guía (§19.29.1.4, C-17); las pruebas lo sustituyen.
    { provide: SHIPMENTS_LABEL_CLOCK, useValue: systemLabelClock },
    // 💰 Las constantes de la verificación (§19.27.7/.28): las pruebas las INYECTAN (⛔ no cambian el fichero).
    { provide: LABEL_VERIFY_CONFIG, useValue: DEFAULT_LABEL_VERIFY_CONFIG },
    // 🔒 La tercera llave (§19.19.7 con §19.31.5): `isPurchaseKeyTurned(selection.kind)`, leída del proceso en CADA compra —
    // `SKYDROPX_ALLOW_SPEND` con el adaptador real, la llave del doble con `fake`. Las pruebas la sustituyen (PS-99).
    {
      provide: LABEL_SPEND_KEY,
      inject: [SHIPPING_PROVIDER_SELECTION],
      useFactory: (selection: ShippingProviderSelection) => purchaseKeyFor(selection.kind),
    },
  ],
  controllers: [ShipmentsController, AdminShipmentsController, AdminInboundShipmentController, SellerInboundLabelController],
  // `ShipmentLabelCancelService` se exporta para el post-commit de los escritores automáticos de `cancelado` (§19.8).
  // ⭐ D2d: los tres jobs se exportan para el planificador y el disparo manual (`jobs/`).
  exports: [
    ShipmentsService,
    ShipmentPrepService,
    ShipmentLabelCancelService,
    LABEL_AUTO_CLOSE,
    ShipmentTrackingPollJob,
    ShipmentLabelProcessingJob,
    ShipmentExtraChargesJob,
    // C-TL-1: el tablero (`admin/dashboard-shipping.service.ts`) lo inyecta normal (⛔ `ModuleRef` con `strict:false`).
    ShippingWorkQueueService,
  ],
})
export class ShipmentsModule {}
