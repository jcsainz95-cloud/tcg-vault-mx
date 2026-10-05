/**
 * dashboard-shipping.service.ts — 💰 D2f: las dos tarjetas del tablero que leen DIALES (API_CONTRACT §19.13, §19.29.9):
 * `workQueue.shipping` (umbral de saldo, proveedor) y `workQueue.spendControl` (tope de guías por persona).
 *
 * Vive APARTE de `AdminService` a propósito: `AdminService` (el P&L) ⛔ no tiene `SettingsService` — candado `IVA-11
 * (c-estructural)`: «no es que no lea el dial, es que no lo tiene». El tablero sí necesita diales; el P&L no puede.
 * Los cuerpos son de su dueño: `shippingWorkQueueOf` (`shipments/`, con `carrierAlertActive`) y `spendControlOf`
 * (`spend-alerts/`, con `labelSpend24h` de TG-1). Aquí solo se leen los diales y se cablea la lectura cacheada del saldo.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SettingKey } from '../settings/settings.constants';
import { ProviderBalanceService } from '../spend-alerts/provider-balance.service';
import { spendControlOf, SpendControlDTO } from '../spend-alerts/spend-control';
import { shippingWorkQueueOf, ShippingWorkQueueDTO } from '../shipments/shipping-work-queue';

@Injectable()
export class DashboardShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly balance: ProviderBalanceService,
  ) {}

  /** `workQueue.shipping` — para los dos roles (el objeto ⛔ lleva la cifra del saldo para nadie). */
  async shipping(): Promise<ShippingWorkQueueDTO> {
    const [provider, thresholdCents] = await Promise.all([
      this.settings.get<string | null>(SettingKey.SHIPPING_PROVIDER),
      this.settings.getNumber(SettingKey.SKYDROPX_LOW_BALANCE_CENTS),
    ]);
    return shippingWorkQueueOf(this.prisma, { provider: provider ?? null, thresholdCents, readBalance: () => this.balance.read() });
  }

  /** `workQueue.spendControl` — SOLO súper-admin (el llamador pone `null` al operador). */
  async spendControl(now: Date): Promise<SpendControlDTO> {
    return spendControlOf(this.prisma, now, await this.settings.getNumber(SettingKey.OPERATOR_LABEL_CAP_24H_CENTS));
  }
}
