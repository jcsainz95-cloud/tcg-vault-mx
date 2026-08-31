import { describe, it, expect } from 'vitest';
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
  it.each([
    ['es', es, /si cobra por petición/],
    ['en', en, /if it charges per request/],
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
    sellRequest: ['cotizada', 'recibida', 'verificacion', 'aprobada', 'pagada', 'rechazada', 'abandonada'],
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
});
