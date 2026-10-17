/**
 * CARD SHOW — contenido de la landing (API_CONTRACT §CARDSHOW v1.96, ARCHITECTURE §4.CARDSHOW).
 *
 * ESTADO (PIVOTE A CAPTURA, decisión del dueño JC 2026-10-17): la landing deja de ser «anuncio con
 * datos» y pasa a ser **página de CAPTURA DE LEADS** que ⛔ NO expone el modelo de negocio.
 * Quitados: precios de mesa, plano de 23 mesas, montos de patrocinio y sus helpers.
 * Conservados: fecha/sede/entrada, cuenta regresiva, torneos por juego (horarios «por anunciar»),
 * rifa informal y datos públicos de Jakomi (nombre + logo, SIN enlaces a sus redes — decisión JC).
 *
 * ⛔ ÚNICO SECRETO QUE QUEDA: los NOMBRES DE PATROCINADORES (no viven en el repo). Las únicas marcas
 * nombradas son **TCG HUNT** y **Jakomi**. El candado de secreto del CI (devops) hace grep de los
 * nombres de patrocinador (env `CARDSHOW_SECRET_TERMS`) sobre esta rama.
 */

/** Juego del torneo / interés (enum `CardShowGame`, §Enums). Pokémon = formal; resto = ligera. */
export type CardShowGame = 'pokemon' | 'riftbound' | 'lorcana' | 'shardbugs';
export type CardShowDayId = 'sat' | 'sun';
export type TorneoEstado = 'abierta' | 'cerrada';

/**
 * Los CUATRO juegos del enum del contrato, con etiqueta de pantalla (§Enums, M-85/v1.97). El valor de
 * enum es `shardbugs` (minúscula); el nombre visible «Shard Bugs» (dos palabras) lo pone el frontend.
 */
export const CARD_SHOW_GAMES: { id: CardShowGame; label: string }[] = [
  { id: 'pokemon', label: 'Pokémon TCG' },
  { id: 'riftbound', label: 'Riftbound' },
  { id: 'lorcana', label: 'Lorcana' },
  { id: 'shardbugs', label: 'Shard Bugs' },
];

export interface FaqItem {
  q: string;
  a: string;
}

/** Aviso de privacidad INTEGRAL que YA está live (⛔ no se redacta uno nuevo). */
const AVISO_PRIVACIDAD = 'https://tcghunt.mx/es/privacidad';

