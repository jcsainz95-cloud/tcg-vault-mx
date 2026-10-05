/**
 * provider-balance.service.ts — 💰 la lectura del saldo de Skydropx **cacheada 5 min** (API_CONTRACT §19.13: «una llamada, no una
 * por carga del tablero»; §19.29.7 paso (3) de `spend-watch`). Toda lectura que hace pasa por `observeBalance` (AG-7 (i): crea
 * `ag7:open` bajo el umbral, lo resuelve en o sobre él).
 *
 * La reusará D2f para `workQueue.shipping.lowBalance` (el MISMO caché: una cifra, una fuente). ⛔ El saldo no sale de aquí hacia
 * ningún DTO de operador.
 *
 * Fallo del proveedor ⇒ `null` y `warn` (⛔ no tumba al llamador ni guarda el fallo en el caché: la siguiente lectura reintenta).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SHIPPING_PROVIDER_PORT, ShippingProviderPort } from '../shipping-provider/shipping-provider.port';
import { SpendAlertsService } from './spend-alerts.service';
import { PROVIDER_BALANCE_CACHE_MS, SPEND_ALERTS_CLOCK, SpendClock } from './spend-alerts.constants';

@Injectable()
export class ProviderBalanceService {
  private readonly logger = new Logger(ProviderBalanceService.name);
  private cached: { balanceCents: number; readAt: number } | null = null;
  private inFlight: Promise<number | null> | null = null;

  constructor(
    @Inject(SHIPPING_PROVIDER_PORT) private readonly port: ShippingProviderPort,
    private readonly alerts: SpendAlertsService,
    @Inject(SPEND_ALERTS_CLOCK) private readonly clock: SpendClock,
  ) {}

  /** El saldo en centavos (del caché si tiene < 5 min), o `null` si el proveedor no respondió. */
  async read(): Promise<number | null> {
    const now = this.clock.now();
    if (this.cached && now.getTime() - this.cached.readAt < PROVIDER_BALANCE_CACHE_MS) return this.cached.balanceCents;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const { balanceCents } = await this.port.balance();
        this.cached = { balanceCents, readAt: now.getTime() };
        await this.alerts.observeBalance(balanceCents, now);
        return balanceCents;
      } catch (e) {
        this.logger.warn(`lectura de saldo del proveedor falló: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      } finally {
        this.inFlight = null;
      }
    })();
    return this.inFlight;
  }

  /**
   * 💰 D2f (`GET /admin/shipping/balance`, §19.13: «leído en vivo»): lee del proveedor SIN caché, refresca el caché con lo leído
   * (una cifra, una fuente) y pasa por `observeBalance` (AG-7 (i): «toda lectura de saldo», §19.29.6). A diferencia de `read`,
   * el fallo SE PROPAGA (el súper-admin pidió la cifra: un `502/503` le dice la verdad; ⛔ un `null` callado no).
   */
  async readFresh(): Promise<{ balanceCents: number; currency: 'MXN'; readAt: Date }> {
    const now = this.clock.now();
    const res = await this.port.balance();
    this.cached = { balanceCents: res.balanceCents, readAt: now.getTime() };
    await this.alerts.observeBalance(res.balanceCents, now);
    return { balanceCents: res.balanceCents, currency: res.currency, readAt: now };
  }

  /** Solo pruebas / tras un cambio que invalida el caché. */
  invalidate(): void {
    this.cached = null;
  }
}
