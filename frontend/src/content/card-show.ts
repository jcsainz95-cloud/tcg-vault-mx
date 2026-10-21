/**
 * CARD SHOW — contenido de la landing (API_CONTRACT §CARDSHOW v1.96, ARCHITECTURE §4.CARDSHOW).
 *
 * ESTADO (PIVOTE A CAPTURA, decisión del dueño JC 2026-10-17): la landing deja de ser «anuncio con
 * datos» y pasa a ser **página de CAPTURA DE LEADS** que ⛔ NO expone el modelo de negocio.
 * Quitados: precios de mesa, plano de 23 mesas, montos de patrocinio y sus helpers.
 * Conservados: fecha/sede/entrada, cuenta regresiva, torneos por juego (horarios y premios finales, JC 2026-10-21),
 * rifa informal y datos públicos de Jakomi (nombre + logo, SIN enlaces a sus redes — decisión JC).
 *
 * ⛔ ÚNICO SECRETO QUE QUEDA: los NOMBRES DE PATROCINADORES (no viven en el repo). Las únicas marcas
 * nombradas son **TCG HUNT** y **Jakomi**. El candado de secreto del CI (devops) hace grep de los
 * nombres de patrocinador (env `CARDSHOW_SECRET_TERMS`) sobre esta rama.
 */

/** Juego del torneo / interés (enum `CardShowGame`, §Enums). Pokémon = formal; resto = ligera. */
export type CardShowGame = 'pokemon' | 'riftbound' | 'lorcana' | 'shardbugs' | 'magic';
export type CardShowDayId = 'sat' | 'sun';
export type TorneoEstado = 'abierta' | 'cerrada';

/**
 * Los CINCO juegos del enum del contrato, con etiqueta de pantalla (§Enums, M-85/v1.97, M-90/v1.101).
 * Valores en minúscula (`shardbugs`, `magic`); el nombre visible lo pone el frontend AQUÍ (un sitio:
 * §CARDSHOW.1a-quater — «Magic: The Gathering»).
 */
export const CARD_SHOW_GAMES: { id: CardShowGame; label: string }[] = [
  { id: 'pokemon', label: 'Pokémon TCG' },
  { id: 'riftbound', label: 'Riftbound' },
  { id: 'lorcana', label: 'Lorcana' },
  { id: 'shardbugs', label: 'Shard Bugs' },
  { id: 'magic', label: 'Magic: The Gathering' },
];

/** Etiqueta visible de un valor de `CardShowGame` (fuente única: `CARD_SHOW_GAMES`). */
export function cardShowGameLabel(id: string): string {
  return CARD_SHOW_GAMES.find((g) => g.id === id)?.label ?? id;
}

