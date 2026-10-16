/**
 * CARD SHOW — contenido de la landing (API_CONTRACT §CARDSHOW, ARCHITECTURE §4.CARDSHOW).
 *
 * ⛔ SECRETO HASTA EL ANUNCIO · ESTE REPOSITORIO ES PÚBLICO.
 * Ningún dato real del evento vive aquí: fecha, sede/dirección, precios, número de mesas, horario,
 * cupo y patrocinador entran **FUERA DEL REPO**, en un commit único el día del anuncio. Mientras
 * tanto todo va como MARCADOR (`FECHA_TBD`, `SEDE_TBD`, `PRECIO_TBD`, `—`). Las MEDIDAS de mesa NO
 * son secreto (decisión JC) y se muestran. «Jakomi» sí se permite (organizador del torneo, público).
 *
 * El candado de secreto del CI (devops) hace grep de los términos prohibidos sobre esta rama; si
 * algún valor real se cuela aquí, el grep lo caza antes del push. Por eso este fichero SOLO contiene
 * marcadores y copy neutro: los textos finales de copy/FAQ los entrega marketing y los valores los
 * pone el dueño el día del anuncio, editando SOLO este fichero.
 *
 * El contador de tabla/plano es estructural: las mesas de ejemplo de abajo son un ANDAMIO para que
 * el plano sea navegable en Fase 1; el plano real (posiciones, número, precios, medidas) llega con
 * los datos del anuncio. El número de mesas de la tira de «Números» queda como `—` a propósito.
 */

/** Marcador reconocible en pantalla: deja claro que es un hueco, no un dato. */
export const TBD = {
  fecha: 'FECHA_TBD',
  sede: 'SEDE_TBD',
  precio: 'PRECIO_TBD',
  medida: 'MEDIDA_TBD',
  dato: '—',
} as const;

export type MesaEstado = 'sin_apartar' | 'apartada';
export type TorneoEstado = 'abierta' | 'cerrada';
export type CardShowDayId = 'sat' | 'sun';

export interface MesaTipo {
  id: string;
  nombre: string;
  /** Precio con IVA incluido y con fecha (decisión JC). Marcador hasta el anuncio. */
  precio: string;
  /** Medida de la mesa (decisión JC: SE muestra, no es dato secreto). `null` ⇒ no se muestra. */
  medida: string | null;
  estado: MesaEstado;
}

export interface MesaPlano {
  /** Número tabulable 1..N (orden de recorrido con Tab y en la tabla). */
  numero: number;
  tipoId: string;
  estado: MesaEstado;
  /** Posición en el lienzo del plano SVG (0..100, sin cotas: son proporciones, no medidas reales). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface NivelPatrocinio {
  id: string;
  nombre: string;
  /** Beneficios en texto (marketing). Sin montos secretos. */
  beneficios: string[];
  /** Precio del paquete con IVA. Marcador hasta el anuncio. */
  precio: string;
}

