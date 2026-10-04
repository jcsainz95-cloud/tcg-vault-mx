/**
 * noop-shipping-provider.adapter.ts — sin proveedor configurado (API_CONTRACT §M4-SHIP.19.4): toda llamada lanza
 * `409 SHIPPING_PROVIDER_NOT_CONFIGURED {missing:['env']}`, cero red. Es también lo que se inyecta bajo
 * `NODE_ENV=test` cuando la suite no pide el doble (§19.19.7: en pruebas el módulo solo ofrece `Fake`/`Noop`).
 */
import { ShippingProviderError } from './shipping-provider.errors';
import {
  CancelResult,
  ProviderExtraCharge,
  ProviderShipmentState,
  PurchaseResult,
  QuoteResult,
  ShippingProviderPort,
} from './shipping-provider.port';

export class NoopShippingProviderAdapter implements ShippingProviderPort {
  readonly name = 'skydropx' as const;

  private fail(): never {
    throw ShippingProviderError.notConfigured(['env']);
  }

  async quote(): Promise<QuoteResult> {
    return this.fail();
  }
  async purchase(): Promise<PurchaseResult> {
    return this.fail();
  }
  async getShipment(): Promise<ProviderShipmentState> {
    return this.fail();
  }
  async cancel(): Promise<CancelResult> {
    return this.fail();
  }
  async balance(): Promise<{ balanceCents: number; currency: 'MXN' }> {
    return this.fail();
  }
  // eslint-disable-next-line require-yield
  async *extraCharges(): AsyncIterable<ProviderExtraCharge> {
    this.fail();
  }
}
