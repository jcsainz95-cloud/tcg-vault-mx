import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { SELL_REQUEST_LIVE_ADJUSTMENT_STATES } from '../src/modules/buylist/buylist-reject.constants';

const pii = new PiiCryptoService(new ConfigService({}));

/**
 * v1.51 · BL-2 (API_CONTRACT §6, ARCHITECTURE §4.39(b.2)) — **guarda de estado de
 * `POST /buylist/requests/:id/respond`**. Es DINERO SALIENTE.
 *
 * ### El agujero que estos tests cierran
 * Hasta v1.50 `respond` hacía `findUnique` **sólo para autorizar propiedad** y **nunca leía
 * `req.status`**: `accept` fijaba `status:'aprobada'` **incondicionalmente**. El dueño de una
 * solicitud **`pagada`** (dinero ya salió), **`rechazada`** o **`abandonada`** podía re-postear
 * `accept` y **revivirla a `aprobada`** — que junto con `verifiedAt` es exactamente el estado
 * pagable de `paySpei`: una solicitud cerrada volvía sola a la cola de «listas para pagar SPEI».
 * `decline` tenía el hueco simétrico (reescribía una `pagada` a `rechazada`).
 *
 * ### Por qué el mock EVALÚA el `where` en vez de devolver `{count:1}` a ciegas
 * La norma no es «que el servicio verifique el estado»: es **que la verificación viva en el `where`
 * del `updateMany` y se compruebe con `count === 1`**. Un read-then-write sufre TOCTOU y dos
 * `accept` concurrentes pasarían los dos. Por eso `fakeDb()` implementa la semántica CONDICIONAL de
 * `updateMany` (evalúa el predicado contra la fila y aplica el `data` sólo si matchea): con un mock
 * que devolviera `count:1` siempre, estos tests pasarían aunque la guarda no existiera.
 */

/** Fila `SellRequest` con un AJUSTE VIVO — la única situación en que `respond` es legal. */
function liveAdjustmentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sr-1',
    userId: 'u1',
    status: 'verificacion',
    quotedTotalCents: 5000,
    approvedTotalCents: 4000,
    verifiedAt: new Date('2026-08-02T00:00:00Z'),
    approvedAt: null,
    // Ajuste enviado y SIN responder: es lo que hace vivo el plazo de 7d del barrido.
    adjustmentSentAt: new Date('2026-08-03T00:00:00Z'),
    closedAt: null,
    // v1.51.5 (§4.39b.3): la CUARTA condición de la precondición, ya cableada. `null` = solicitud
    // de la cohorte LEGACY (sin oferta emitida), que es la única a la que el ajuste le aplica.
    offerSentAt: null,
    ...over,
  };
}

/** Predicado de una condición Prisma sobre un valor: escalar, `null`, `{not:...}`, `{in:[...]}`. */
function matches(value: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object') {
    const c = cond as Record<string, unknown>;
    if ('in' in c) return (c.in as unknown[]).includes(value);
    if ('not' in c) return !matches(value, c.not);
    if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
    throw new Error(`condición no soportada por el fake: ${JSON.stringify(cond)}`);
  }
  if (value instanceof Date && cond instanceof Date) return value.getTime() === cond.getTime();
  return value === cond;
}

/**
 * Prisma de mentira con la semántica CONDICIONAL de `updateMany`. `sellRequest` es UNA fila; el
 * `where` se evalúa campo por campo y el `data` sólo se aplica si TODOS los campos matchean —
 * exactamente lo que hace el motor, que es donde debe vivir la guarda.
 */
