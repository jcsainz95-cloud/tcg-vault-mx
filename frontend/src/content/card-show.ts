/**
 * CARD SHOW — contenido de la landing (API_CONTRACT §CARDSHOW, ARCHITECTURE §4.CARDSHOW).
 *
 * ESTADO (decisión del dueño JC, 2026-10-16): el evento SALE con DATOS REALES. Fecha, sede, precios,
 * mesas y horarios YA SON PÚBLICOS y viven directo en este fichero.
 *
 * ⛔ ÚNICO SECRETO QUE QUEDA: los NOMBRES DE PATROCINADORES. No viven en NINGÚN sitio del repo (es
 * público). El bloque de LOGOS de patrocinadores va OCULTO con `patrocinios.showSponsors === false`.
 * Las únicas marcas nombradas son **TCG HUNT** y **Jakomi**. El candado de secreto del CI (devops)
 * hace grep de los nombres de patrocinador (env `CARDSHOW_SECRET_TERMS`) sobre esta rama.
 *
 * El modelo de mesas es NUMERADO (23 mesas): cada mesa tiene tipo→precio y disponibilidad. ⛔ SIN
 * medidas (decisión JC v2). La lista de `apartadas` es el ÚNICO sitio que JC edita a mano cuando
 * cambia la disponibilidad.
 */

export type TorneoEstado = 'abierta' | 'cerrada';
export type CardShowDayId = 'sat' | 'sun';
export type MesaDisponibilidad = 'disponible' | 'apartada';
export type MesaTipoId = 'premium' | 'grande' | 'chica';

export interface MesaTipo {
  id: MesaTipoId;
  nombre: string;
  /** Precio final en pesos, sin medidas (decisión JC v2). */
  precio: string;
  /** Números de mesa asignados a este tipo. */
  numeros: number[];
}

export interface MesaResuelta {
  numero: number;
  tipo: MesaTipo;
  disponibilidad: MesaDisponibilidad;
}

export interface FaqItem {
  q: string;
  a: string;
}

export interface NivelPatrocinio {
  id: string;
  nombre: string;
  /** Precio del paquete (o «En especie»). Dato público. */
  precio: string;
  /** Beneficios específicos del nivel (sin marca de patrocinador). */
  beneficios: string[];
}

const WA = 'https://wa.me/525564893921';

/** Enlaces de WhatsApp con mensaje prellenado (URLs EXACTAS del encargo del dueño). */
export const WHATSAPP = {
  /** Número visible (no solo en el href). */
  numeroDisplay: '55 6489 3921',
  /** #1 Plano: lleva `{n}` que se sustituye por el número de mesa. */
  apartarMesaConNumero:
    'https://wa.me/525564893921?text=Hola%2C%20quiero%20apartar%20una%20mesa%20para%20el%20Card%20Show%20CDMX%20(5%E2%80%936%20dic).%20Me%20interesa%20la%20mesa%20%23{n}.',
  /** #2 Genérico (tarjetas y CTA móvil). */
  apartarMesaGenerico:
    'https://wa.me/525564893921?text=Hola%2C%20quiero%20apartar%20una%20mesa%20para%20el%20Card%20Show%20CDMX%20(5%E2%80%936%20dic).%20Me%20interesa%20la%20mesa%20%23',
  /** #3 Patrocinio. */
  patrocinio:
    'https://wa.me/525564893921?text=Hola%2C%20me%20interesa%20patrocinar%20el%20Card%20Show%20CDMX%20(5%E2%80%936%20dic).%20%C2%BFMe%20pueden%20mandar%20el%20deck%3F',
  /** #4 Dudas (footer). */
  dudas:
    'https://wa.me/525564893921?text=Hola%2C%20tengo%20una%20duda%20sobre%20el%20Card%20Show%20CDMX%20(5%E2%80%936%20dic).',
} as const;

/** Mailto de patrocinio (URL EXACTA del encargo). El CTA «pide la propuesta» abre ESTO (no scroll). */
export const MAILTO_PATROCINIO =
  'mailto:jsainz@tcghunt.mx?cc=cardshow@jakomi.mx&subject=Patrocinio%20Card%20Show%20CDMX&body=Hola%2C%20me%20interesa%20patrocinar%20el%20Card%20Show%20CDMX%20(5%E2%80%936%20dic).%0A%0AMarca%3A%20%0ANivel%20de%20inter%C3%A9s%20(Oro%20%2F%20Plata%20%2F%20Producto)%3A%20%0AContacto%3A%20%0A%0A%C2%BFMe%20pueden%20mandar%20el%20deck%3F';

