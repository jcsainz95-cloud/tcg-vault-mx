/**
 * dashboard-shipping.service.ts — 💰 D2f: las dos tarjetas del tablero que leen DIALES (API_CONTRACT §19.13, §19.29.9):
 * `workQueue.shipping` (umbral de saldo, proveedor) y `workQueue.spendControl` (tope de guías por persona).
 *
 * Vive APARTE de `AdminService` a propósito: `AdminService` (el P&L) ⛔ no tiene `SettingsService` — candado `IVA-11
 * (c-estructural)`: «no es que no lea el dial, es que no lo tiene». El tablero sí necesita diales; el P&L no puede.
 * Los cuerpos son de su dueño: `shippingWorkQueueOf` (`shipments/`, con `carrierAlertActive`) y `spendControlOf`
 * (`spend-alerts/`, con `labelSpend24h` de TG-1). Aquí solo se leen los diales y se cablea la lectura cacheada del saldo.
 *
 * ⭐ v1.80.12.16 (§19.35.5 fila 1, B-3): `withLabelAlert` necesita el MISMO reloj de la guía (`SHIPMENTS_LABEL_CLOCK`) y el MISMO
 * `tUnknownMs` (`LABEL_VERIFY_CONFIG`) que pintan `labelAlert` en el DTO. Los dos son proveedores de `ShipmentsModule` que ese
 * módulo no exporta; se leen por `ModuleRef` (`strict: false`) para tomar LA instancia de `ShipmentsModule` (la que las pruebas
 * sustituyen), ⛔ no una segunda declaración en `AdminModule` que podría divergir.
 */
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { ProviderBalanceService } from '../spend-alerts/provider-balance.service';
import { spendControlOf, SpendControlDTO } from '../spend-alerts/spend-control';
import { shippingWorkQueueOf, ShippingWorkQueueDTO } from '../shipments/shipping-work-queue';
import { LabelClock, SHIPMENTS_LABEL_CLOCK } from '../shipments/label-clock';
import { LABEL_VERIFY_CONFIG, LabelVerifyConfig } from '../shipments/label-verify.constants';

@Injectable()
export class DashboardShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly balance: ProviderBalanceService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** `workQueue.shipping` — para los dos roles (el objeto ⛔ lleva la cifra del saldo para nadie). */
  async shipping(): Promise<ShippingWorkQueueDTO> {
    const [provider, thresholdCents] = await Promise.all([
      this.settings.get<string | null>(SettingKey.SHIPPING_PROVIDER),
      this.settings.getNumber(SettingKey.SKYDROPX_LOW_BALANCE_CENTS),
    ]);
    const clock = this.moduleRef.get<LabelClock>(SHIPMENTS_LABEL_CLOCK, { strict: false });
    const { tUnknownMs } = this.moduleRef.get<LabelVerifyConfig>(LABEL_VERIFY_CONFIG, { strict: false });
    return shippingWorkQueueOf(this.prisma, {
      provider: provider ?? null,
      thresholdCents,
      readBalance: () => this.balance.read(),
      now: clock.now(),
      tUnknownMs,
    });
  }

  /** `workQueue.spendControl` — SOLO súper-admin (el llamador pone `null` al operador). */
  async spendControl(now: Date): Promise<SpendControlDTO> {
    return spendControlOf(this.prisma, now, await this.settings.getNumber(SettingKey.OPERATOR_LABEL_CAP_24H_CENTS));
  }
}
