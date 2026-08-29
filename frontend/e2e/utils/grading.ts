import { IS_REAL, apiAs, apiAsOk, resolveApiBaseUrl } from './env';
import { readState, sharedOnce, writeState, clearState } from './state';

/**
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ESCENARIO DEL «GANCHO DE GRADING», AGNÓSTICO AL ENTORNO (PROJECT §O, contrato v1.50.x).
 *
 * POR QUÉ EXISTE — el bloqueante de QA. `grading-estimate.spec.ts` navegaba a ids de FIXTURE
 * (`c-blastoise`, `c-eevee`, `c-pikachu`, `c-milotic-fa`) que no existen en el seed real, y no
 * declaraba `mockOnly`. Resultado: 9 rojos contra el stack vivo y, peor, **cero cobertura del
 * gancho en el subset `@real`** — el único gate que corre contra la plataforma levantada. El
 * «97/97» era verdad, pero medido contra las propias simulaciones del front.
 *
 * Se eligió la opción cara: **reescribir los specs agnósticos al fixture**, no taparlos con
 * `mockOnly`. Este módulo resuelve «¿qué cartas uso?» según el entorno:
 *
 *   MOCK  → devuelve los ids de `src/lib/mock/fixtures.ts`. Cero I/O.
 *   REAL  → DESCUBRE cartas del catálogo publicado y **siembra el escenario por la API del
 *           contrato** (los mismos endpoints que usa el back-office: `PUT /admin/settings`
 *           para el interruptor maestro y `POST /admin/pricing/override` con
 *           `intent:"graded_estimate"` para las cifras). Después **verifica con
 *           `GET /admin/pricing/graded-estimates/preview`** que el gate quedó donde el test
 *           necesita. Ningún monto se hornea: se derivan de los diales VIVOS del entorno.
 *
 * El resultado es que los MISMOS asserts (bloque en la ficha, micro-aviso visible con los
 * `sr-only` ocultos, nota al pie, badge de la teja, vitrina del home) corren contra los
 * fixtures Y contra el backend real. Es lo que convierte al gancho en algo que el gate puede
 * afirmar.
 *
 * ¿Por qué sembrar y no exigirle la fila al seed? Porque la captura manual **es** la fase 1 del
 * gancho (§O.6, decisión 47): sembrarla por su propio endpoint ejercita de punta a punta la vía
 * que el producto usa de verdad, incluida la obligatoriedad de `intent` (§4.38l). Un seed con la
 * fila ya puesta probaría menos.
 *
 * HUELLA QUE DEJA EN EL ENTORNO (declarada, no escondida):
 *  - El dial `gradedEstimatesEnabled` se enciende y **se restaura en `globalTeardown`**
 *    (`restoreGradingDial`), leyendo el valor previo de un archivo de estado.
 *  - Las `PriceReference` de estimado quedan escritas. La mitigación vigente es que la siembra sea
 *    IDEMPOTENTE (un override posterior supersede al anterior) y que el dial vuelva a `off`: **nada
 *    de lo sembrado se publica**. *(v1.50.3-d: el contrato **ya norma** el borrado —`DELETE
 *    /admin/pricing/graded-estimates/:cardId/:gradeValue`—, así que el teardown podrá además
 *    **retirar** lo sembrado. No se cablea aquí todavía: el endpoint aún no está desplegado en el
 *    stack real y un teardown que llama a una ruta inexistente solo añade ruido a corridas ya
 *    terminadas. Anotado en `docs/FRONTEND_NOTES.md`.)*
 * ─────────────────────────────────────────────────────────────────────────────────────
 */

export interface GradingCard {
  /** `cardId` para navegar a `/{locale}/catalog/{id}`. */
  id: string;
  /** Nombre visible: sirve de ancla para esperar a que la ficha/teja resuelva. */
  name: string;
}

export interface GradingScenario {
  /**
   * Carta raw con estimado de **PSA 10 y PSA 9** que **pasa el gate de ROI**: bloque en la ficha,
   * badge en la teja de Compra y presencia en la vitrina del home.
   */
  curated: GradingCard;
  /**
   * Carta raw con estimado de **un solo grado** (PSA 10) ⇒ la **ficha informa** pero la teja
   * **no promueve**: sin estimado de PSA 9 no hay promoción (PROJECT §O.4). Cubre a la vez el
   * estado «un solo grado» (§22.7) y el estado «informar ≠ promover» (§22.7).
   */
  informed: GradingCard;
  /** Carta cuya ficha **no debe** mostrar el gancho en absoluto (R4: ni bloque, ni nota, ni rastro). */
  bare: GradingCard;
  /** Grados que la FICHA pinta (dial `grades`). Se lee del entorno, no se hornea. */
  detailGrades: string[];
  /** Grados que el BADGE pinta (dial `highlightGrades`). */
  badgeGrades: string[];
}