export const CARD_SHOW = {
  /** Ruta canónica FUERA del i18n (§CARDSHOW.2). */
  canonicalUrl: 'https://tcghunt.mx/card-show',
  lang: 'es-MX',
  homeUrl: 'https://tcghunt.mx',

  /** Fecha/hora de inicio para la cuenta regresiva (America/Mexico_City, UTC-6). */
  countdownTargetIso: '2026-12-05T11:00:00-06:00',

  hero: {
    titulo: 'Card Show',
    lineaDos: 'CDMX 2026',
    presenta: 'TCG HUNT × Jakomi TCG Café',
    tier: ['Evento presencial', 'Entrada libre', 'TCG HUNT × Jakomi TCG Café'],
    lede:
      'Dos días de torneos, intercambio y las mejores cartas — Pokémon y otros TCG, bajo un mismo techo. Organiza TCG HUNT.',
    fecha: 'Sáb 5 y dom 6 de diciembre de 2026',
    entrada: 'Entrada libre',
    sede: 'San José Insurgentes, CDMX',
    facts: [
      { k: 'Fechas', v: 'Sáb 5 y Dom 6 · Dic 2026' },
      { k: 'Sede', v: 'San José Insurgentes, CDMX' },
      { k: 'Entrada', v: 'Libre' },
    ],
    ctaPrimario: { label: 'Regístrate gratis', href: '#registro' },
    ctaSecundario: { label: '¿Vendes o patrocinas?', href: '#registro' },
  },

  /** Colaborador visible: logo + nombre + qué hace. ⛔ SIN enlaces a sus redes (decisión JC). */
  colaborador: {
    label: 'En colaboración con',
    nombre: 'Jakomi TCG Café',
    logo: '/card-show/jakomi-logo.webp',
    descripcion:
      '«Tu casa del TCG en Coyoacán». Tienda-café de cartas (Pokémon, Lorcana y Magic) que organiza los torneos del Card Show.',
  },

  queEncontraras: [
    {
      n: '01',
      titulo: 'Torneos por juego',
      texto: 'Pokémon como torneo principal, más Riftbound, Lorcana y Shard Bugs. Formatos y premios por anunciar.',
    },
    {
      n: '02',
      titulo: 'Compra, venta e intercambio',
      texto: 'Mesas de vendedores con singles, sellado y accesorios. Trae tus cartas y encuentra las que te faltan.',
    },
    {
      n: '03',
      titulo: 'Rifas y sorpresas',
      texto: 'Dinámicas durante el evento para los asistentes registrados. Entra desde ya con tu registro.',
    },
  ] as { n: string; titulo: string; texto: string }[],

  torneos: {
    intro:
      'Cuatro juegos sobre la mesa. Horarios, formatos y costos se confirmarán pronto — regístrate y te avisamos primero.',
    /** Una línea por juego; todo «por anunciar». Los cuatro son valores del enum `CardShowGame`. */
    juegos: [
      {
        id: 'pokemon' as CardShowGame,
        nombre: 'Pokémon TCG',
        pill: 'Torneo principal',
        principal: true,
        linea: 'Los dos días. Horario, formato e inscripción — te avisamos primero si te registras.',
      },
      {
        id: 'riftbound' as CardShowGame,
        nombre: 'Riftbound',
        pill: 'Confirmado',
        principal: false,
        linea: 'Horario, formato e inscripción por anunciar. Regístrate y te enteras primero.',
      },
      {
        id: 'lorcana' as CardShowGame,
        nombre: 'Lorcana',
        pill: 'Confirmado',
        principal: false,
        linea: 'Horario, formato e inscripción por anunciar. Regístrate y te enteras primero.',
      },
      {
        id: 'shardbugs' as CardShowGame,
        nombre: 'Shard Bugs',
        pill: 'Confirmado',
        principal: false,
        linea: 'Horario, formato e inscripción por anunciar. Regístrate y te enteras primero.',
      },
    ],
    cuarto: 'Cuatro juegos confirmados. Dinos en el registro cuál te gustaría jugar y te avisamos primero.',
    /** Días de la preinscripción (texto de pantalla; el cupo ⛔ no se muestra). */
    dias: [
      { id: 'sat' as CardShowDayId, label: 'Sábado 5 de diciembre' },
      { id: 'sun' as CardShowDayId, label: 'Domingo 6 de diciembre' },
    ],
    estado: 'abierta' as TorneoEstado,
  },

  /** Rifa INFORMAL sin costo: hay que estar presente para ganar; se elige en vivo. Va AL FINAL. */
  rifa: {
    eyebrow: 'La rifa del Card Show',
    titulo: 'Regístrate y participa',
    premio: 'Pokémon TCG — 30th Celebration Poster Collection',
    imagen: '/card-show/product_30th.jpg',
    imagenAlt: 'Premio de la rifa: Pokémon TCG 30th Celebration Poster Collection',
    strip: 'Rifa: set del 30.º aniversario de Pokémon — sin costo. Regístrate y participa.',
    lede:
      'Entre todos los asistentes y registrados rifamos la Poster Collection del 30.º aniversario de Pokémon — 3 sobres, póster gigante y cartas promo. Sin costo: con registrarte ya participas.',
    pasos: [
      'Regístrate y marca la casilla «Quiero participar en la rifa».',
      'El día del evento, hay que estar presente para ganar.',
      'Elegimos al ganador en vivo, ahí mismo, frente a la comunidad.',
    ],
    bases:
      'Dinámica entre asistentes y registrados de TCG HUNT. No es un sorteo con costo. Es necesario estar presente en el evento al momento de la elección para reclamar el premio. TCG HUNT define día y hora de la elección y lo anuncia en el evento.',
    cta: { label: 'Registrarme para la rifa', href: '#registro' },
  },

  faq: [
    {
      q: '¿Cuánto cuesta entrar?',
      a: 'La entrada al Card Show CDMX es libre. Los torneos tienen inscripción propia, que anunciaremos pronto.',
    },
    {
      q: '¿Dónde y cuándo es?',
      a: 'Sábado 5 y domingo 6 de diciembre de 2026, en San José Insurgentes, CDMX. La dirección exacta la compartimos con tu registro.',
    },
    {
      q: '¿Qué juegos habrá?',
      a: 'Pokémon TCG como torneo principal, además de Riftbound, Lorcana y Shard Bugs.',
    },
    {
      q: '¿Cómo entro a la rifa?',
      a: 'Regístrate y marca «Quiero participar en la rifa». Es necesario estar presente el día del evento: elegimos al ganador en vivo.',
    },
    {
      q: 'Quiero vender o patrocinar, ¿qué hago?',
      a: 'Llena el formulario de «Vendedor / Patrocinador» con tu nombre o marca, correo y teléfono. Te contactamos en privado con las opciones.',
    },
  ] as FaqItem[],

  /**
   * Dirección general (zona) — se usa para el `.ics` (LOCATION). ⛔ La calle exacta NO se publica en la
   * página: «la dirección exacta la compartimos con tu registro» (FAQ).
   */
  comoLlegar: {
    direccion: 'San José Insurgentes, Benito Juárez, CDMX',
  },

  footer: {
    marca: 'TCG HUNT',
    wordmarkSub: 'tcghunt.mx/card-show',
    colaboracion: 'Organiza TCG HUNT en colaboración con Jakomi TCG Café.',
    whatsappDisplay: '55 6489 3921',
    contactoEmail: 'hola@tcghunt.mx',
    privacidadUrl: AVISO_PRIVACIDAD,
    legal:
      'Card Show CDMX · Organiza TCG HUNT en colaboración con Jakomi TCG Café. Entrada libre. Fechas, sede y dinámicas sujetas a confirmación. La rifa es una dinámica sin costo entre asistentes y registrados; es necesario estar presente para ganar. Pokémon y las demás marcas de juego pertenecen a sus respectivos titulares; TCG HUNT no está afiliado a ellos.',
  },

  /**
   * Versión de las BASES de la rifa que el visitante acepta al marcar `raffleOptIn` (§CARDSHOW.1b:
   * `raffleTermsVersion` obligatorio ⇔ `raffleOptIn=true`). Se envía TAL CUAL al backend.
   */
  raffleTermsVersion: 'rifa-cardshow-2026-12-v1',

  /** Logos de patrocinadores OCULTOS: sus nombres son secretos (§CARDSHOW.0). */
  patrocinios: { showSponsors: false },
} as const;
