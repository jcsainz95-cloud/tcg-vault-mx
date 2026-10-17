/**
 * 🔒 CANDADO — filtro PII de las anotaciones/términos de marketing (`containsPii`, ARCHITECTURE
 * §13.4.3 c6 / §13.4.6 h1; API_CONTRACT §MKT.E). El admin es de confianza, pero este filtro cierra el
 * **error honesto**: pegar el correo, `@usuario`, teléfono o CURP/RFC de un cliente en una etiqueta que
 * acaba en una gráfica y en el export.
 *
 * CANARIO (fail-first): si alguien debilita `containsPii` a `return false`, los casos POSITIVOS de abajo
 * se ponen ROJOS. Son el instrumento que demuestra que el candado muerde.
 */
import { containsPii } from '../src/modules/marketing/marketing-pii-filter';

describe('containsPii — rechaza PII (casos POSITIVOS; el canario que muerde)', () => {
  const PII_POSITIVOS: Array<[string, string]> = [
    ['arroba de usuario', '@juanito'],
    ['correo', 'prueba@correo.com'],
    ['correo dentro de texto', 'avisar a cliente ventas@tienda.mx por favor'],
    ['teléfono 10 dígitos', 'llamar al 5512345678'],
    ['teléfono con separadores', 'tel 55-1234-5678'],
    ['teléfono con espacios/puntos', '55 1234.5678'],
    ['racha de 7 dígitos', 'folio 1234567'],
    ['CURP', 'cliente MAGL850315HdfRsL09'],
    ['RFC persona física', 'rfc MAGL850315XYZ'],
    ['CLABE (18 dígitos)', '012345678901234567'],
  ];

  it.each(PII_POSITIVOS)('rechaza: %s', (_desc, value) => {
    expect(containsPii(value)).toBe(true);
  });
});

describe('containsPii — deja pasar texto legítimo de marketing (casos NEGATIVOS)', () => {
  const LIMPIOS: Array<[string, string]> = [
    ['promo simple', 'Promoción de otoño'],
    ['despliegue técnico', 'Encendimos GA4 y el píxel'],
    ['evento con año', 'Card Show 2026'],
    ['carta con número', 'Charizard 151'],
    ['destino de ruta', '/es/promos/otono'],
    ['pocas cifras sueltas', 'descuento 15% el día 3'],
    ['vacío', ''],
    ['guiones de palabra', 'edicion-especial-holo'],
  ];

  it.each(LIMPIOS)('permite: %s', (_desc, value) => {
    expect(containsPii(value)).toBe(false);
  });

  it('null/undefined no son PII (no rompen)', () => {
    expect(containsPii(null)).toBe(false);
    expect(containsPii(undefined)).toBe(false);
  });
});