/** Escenario de MOCK: los fixtures de `src/lib/mock/fixtures.ts`, sin tocar red. */
const MOCK_SCENARIO: GradingScenario = {
  curated: { id: 'c-blastoise', name: 'Blastoise' },
  informed: { id: 'c-eevee', name: 'Eevee' },
  bare: { id: 'c-pikachu', name: 'Pikachu' },
  detailGrades: ['10', '9'],
  badgeGrades: ['10'],
};

// ── Tipos mínimos del contrato que este helper consume (no se re-declara el DTO entero) ──

interface GradingCostTier {
  minValueMxnCents: number;
  maxValueMxnCents: number | null;
  costMxnCents: number;
}

interface GradedEstimateConfig {
  enabled: boolean;
  grades: string[];
  highlightGrades: string[];
  minUpsidePct: number;
  maxRawMultiple: number;
  gradingCostTiers: GradingCostTier[];
}

interface CatalogGroup {
  representativeInventoryItemId: string;
  card: { id: string; name: string };
  productType: 'raw' | 'graded' | 'sealed';
  salePriceCents?: number | null;
}

interface PreviewGroup {
  salePriceCents: number | null;
  psa10MxnCents: number | null;
  psa9MxnCents: number | null;
  eligible: boolean;
  reason?: string;
}

interface PreviewResponse {
  enabled: boolean;
  groups: PreviewGroup[];
}

/** Escalón `[min, max)` que cubre `valueCents`, o `null` (sin escalón no hay destacado, §O.2.1). */
function tierFor(tiers: GradingCostTier[], valueCents: number): GradingCostTier | null {
  return (
    tiers.find(
      (t) =>
        valueCents >= t.minValueMxnCents &&
        (t.maxValueMxnCents === null || valueCents < t.maxValueMxnCents),
    ) ?? null
  );
}

/**
 * Deriva un par (PSA 10, PSA 9) que **pasa el gate de ROI** con los diales VIVOS del entorno:
 *
 *   promocionable ⇔ psa9 ≥ (precioRaw + costoDelEscalón(psa10)) × (1 + minUpsidePct/100)
 *
 * El costo depende del propio PSA 10 (escalones por valor declarado, §O.2.1), así que se itera:
 * se propone un PSA 10, se resuelve su escalón, se calcula el PSA 9 mínimo con holgura y, si el
 * PSA 9 se salió por encima del PSA 10 (que sería `GRADE_ORDER_INVERTED`), se sube el PSA 10 y se
 * repite. Converge en una o dos vueltas con cualquier tabla razonable.
 *
 * NO se replica el gate como oráculo del test: esto solo elige DATOS. Quien dice si la carta
 * quedó destacada es el backend, vía `preview` (ver `assertPreview`).
 */
function amountsThatPassTheGate(
  salePriceCents: number,
  cfg: GradedEstimateConfig,
): { psa10: number; psa9: number } {
  // Cota superior de magnitud del gate de confianza; se deja holgura para no rozarla.
  const maxPsa10 = Math.floor(salePriceCents * cfg.maxRawMultiple * 0.8);
  let psa10 = Math.min(salePriceCents * 10, maxPsa10);
  let psa9 = 0;

  for (let i = 0; i < 4; i++) {
    const tier = tierFor(cfg.gradingCostTiers, psa10);
    if (!tier) {
      throw new Error(
        `Ningún escalón de gradingCostTiers cubre ${psa10} centavos. ` +
          `Revisa la tabla del entorno (GET /admin/pricing/graded-estimates).`,
      );
    }
    // 10 % de holgura sobre el umbral: el test no debe quedar en el filo de un redondeo.
    psa9 = Math.ceil((salePriceCents + tier.costMxnCents) * (1 + cfg.minUpsidePct / 100) * 1.1);
    if (psa9 < psa10) break;
    psa10 = Math.min(psa9 * 2, maxPsa10);
  }

  if (!(psa9 > 0 && psa9 < psa10 && psa10 > salePriceCents && psa10 <= maxPsa10)) {
    throw new Error(
      `No se pudo derivar un par PSA10/PSA9 que pase el gate con los diales del entorno ` +
        `(raw=${salePriceCents}, minUpsidePct=${cfg.minUpsidePct}, maxRawMultiple=${cfg.maxRawMultiple}). ` +
        `Sube maxRawMultiple o baja minUpsidePct en el entorno de pruebas.`,
    );
  }
  return { psa10, psa9 };
}