function fakeDb(row: Record<string, unknown>, opts: { readDelayMs?: number } = {}) {
  const state: Record<string, unknown> = { ...row };
  const guardWheres: any[] = [];
  const itemUpdates: any[] = [];

  const prisma: any = {
    kycProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    sellRequest: {
      findUnique: jest.fn(async () => {
        // Ventana de lectura: fuerza el interleaving de dos llamadas concurrentes, de modo que las
        // DOS autoricen contra el MISMO estado inicial. Es el escenario TOCTOU que la guarda mata.
        if (opts.readDelayMs) await new Promise((r) => setTimeout(r, opts.readDelayMs));
        return { ...state };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        guardWheres.push(where);
        const hit = Object.entries(where).every(([k, cond]) => matches(state[k], cond));
        if (!hit) return { count: 0 };
        Object.assign(state, data);
        return { count: 1 };
      }),
      update: jest.fn(async () => {
        throw new Error('respond NO debe transicionar con `update`: la guarda es el updateMany');
      }),
    },
    sellRequestItem: {
      updateMany: jest.fn(async (args: any) => {
        itemUpdates.push(args);
        return { count: 1 };
      }),
    },
    $transaction: jest.fn(async (cb: any, _o?: any) => cb(prisma)),
  };

  const svc = new BuylistService(
    prisma as PrismaService,
    {} as PricingService,
    { getNumber: jest.fn(async () => 100_000_000) } as unknown as SettingsService,
    {} as UsersService,
    pii,
  );
  return { svc, prisma, state, guardWheres, itemUpdates };
}

/** Estados en los que la solicitud YA está cerrada: responder un ajuste ahí es el bug de BL-2. */
const CLOSED_STATES = ['pagada', 'rechazada', 'abandonada'] as const;

describe('BL-2 · respond(accept) — NO revive una solicitud ya cerrada', () => {
  it.each(CLOSED_STATES)(
    'accept sobre una solicitud `%s` ⇒ 409 NO_LIVE_ADJUSTMENT y el estado NO se reescribe',
    async (status) => {
      // Escenario del reporte: la solicitud se cerró (o se pagó) y el ajuste ya se consumió.
      const { svc, state, itemUpdates } = fakeDb(
        liveAdjustmentRow({
          status,
          adjustmentSentAt: null,
          closedAt: new Date('2026-08-10T00:00:00Z'),
          approvedAt: new Date('2026-08-04T00:00:00Z'),
        }),
      );
      await expect(svc.respond('u1', 'sr-1', 'accept')).rejects.toMatchObject({
        code: 'NO_LIVE_ADJUSTMENT',
        status: 409,
        details: { status },
      });
      // LO QUE IMPORTA: la fila quedó intacta. Nada de `aprobada`, nada de `approvedAt` nuevo.
      expect(state.status).toBe(status);
      expect(state.closedAt).toEqual(new Date('2026-08-10T00:00:00Z'));
      expect(state.approvedAt).toEqual(new Date('2026-08-04T00:00:00Z'));
      // Y ni un ítem se movió: la guarda corre ANTES de tocar los ítems.
      expect(itemUpdates).toHaveLength(0);
    },
  );

  it('`pagada` con el ajuste todavía sellado tampoco pasa (closedAt manda por sí solo)', async () => {
    // El caso más caro: `pagada` + `verifiedAt` = la solicitud pagable de `paySpei`. Aunque quedara
    // un `adjustmentSentAt` viejo sin limpiar, `closedAt` la deja fuera.
    const { svc, state } = fakeDb(
      liveAdjustmentRow({ status: 'pagada', closedAt: new Date('2026-08-10T00:00:00Z') }),
    );
    await expect(svc.respond('u1', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
      details: { status: 'pagada' },
    });
    expect(state.status).toBe('pagada');
  });

  it('re-`accept` sobre un ajuste YA consumido ⇒ 409, NO un 200 idempotente', async () => {
    // El primer accept limpia `adjustmentSentAt`; el segundo cae por eso mismo. La idempotencia
    // silenciosa está PROHIBIDA aquí: este verbo mueve dinero (contrato §6 v1.51).
    const { svc, state } = fakeDb(liveAdjustmentRow());
    await svc.respond('u1', 'sr-1', 'accept');
    expect(state.status).toBe('aprobada');
    expect(state.adjustmentSentAt).toBeNull();
    await expect(svc.respond('u1', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
      details: { status: 'aprobada' },
    });
  });

  it('`cotizada`/`recibida` (todavía sin ajuste enviado) tampoco son respondibles', async () => {
    for (const status of ['cotizada', 'recibida']) {
      const { svc, state } = fakeDb(liveAdjustmentRow({ status, adjustmentSentAt: null }));
      await expect(svc.respond('u1', 'sr-1', 'accept')).rejects.toMatchObject({
        code: 'NO_LIVE_ADJUSTMENT',
        details: { status },
      });
      expect(state.status).toBe(status);
    }
  });
});

