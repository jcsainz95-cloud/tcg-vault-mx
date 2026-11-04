/**
 * portada-day.ts — v1.113⟨portada⟩ (API_CONTRACT §DYN.2/§DYN.5, TL-DYN-3) — EL «día de portada»: el día que la tienda sirve
 * (Destacadas y precio del día) cambia a las `H:00` CDMX (`featured_rotation_hour`), no a medianoche. Una sola definición para
 * `FeaturedService` (rotación de Destacadas) y `ListingPriceService` (precio del día): antes cada uno tenía la suya
 * (`effectiveFromOf`/`servedDayAt` y `portadaEffectiveFrom`/`portadaServedDay`), iguales hoy y libres de divergir mañana.
 * La fecha civil CDMX y el inicio del día salen de `spend-alerts` (`dayMx`, `mxDayStart`), sin copia.
 */
import { dayMx } from '../modules/spend-alerts/spend-alerts.service';
import { mxDayStart } from '../modules/spend-alerts/mx-day';

const HOUR_MS = 3_600_000;

/** `effectiveFrom` del día de portada `ymd` = ese día a las `hour`:00 CDMX (en UTC). */
export function portadaEffectiveFrom(ymd: string, hour: number): Date {
  return new Date(mxDayStart(ymd).getTime() + hour * HOUR_MS);
}

/** El día de portada que se sirve en `now` (el último cuyo `hour`:00 CDMX ya pasó). */
export function portadaServedDay(now: Date, hour: number): string {
  return dayMx(new Date(now.getTime() - hour * HOUR_MS));
}