/** Enlaces externos (todos públicos). */
export const LINKS = {
  tcgHuntWeb: 'https://tcghunt.mx?utm_source=cardshow&utm_medium=landing',
  tcgHuntIg: 'https://instagram.com/tcghunt.mx',
  jakomiWeb: 'https://jakomi.mx',
  jakomiIg: 'https://instagram.com/jakomi.mx',
  jakomiTiktok: 'https://www.tiktok.com/@jakomi.mx',
  jakomiFb: 'https://www.facebook.com/profile.php?id=61590592537817',
  deckPatrocinio: 'https://drive.google.com/file/d/1DP9p8yXA8ThLP1uyWVjSCB13gD5P1bzd/view',
  convocatoriaVendedores: 'https://drive.google.com/file/d/1WLlqbqk5XCqKVhDAZ4m0Ohsug6U-ze0p/view',
  /** Aviso de privacidad INTEGRAL que YA está live (⛔ no se redacta uno nuevo). */
  avisoPrivacidad: 'https://tcghunt.mx/es/privacidad',
} as const;

export const CARD_SHOW = {
  /** Ruta canónica FUERA del i18n (§CARDSHOW.2). */
  canonicalUrl: 'https://tcghunt.mx/card-show',
  lang: 'es-MX',
  homeUrl: 'https://tcghunt.mx',

  /** Fecha/hora de inicio para la cuenta regresiva (America/Mexico_City, UTC-6). */
  countdownTargetIso: '2026-12-05T11:00:00-06:00',

  hero: {
    titulo: 'Card Show',
    presenta: 'TCG HUNT × Jakomi TCG Café',
    subtitulo:
      'Dos días de compra, venta, torneos y juego libre de Pokémon TCG y otros juegos de cartas en la Ciudad de México.',
    fecha: 'Sáb 5 y dom 6 de diciembre de 2026',
    horario: '11:00–19:00 sáb · 11:00–18:00 dom',
    sede: 'San José Insurgentes, Benito Juárez, CDMX',
    entrada: 'Entrada libre',
    // Chip de torneo en TEXTO. ⛔ NUNCA «oficial» ni «Play!».
    chipTorneo: 'Torneo de Pokémon cada día',
    ctaPrimario: { label: 'Avísame', href: '#registrate' },
    ctaSecundario: { label: 'Ver qué habrá', href: '#que-vas-a-encontrar' },
  },

  numeros: [
    { label: 'Fecha', value: '5–6 dic 2026' },
    { label: 'Horario', value: '11–19 h' },
    { label: 'Entrada', value: 'Libre' },
    { label: 'Mesas', value: '23' },
  ] as { label: string; value: string }[],

  queEncontraras: [
    {
      titulo: 'Compra y venta en mesas',
      texto: 'Vendedores de singles y producto sellado de Pokémon TCG y otros juegos de cartas.',
    },
    {
      titulo: 'Torneo de Pokémon cada día',
      texto: 'Un torneo de Pokémon el sábado y el domingo. Horarios finales en los próximos días.',
    },
    {
      titulo: 'Juega e intercambia',
      texto: 'Mesas libres en el piso 3 para jugar e intercambiar cartas.',
    },
    { titulo: 'Comida', texto: 'Zona de comida en el piso 3 para que pases el día.' },
  ] as { titulo: string; texto: string }[],

  torneo: {
    organizador: 'Jakomi',
    titulo: 'Torneo de Pokémon cada día',
    descripcion:
      'Hay un torneo de Pokémon cada día: el sábado y el domingo. La inscripción es desde $200. El registro y los ' +
      'horarios finales los anunciamos en los próximos días en Instagram @tcghunt.mx. Los side events de otros ' +
      'juegos están por anunciarse.',
    /** ⚠️ SIEMPRE con esta nota (los horarios no son finales). */
    notaHorarios: 'Horarios finales en los próximos días.',
    inscripcion: 'Desde $200 MXN',
    dias: [
      { id: 'sat' as CardShowDayId, label: 'Sábado · 12:00–18:00' },
      { id: 'sun' as CardShowDayId, label: 'Domingo · 12:00–17:00' },
    ],
    // ⛔ El cupo NO se muestra.
    // «Abierta / Cerrada» — ⛔ NUNCA «disponible».
    estado: 'abierta' as TorneoEstado,
  },

  comoLlegar: {
    zona: 'San José Insurgentes, Benito Juárez, CDMX',
    direccion: 'José del Castillo 3, esq. Av. Revolución, Col. San José Insurgentes, Benito Juárez, 03900 CDMX',
    pisos:
      'Piso 2: vendedores (23 mesas y zona de activación al fondo, esquina lado Av. Revolución). ' +
      'Piso 3: torneos, juego libre, intercambio y comida.',
    indicaciones:
      'Llega en Metro a Mixcoac (Líneas 7 y 12) y camina unos 5 minutos sobre Av. Revolución. En Metrobús Línea 1, ' +
      'bájate en Río Churubusco.',
    transporte: [
      'Metro Mixcoac (Líneas 7 y 12): ~500 m, 5 min caminando sobre Av. Revolución.',
      'Metrobús Línea 1 (Insurgentes Sur): Río Churubusco (~800 m) o Teatro Insurgentes (~1 km). El Metrobús no pasa por Revolución.',
      'Metro Barranca del Muerto (Línea 7): ~1.2 km.',
    ],
    mapaUrl:
      'https://www.google.com/maps/search/?api=1&query=Jos%C3%A9+del+Castillo+3%2C+San+Jos%C3%A9+Insurgentes%2C+Benito+Ju%C3%A1rez%2C+CDMX',
    mapaEmbedUrl:
      'https://www.google.com/maps?q=Jos%C3%A9+del+Castillo+3,+San+Jos%C3%A9+Insurgentes,+CDMX&output=embed',
  },

  mesas: {
    intro: 'Aparta tu mesa para vender en el Card Show. Precios finales; tú eliges tu número en el plano.',
    montaje: 'Montaje de vendedores el viernes 4 de diciembre (el horario se confirma al apartar).',
    nota: 'Se aparta solo con el pago completo. El vendedor elige su número de mesa.',
    convocatoriaUrl: LINKS.convocatoriaVendedores,
    incluye: [
      'Mantel',
      '2 sillas',
      'Luz',
      'WiFi para terminal',
      'Seguridad en el acceso',
      'Montaje el viernes 4 de diciembre',
      'Difusión en nuestras redes',
    ],
    totalMesas: 23,
    tipos: [
      { id: 'premium', nombre: 'Premium', precio: '$3,000', numeros: [6, 7, 8, 16, 19] },
      {
        id: 'grande',
        nombre: 'Grande',
        precio: '$2,500',
        numeros: [1, 2, 9, 10, 11, 12, 13, 14, 15, 17, 18, 20, 21, 22, 23],
      },
      { id: 'chica', nombre: 'Chica', precio: '$1,800', numeros: [3, 4, 5] },
    ] as MesaTipo[],
    /**
     * ⛔ ÚNICA lista que JC edita a mano cuando cambie la disponibilidad (medido al 16-oct). Una mesa
     * que NO está aquí se considera DISPONIBLE. La #7 (premium) está apartada.
     */
    apartadas: [6, 7, 8, 9, 10, 18, 20] as number[],
  },

  patrocinios: {
    intro: 'Tres niveles de patrocinio para marcas que quieren estar frente a la comunidad del Pokémon TCG.',
    /** ⛔ OCULTA el bloque de LOGOS de patrocinadores: su nombre es secreto hasta nuevo aviso. */
    showSponsors: false,
    /** Beneficios comunes a los tres niveles. */
    comunes: ['Activación en el evento', 'Presencia digital', 'Señalética', 'Prize partner de los torneos'],
    niveles: [
      { id: 'oro', nombre: 'Oro', precio: '$25,000', beneficios: ['Único patrocinador «presented by»', 'Stand en el evento'] },
      { id: 'plata', nombre: 'Plata', precio: '$8,500', beneficios: ['Mesa a elegir en el piso 2', 'Exclusividad de categoría'] },
      { id: 'producto', nombre: 'Producto', precio: 'En especie', beneficios: [] },
    ] as NivelPatrocinio[],
    // ⛔ Abre el MAILTO de patrocinio (NO hace scroll al formulario).
    cta: { label: 'Pide la propuesta de patrocinio', href: MAILTO_PATROCINIO },
    deckUrl: LINKS.deckPatrocinio,
  },

  // §10 — copy B (recomendación PO, decisión final del dueño). «Caza la carta. Nosotros la guardamos.»
  queEsTcgHunt: {
    titulo: 'Qué es TCG HUNT',
    lema: 'Caza la carta. Nosotros la guardamos.',
    parrafo:
      'Compra y vende cartas Pokémon en México, con bóveda. Cada carta llega con su condición verificada; tus ' +
      'compras se guardan y salen en un solo envío. Y si te sobran repetidas, las cotizas gratis y sin cuenta.',
    puntos: ['Compra verificada (PSA/CGC)', 'Un solo envío', '¿Cuánto vale tu carpeta?'],
    cta: { label: 'Conoce TCG HUNT', href: LINKS.tcgHuntWeb },
  },

  /** 12 preguntas frecuentes, texto VERBATIM del dueño (2026-10-16). */
  faq: [
    {
      q: '¿Cuándo es y a qué hora?',
      a: 'Sábado 5 de diciembre de 11:00 a 19:00 y domingo 6 de diciembre de 11:00 a 18:00.',
    },
    { q: '¿Cuánto cuesta la entrada?', a: 'Nada. La entrada es libre los dos días.' },
    {
      q: '¿Dónde es?',
      a: 'En José del Castillo 3, esquina con Av. Revolución, col. San José Insurgentes, Benito Juárez. Vendedores en el piso 2; torneos, juego libre y comida en el piso 3.',
    },
    {
      q: '¿Cómo llego?',
      a: 'En Metro, bájate en Mixcoac (Líneas 7 y 12) y camina unos 5 minutos sobre Av. Revolución. En Metrobús Línea 1, bájate en Río Churubusco.',
    },
    {
      q: '¿Qué voy a encontrar?',
      a: 'Vendedores de singles y producto sellado de Pokémon TCG y otros juegos de cartas, un torneo de Pokémon cada día, mesas libres para jugar e intercambiar y comida.',
    },
    {
      q: '¿A qué hora son los torneos?',
      a: 'Hay un torneo de Pokémon cada día: el sábado de 12:00 a 18:00 y el domingo de 12:00 a 17:00. Los horarios finales los publicamos en los próximos días en @tcghunt.mx.',
    },
    {
      q: '¿Cómo me inscribo al torneo?',
      a: 'La inscripción es desde $200. El registro lo anunciamos en Instagram @tcghunt.mx junto con los horarios finales. Los side events de otros juegos están por anunciarse.',
    },
    { q: '¿Puedo intercambiar cartas?', a: 'Sí. En la zona de torneo, en el piso 3, hay mesas libres para jugar e intercambiar.' },
    {
      q: 'Quiero vender, ¿cómo aparto mesa?',
      a: 'Elige tu mesa en el plano y escríbenos por WhatsApp al 55 6489 3921. La mesa queda apartada cuando se recibe el pago completo.',
    },
    {
      q: '¿Qué incluye la mesa?',
      a: 'Mantel, 2 sillas, luz, WiFi para terminal, seguridad en el acceso, montaje el viernes 4 de diciembre y difusión en nuestras redes.',
    },
    { q: '¿Cuándo se monta?', a: 'El viernes 4 de diciembre. Te confirmamos el horario al apartar tu mesa.' },
    {
      q: '¿Cómo patrocino?',
      a: 'Tenemos tres niveles: Oro, Plata y Producto. Pide el deck a jsainz@tcghunt.mx o déjanos tu correo en el formulario.',
    },
  ] as FaqItem[],

  footer: {
    marca: 'TCG HUNT',
    colaboracion: 'En colaboración con Jakomi TCG Café, Coyoacán',
    jakomiDireccion: 'Av. Río Churubusco 316, Local 18 bis, Col. Del Carmen, Coyoacán',
    privacidadUrl: LINKS.avisoPrivacidad,
    contactoEmail: 'soporte@tcghunt.mx',
  },
} as const;

