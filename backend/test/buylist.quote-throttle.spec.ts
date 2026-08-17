import 'reflect-metadata';
import { BuylistController } from '../src/modules/buylist/buylist.controller';

/**
 * B-C1 (seguridad): el cotizador PÚBLICO/anónimo de buylist (`POST /buylist/quote` y
 * `POST /buylist/quote/batch`) lleva rate-limit dedicado (@Throttle), no solo el throttler
 * global. El batch amplifica hasta 50× el trabajo por request, así que su límite es más
 * estricto (12/min) para cerrar la amplificación DoS anónima; el quote por-carta va a 60/min,
 * alineado con los controllers públicos hermanos (buylist-catalog).
 */
describe('Buylist public quote rate-limiting — B-C1', () => {
  const limit = (fn: unknown) => Reflect.getMetadata('THROTTLER:LIMITdefault', fn as object);
  const ttl = (fn: unknown) => Reflect.getMetadata('THROTTLER:TTLdefault', fn as object);

  it('POST /buylist/quote está limitado a 60/min (alineado con buylist-catalog)', () => {
    expect(limit(BuylistController.prototype.quote)).toBe(60);
    expect(ttl(BuylistController.prototype.quote)).toBe(60_000);
  });

  it('POST /buylist/quote/batch tiene límite MÁS estricto (12/min) por amplificación 50×', () => {
    expect(limit(BuylistController.prototype.quoteBatch)).toBe(12);
    expect(ttl(BuylistController.prototype.quoteBatch)).toBe(60_000);
    // El batch nunca debe ser tan holgado (o más) que el quote por-carta.
    expect(limit(BuylistController.prototype.quoteBatch)).toBeLessThan(
      limit(BuylistController.prototype.quote),
    );
  });
});
