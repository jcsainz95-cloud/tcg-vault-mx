/**
 * ⭐ §MKT tienda §E6 — las 4 guías de `/guias` (brief v1 §2.5).
 *
 * FUENTE: la sección «Caption» de cada `copy.md` del repo de marketing (rutas en `source`, todas
 * existen tal cual las da la v1 §2.5; medido 2026-10-18). Cada línea se copia TAL CUAL; lo único
 * que se hace es QUITAR, nunca reescribir:
 *  - los emojis (los textos para buscadores van sin emojis, misma regla que `RESPUESTAS.md` §12.0.4);
 *  - las líneas que solo tienen sentido en Instagram («Guarda la lista. 📌», «Pregunta/Mándanos foto
 *    en comentarios…», «Abre la tuya en el link del perfil.»), anotadas en `omitted`.
 *
 * Guía 1 (`que-es-nm`): el carrusel `2026-10-16-carrusel-que-es-nm` está `estado: pendiente-de-
 * aprobación` en su `copy.md` (medido 2026-10-18), así que su caption NO se usa. La guía se arma solo
 * con texto aprobado: la historia `2026-10-08-historia-es-nm` (aprobada por el dueño 2026-10-08:
 * titular, las 4 cosas y su CTA «Cotiza la tuya») + la FAQ pública P7 (definición de NM, por id: el
 * texto vive en `faq.es.ts`, una sola fuente).
 *
 * ⛔ Sin precios (ninguna guía los lleva), nunca «mejor precio» / «pagamos más», nada del Card Show:
 * lo vigila `seo-content.test.ts`. Sin imágenes por ahora (las láminas son PNG 2160×2700 del repo de
 * marketing; dónde se hospedan no está decidido — se reporta, no se inventa una URL).
 */

export interface GuideBlock {
  kind: 'p' | 'ol' | 'faq';
  /** `p`: un párrafo · `ol`: lista numerada · `faq`: respuesta de la FAQ pública con ese id. */
  text?: string;
  items?: readonly string[];
  faqId?: string;
}

export interface Guide {
  slug: string;
  /** `headline` del `Article` = `<h1>` visible. */
  headline: string;
  /** Fecha de publicación EN LA WEB (YYYY-MM-DD). */
  datePublished: string;
  blocks: readonly GuideBlock[];
  /** Cierre: enlace a catálogo o a buylist, sin superlativos de precio (v1 §2.5). */
  cta: 'catalog' | 'buylist';
  /** `copy.md` de origen (repo de marketing) y estado de aprobación leído en su cabecera. */
  source: readonly { path: string; estado: string }[];
  /** Líneas del caption que NO se copian (solo valen en Instagram). */
  omitted: readonly string[];
}

const PUBLISHED_ON = '2026-10-18';

