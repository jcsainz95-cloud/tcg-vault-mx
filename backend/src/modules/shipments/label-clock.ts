/**
 * label-clock.ts — 🔒 UN reloj para la guía de Skydropx (API_CONTRACT §M4-SHIP.19.29.1.4, C-17: «`since`, `notAfter` y el
 * `now` del job salen del MISMO `Clock` inyectado de la aplicación; ⛔ `since` nunca de `now()` de Postgres»). Lo leen
 * cotizar (vigencia de 24 h), comprar (reclamo, plazo, TG-1) y la verificación de la compra en vuelo.
 *
 * Token DI `SHIPMENTS_LABEL_CLOCK`; por defecto el reloj del sistema. Las pruebas lo sustituyen por uno que avanza a
 * mano (PS-71 «reloj a +24 h», PS-108, PS-137).
 */
export const SHIPMENTS_LABEL_CLOCK = 'SHIPMENTS_LABEL_CLOCK';

export interface LabelClock {
  now(): Date;
}

export const systemLabelClock: LabelClock = { now: () => new Date() };

/** Reloj de prueba: arranca en `start` y solo avanza cuando se le pide. */
export class ManualLabelClock implements LabelClock {
  private t: number;
  constructor(start: Date = new Date()) {
    this.t = start.getTime();
  }
  now(): Date {
    return new Date(this.t);
  }
  set(d: Date): void {
    this.t = d.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