describe('BL-2 · respond(decline) — las MISMAS guardas (hueco simétrico)', () => {
  it.each(CLOSED_STATES)(
    'decline sobre una solicitud `%s` ⇒ 409 NO_LIVE_ADJUSTMENT sin tocar la fila',
    async (status) => {
      const closedAt = new Date('2026-08-10T00:00:00Z');
      const { svc, state } = fakeDb(
        liveAdjustmentRow({ status, adjustmentSentAt: null, closedAt }),
      );
      await expect(svc.respond('u1', 'sr-1', 'decline')).rejects.toMatchObject({
        code: 'NO_LIVE_ADJUSTMENT',
        status: 409,
        details: { status },
      });
      // Concreto: una `pagada` NO se puede reescribir a `rechazada` (borraría el rastro del pago),
      // y el `closedAt` original —ancla de la retención de INE, SEC-D2— no se re-sella.
      expect(state.status).toBe(status);
      expect(state.closedAt).toEqual(closedAt);
    },
  );

  it('decline CON ajuste vivo sigue funcionando: rechazada + closedAt', async () => {
    const { svc, state } = fakeDb(liveAdjustmentRow());
    const res: any = await svc.respond('u1', 'sr-1', 'decline');
    expect(res.status).toBe('rechazada');
    expect(state.status).toBe('rechazada');
    expect(state.closedAt).toBeInstanceOf(Date);
    // SEC-D2 / S49-M1: `closedAt` es interno y NO viaja al cliente aunque se acabe de escribir.
    expect(res.closedAt).toBeUndefined();
  });

  it('un segundo decline (ya `rechazada` y cerrada) ⇒ 409, sin re-sellar closedAt', async () => {
    const { svc, state } = fakeDb(liveAdjustmentRow());
    await svc.respond('u1', 'sr-1', 'decline');
    const firstClosedAt = state.closedAt;
    await expect(svc.respond('u1', 'sr-1', 'decline')).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
      details: { status: 'rechazada' },
    });
    expect(state.closedAt).toBe(firstClosedAt);
  });
});

describe('BL-2 · el flujo LEGÍTIMO no se rompe', () => {
  it.each([...SELL_REQUEST_LIVE_ADJUSTMENT_STATES])(
    'accept con ajuste vivo en `%s` ⇒ aprobada + approvedAt, ajuste consumido e ítems movidos',
    async (status) => {
      const { svc, state, itemUpdates } = fakeDb(liveAdjustmentRow({ status }));
      const res: any = await svc.respond('u1', 'sr-1', 'accept');

      // Efecto IDÉNTICO al de v1.50 en el camino legal: esto es lo que prueba que no se rompió nada.
      expect(state.status).toBe('aprobada');
      expect(state.adjustmentSentAt).toBeNull();
      expect(state.approvedAt).toBeInstanceOf(Date);
      expect(itemUpdates).toEqual([
        {
          where: { sellRequestId: 'sr-1', itemStatus: 'ajustada' },
          data: { itemStatus: 'aprobada' },
        },
      ]);
      // Y la respuesta sigue siendo la proyección de CLIENTE (sin `closedAt` ni `paidBy`).
      expect(res.status).toBe('aprobada');
      expect(res).not.toHaveProperty('closedAt');
      expect(res).not.toHaveProperty('paidBy');
      expect(res).not.toHaveProperty('clabeSnapshotEnc');
    },
  );

  it('la guarda vive en el `where` del updateMany, no en un `if` de aplicación', async () => {
    // Estructural: si alguien mueve la verificación a un `if` previo (read-then-write), este test
    // cae. Es la diferencia entre una guarda atómica y una carrera esperando a ocurrir.
    const { svc, guardWheres } = fakeDb(liveAdjustmentRow());
    await svc.respond('u1', 'sr-1', 'accept');
    expect(guardWheres).toHaveLength(1);
    expect(guardWheres[0]).toMatchObject({
      id: 'sr-1',
      userId: 'u1', // autorización TAMBIÉN en el where: no cuelga de la lectura previa.
      closedAt: null,
      adjustmentSentAt: { not: null },
      status: { in: [...SELL_REQUEST_LIVE_ADJUSTMENT_STATES] },
    });
  });
});

