import { PricingController } from '../src/modules/pricing/pricing.controller';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * v1.50.2 (BREAKING chico, `super_admin`) — **`intent` OBLIGATORIO en `POST /admin/pricing/override`
 * cuando `productType:"graded"`** (API_CONTRACT §M2; ARCHITECTURE §4.38l.1 · INV-D).
 *
 * ### El agujero que cierra, en una frase
 * La fila del **«valor estimado si se gradea»** y la **referencia de mercado real de una pieza PSA N
 * publicada** son **LA MISMA FILA** (`cardId` + `productType='graded'` + `gradeKey` + `finish='normal'`).
 * Así que teclear un «estimado» sobre una carta que además tiene un slab publicado de ese grado
 * **cambia el precio de venta real de esa pieza**. Es preexistente; el gancho lo **amplifica**, porque
 * convierte esa captura en una tarea rutinaria de curaduría.
 *
 * ### Por qué OBLIGATORIO y no opcional-con-default
 * Un `intent` que cayera a `"market"` por omisión es **FAIL-OPEN**: el operador que olvida el campo
 * obtiene, **en silencio**, la ruta que **mueve dinero**. Se acepta el coste de un *breaking* pequeño en
 * una ruta `super_admin` a cambio de que **la ambigüedad sea imposible de expresar**. Es la misma
 * doctrina que «sin escalón no hay destacado» y que «AUSENTE ≠ INVÁLIDA»: cuando la intención se
 * perdió, **no se adivina**.
 */

const REF = {
  id: 'pr-1',
  capturedDate: new Date('2026-08-28T00:00:00.000Z'),
  source: 'manual' as const,
  gradeKey: 'graded:PSA:10',
  productType: 'graded' as const,
  priceMxnCents: 900_000,
  isManualOverride: true,
};

function build(publishedSlabs: { id: string }[] = []) {
  const pricing = {
    // v1.50.3-g (M-44b): el borde llama a `applyManualOverride` (devuelve `{ref, before}`) para poder
    // auditar el monto pisado. `manualOverride` se conserva en el doble porque es el envoltorio que
    // siguen usando los otros call-sites del servicio.
    manualOverride: jest.fn(async () => REF),
    applyManualOverride: jest.fn(async () => ({ ref: REF, before: null })),
    publishedSlabsForGradeKey: jest.fn(async () => publishedSlabs),
  } as unknown as PricingService;
  const audit = { log: jest.fn(async () => undefined) } as unknown as AuditService;
  // v1.50.3-g (SEC-M43-4): el borde exige que la carta EXISTA (antes: `500` por violación de FK).
  const prisma = { card: { findUnique: jest.fn(async () => ({ id: 'c1' })) } };
  const ctrl = new PricingController(
    pricing, {} as never, {} as never, audit, prisma as never, {} as never, {} as never, {} as never,
  );
  return { ctrl, pricing, audit, prisma };
}

/** Los argumentos con los que el borde invocó la escritura (M-44b: ahora es un objeto). */
const wrote = (pricing: PricingService) =>
  (pricing.applyManualOverride as jest.Mock).mock.calls.map(([a]) => a as Record<string, unknown>);

const body = (over: Record<string, unknown> = {}) => ({
  cardId: 'c1',
  productType: 'graded',
  gradeKey: 'graded:PSA:10',
  priceMxnCents: 900_000,
  ...over,
});