export const CARD_SHOW = {
  /** Ruta canónica FUERA del i18n (§CARDSHOW.2). */
  canonicalUrl: 'https://tcghunt.mx/card-show',
  lang: 'es-MX',
  homeUrl: 'https://tcghunt.mx',

  hero: {
    // ⛔ Sin el nombre secreto del evento: «Card Show» es el término genérico público.
    titulo: 'Card Show',
    subtitulo: 'El punto de encuentro del Pokémon TCG en México.',
    fecha: TBD.fecha,
    sede: TBD.sede, // ciudad/zona, nunca la dirección exacta
    entrada: 'Entrada libre',
    // Chip de torneo en TEXTO, sin logos de Pokémon/Play! (decisión de marca).
    chipTorneo: 'Torneo oficial',
    ctaPrimario: { label: 'Avísame', href: '#registrate' },
    ctaSecundario: { label: 'Ver qué habrá', href: '#que-vas-a-encontrar' },
  },

  numeros: [
    { label: 'Mesas', value: TBD.dato },
    { label: 'Horario', value: TBD.fecha },
    { label: 'Entrada', value: 'Libre' },
    { label: 'Expositores', value: TBD.dato },
  ] as { label: string; value: string }[],

  queEncontraras: [
    { titulo: 'Compra y venta en mesas', texto: 'Decenas de expositores con cartas sueltas, sellado y accesorios.' },
    { titulo: 'Torneo oficial', texto: `Competencia organizada por Jakomi. Días: ${TBD.fecha}.` },
    { titulo: 'Cotiza tus cartas', texto: 'Trae tus repetidas y conoce cuánto valen, gratis y sin cuenta.' },
    { titulo: 'Bóveda TCG HUNT', texto: 'Conoce cómo guardamos y verificamos la condición de tus cartas.' },
  ] as { titulo: string; texto: string }[],

  torneo: {
    organizador: 'Jakomi',
    descripcion:
      'El torneo oficial lo organiza Jakomi. Preinscríbete en línea para apartar tu lugar; confirmamos tu ' +
      'registro por correo.',
    dias: [
      { id: 'sat' as CardShowDayId, label: `Sábado · ${TBD.fecha}` },
      { id: 'sun' as CardShowDayId, label: `Domingo · ${TBD.fecha}` },
    ],
    cupo: TBD.dato,
    cierrePreinscripcion: TBD.dato,
    // «Abierta / Cerrada» — ⛔ NUNCA «disponible».
    estado: 'abierta' as TorneoEstado,
  },

  comoLlegar: {
    zona: TBD.sede,
    direccion: TBD.sede, // dirección exacta: marcador hasta el anuncio
    indicaciones: 'Publicaremos la dirección exacta y las indicaciones de transporte el día del anuncio.',
    // Enlace del mapa: entra con la dirección real el día del anuncio.
    mapaUrl: null as string | null,
  },

  mesas: {
    intro: 'Aparta tu mesa para vender en el Card Show. Precios con IVA incluido y vigentes a su fecha.',
    tipos: [
      // Medidas (decisión JC, NO secreto): «chica» 1.20 m (estándar), «grande» 1.80–2.20 m (premium).
      { id: 'estandar', nombre: 'Mesa estándar', precio: TBD.precio, medida: '1.20 m', estado: 'sin_apartar' },
      { id: 'premium', nombre: 'Mesa premium', precio: TBD.precio, medida: '1.80–2.20 m', estado: 'sin_apartar' },
    ] as MesaTipo[],
    // Andamio de Fase 1: posiciones de ejemplo para que el plano sea navegable. El plano REAL
    // (número, posiciones, precios, medidas) llega con los datos del anuncio. NO es el conteo real.
    plano: [
      { numero: 1, tipoId: 'premium', estado: 'sin_apartar', x: 6, y: 10, w: 18, h: 12 },
      { numero: 2, tipoId: 'premium', estado: 'apartada', x: 6, y: 28, w: 18, h: 12 },
      { numero: 3, tipoId: 'estandar', estado: 'sin_apartar', x: 6, y: 46, w: 18, h: 12 },
      { numero: 4, tipoId: 'estandar', estado: 'sin_apartar', x: 40, y: 10, w: 18, h: 12 },
      { numero: 5, tipoId: 'estandar', estado: 'apartada', x: 40, y: 28, w: 18, h: 12 },
      { numero: 6, tipoId: 'estandar', estado: 'sin_apartar', x: 40, y: 46, w: 18, h: 12 },
    ] as MesaPlano[],
  },

  patrocinios: {
    intro: 'Tres niveles de patrocinio para marcas que quieren estar frente a la comunidad del Pokémon TCG.',
    // ⛔ SIN patrocinador nombrado (decisión JC: la sección se construye sin él).
    niveles: [
      { id: 'bronce', nombre: 'Bronce', beneficios: ['Logo en el sitio del evento', 'Mención en redes'], precio: TBD.precio },
      { id: 'plata', nombre: 'Plata', beneficios: ['Todo lo de Bronce', 'Espacio en el salón', 'Logo en materiales'], precio: TBD.precio },
      { id: 'oro', nombre: 'Oro', beneficios: ['Todo lo de Plata', 'Presencia en el torneo', 'Activación de marca'], precio: TBD.precio },
    ] as NivelPatrocinio[],
    cta: { label: 'Pide la propuesta de patrocinio', href: '#registrate' },
  },

  // §10 — copy B (recomendación PO, decisión final del dueño). «Caza la carta. Nosotros la guardamos.»
  queEsTcgHunt: {
    titulo: 'Qué es TCG HUNT',
    lema: 'Caza la carta. Nosotros la guardamos.',
    parrafo:
      'Compra y vende cartas Pokémon en México, con bóveda. Cada carta llega con su condición verificada; tus ' +
      'compras se guardan y salen en un solo envío. Y si te sobran repetidas, las cotizas gratis y sin cuenta.',
    puntos: ['Compra verificada (PSA/CGC)', 'Un solo envío', '¿Cuánto vale tu carpeta?'],
    cta: { label: 'Conoce TCG HUNT', href: 'https://tcghunt.mx' },
  },

  faq: [
    { q: '¿Cuándo y dónde es el Card Show?', a: `La fecha y la sede se anuncian pronto (${TBD.fecha}, ${TBD.sede}). Déjanos tu correo y te avisamos.` },
    { q: '¿Cuánto cuesta la entrada?', a: 'La entrada es libre.' },
    { q: '¿Cómo me preinscribo al torneo?', a: 'En la sección del torneo: elige el día, pon tus datos y confirma tu registro por correo.' },
    { q: '¿Cómo aparto una mesa para vender?', a: 'Déjanos tu correo marcando «Vender» y te contactamos con los detalles de apartado.' },
  ] as FaqItem[],

  footer: {
    marca: 'TCG HUNT',
    privacidadUrl: '/privacidad',
    contactoEmail: 'soporte@tcghunt.mx',
  },

  /**
   * Aviso de privacidad SIMPLIFICADO (RONDA_0 §5.a) que va JUNTO a los formularios. Marcadores
   * hasta que lleguen los datos (razón social, domicilio, organizador, versión/fecha). Este
   * fichero NO pasa por el candado `legal-gate.ts` (ese solo cubre el aviso integral); los
   * marcadores aquí se ven como huecos en dev/preview y se rellenan el día del anuncio.
   */
  privacidad: {
    razonSocial: '[RAZÓN_SOCIAL]',
    domicilio: '[DOMICILIO]',
    organizador: '[ORGANIZADOR_TORNEO]',
    version: '[VERSIÓN_FECHA]',
    integralUrl: 'https://tcghunt.mx/privacidad',
  },
} as const;

/** Nombre accesible de una mesa para el plano/tabla (orden 1..N). */
export function mesaLabel(numero: number, tipoNombre: string, estado: MesaEstado): string {
  const estadoTxt = estado === 'apartada' ? 'Apartada' : 'Sin apartar';
  return `Mesa ${numero}, ${tipoNombre}, ${estadoTxt}`;
}

export function tipoNombre(tipoId: string): string {
  return CARD_SHOW.mesas.tipos.find((t) => t.id === tipoId)?.nombre ?? 'Mesa';
}