/** Un torneo del programa por día (datos del dueño JC, chat 2026-10-21). */
export interface TorneoProgramado {
  id: CardShowGame;
  nombre: string;
  horas: string;
  cupo: number;
  precio: string;
  premios: string[];
}

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
    // Mascota SOLA (axolotl, recortada del lockup vertical): para el topbar, donde el lockup completo
    // dejaba el nombre a ~5px ilegible. En el topbar va la mascota chica + «Jakomi» en texto (RONDA 3 I-1).
    mascota: '/card-show/jakomi-mascota.webp',
    descripcion:
      '«Tu casa del TCG en Coyoacán». Tienda-café de cartas (Pokémon, Lorcana y Magic) que organiza los torneos del Card Show.',
  },

  /**
   * DATOS DEL EVENTO — fuente única: `docs/specs/CARDSHOW_LANDING_ESTADO.md` «DATOS DEL EVENTO» (JC
   * 2026-10-17, públicos por decisión del dueño). La dirección exacta YA se publica. El mapa va
   * EMBEBIDO (iframe de Google Maps sin API key, `mapsEmbedUrl`) — la CSP lo admite desde que el dueño
   * autorizó añadir `frame-src https://www.google.com` (JC 2026-10-18, `security/csp.ts`); además queda
   * el ENLACE externo `mapsUrl` («Abrir en Google Maps»). Horarios de torneos FINALES (JC 2026-10-21).
   */
  evento: {
    eyebrow: 'Cuándo y dónde',
    titulo: 'Dos días en San José Insurgentes',
    entrada: 'Entrada libre — no necesitas registrarte para entrar.',
    horarios: [
      { dia: 'Sábado 5 de diciembre', horas: '11:00–19:00' },
      { dia: 'Domingo 6 de diciembre', horas: '11:00–18:00' },
    ] as { dia: string; horas: string }[],
    direccion: {
      calle: 'José del Castillo 3, esq. Av. Revolución',
      colonia: 'Col. San José Insurgentes, Benito Juárez',
      cp: '03900 CDMX',
      pisos: [
        'Piso 2 — vendedores',
        'Piso 3 — torneos, juego libre y comida',
      ],
      mapsLabel: 'Abrir en Google Maps',
      mapsUrl:
        'https://www.google.com/maps/search/?api=1&query=Jos%C3%A9+del+Castillo+3%2C+San+Jos%C3%A9+Insurgentes%2C+Benito+Ju%C3%A1rez%2C+CDMX',
      // Iframe SIN API key (forma `?q=<dir>&output=embed`); host `www.google.com` (único dominio añadido
      // a `frame-src`). Dirección urlencoded = la misma `comoLlegar.direccion` (fuente única del texto plano).
      mapsEmbedUrl:
        'https://www.google.com/maps?q=Jos%C3%A9%20del%20Castillo%203%2C%20San%20Jos%C3%A9%20Insurgentes%2C%20Benito%20Ju%C3%A1rez%2C%2003900%20CDMX&output=embed',
      mapsEmbedTitle:
        'Mapa de Google: José del Castillo 3, Col. San José Insurgentes, Benito Juárez, 03900 CDMX',
    },
    torneoPokemon:
      'Torneos: 11:00–14:00 Riftbound y Magic (sábado), Lorcana y Shard Bugs (domingo); 14:00–18:00 Pokémon los dos días. Detalle y premios en «Torneos».',
    montaje: 'Montaje de vendedores: viernes 4 de diciembre (el horario se confirma al apartar la mesa).',
    comoLlegar: [
      'Metro Mixcoac (Líneas 7 y 12) + ~5 min caminando por Av. Revolución.',
      'Metrobús Línea 1, estación Río Churubusco.',
    ] as string[],
  },

  queEncontraras: [
    {
      n: '01',
      titulo: 'Torneos por juego',
      texto: 'Pokémon como torneo principal, más Riftbound, Magic: The Gathering, Lorcana y Shard Bugs. Horarios y premios en «Torneos».',
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
      'Cinco juegos sobre la mesa. Pokémon cuesta MX$200; Riftbound, Magic, Lorcana y Shard Bugs son gratis. Preinscríbete aquí y haz tu registro final en el lugar.',
    /**
     * Una tarjeta por juego (los cinco valores del enum). Pokémon MX$200 los dos días (JC 2026-10-17,
     * sin cambio 2026-10-21); los demás GRATIS con «premios por anunciar» (JC 2026-10-21).
     */
    juegos: [
      {
        id: 'pokemon' as CardShowGame,
        nombre: 'Pokémon TCG',
        pill: 'Torneo principal',
        principal: true,
        precio: 'MX$200',
        linea:
          'Sábado y domingo, 14:00–18:00. Cupo de 64 por día. Preinscripción con tu Player ID; registro final en el lugar.',
      },
      {
        id: 'riftbound' as CardShowGame,
        nombre: 'Riftbound',
        pill: 'Sábado 11:00–14:00',
        principal: false,
        precio: 'Gratis',
        linea: '32 jugadores. Premios por anunciar. Preinscríbete aquí; registro final en el lugar.',
      },
      {
        id: 'magic' as CardShowGame,
        nombre: 'Magic: The Gathering',
        pill: 'Sábado 11:00–14:00',
        principal: false,
        precio: 'Gratis',
        linea: '32 jugadores. Premios por anunciar. Preinscríbete aquí; registro final en el lugar.',
      },
      {
        id: 'lorcana' as CardShowGame,
        nombre: 'Lorcana',
        pill: 'Domingo 11:00–14:00',
        principal: false,
        precio: 'Gratis',
        linea: '32 jugadores. Premios por anunciar. Preinscríbete aquí; registro final en el lugar.',
      },
      {
        id: 'shardbugs' as CardShowGame,
        nombre: 'Shard Bugs',
        pill: 'Domingo 11:00–14:00',
        principal: false,
        precio: 'Gratis',
        linea: '32 jugadores. Premios por anunciar. Preinscríbete aquí; registro final en el lugar.',
      },
    ],
    /** Programa por día con horario, cupo, inscripción y premios (dueño JC, chat 2026-10-21). */
    programa: [
      {
        id: 'sat' as CardShowDayId,
        titulo: 'Sábado 5 de diciembre',
        torneos: [
          { id: 'riftbound', nombre: 'Riftbound', horas: '11:00–14:00', cupo: 32, precio: 'Gratis', premios: ['Premios por anunciar'] },
          { id: 'magic', nombre: 'Magic: The Gathering', horas: '11:00–14:00', cupo: 32, precio: 'Gratis', premios: ['Premios por anunciar'] },
          {
            id: 'pokemon',
            nombre: 'Pokémon TCG',
            horas: '14:00–18:00',
            cupo: 64,
            precio: 'MX$200',
            premios: [
              '1.º Ultra Premium Collection 30 aniversario',
              '2.º Elite Trainer Box 30 aniversario',
              '3.º Poster Collection',
            ],
          },
        ] as TorneoProgramado[],
      },
      {
        id: 'sun' as CardShowDayId,
        titulo: 'Domingo 6 de diciembre',
        torneos: [
          { id: 'lorcana', nombre: 'Lorcana', horas: '11:00–14:00', cupo: 32, precio: 'Gratis', premios: ['Premios por anunciar'] },
          { id: 'shardbugs', nombre: 'Shard Bugs', horas: '11:00–14:00', cupo: 32, precio: 'Gratis', premios: ['Premios por anunciar'] },
          {
            id: 'pokemon',
            nombre: 'Pokémon TCG',
            horas: '14:00–18:00',
            cupo: 64,
            precio: 'MX$200',
            premios: ['1.º Elite Trainer Box 30 aniversario', '2.º Poster Collection 30 aniversario'],
          },
        ] as TorneoProgramado[],
      },
    ],
    registroFinal:
      'Todos los torneos: preinscripción en esta página y registro final en el lugar, el día del torneo.',
    cuarto: 'Cinco juegos confirmados. Dinos en el registro cuál te gustaría jugar y te avisamos primero.',
    /** Días de la preinscripción (el cupo vivo de Pokémon lo pinta `TournamentCounter`, §CARDSHOW.12-bis). */
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
    // Barra de anuncio superior (gancho ARRIBA DEL TODO, decisión JC 2026-10-18 «que jale gente»).
    anuncio: 'Rifa en vivo · Pokémon 30th Celebration Poster Collection — regístrate y participa',
    // Variante CORTA para <640px (RONDA 3 I-3): evita que la barra caiga a 3 líneas con la «→» huérfana.
    anuncioCorto: 'Rifa en vivo · Pokémon 30th — regístrate y participa',
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
      a: 'La entrada al Card Show CDMX es libre: no necesitas registrarte para entrar. El torneo de Pokémon cuesta MX$200 (sábado y domingo); los torneos de Riftbound, Magic: The Gathering, Lorcana y Shard Bugs son gratis.',
    },
    {
      q: '¿Dónde y cuándo es?',
      a: 'Sábado 5 (11:00–19:00) y domingo 6 (11:00–18:00) de diciembre de 2026, en José del Castillo 3, esq. Av. Revolución, Col. San José Insurgentes, Benito Juárez, 03900 CDMX. Piso 2 para vendedores; piso 3 para torneos, juego libre y comida.',
    },
    {
      q: '¿Qué juegos habrá?',
      a: 'Cinco: Pokémon TCG (sábado y domingo, 14:00–18:00, 64 jugadores por día); Riftbound y Magic: The Gathering (sábado, 11:00–14:00, 32 jugadores cada uno); Lorcana y Shard Bugs (domingo, 11:00–14:00, 32 jugadores cada uno).',
    },
    {
      q: '¿Cómo me inscribo a un torneo?',
      a: 'Preinscríbete en esta página (Pokémon pide tu Player ID) y haz tu registro final en el lugar, el día del torneo. La preinscripción no sustituye el registro en sitio.',
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
   * Dirección completa — se usa para el `.ics` (LOCATION) y ahora es PÚBLICA (JC 2026-10-17): se
   * muestra en la sección «Cuándo y dónde» (ver `evento.direccion`). Una sola fuente del texto plano.
   */
  comoLlegar: {
    direccion: 'José del Castillo 3, esq. Av. Revolución, Col. San José Insurgentes, Benito Juárez, 03900 CDMX',
  },

  footer: {
    marca: 'TCG HUNT',
    wordmarkSub: 'tcghunt.mx/card-show',
    colaboracion: 'Organiza TCG HUNT en colaboración con Jakomi TCG Café.',
    whatsappDisplay: '55 6489 3921',
    // Accionable: WhatsApp vía wa.me con lada MX (52 + 10 dígitos). ⛔ sin separadores en el href.
    whatsappHref: 'https://wa.me/525564893921',
    contactoEmail: 'hola@tcghunt.mx',
    contactoEmailHref: 'mailto:hola@tcghunt.mx',
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