/**
 * Claves del estado compartido. Van **por API base**: apuntar la suite a otro stack no puede
 * reutilizar el escenario —ni el valor previo del dial— de un entorno distinto.
 */
async function stateKeys(): Promise<{ dial: string; scenario: string }> {
  const apiBase = await resolveApiBaseUrl();
  return { dial: `grading:dial-master-switch:${apiBase}`, scenario: `grading:scenario:${apiBase}` };
}

interface DialState {
  /** Valor que tenía `gradedEstimatesEnabled` ANTES de que la suite lo tocara. */
  previous: string;
}

/** Publica el estimado de un grado por la MISMA vía que el back-office (`intent:"graded_estimate"`). */
async function captureEstimate(cardId: string, gradeValue: string, cents: number): Promise<void> {
  const res = await apiAs('admin', 'POST', '/admin/pricing/override', {
    cardId,
    productType: 'graded',
    gradeKey: `graded:PSA:${gradeValue}`,
    priceMxnCents: cents,
    intent: 'graded_estimate',
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `No se pudo capturar el estimado PSA ${gradeValue} de ${cardId}: ` +
        `${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`,
    );
  }
}

async function previewOf(cardId: string): Promise<PreviewResponse> {
  return apiAsOk<PreviewResponse>(
    'admin',
    'GET',
    `/admin/pricing/graded-estimates/preview?cardId=${encodeURIComponent(cardId)}`,
  );
}

/**
 * Siembra el escenario contra el backend REAL y devuelve las cartas descubiertas.
 * Corre **una vez por corrida** (candado compartido entre workers, ver `./state`).
 */
async function seedRealScenario(): Promise<GradingScenario> {
  // 1. Catálogo publicado: de aquí salen las cartas. Nada se hornea.
  const catalog = await apiAsOk<{ data: CatalogGroup[] }>(
    'admin',
    'GET',
    '/catalog/cards?pageSize=100',
  );
  const groups = catalog.data ?? [];
  const rawGroups = groups
    .filter((g) => g.productType === 'raw' && (g.salePriceCents ?? 0) > 0)
    .sort((a, b) => (b.salePriceCents ?? 0) - (a.salePriceCents ?? 0));

  if (rawGroups.length < 2) {
    throw new Error(
      `El gancho de grading necesita al menos DOS cartas raw publicadas en el seed y hay ` +
        `${rawGroups.length}. Corre \`npm run seed:synthetic\` en backend/.`,
    );
  }

  // «Sin gancho»: preferentemente una GRADEADA — el contrato prohíbe el gancho ahí (§2: nunca
  // para una gradeada), así que es un caso más fuerte que «una raw a la que no le escribimos».
  const notRaw = groups.find((g) => g.productType !== 'raw');
  const bareGroup = notRaw ?? rawGroups[2];
  if (!bareGroup) {
    throw new Error(
      'El seed no tiene ninguna carta gradeada/sellada ni una tercera raw para el caso «sin gancho».',
    );
  }

  const curated = rawGroups[0];
  const informed = rawGroups[1];

  // 2. Interruptor maestro M10. Se guarda el valor previo ANTES de tocarlo (solo la primera vez:
  //    una segunda corrida no debe registrar «on» como si fuese el estado pristino).
  const keys = await stateKeys();
  const settings = await apiAsOk<Record<string, unknown>>('admin', 'GET', '/admin/settings');
  const previous = String(settings.gradedEstimatesEnabled ?? 'off');
  if (!readState<DialState>(keys.dial)) {
    writeState<DialState>(keys.dial, { previous });
  }
  await apiAsOk('admin', 'PUT', '/admin/settings', { gradedEstimatesEnabled: 'on' });

  // 3. Diales del gancho: de aquí salen los grados a asertar y la matemática de los montos.
  const cfg = await apiAsOk<GradedEstimateConfig>('admin', 'GET', '/admin/pricing/graded-estimates');

  // 4. Siembra por la vía del contrato.
  const [gradeHigh, gradeLow] = [...cfg.grades].sort((a, b) => Number(b) - Number(a));
  const { psa10, psa9 } = amountsThatPassTheGate(curated.salePriceCents!, cfg);
  await captureEstimate(curated.card.id, gradeHigh, psa10);
  await captureEstimate(curated.card.id, gradeLow, psa9);
  // `informed`: SOLO el grado alto. Sin PSA 9 no hay promoción (§O.4) ⇒ ficha con una cifra y
  // teja sin badge. Coherente de magnitud (por encima del raw, muy por debajo del múltiplo máximo)
  // para que el motivo sea `NO_PSA9` y no una incoherencia.
  await captureEstimate(informed.card.id, gradeHigh, informed.salePriceCents! * 8);

  // 5. VERIFICACIÓN con el diagnóstico del backend: quien dice si el gate pasó es el servidor.
  const curatedPreview = await previewOf(curated.card.id);
  const curatedGroup = curatedPreview.groups.find((g) => g.eligible);
  if (!curatedPreview.enabled || !curatedGroup) {
    throw new Error(
      `La carta curada (${curated.card.name}) NO quedó elegible tras sembrarla. ` +
        `preview=${JSON.stringify(curatedPreview.groups).slice(0, 400)}`,
    );
  }

  const informedPreview = await previewOf(informed.card.id);
  const informedGroup = informedPreview.groups[0];
  if (!informedGroup || informedGroup.eligible || informedGroup.psa9MxnCents !== null) {
    throw new Error(
      `La carta «informada» (${informed.card.name}) debía quedar con UN solo grado y sin destacar ` +
        `(reason NO_PSA9), y quedó: ${JSON.stringify(informedGroup)}. ` +
        `Probablemente una corrida anterior le escribió un PSA ${gradeLow}: retíralo con ` +
        `DELETE /admin/pricing/graded-estimates/${informed.card.id}/${gradeLow} (contrato ` +
        `v1.50.3-d) o re-siembra la base (npm run seed:synthetic).`,
    );
  }

  return {
    curated: { id: curated.card.id, name: curated.card.name },
    informed: { id: informed.card.id, name: informed.card.name },
    bare: { id: bareGroup.card.id, name: bareGroup.card.name },
    detailGrades: [...cfg.grades].sort((a, b) => Number(b) - Number(a)),
    badgeGrades: [...cfg.highlightGrades].sort((a, b) => Number(b) - Number(a)),
  };
}

