import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { getBadgeSpec, type StatusDomain } from './status-map';

function keyPaths(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

function stringEntries(obj: unknown, prefix = ''): [string, string][] {
  if (typeof obj === 'string') return [[prefix, obj]];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    stringEntries(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n catalogs', () => {
  it('ES and EN have identical key sets (no missing translations)', () => {
    const esKeys = keyPaths(es).sort();
    const enKeys = keyPaths(en).sort();
    expect(esKeys).toEqual(enKeys);
  });

  // The brand is TCG HUNT (common.brand.name). "TCG Vault MX" is the internal
  // project/doc name and must never leak into buyer-facing copy.
  it.each([
    ['es', es],
    ['en', en],
  ])('%s contains no string with the retired "TCG Vault" name', (_locale, catalog) => {
    const offenders = stringEntries(catalog)
      .filter(([, value]) => /tcg\s*vault/i.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * DESIGN_SYSTEM §22.13(h)/(k.k) — el disclaimer del gancho **YA está aprobado por el dueño**
   * (2026-08-31). El copy anterior de M10 decía lo contrario, y decirlo hoy sería **publicar en
   * pantalla algo falso**, precisamente en la pantalla que existe para que nadie encienda una
   * fuente de gasto a ciegas. Lo único que sigue siendo verdad —«sin revisión legal profesional»—
   * se conserva, y se caerá el día que un abogado revise el texto.
   *
   * Es el mismo candado que el de la marca de arriba: una afirmación de HECHO que el catálogo no
   * puede contradecir, verificada sobre `messages/` y no sobre otro documento.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s no afirma que el disclaimer del gancho carezca del visto bueno del dueño', (_locale, catalog) => {
    const offenders = stringEntries(catalog)
      .filter(([, value]) =>
        /(no tiene el visto bueno del dueño|todavía no tiene el visto bueno|not been signed off by the owner)/i.test(
          value,
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * DESIGN_SYSTEM §22.13(d.1)/(h)/(k.l)/(k.o) — **ninguna cifra de créditos sin su supuesto en la
   * misma frase**. El techo diario (`{credits}`) solo vale si el proveedor cobra **por petición**;
   * la petición manda `fetchAllInSet=true` —pide el set entero—, así que si cobra por carta
   * devuelta el gasto real puede ser **varias veces** mayor (un factor de 16 con los topes de hoy).
   * Escribirla desnuda es enseñarle al dueño una hipótesis con cara de medición, en la pantalla que
   * existe para que no encienda una fuente de gasto a ciegas.
   *
   * Va aquí, sobre el CATÁLOGO, y no solo sobre la pantalla, por la lección que dejó este defecto:
   * el test que lo cubría fijaba la cifra desnuda y por tanto **protegía la falsedad en CI**. Un
   * candado sobre el texto renderizado se mueve reescribiendo el texto; este se mueve solo
   * quitándole el calificador a la cadena, que es exactamente lo que debe estar prohibido.
   */
  // El calificador se busca por su NÚCLEO («cobra por petición» / «charges per request») y no por
  // la frase entera de M10: §22.14 añadió una segunda superficie que publica la misma cifra —el
  // aviso de gasto de M2— y allí el sujeto es explícito («si **el proveedor** cobra por petición»).
  // Un candado que exigiera la variante literal de una pantalla dejaría la otra sin cubrir.
  it.each([
    ['es', es, /cobra por petición/],
    ['en', en, /charges per request/],
  ])(
    '%s no publica un techo de créditos sin el régimen de cobro que lo condiciona',
    (_locale, catalog, condicional) => {
      const conCifra = stringEntries(catalog).filter(([, value]) =>
        // El `<\/n>` de en medio es el rich text que pone la cifra en mono (§20.14): la cifra y su
        // unidad viajan pegadas aunque el markup las separe.
        /\{credits[^}]*\}(?:<\/?[a-z]+>|\s)*(créditos al día|credits a day)/.test(value),
      );
      // La cifra NO se borra (§22.13d.1: un aviso de gasto sin orden de magnitud no deja decidir):
      // se publica con su supuesto pegado. Si nadie la interpola, este candado no verifica nada.
      expect(conCifra.length).toBeGreaterThan(0);
      for (const [path, value] of conCifra) {
        // O bien la frase nombra el régimen de cobro que la hace válida (`on`), o bien declara que
        // la cifra está MEDIDA con su fecha (`onMeasured`). No hay tercera forma legítima.
        const calificada =
          condicional.test(value) || /\{measuredOn\}/.test(value);
        expect(calificada, `${path}: cifra de créditos sin calificador`).toBe(true);
      }
    },
  );

  /*
   * §22.13(h) — «aproximadamente», «~» o «estimado» NO son calificadores válidos: sugieren un error
   * de REDONDEO sobre un número correcto. El error posible es un **factor**, no un decimal, y su
   * causa es un supuesto de facturación sin observar.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s no califica el techo de créditos con un simple «aproximadamente»/«~»', (_locale, catalog) => {
    const offenders = stringEntries(catalog)
      .filter(([, value]) =>
        /(aproximadamente|approximately|unos|around|about|~)\s*<?[a-z]*>?\{credits/i.test(value),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * §22.13(d.1)/(k.o) — el candado de arriba solo mira las cadenas que INTERPOLAN `{credits}`. QA
   * demostró que la falsedad no necesita el placeholder: basta teclear la cifra a mano
   * («gasta 1000 créditos al día»), y entonces ni la paridad ni la pantalla la veían. Aquí se
   * prohíbe la cifra LITERAL en cualquier idioma: el techo se calcula en `grading-hook-cost.ts` y
   * se interpola, nunca se escribe. Un número escrito a mano en el copy es, por construcción, un
   * número que nadie recalcula cuando el tope cambia.
   */
  it.each([
    ['es', es, /\d[\d.,\s]*\s*créditos al día/],
    ['en', en, /\d[\d.,\s]*\s*credits a day/],
  ])('%s no escribe NINGUNA cifra de créditos a mano (solo se interpola)', (_locale, catalog, literal) => {
    const offenders = stringEntries(catalog)
      .filter(([, value]) => literal.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * §22.13(e)/(f)/(k.r) — **cero apariciones de «grados» como remedio**. En M2 los grados son un
   * párrafo READ-ONLY (`server.grades.join(' · ')`), no un control: mientras no exista editor,
   * nombrarlos en el aviso de apagado o en la nota es prometerle al dueño una palanca que no
   * puede accionar — el mismo defecto que §22.14 corrige con el tope, en el escalón de en medio.
   * La escalera de remedios pasa a DOS escalones, y los dos existen en pantalla.
   */
  it.each([
    ['es', es, /\bgrados\b/i],
    ['en', en, /\bgrades\b/i],
  ])('%s no ofrece «los grados» como remedio en el aviso de apagado ni en la nota del gancho', (_locale, catalog, grados) => {
    const remedios = stringEntries(catalog).filter(([path]) =>
      ['admin.m10.dials.gradingHook.off', 'admin.m10.dials.gradingHook.note'].includes(path),
    );
    // Si alguien renombra las claves, el candado no puede quedar mirando al vacío y aprobando.
    expect(remedios).toHaveLength(2);
    expect(remedios.filter(([, value]) => grados.test(value)).map(([path]) => path)).toEqual([]);
  });

  /*
   * §22.14(e)/(f.i) — **5 000 salió del contrato** (I8, v1.51-a: el tope vive en `[1, 1000]`).
   * Escribirlo en una etiqueta, una ayuda, un ejemplo o un `placeholder` lo reintroduce por la
   * puerta de atrás, y el sitio donde más daño hace es justo el copy del dial del gasto.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s no menciona el 5 000 retirado en el copy del gancho', (_locale, catalog) => {
    const offenders = stringEntries(catalog)
      .filter(([path]) => /admin\.(m2\.gradedEstimates|m10\.dials\.gradingHook)/.test(path))
      .filter(([, value]) => /\b5[.,\s]?000\b/.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * ══ DESIGN_SYSTEM §29 (v3.6) · 🔴 exposición legal ═════════════════════════════════════════
   *
   * La frase que había en la pantalla de pago —«Cubre la comisión del procesador de pago (Stripe),
   * **trasladada a ti**»— DECLARABA POR ESCRITO que le pasamos al cliente la comisión de nuestro
   * procesador, y el dueño del negocio dice que en México eso es ilegal. Lo que se retiró es **la
   * afirmación**, no el nombre feo.
   *
   * ⚠️ Por qué el candado vive AQUÍ y no en los e2e: los dos specs de checkout leen la cadena con
   * `t('es', 'checkout.platformFee')` y comprueban que **lo que dice el catálogo** está en pantalla.
   * Eso verifica el cableado —que la etiqueta se pinta— pero es CIEGO al contenido: con la frase
   * vieja restaurada en el catálogo, los dos specs siguen verdes. Hoy nada impedía la recaída.
   * Estos candados miden **la conducta** (qué afirma la pantalla), no el rótulo.
   */

  // Vocabulario que convierte un importe en una declaración de traslado. En la superficie de
  // cliente no tiene ningún uso legítimo, así que se prohíbe sin excepciones ni lista blanca.
  const RECLAMO_DE_TRASLADO = /trasladad|traslado|passed on|repercut|se te pasa|te lo pasamos/i;
  // Palabras que indican que la cadena está hablando de un IMPORTE que cobramos.
  const HABLA_DE_UN_COBRO = /comisi|cargo|tarifa|\bfees?\b/i;
  const esCliente = (path: string) => !path.startsWith('admin.');

  /*
   * §29.1/§29.6.2 — **cero declaraciones de traslado en la superficie de cliente.** Se busca el
   * NÚCLEO de la afirmación, no la frase concreta que había: la recaída peligrosa no es restaurar
   * el texto literal (eso lo caza el candado de valor normativo de más abajo), es volver a
   * escribir la misma idea con otras palabras en cualquier pantalla nueva que cobre algo.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s no declara en NINGUNA pantalla de cliente que un importe se traslade', (_locale, catalog) => {
    const offenders = stringEntries(catalog)
      .filter(([path]) => esCliente(path))
      .filter(([, value]) => RECLAMO_DE_TRASLADO.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * §29.4(c) — el matiz que hace falta para NO romper `error.PAYMENT_PROVIDER_UNAVAILABLE`, que es
   * correcta y se queda: ahí el proveedor es **la causa de un fallo**, no la justificación de un
   * importe. La regla mecanizada es exactamente ese matiz — se prohíbe nombrar al procesador (o a
   * Stripe) en una cadena de cliente **que además hable de un cobro**. No hay lista blanca: el
   * error operativo y los avisos de modo demo pasan solos porque ninguno nombra una comisión.
   */
  it.each([
    ['es', es, /procesador de pago|stripe/i],
    ['en', en, /payment processor|stripe/i],
  ])('%s no justifica ningún cobro al cliente nombrando al procesador de pago', (_locale, catalog, proveedor) => {
    const offenders = stringEntries(catalog)
      .filter(([path]) => esCliente(path))
      .filter(([, value]) => proveedor.test(value) && HABLA_DE_UN_COBRO.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  /*
   * §29.4(b)/§29.6.4 — **el candado en la dirección contraria, y es el más fácil de romper.**
   * En el back-office Stripe SÍ es un costo nuestro y nombrarlo es lo único honesto: son el dial
   * del costo real y una línea de gasto del P&L. Quien «arregle» esta exposición barriendo el
   * catálogo con un `grep` de Stripe rompe la contabilidad del panel — el problema nunca fue
   * nombrar a Stripe, fue decirle AL CLIENTE que su comisión se la pasamos a él.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s conserva el nombre de Stripe en los cuatro rótulos de back-office (§29.4b)', (_locale, catalog) => {
    const backOffice = [
      'admin.m10.dials.labels.stripeFeePct',
      'admin.m10.dials.labels.stripeFeeFixedCents',
      'admin.m7.pnl.stripeFees',
      'admin.m7.pnl.formula',
    ];
    const encontradas = stringEntries(catalog).filter(([path]) => backOffice.includes(path));
    // Si alguien borra o renombra las claves, el candado no puede quedar mirando al vacío.
    expect(encontradas.map(([path]) => path).sort()).toEqual([...backOffice].sort());
    for (const [path, value] of encontradas) {
      expect(/stripe/i.test(value), `${path}: el back-office dejó de nombrar a Stripe`).toBe(true);
    }
  });

  /*
   * §29.3 — **las cadenas son normativas: se copian sin interpretar.** Se fijan literales a
   * propósito, y es el único sitio del proyecto donde eso está justificado: sin abogado, la
   * disciplina es afirmar MENOS, y cualquier «mejora» de criterio propio —incluida una negación
   * defensiva del tipo «esto no es un traslado», que introduce el tema y sigue siendo una
   * afirmación que habría que sostener— es una regresión. Cuando haya abogado se revisa §29 y
   * entonces se mueve este candado, deliberadamente y con la sección delante.
   */
  it('la línea de comisión del checkout dice exactamente lo aprobado en §29.3 (ES y EN)', () => {
    const valor = (catalog: unknown, key: string) =>
      stringEntries(catalog).find(([path]) => path === key)?.[1];

    expect(valor(es, 'checkout.platformFee')).toBe('Comisión de plataforma');
    expect(valor(es, 'checkout.platformFeeHint')).toBe(
      'Nuestra comisión por operar tu compra en TCG HUNT. Ya está incluida en el total que ves aquí.',
    );
    expect(valor(en, 'checkout.platformFee')).toBe('Platform fee');
    expect(valor(en, 'checkout.platformFeeHint')).toBe(
      "Our fee for handling your purchase on TCG HUNT. It's already included in the total shown here.",
    );
  });

  /*
   * §29.3 (EN) — `handling`, **no** `processing`. Es una regla de conducta, no de literal: se
   * mantiene viva aunque el copy se revise. `processing` reintroduce por la puerta de atrás el
   * vocabulario del procesador de pago, que es exactamente del que se sale.
   */
  it('el copy EN de la comisión no reintroduce «processing»', () => {
    const feeCopy = stringEntries(en)
      .filter(([path]) => path === 'checkout.platformFee' || path === 'checkout.platformFeeHint')
      .map(([, value]) => value);
    expect(feeCopy).toHaveLength(2);
    expect(feeCopy.filter((v) => /process/i.test(v))).toEqual([]);
  });

  /*
   * §29.5 — el renombrado de la clave se hizo, y esto impide la vuelta a medias. El nombre viejo
   * arrastraba el vocabulario retirado e invitaba a «restaurar» el rótulo para que casara con la
   * clave. ⚠️ El campo del CONTRATO (`processingFeeCents` del `BreakdownDTO`) **no se toca**: es
   * nombre de API interna y no lo lee ningún cliente.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s no conserva las claves retiradas `checkout.processingFee*`', (_locale, catalog) => {
    const paths = keyPaths(catalog);
    expect(paths).not.toContain('checkout.processingFee');
    expect(paths).not.toContain('checkout.processingFeeHint');
    expect(paths).toContain('checkout.platformFee');
    expect(paths).toContain('checkout.platformFeeHint');
  });

  /*
   * PROJECT.md decisión 62 / criterio **119(b)** — verificación negativa: la clave del eyebrow de
   * fecha de la ficha no existe en NINGÚN idioma. Retirarla en uno solo sería la recaída silenciosa
   * que el candado de paridad de arriba caza; esta es la que dice **por qué** no debe volver.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s no define `catalog.gradingEstimate.updatedAt` (criterio 119)', (_locale, catalog) => {
    expect(keyPaths(catalog)).not.toContain('catalog.gradingEstimate.updatedAt');
    // El grupo sigue vivo: la decisión retira la FECHA, no el bloque de estimados.
    expect(keyPaths(catalog)).toContain('catalog.gradingEstimate.eyebrow');
  });
});

describe('status-map ↔ i18n coverage', () => {
  const enums: Record<string, string[]> = {
    ownership: ['pending', 'settled'],
    order: ['pending', 'settled', 'failed', 'refunded', 'chargeback'],
    shipment: ['solicitado', 'picking', 'guia', 'enviado', 'entregado', 'cancelado'],
    // ⚠️ v1.51 (M-46): los ONCE valores del enum del contrato. Un estado sin rótulo se pintaba
    // con la clave i18n cruda en pantalla; esta lista es lo que impide que vuelva a pasar.
    sellRequest: [
      'cotizada',
      'ofertada',
      'aceptada',
      'en_transito',
      'recibida',
      'verificacion',
      'aprobada',
      'pagada',
      'rechazada',
      'abandonada',
      'expirada',
    ],
    dispute: ['abierta', 'en_revision', 'resuelta_recompra', 'rechazada'],
  };

  it('every contract enum resolves to a badge spec whose i18n key exists in both locales', () => {
    const esFlat = new Set(keyPaths(es));
    const enFlat = new Set(keyPaths(en));
    for (const [domain, values] of Object.entries(enums)) {
      for (const value of values) {
        const spec = getBadgeSpec(domain as StatusDomain, value);
        expect(esFlat.has(spec.i18nKey), `ES missing ${spec.i18nKey}`).toBe(true);
        expect(enFlat.has(spec.i18nKey), `EN missing ${spec.i18nKey}`).toBe(true);
      }
    }
  });

  // DESIGN_SYSTEM §23.1d: `expirada` resuelve por `expiredReason`, y los DOS motivos necesitan
  // rótulo propio en los dos catálogos (son copys distintos, no matices del mismo).
  it('los dos motivos de `expirada` resuelven a specs distintas con rótulo en ambos idiomas', () => {
    const esFlat = new Set(keyPaths(es));
    const enFlat = new Set(keyPaths(en));
    const specs = ['no_offer', 'not_shipped'].map((reason) =>
      getBadgeSpec('sellRequest', 'expirada', reason),
    );
    for (const spec of specs) {
      expect(esFlat.has(spec.i18nKey), `ES missing ${spec.i18nKey}`).toBe(true);
      expect(enFlat.has(spec.i18nKey), `EN missing ${spec.i18nKey}`).toBe(true);
    }
    // Motivos opuestos ⇒ specs distintas: si alguien colapsara el mapeo, esto lo caza.
    expect(specs[0].i18nKey).not.toBe(specs[1].i18nKey);
    expect(specs[0].tone).not.toBe(specs[1].tone);
    // Y el fallback (motivo ausente) NUNCA es el acusatorio.
    expect(getBadgeSpec('sellRequest', 'expirada').tone).toBe('neutral');
    expect(getBadgeSpec('sellRequest', 'expirada', null).tone).toBe('neutral');
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * P-55 — LA CLASE QUE FALLÓ: paridad ≠ existencia.
 *
 * Qué pasó: `error.BUYLIST_RAW_ONLY` se documentó como añadida (FRONTEND_NOTES §45.4/§45.6) pero
 * NUNCA existió. La cadena de nivel-request se pegó DENTRO de
 * `masterSet.separateProductErrorCode`, dejando **dos claves con el mismo nombre en el mismo
 * objeto**. Efecto en la pantalla del dinero: el `422` de `POST /buylist/requests` caía al
 * fallback de `useErrorMessage` y pintaba el mensaje EN crudo del servidor — y en modo mock,
 * donde `api.ts` manda `message: res.code`, el literal `BUYLIST_RAW_ONLY`. Segundo efecto: como
 * en un duplicado **gana la última**, la teja de producto separado pintaba la frase larga en un
 * caption de 10px.
 *
 * Por qué NINGÚN candado lo vio, y es lo que estos dos tests arreglan:
 *   1. `keyPaths` recorre el objeto YA PARSEADO, y `JSON.parse` colapsa el duplicado antes de que
 *      cualquier test mire.
 *   2. El error estaba IGUAL en los dos idiomas ⇒ la paridad es↔en pasaba en verde.
 *
 * El candado de arriba mide SIMETRÍA entre idiomas. Estos miden EXISTENCIA de lo que el código
 * busca: van contra el CONTRATO y contra el TEXTO del JSON, que son las dos cosas que la paridad
 * no puede ver.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Todos los `.ts`/`.tsx` de PRODUCCIÓN bajo `src/` (sin tests, sin `node_modules`/`.next`). */
function productionSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      productionSources(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Unión de literales MAYÚSCULA_CON_GUIONES: `'A' | 'B' | 'C'`. Se exige ≥2 miembros a propósito —
 * una sola constante suelta no es una unión de códigos de contrato.
 */
const CODE_UNION = String.raw`(?:\|\s*)?'[A-Z][A-Z0-9_]{2,}'(?:\s*\|\s*'[A-Z][A-Z0-9_]{2,}')+`;

/**
 * Códigos de error que el CLIENTE DECLARA poder recibir: una unión de literales colgada de una
 * propiedad `code:` (los DTO de error del contrato) o de un alias `type …Error… =` (los del mock).
 * Es deliberadamente ESTRECHO: no basta con nombrar un código en cualquier parte del código —
 * `FILE_TOO_LARGE`, `VAULT_REQUIRES_ACCOUNT`, `INSUFFICIENT_STOCK` y compañía se manejan con UI
 * propia en su `catch` y nunca pasan por `error.<CODE>`. Lo que entra aquí es lo que el cliente
 * declaró como el conjunto de códigos de UNA superficie del contrato.
 */
function declaredContractErrorCodes(source: string): string[] {
  const declaration = new RegExp(
    String.raw`(?:\bcode\??\s*:\s*|\btype\s+\w*(?:Error|Code)\w*\s*=\s*)(${CODE_UNION})`,
    'g',
  );
  const codes: string[] = [];
  for (const match of source.matchAll(declaration)) {
    for (const literal of match[1].matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) codes.push(literal[1]);
  }
  return codes;
}

/**
 * Claves duplicadas dentro del MISMO objeto, leídas del TEXTO del JSON.
 *
 * `JSON.parse` (y por tanto el `import` del catálogo, y por tanto `keyPaths`) colapsa el duplicado
 * —gana la última— ANTES de que ningún test pueda mirarlo. Tokenizar el texto es la ÚNICA forma de
 * verlas. El escáner consume los literales de cadena enteros (con sus escapes), así que una llave,
 * una coma o un corchete DENTRO de un texto traducido no lo descuadran.
 */
function duplicateKeyPaths(text: string): string[] {
  const duplicates: string[] = [];
  // Pila de contenedores abiertos. `keys` solo se usa en objetos; `key` es la clave en curso de
  // ese objeto, y sirve para reconstruir la ruta del duplicado.
  const stack: { isObject: boolean; keys: Set<string>; key: string }[] = [];
  let expectKey = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      let j = i + 1;
      let raw = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          raw += text[j] + text[j + 1];
          j += 2;
          continue;
        }
        raw += text[j];
        j += 1;
      }
      const literal = JSON.parse(`"${raw}"`) as string;
      const top = stack[stack.length - 1];
      if (top?.isObject && expectKey) {
        // La ruta del objeto CONTENEDOR: las claves de los ancestros, sin la del propio `top`.
        const container = stack
          .slice(0, -1)
          .filter((frame) => frame.isObject)
          .map((frame) => frame.key)
          .filter(Boolean)
          .join('.');
        if (top.keys.has(literal)) {
          duplicates.push(container ? `${container}.${literal}` : literal);
        }
        top.keys.add(literal);
        top.key = literal;
        expectKey = false;
      }
      i = j;
      continue;
    }

    if (char === '{') {
      stack.push({ isObject: true, keys: new Set(), key: '' });
      expectKey = true;
    } else if (char === '[') {
      stack.push({ isObject: false, keys: new Set(), key: '' });
      expectKey = false;
    } else if (char === '}' || char === ']') {
      stack.pop();
      expectKey = false;
    } else if (char === ',') {
      expectKey = stack[stack.length - 1]?.isObject ?? false;
    }
  }
  return duplicates;
}

describe('códigos de error del contrato ↔ catálogo (candado de EXISTENCIA, no de simetría)', () => {
  const declared = [
    ...new Set(
      productionSources(join(__dirname, '..')).flatMap((file) =>
        declaredContractErrorCodes(readFileSync(file, 'utf8')),
      ),
    ),
  ].sort();

  /*
   * Anti-vacuidad. Sin esto, reformatear `contract.ts` (partir una unión, renombrar un alias)
   * dejaría la extracción en cero y el candado aprobaría MIRANDO AL VACÍO — que es justo el modo
   * de fallo que se está corrigiendo. Los cinco anclas son la unión por-ítem de
   * `BuylistBatchQuoteResultDTO` (contrato §6): si el candado deja de verlos, se pone rojo aquí.
   */
  it('la extracción encuentra de verdad las uniones de código del contrato', () => {
    for (const anchor of [
      'NOT_FOUND',
      'FINISH_NOT_AVAILABLE',
      'PRODUCT_NOT_FOUND',
      'PRODUCT_CARD_MISMATCH',
      'BUYLIST_RAW_ONLY',
    ]) {
      expect(declared, `la unión por-ítem de /buylist/quote/batch ya no se detecta`).toContain(
        anchor,
      );
    }
  });

  /*
   * EL CANDADO. `useErrorMessage` (`components/ui/QueryState.tsx`) resuelve `error.<CODE>` y, si no
   * existe, cae a `apiError.message` — el texto EN crudo del servidor. Todo código que el cliente
   * declara poder recibir tiene que existir en LOS DOS idiomas: no basta con que es y en coincidan,
   * porque coincidían perfectamente en el defecto que originó este test.
   */
  it.each([
    ['es', es],
    ['en', en],
  ])('%s traduce TODO código de error que el cliente declara recibir', (locale, catalog) => {
    const keys = new Set(keyPaths(catalog));
    const missing = declared.filter((code) => !keys.has(`error.${code}`));
    expect(missing, `${locale}: sin \`error.<CODE>\` para ${missing.join(', ')}`).toEqual([]);
  });

  /*
   * La otra mitad de la misma superficie: `MasterSetBinder` interpola el código por-ítem del batch
   * DIRECTO en `t(\`separateProductErrorCode.${quoteError}\`)`. Una clave que falte ahí no cae a
   * ningún fallback: next-intl tira `MISSING_MESSAGE`. Se limita a los códigos por-ítem del batch
   * (los únicos que esa teja puede recibir), no a la unión entera.
   */
  const PER_ITEM_BATCH_CODES = [
    'NOT_FOUND',
    'FINISH_NOT_AVAILABLE',
    'PRODUCT_NOT_FOUND',
    'PRODUCT_CARD_MISMATCH',
    'BUYLIST_RAW_ONLY',
  ];
  it.each([
    ['es', es],
    ['en', en],
  ])('%s tiene teja legible para cada código por-ítem de /buylist/quote/batch', (locale, catalog) => {
    const keys = new Set(keyPaths(catalog));
    const missing = PER_ITEM_BATCH_CODES.filter(
      (code) => !keys.has(`masterSet.separateProductErrorCode.${code}`),
    );
    expect(missing, `${locale}: MISSING_MESSAGE en la teja para ${missing.join(', ')}`).toEqual([]);
  });
});

describe('catálogos i18n: claves duplicadas (se leen del TEXTO, no del objeto parseado)', () => {
  it.each([['es'], ['en']])(
    '%s no define dos veces la misma clave en el mismo objeto',
    (locale) => {
      const text = readFileSync(join(__dirname, '..', '..', 'messages', `${locale}.json`), 'utf8');
      const duplicates = duplicateKeyPaths(text);
      expect(
        duplicates,
        `${locale}.json: clave duplicada (gana la última, y el resto del catálogo no se entera): ${duplicates.join(', ')}`,
      ).toEqual([]);
    },
  );

  /*
   * El escáner tiene que ser capaz de VER un duplicado, no solo de no encontrarlo. Sin esta prueba,
   * un bug en el tokenizador convertiría el candado de arriba en un verde permanente.
   */
  it('el escáner detecta un duplicado real y no se confunde con llaves dentro de un texto', () => {
    expect(duplicateKeyPaths('{"a":{"b":"1","b":"2"}}')).toEqual(['a.b']);
    expect(duplicateKeyPaths('{"a":{"b":"1"},"c":{"b":"2"}}')).toEqual([]);
    // Llaves, comas y comillas escapadas DENTRO de un valor traducido: no son estructura.
    expect(duplicateKeyPaths('{"a":"{ \\"b\\": 1, }","b":"x"}')).toEqual([]);
    expect(duplicateKeyPaths('{"a":[{"x":"1"},{"x":"2"}],"a":"dup"}')).toEqual(['a']);
  });
});