describe('POST /admin/pricing/override — `intent` con `productType:"graded"` (INV-D)', () => {
  it('SIN `intent` ⇒ 422 GRADED_INTENT_REQUIRED, y NO se escribe nada', async () => {
    const { ctrl, pricing } = build();
    await expect(ctrl.override(body() as never, 'admin-1')).rejects.toMatchObject({
      code: 'GRADED_INTENT_REQUIRED',
      status: 422,
    });
    // Lo importante no es el código: es que la tabla de dinero NO se tocó.
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('el 422 dice QUÉ hacer: nombra las dos intenciones y qué significa cada una', async () => {
    const { ctrl } = build();
    const err: any = await ctrl.override(body() as never, 'admin-1').catch((e) => e);
    expect(err.message).toContain('market');
    expect(err.message).toContain('graded_estimate');
    expect(err.details).toMatchObject({ field: 'intent' });
  });

  it('`intent:"graded_estimate"` con SLAB PUBLICADO de ese grado ⇒ 409 GRADED_ESTIMATE_SLAB_PUBLISHED', async () => {
    const { ctrl, pricing } = build([{ id: 'inv-1' }, { id: 'inv-2' }]);
    const err: any = await ctrl
      .override(body({ intent: 'graded_estimate' }) as never, 'admin-1')
      .catch((e) => e);
    expect(err.code).toBe('GRADED_ESTIMATE_SLAB_PUBLISHED');
    expect(err.status).toBe(409); // conflicto de ESTADO, no de forma: el body es válido
    // El `details` tiene que permitir ACTUAR: qué piezas son y cuántas.
    expect(err.details).toMatchObject({
      cardId: 'c1',
      gradeKey: 'graded:PSA:10',
      publishedSlabCount: 2,
      inventoryItemIds: ['inv-1', 'inv-2'],
    });
    // …y el mensaje enruta a la salida correcta, no solo prohíbe.
    expect(err.message).toContain('intent:"market"');
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('`intent:"graded_estimate"` SIN slab publicado ⇒ escribe (es el flujo normal del gancho, fase 1)', async () => {
    const { ctrl, pricing } = build([]);
    const res = await ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1');
    expect(res.data.priceMxnCents).toBe(900_000);
    // v1.50.3-f (M-43, §4.38l.4.3): la NATURALEZA la fija el `intent` y viaja a la escritura.
    expect(wrote(pricing)).toEqual([
      {
        cardId: 'c1',
        productType: 'graded',
        gradeKey: 'graded:PSA:10',
        priceMxnCents: 900_000,
        finish: 'normal',
        refKind: 'graded_estimate',
      },
    ]);
  });

  it('`intent:"market"` NO consulta la guarda: es el comportamiento vigente de §M1 v1.28, intacto', async () => {
    const { ctrl, pricing } = build([{ id: 'inv-1' }]);
    const res = await ctrl.override(body({ intent: 'market' }) as never, 'admin-1');
    expect(res.data.priceMxnCents).toBe(900_000);
    // Con un slab publicado, `market` es EXACTAMENTE lo que el operador quiere hacer: fijar su precio.
    expect(pricing.publishedSlabsForGradeKey).not.toHaveBeenCalled();
    expect(wrote(pricing)[0]).toMatchObject({ gradeKey: 'graded:PSA:10', refKind: 'market' });
  });

  /**
   * ===== v1.50.3-f (M-43, §4.38l.4.3) — el `intent` FIJA la naturaleza, no solo la bitácora =====
   *
   * Hasta v1.50.3-e las dos intenciones escribían una fila IDÉNTICA y el `intent` solo viajaba al
   * `AuditLog`. Ése era el hueco: quién decidía si la fila era dinero era el LECTOR, por inferencia
   * sobre el estado del mundo, así que el mismo dato significaba dos cosas distintas en dos instantes
   * distintos **sin que nada cambiara en la fila**. Estos casos fijan el mapeo en el borde HTTP.
   */
  it('M-43 — `intent` ⇒ `refKind`: "market"⇒market, "graded_estimate"⇒graded_estimate', async () => {
    const { ctrl, pricing } = build([]);
    await ctrl.override(body({ intent: 'market' }) as never, 'admin-1');
    await ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1');
    expect(wrote(pricing).map((a) => a.refKind)).toEqual(['market', 'graded_estimate']);
  });

  it('M-43 — con `productType` ≠ graded la naturaleza es SIEMPRE `market`, aunque venga un `intent`', async () => {
    // El contrato dice que fuera de `graded` el `intent` se IGNORA. «Ignorar» tiene que significar
    // `market`: un `intent:"graded_estimate"` colado en un `raw` NO puede sacar del dinero la
    // referencia de una carta suelta — sería una forma de despublicar inventario por un campo que la
    // ruta declara irrelevante.
    const { ctrl, pricing } = build([]);
    await ctrl.override(
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', priceMxnCents: 115_000, intent: 'graded_estimate' } as never,
      'admin-1',
    );
    await ctrl.override(
      { cardId: 'c1', productType: 'sealed', gradeKey: 'sealed', priceMxnCents: 115_000, intent: 'graded_estimate' } as never,
      'admin-1',
    );
    expect(wrote(pricing).map((a) => a.refKind)).toEqual(['market', 'market']);
  });

  it('con `productType` distinto de `graded` el `intent` NI SE EXIGE NI ESTORBA (raw/sealed intactos)', async () => {
    const { ctrl, pricing } = build([{ id: 'inv-1' }]);
    await ctrl.override(
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', priceMxnCents: 115_000 } as never,
      'admin-1',
    );
    await ctrl.override(
      { cardId: 'c1', productType: 'sealed', gradeKey: 'sealed', priceMxnCents: 115_000, intent: 'graded_estimate' } as never,
      'admin-1',
    );
    expect(pricing.applyManualOverride).toHaveBeenCalledTimes(2);
    expect(pricing.publishedSlabsForGradeKey).not.toHaveBeenCalled();
  });

  // v1.50.3-f: el `intent` ya NO es «lo único» que distingue las dos capturas —desde M-43 lo dice la
  // propia fila (`refKind`)—, pero la bitácora sigue siendo la que reconstruye la INTENCIÓN del
  // operador, y eso no lo sustituye una columna de estado.
  it('el `intent` queda en la BITÁCORA: es lo que reconstruye la intención del operador', async () => {
    const { ctrl, audit } = build([]);
    await ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'pricing.override',
        after: expect.objectContaining({ intent: 'graded_estimate' }),
      }),
    );
  });
});

/**
 * §O.8 / criterio **112(b)** — **el intento BLOQUEADO queda auditado**.
 *
 * ### Por qué es su propio bloque de pruebas
 * Los tests de arriba comprueban que la guarda **no escribe** el precio. Eso es la mitad del criterio:
 * §O.8 pide además que «todo intento bloqueado —manual o del ingest— quede **registrado**, para que se
 * vea si la guarda está saltando seguido y por qué». Sin bitácora, el `422`/`409` lo ve **solo** quien
 * hizo la petición y se pierde al cerrar la pestaña: la única señal de que un operador está chocando
 * contra la guarda a diario desaparece, y con ella la evidencia de que la guarda hace falta o de que
 * la UI está enrutando mal.
 *
 * La vía del **ingest** ya cumplía (`PriceIngestService.auditGradedSkip`); la **manual** no. QA lo midió
 * contra el stack vivo: `AuditLog` 421 filas antes, 421 después de un 409 **y** un 422.
 */
describe('POST /admin/pricing/override — el intento BLOQUEADO se AUDITA (§O.8, criterio 112b)', () => {
  const blocked = (audit: AuditService) =>
    (audit.log as jest.Mock).mock.calls
      .map(([e]) => e as { action: string; after: Record<string, unknown> })
      .filter((e) => e.action === 'pricing.override.blocked');

  it('el 422 (sin `intent`) deja fila en la bitácora ANTES de rechazar', async () => {
    const { ctrl, audit, pricing } = build();
    await expect(ctrl.override(body() as never, 'admin-1')).rejects.toMatchObject({ status: 422 });
    const rows = blocked(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({
      code: 'GRADED_INTENT_REQUIRED',
      reason: 'intent_missing',
      cardId: 'c1',
      gradeKey: 'graded:PSA:10',
      // El monto que NO se escribió: sin él la bitácora no permite ver si el operador insiste.
      attemptedPriceMxnCents: 900_000,
      intent: null,
    });
    // La traza no puede haber costado una escritura de dinero.
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('el 409 (slab publicado) deja fila con las piezas reales que lo bloquearon', async () => {
    const { ctrl, audit, pricing } = build([{ id: 'inv-1' }, { id: 'inv-2' }]);
    await expect(
      ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1'),
    ).rejects.toMatchObject({ status: 409 });
    const rows = blocked(audit);
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toMatchObject({
      code: 'GRADED_ESTIMATE_SLAB_PUBLISHED',
      reason: 'slab_published',
      cardId: 'c1',
      gradeKey: 'graded:PSA:10',
      attemptedPriceMxnCents: 900_000,
      intent: 'graded_estimate',
      publishedSlabCount: 2,
      inventoryItemIds: ['inv-1', 'inv-2'],
    });
    expect(pricing.applyManualOverride).not.toHaveBeenCalled();
  });

  it('la ACCIÓN es propia (`pricing.override.blocked`): un intento bloqueado NO es un override', async () => {
    const { ctrl, audit } = build();
    await ctrl.override(body() as never, 'admin-1').catch(() => undefined);
    const actions = (audit.log as jest.Mock).mock.calls.map(([e]) => e.action);
    expect(actions).toEqual(['pricing.override.blocked']);
    // Contarlo como `pricing.override` haría indistinguible «lo escribí» de «me lo negaron».
    expect(actions).not.toContain('pricing.override');
  });

  it('un override LEGÍTIMO no ensucia la bitácora de bloqueos', async () => {
    const { ctrl, audit } = build([]);
    await ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1');
    expect(blocked(audit)).toHaveLength(0);
  });

  it('si la BITÁCORA falla, el rechazo SIGUE en pie (no se convierte en 500 ni se deja pasar)', async () => {
    const { ctrl, audit } = build([{ id: 'inv-1' }]);
    (audit.log as jest.Mock).mockRejectedValue(new Error('audit down'));
    // Perder la traza es malo; dejar pasar el intento por perderla sería MUCHO peor.
    await expect(
      ctrl.override(body({ intent: 'graded_estimate' }) as never, 'admin-1'),
    ).rejects.toMatchObject({ code: 'GRADED_ESTIMATE_SLAB_PUBLISHED', status: 409 });
  });
});
