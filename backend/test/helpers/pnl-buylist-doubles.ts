/**
 * 💰 rev BSD-1, errata BSD-1.2 (API_CONTRACT §BSD.16) — el P&L gana TRES lecturas del buylist: las guías de Skydropx de
 * ENTRADA (`shipmentRequest.findMany` con `INBOUND_ONLY`) y dos de `sellRequest.findMany` (guías manuales y pagadas).
 *
 * Los dobles LEGACY del P&L construyen `shipmentRequest.findMany` como un `mockResolvedValue(envíos)` que responde lo mismo
 * a cualquier `where`: sin esto, la lectura de entrada recibiría los envíos de VENTA y los contaría como guías del buylist.
 * Este envoltorio entrega al SERVICIO un objeto que:
 *  - responde la lectura `INBOUND_ONLY` con `inbound()` (por defecto, ninguna guía de entrada);
 *  - responde `sellRequest.findMany` con `[]` si el doble no lo instrumenta;
 *  - y deja INTACTO el doble del test: su `shipmentRequest.findMany` sigue siendo el mismo `jest.fn` (sus `mock.calls`,
 *    `toHaveBeenCalledTimes` y `mockResolvedValue` posteriores ven solo las lecturas de VENTA, como antes de BSD-1.2).
 * ⛔ No afloja ninguna aserción: con cero solicitudes y cero guías de entrada los cuatro renglones nuevos valen 0 y la
 * ganancia es, al centavo, la de antes. Lo nuevo se mide en `test/bsd.b4-pnl.spec.ts` y contra Postgres real.
 */
const isInbound = (args: any): boolean => args?.where?.kind === 'buylist_inbound';

export function withPnlBuylistDoubles<T extends object>(db: T, inbound: () => unknown[] = () => []): T {
  const inboundFindMany = jest.fn(async () => inbound());
  const sellRequestFindMany = jest.fn(async () => []);
  return new Proxy(db, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === 'shipmentRequest' && v) {
        return new Proxy(v, {
          get(t: any, p) {
            if (p === 'findMany') return (args: unknown) => (isInbound(args) ? inboundFindMany() : t.findMany(args));
            return Reflect.get(t, p);
          },
        });
      }
      if (prop === 'sellRequest') {
        return new Proxy(v ?? {}, {
          get(t: any, p) {
            if (p === 'findMany') return t.findMany ?? sellRequestFindMany;
            return Reflect.get(t, p);
          },
        });
      }
      return v;
    },
  });
}