export const GUIDES: readonly Guide[] = [
  {
    slug: 'que-es-nm',
    headline: '¿Es NM? Revisa 4 cosas.',
    datePublished: PUBLISHED_ON,
    blocks: [
      { kind: 'faq', faqId: 'P7' },
      {
        kind: 'ol',
        items: [
          'Esquinas sin dobleces',
          'Bordes limpios',
          'Superficie sin rayones',
          'Centrado parejo',
        ],
      },
    ],
    cta: 'buylist',
    source: [
      { path: 'piezas/2026-10-08-historia-es-nm/copy.md', estado: 'aprobada-por-el-dueño-2026-10-08' },
      { path: 'plan/RESPUESTAS.md §12.2 P7', estado: 'manual v5 (2026-10-11)' },
    ],
    omitted: [],
  },
  {
    slug: 'carta-pirata-5-senales',
    headline: '¿Carta pirata? Cinco señales para saberlo antes de comprar.',
    datePublished: PUBLISHED_ON,
    blocks: [
      {
        kind: 'ol',
        items: [
          'Tipografía: las originales usan siempre la misma letra y el mismo tamaño; letras raras, acentos cambiados o faltas de ortografía delatan la copia.',
          'Bordes e impresión: marco parejo por los cuatro lados y detalle nítido; bordes chuecos o imagen borrosa, mala señal.',
          'Holo y textura: cada rareza tiene su acabado; brillo donde no debería o plástico liso, desconfía.',
          'Reverso y luz: azul parejo y remolino nítido por atrás; con una linterna, la original deja pasar poca luz y pareja. Sin rasgar ni doblar: dañas una carta real.',
          'Precio y vendedor: muy por debajo de lo normal, sin historial y con fotos de catálogo en vez de la carta real, no compres.',
        ],
      },
      {
        kind: 'p',
        text: 'Cada carta que vendemos se revisa antes de publicarse: autenticidad y condición.',
      },
      {
        kind: 'p',
        text: 'Glosario: holo = la capa brillante de la carta; reverso = la parte de atrás; SIR = Special Illustration Rare, la rareza con ilustración completa.',
      },
    ],
    cta: 'catalog',
    source: [
      {
        path: 'piezas/2026-10-15-carrusel-carta-pirata/copy.md',
        estado: 'aprobada-por-el-dueño-2026-10-09',
      },
    ],
    omitted: [
      'Guarda las 5 señales. 📌',
      '¿Dudas con una carta tuya? Mándanos foto en comentarios y te contestamos en el día (lun-sáb).',
    ],
  },
  {
    slug: 'como-guardar-tus-cartas',
    headline: 'Cómo guardar tus cartas para que sigan NM.',
    datePublished: PUBLISHED_ON,
    blocks: [
      {
        kind: 'ol',
        items: [
          'Funda: una funda fina por carta, sin excepción. Evita rayones, huellas y polvo.',
          'Rígido: las valiosas, con funda, dentro de un toploader o una semirrígida, con la abertura de la funda hacia abajo. Para enviar o gradear, doble funda.',
          'Binder: carpeta de carga lateral con hojas sin PVC (polipropileno); nada de anillas sueltas, que marcan las cartas al cerrar.',
          'Ambiente: lejos del sol, del calor y de la humedad; lugar fresco y seco, nunca en el coche.',
        ],
      },
      {
        kind: 'p',
        text: '¿O prefieres que las guardemos nosotros? Lo que compras en tcghunt.mx se queda en tu bóveda y sale en un solo envío cuando tú lo pidas.',
      },
      {
        kind: 'p',
        text: 'Glosario: NM = Near Mint, casi nueva; toploader = funda rígida de plástico; binder = carpeta con hojas para cartas.',
      },
    ],
    cta: 'catalog',
    source: [
      {
        path: 'piezas/2026-10-16-carrusel-como-guardar-cartas/copy.md',
        estado: 'aprobada-por-el-dueño-2026-10-09',
      },
    ],
    omitted: ['Guarda la lista. 📌', 'Abre la tuya en el link del perfil.'],
  },
  {
    slug: 'que-es-una-sir',
    headline: '¿Qué es una SIR?',
    datePublished: PUBLISHED_ON,
    blocks: [
      {
        kind: 'p',
        text: 'Special Illustration Rare: la rareza con ilustración completa, una capa extra de foil y el número por encima del total del set (161/131). Casi siempre es un Pokémon ex o un Partidario.',
      },
      {
        kind: 'p',
        text: 'No cambia cómo juega la carta; cambia cómo se ve (y lo que cuesta). Para reconocerla: mira el número junto al código del set; si pasa del total impreso y tiene dos estrellas doradas, es SIR.',
      },
      {
        kind: 'p',
        text: 'Glosario: IR = Illustration Rare, arte alternativo con una estrella dorada; SIR = dos estrellas y foil extra.',
      },
    ],
    cta: 'catalog',
    source: [
      {
        path: 'piezas/2026-10-17-carrusel-que-es-sir/copy.md',
        estado: 'aprobada-por-el-dueño-2026-10-09',
      },
    ],
    omitted: [
      'Guarda la guía: cómo reconocer una SIR en 10 segundos. 📌',
      'Comenta tu SIR favorita y te digo si está hoy en el catálogo.',
    ],
  },
];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