/** Tipo de una mesa por su número (o `undefined` si el número no existe). */
export function mesaTipoDe(numero: number): MesaTipo | undefined {
  return CARD_SHOW.mesas.tipos.find((t) => t.numeros.includes(numero));
}

/** Disponibilidad de una mesa: apartada si está en la lista editable; si no, disponible. */
export function mesaDisponibilidad(numero: number): MesaDisponibilidad {
  return CARD_SHOW.mesas.apartadas.includes(numero) ? 'apartada' : 'disponible';
}

/** Las 23 mesas resueltas (número → tipo + disponibilidad), ordenadas 1→N. */
export function mesasResueltas(): MesaResuelta[] {
  return CARD_SHOW.mesas.tipos
    .flatMap((tipo) => tipo.numeros.map((numero) => ({ numero, tipo, disponibilidad: mesaDisponibilidad(numero) })))
    .sort((a, b) => a.numero - b.numero);
}

/** Texto de disponibilidad para pantalla. ⛔ Nunca «disponible» como estado interno de torneo; aquí SÍ aplica a mesas. */
export function disponibilidadTexto(d: MesaDisponibilidad): string {
  return d === 'apartada' ? 'Apartada' : 'Disponible';
}

/** URL de WhatsApp para apartar una mesa concreta (#1, con el número prellenado). */
export function waApartarMesaUrl(numero: number): string {
  return WHATSAPP.apartarMesaConNumero.replace('{n}', String(numero));
}

/** Nombre accesible de una mesa para el plano/tabla (orden 1..N). */
export function mesaLabel(numero: number, tipoNombre: string, precio: string, d: MesaDisponibilidad): string {
  return `Mesa ${numero}, ${tipoNombre}, ${precio}, ${disponibilidadTexto(d)}`;
}
