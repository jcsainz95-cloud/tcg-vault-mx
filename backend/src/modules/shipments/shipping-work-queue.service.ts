/**
 * shipping-work-queue.service.ts — `workQueue.shipping` del tablero (API_CONTRACT §19.13, §19.35.5 fila 1) servido POR
 * `ShipmentsModule` (C-TL-1 del gate techlead sobre 31af0883).
 *
 * El conteo de `withLabelAlert` necesita el MISMO reloj de la guía (`SHIPMENTS_LABEL_CLOCK`) y el MISMO `tUnknownMs`
 * (`LABEL_VERIFY_CONFIG`) que pintan `labelAlert` en el DTO. Los dos son proveedores de este módulo: este servicio los recibe
 * por inyección normal y el módulo lo EXPORTA. `AdminModule` (`DashboardShippingService`) ya no los lee por `ModuleRef`
 * (`strict:false`) ni los declara por segunda vez. Lo que lee DIALES (proveedor, umbral de saldo) se queda en `admin/`, que
 * los tiene; aquí solo el cuerpo y sus dos insumos de `shipments/`.
 */
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from './label-clock';
import { LABEL_VERIFY_CONFIG, LabelVerifyConfig } from './label-verify.constants';
import { shippingWorkQueueOf, ShippingWorkQueueDTO, ShippingWorkQueueDeps } from './shipping-work-queue';

@Injectable()
export class ShippingWorkQueueService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPMENTS_LABEL_CLOCK) private readonly clock: LabelClock,
    @Inject(LABEL_VERIFY_CONFIG) private readonly cfg: LabelVerifyConfig,
  ) {}

  /** `workQueue.shipping` con el reloj y `tUnknownMs` de este módulo; el llamador pone los diales y la lectura del saldo. */
  shipping(deps: Omit<ShippingWorkQueueDeps, 'now' | 'tUnknownMs'>): Promise<ShippingWorkQueueDTO> {
    return shippingWorkQueueOf(this.prisma, { ...deps, now: this.clock.now(), tUnknownMs: this.cfg.tUnknownMs });
  }
}