describe('BL-2 · anti-IDOR: la guarda no relaja la propiedad', () => {
  it('un tercero con sesión propia ⇒ 404 (no 409, no se confirma la existencia) y sin escritura', async () => {
    const { svc, prisma, state } = fakeDb(liveAdjustmentRow());
    await expect(svc.respond('otro-user', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(prisma.sellRequest.updateMany).not.toHaveBeenCalled();
    expect(state.status).toBe('verificacion');
  });
});

describe('BL-2 · concurrencia: dos `accept` simultáneos, UNA sola transición', () => {
  it('sólo la llamada que hace `count===1` transiciona; la otra recibe 409', async () => {
    // Las DOS leen (y autorizan) contra el mismo estado inicial —el `readDelayMs` fuerza ese
    // interleaving—, así que un `if` sobre la lectura previa habría dejado pasar las dos.
    const { svc, state, prisma, itemUpdates } = fakeDb(liveAdjustmentRow(), { readDelayMs: 5 });
    const results = await Promise.allSettled([
      svc.respond('u1', 'sr-1', 'accept'),
      svc.respond('u1', 'sr-1', 'accept'),
    ]);

    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ code: 'NO_LIVE_ADJUSTMENT', status: 409 });

    // Las dos intentaron el updateMany; sólo una matcheó.
    expect(prisma.sellRequest.updateMany).toHaveBeenCalledTimes(2);
    expect(state.status).toBe('aprobada');
    expect(state.adjustmentSentAt).toBeNull();
    // Y los ítems se movieron UNA vez: la perdedora no llega a tocarlos.
    expect(itemUpdates).toHaveLength(1);
  });

  it('accept y decline simultáneos: gana uno, y el otro NO pisa el desenlace', async () => {
    const { svc, state } = fakeDb(liveAdjustmentRow(), { readDelayMs: 5 });
    const results = await Promise.allSettled([
      svc.respond('u1', 'sr-1', 'accept'),
      svc.respond('u1', 'sr-1', 'decline'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    // El estado final es UNO de los dos desenlaces, nunca una mezcla.
    expect(['aprobada', 'rechazada']).toContain(state.status);
  });
});

// =============================================================================================
// v1.51.5 (§4.39b.3) — LA CUARTA CONDICIÓN, ya cableada: cierre de los dos `TODO(M-46)`
// =============================================================================================
/**
 * El JSDoc de `respond` afirmaba que `offerSentAt IS NULL` *«no se puede cablear sin inventar la
 * columna»*. **`offerSentAt` existe desde M-46**, así que el bloqueo desapareció y el `TODO` pasó a
 * ser **documentación que miente**.
 *
 * **La ruta de ajuste NO muere con el ciclo (§4.39b.3): sobrevive a UNA COHORTE.** Para toda
 * solicitud nueva es *inalcanzable por construcción* (`recibida` solo se llega vía
 * `en_transito ← aceptada ← ofertada` ⇒ nunca sin `offerSentAt`), pero la cohorte **legacy en vuelo**
 * al cut-over **la necesita**: apagar la salida el día que se apaga la entrada dejaría a un vendedor
 * con un ajuste vivo y **sin forma de aceptar un dinero que ya le propusimos**.
 */
describe('v1.51.5 · `respond` — la solicitud del CICLO no se ajusta (criterio 150)', () => {
  it.each([['accept'], ['decline']] as const)(
    '%s con `offerSentAt` poblado ⇒ 409 ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE, y NADA se mueve',
    async (decision) => {
      // Peor caso posible: ajuste VIVO y estado legal. Lo único que la descalifica es el ciclo.
      const { svc, state } = fakeDb(
        liveAdjustmentRow({ offerSentAt: new Date('2026-08-04T00:00:00Z') }),
      );
      await expect(svc.respond('u1', 'sr-1', decision)).rejects.toMatchObject({
        code: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
        status: 409,
        details: { status: 'verificacion' },
      });
      // El precio ofertado es vinculante desde el correo y NO se mueve (D2/D9): ni por esta puerta.
      expect(state.status).toBe('verificacion');
      expect(state.approvedAt).toBeNull();
      expect(state.closedAt).toBeNull();
      expect(state.adjustmentSentAt).not.toBeNull();
    },
  );

  it('la CUARTA condición vive en el `where` del updateMany, no en un `if` de aplicación', async () => {
    const { svc, guardWheres } = fakeDb(liveAdjustmentRow());
    await svc.respond('u1', 'sr-1', 'accept');
    expect(guardWheres[0]).toMatchObject({ offerSentAt: null });
  });

  it('⚠️ los DOS códigos 409 discriminan: «no hay ajuste» ≠ «aquí no se ajusta NUNCA»', async () => {
    // Sin ajuste vivo y sin ciclo ⇒ NO_LIVE_ADJUSTMENT (puede resolverse esperando un ajuste).
    const sinAjuste = fakeDb(liveAdjustmentRow({ adjustmentSentAt: null }));
    await expect(sinAjuste.svc.respond('u1', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'NO_LIVE_ADJUSTMENT',
    });
    // Con ciclo ⇒ ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE (no se resolverá jamás). *Un código que miente
    // sobre la causa manda a alguien a esperar algo que no va a pasar.*
    const enCiclo = fakeDb(
      liveAdjustmentRow({ adjustmentSentAt: null, offerSentAt: new Date('2026-08-04T00:00:00Z') }),
    );
    await expect(enCiclo.svc.respond('u1', 'sr-1', 'accept')).rejects.toMatchObject({
      code: 'ADJUST_NOT_ALLOWED_IN_OFFER_CYCLE',
    });
  });

  it('la cohorte LEGACY sigue pudiendo responder: sin `offerSentAt`, el flujo intacto', async () => {
    const { svc, state } = fakeDb(liveAdjustmentRow());
    await svc.respond('u1', 'sr-1', 'accept');
    expect(state.status).toBe('aprobada');
    expect(state.adjustmentSentAt).toBeNull();
  });
});

// =============================================================================================
// v1.51.5 — el `TODO(M-46)` no puede volver: es documentación que se vuelve falsa
// =============================================================================================
describe('v1.51.5 · guard de residuo — cero `TODO(M-46)` en `src/`', () => {
  it('no queda ningún `TODO(M-46)` pendiente (su bloqueo desapareció con la migración)', () => {
    const SRC = join(__dirname, '..', 'src');
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
      );
    const ofensores = walk(SRC).filter((f) => {
      const text = readFileSync(f, 'utf8');
      // Se busca el marcador PENDIENTE, no las menciones en prosa de que ya se cerró.
      return /TODO\(M-46\):/.test(text);
    });
    expect(ofensores).toEqual([]);
  });
});