/** TTL del escenario sembrado: una corrida larga no vuelve a sembrar, pero una nueva sí. */
const SCENARIO_TTL_MS = 30 * 60 * 1000;

/**
 * El escenario del gancho para el entorno actual. En mock es una constante; en real siembra
 * (una sola vez por corrida, con candado entre workers) y verifica contra `preview`.
 */
export async function gradingScenario(): Promise<GradingScenario> {
  if (!IS_REAL) return MOCK_SCENARIO;
  const keys = await stateKeys();
  return sharedOnce<GradingScenario>(keys.scenario, {
    isFresh: (_value, at) => Date.now() - at < SCENARIO_TTL_MS,
    compute: seedRealScenario,
    // Sembrar cuesta unas pocas llamadas; el resto de workers espera a que termine.
    timeoutMs: 180_000,
  });
}

/**
 * Devuelve el interruptor maestro al valor que tenía antes de la suite. Lo llama el
 * `globalTeardown` de `playwright.config.ts`, que corre UNA vez cuando todos los workers
 * terminaron — no un `afterAll` por worker, que apagaría el dial mientras otro worker sigue
 * navegando.
 */
export async function restoreGradingDial(): Promise<void> {
  let previous = '(desconocido)';
  try {
    const keys = await stateKeys();
    const saved = readState<DialState>(keys.dial);
    // Sin archivo de estado, la suite no tocó el dial: no hay nada que deshacer.
    if (!saved) return;
    previous = saved.value.previous;
    await apiAsOk('admin', 'PUT', '/admin/settings', { gradedEstimatesEnabled: previous });
    clearState(keys.dial);
    clearState(keys.scenario);
  } catch (error) {
    // Se AVISA pero no se tumba una corrida ya terminada (p. ej. el stack se cayó a mitad). El
    // archivo de estado se conserva a propósito: la siguiente corrida encontrará el valor pristino
    // y volverá a intentar restaurarlo, en vez de grabar «on» como si fuese el original.
    console.warn(
      `[e2e] No se pudo restaurar gradedEstimatesEnabled a "${previous}": ${String(error)}. ` +
        `Revísalo a mano: es una afirmación comercial encendida en el entorno.`,
    );
  }
}
