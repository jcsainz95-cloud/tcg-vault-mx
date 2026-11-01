/**
 * ⭐ §MKT tienda §E4 — FAQ públicas de `/preguntas` (y los bloques de `/como-funciona`).
 *
 * FUENTE ÚNICA: repo de marketing `plan/RESPUESTAS.md` §12.2, **manual v9** (2026-10-23, commit `b1be3cd`). Pregunta y
 * respuesta se copian TAL CUAL (§12.0 regla 1); la tienda NO redacta ni retoca FAQ: todo cambio vuelve
 * al manual primero y después se copia la versión nueva aquí (§12.0 regla 2). Texto en español de
 * México: el manual no tiene versión en inglés, y la ruta `/en/…` lo sirve en español con aviso.
 *
 * Orden = el de §12.2 (Comprar → Bóveda → Vender → Cartas y condición → Jugar → Contacto, §12.0 regla 6).
 * `group` = el encabezado `####` de §12.2. `core` = marca ★ (núcleo).
 *
 * VIGENCIA (§12.0 regla 3): «una FAQ con revisión vencida se retira de la página hasta que se re-mida».
 * `validThrough` es el ÚLTIMO día (inclusive, hora de CDMX) en que se publica:
 *  - desde v9 cada FAQ trae su propio `validThrough` en la tabla de §12.2 («Esta tabla prevalece sobre el
 *    "Revisión: mensual" de cada ficha»); se copia tal cual (P19: 2026-11-20).
 * La página y el sitemap filtran con `publishedFaqs()` (`lib/seo-content.ts`): al vencer, sale SOLA.
 *
 * RETENIDAS (no publicadas) — ver `HELD_FAQS` al final, con su motivo (hoy ninguna: P8 se publica desde v8).
 * P1 y P8 llevan el texto v7/v8/v9 (sin cambios en v9) sin «autentic-» en la respuesta («vigente desde 2026-10-19 · revisión mensual»).
 * La PREGUNTA de P8 conserva «auténtica» (decisión A de v8: es la pregunta del cliente, no afirmación nuestra):
 * excepción nombrada en el trinquete «autentic-» de `seo-content.test.ts`.
 * ⛔ Nada del Card Show, sin precios, sin «disponible», sin emojis (§12.0 regla 4): lo vigila
 * `seo-content.test.ts`.
 */

import { PUBLIC_CONTACT_EMAIL } from '@/lib/about';

// TL-MKT5-7: el buzón de contacto se interpola de su fuente única (`lib/about.ts`, ARCHITECTURE §13.8 (c)); el texto
// que resulta es el del manual, letra por letra (`seo-content.test.ts` «TL-MKT5-7» fija el correo en las dos FAQ).
export const FAQ_MANUAL_VERSION = 'v9';
/** `FAQ_LAST_REVIEW` de §12.2 v9 de `RESPUESTAS.md`. */
export const FAQ_LAST_REVIEW = '2026-10-23';

export type FaqGroup =
  | 'Comprar'
  | 'Bóveda'
  | 'Vender'
  | 'Cartas y condición'
  | 'Jugar'
  | 'Contacto';

export const FAQ_GROUP_ORDER: readonly FaqGroup[] = [
  'Comprar',
  'Bóveda',
  'Vender',
  'Cartas y condición',
  'Jugar',
  'Contacto',
];

export interface PublicFaq {
  /** Id del manual (`P1`…`P24`). */
  id: string;
  /** ★ núcleo del manual. */
  core: boolean;
  group: FaqGroup;
  /** `Question.name` del `FAQPage` = texto visible, tal cual. */
  question: string;
  /** `acceptedAnswer.text` = texto visible, tal cual (texto plano, §12.0 regla 5). */
  answer: string;
  /** Último día de publicación (YYYY-MM-DD, CDMX, inclusive). */
  validThrough: string;
}

export const PUBLIC_FAQS: readonly PublicFaq[] = [
  {
    id: 'P1',
    core: true,
    group: "Comprar",
    question: "¿Cómo funciona la bóveda? ¿No me mandan las cartas?",
    answer:
      "Cuando compras en tcghunt.mx, tus cartas no se envían una por una: se quedan verificadas y resguardadas a tu nombre en tu bóveda, dentro de tu cuenta. Puedes seguir comprando y, cuando tú quieras, pedir el envío de todo junto en un solo paquete. Mientras están en la bóveda ves el valor de tu colección actualizado al precio de mercado del día.",
    validThrough: '2026-12-11',
  },
  {
    id: 'P2',
    core: true,
    group: "Comprar",
    question: "¿Cuándo me envían mis cartas? ¿Hay un mínimo?",
    answer:
      "Cuando tú decidas y sin mínimo de cartas. Desde «Mi bóveda» eliges las cartas que quieres recibir y pides el envío a una dirección en México. Pagas una sola tarifa de envío por paquete, que ves en el checkout antes de confirmar, y le das seguimiento desde tu cuenta.",
    validThrough: '2026-12-11',
  },
  {
    id: 'P3',
    core: true,
    group: "Comprar",
    question: "¿Hacen envíos a todo México? ¿Y al extranjero?",
    answer:
      "Enviamos a cualquier dirección en México. Por ahora no hacemos envíos internacionales. Cuando sale tu paquete te llega el número de guía por correo y puedes seguirlo desde tu cuenta o desde el enlace del correo.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P4',
    core: false,
    group: "Comprar",
    question: "¿Puedo comprar sin cuenta?",
    answer:
      "Sí. Puedes comprar como invitado con tu correo y una dirección en México; el pedido se envía a tu domicilio y le das seguimiento con el enlace que te llega al correo. La bóveda sí requiere cuenta, porque es donde se guardan tus cartas y desde donde pides tus envíos.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P5',
    core: false,
    group: "Comprar",
    question: "¿El precio ya incluye IVA? ¿Qué me cobran al final?",
    answer:
      "El precio que ves en cada carta ya lleva el IVA incluido. En el checkout ves el desglose completo —envío, si aplica, y la comisión de plataforma— antes de pagar. Nada se suma después sin que lo hayas visto.",
    validThrough: '2026-12-11',
  },
  {
    id: 'P6',
    core: false,
    group: "Comprar",
    question: "¿Por qué cambian los precios de un día a otro?",
    answer:
      "El precio de venta de cada carta se deriva del valor de mercado de ese día para esa carta y ese acabado, y se actualiza a diario. Por eso una carta puede costar distinto hoy que la semana pasada.",
    validThrough: '2026-12-11',
  },
  {
    id: 'P11',
    core: false,
    group: "Comprar",
    question: "¿Ustedes gradean cartas? ¿La cifra de PSA 10 de la ficha es lo que vale la mía?",
    answer:
      "No gradeamos cartas ni intermediamos el servicio de gradeo. La cifra de PSA 10 o PSA 9 que aparece en algunas fichas es un dato ilustrativo de mercado sobre ese modelo de carta ya gradeado por terceros. No es una valuación de tu carta ni una promesa de grado.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P23',
    core: false,
    group: "Bóveda",
    question: "¿Puedo ver cuánto vale mi colección?",
    answer:
      "Sí. En «Mi bóveda» ves el valor de tu colección carta por carta, a precio de mercado del día, y una gráfica de cómo ha cambiado en el tiempo.",
    validThrough: '2026-12-11',
  },
  {
    id: 'P24',
    core: false,
    group: "Bóveda",
    question: "¿Cuánto cuesta guardar las cartas en la bóveda? ¿Hay límite?",
    answer:
      "Hoy guardar tus cartas en la bóveda no tiene costo, ni límite de tiempo ni de cantidad. Los términos de tcghunt.mx reservan el derecho de la plataforma a cobrar custodia en el futuro.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P12',
    core: true,
    group: "Vender",
    question: "¿Cómo vendo mis cartas? ¿Necesito cuenta para cotizar?",
    answer:
      "Entra al cotizador de tcghunt.mx, busca cada carta, elige su acabado y ves al momento lo que te pagamos hoy. Cotizar es gratis, sin cuenta y sin compromiso. Para mandar la solicitud de venta sí necesitas una cuenta con correo verificado; después recibes una oferta con el detalle y, si la aceptas, nosotros te mandamos la guía de envío.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P13',
    core: true,
    group: "Vender",
    question: "¿Qué cartas compran? ¿Compran jugadas, sellado o gradeadas?",
    answer:
      `Por el cotizador compramos cartas sueltas en Near Mint (NM). Si al recibirla una carta no está en NM, no se compra: se te devuelve si lo pides, a tu costo, dentro de 7 días, o se considera abandonada a los 30 días. Producto sellado no lo compramos por la app, pero puedes escribirnos a ${PUBLIC_CONTACT_EMAIL} con fotos y lo cotizamos.`,
    validThrough: '2027-01-22',
  },
  {
    id: 'P14',
    core: true,
    group: "Vender",
    question: "¿A cuánto compran? ¿Cuánto me dan por mi carta?",
    answer:
      "Lo que te pagamos por cada carta lo ves en el cotizador de tcghunt.mx: buscas la carta, eliges el acabado y aparece el precio de compra de hoy en NM. Ese precio cambia a diario, por eso no publicamos cifras fuera del cotizador. El precio de la oferta que aceptes ya no se mueve cuando llegan tus cartas: cada una que llegue en NM se paga a lo ofertado.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P15',
    core: false,
    group: "Vender",
    question: "¿Quién paga el envío cuando vendo?",
    answer:
      "La guía la ponemos nosotros y no la pagas por adelantado. Su costo es una tarifa fija que se descuenta de lo que te pagamos, y el monto exacto va en la oferta, antes de que aceptes. No mandes nada hasta tener la guía.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P16',
    core: false,
    group: "Vender",
    question: "¿Cómo empaco mis cartas para mandarlas?",
    answer:
      "Cada carta en su funda y la funda dentro de un top loader rígido. Todo va en un sobre burbuja si son pocas cartas, o en una caja con relleno si es un lote, con una hoja adentro con tu número de solicitud. La guía te la mandamos nosotros al aceptar la oferta.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P17',
    core: true,
    group: "Vender",
    question: "¿Cómo y cuándo me pagan las cartas que les vendo?",
    answer:
      "Te pagamos por transferencia SPEI a una CLABE a tu nombre, después de recibir y verificar tus cartas. El precio de la oferta que aceptaste es el que se paga por cada carta que llegue en NM. La fecha límite para aceptar la oferta y para enviar van con fecha y hora exactas en tu correo.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P7',
    core: true,
    group: "Cartas y condición",
    question: "¿Qué es NM? ¿Las cartas están en Near Mint aunque no haya foto?",
    answer:
      "NM es Near Mint: una carta casi perfecta, sin rayones, dobleces ni desgaste visible en bordes y esquinas. Es la única condición de las cartas sueltas que vendemos y compramos. Cada carta se revisa en mano al entrar a la bóveda, por eso la ficha usa la imagen de catálogo y no fotos sueltas. Si una carta te llegara dañada o equivocada, tienes 7 días desde la entrega para abrir una disputa y te compensamos.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P8',
    core: true,
    group: "Cartas y condición",
    question: "¿Cómo sé que una carta que compro en TCG HUNT es auténtica?",
    answer:
      "Cada carta que vendemos se revisa en mano antes de publicarse: que sea original y su condición. Después se queda resguardada en la bóveda hasta que pides tu envío, así que la pieza que compras ya pasó esa revisión. No revisamos cartas de terceros por foto ni a distancia: que una carta sea original lo verificamos solo con la carta en mano, cuando entra a la bóveda o cuando nos la vendes.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P9',
    core: true,
    group: "Cartas y condición",
    question: "¿Cómo sé si una carta Pokémon es pirata?",
    answer:
      "Revisa cinco señales: tipografía, impresión, holo y textura, reverso y precio. Las originales usan siempre la misma letra y el mismo tamaño, el marco va parejo por los cuatro lados y nítido, y cada rareza tiene su brillo y textura; letras raras, faltas de ortografía, bordes chuecos, imagen borrosa, holo donde no debería o plástico liso delatan la copia. Por atrás la original es azul parejo con el remolino nítido y, con una linterna por detrás, deja pasar poca luz y pareja; nunca rasgues ni dobles una carta para probarla, porque dañas una carta real. Si el precio está muy por debajo de lo normal, el vendedor no tiene historial y usa fotos de catálogo en vez de la carta real, no compres.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P10',
    core: true,
    group: "Cartas y condición",
    question: "¿Qué es una SIR y qué es una IR?",
    answer:
      "IR es Illustration Rare: una carta común, poco común o rara con ilustración completa alternativa, marcada con una estrella dorada. SIR es Special Illustration Rare: ilustración completa con una capa extra de foil, normalmente de un Pokémon ex o un Partidario, con dos estrellas doradas y al final de la numeración del set. La rareza la ves en el símbolo junto al número de la carta.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P18',
    core: true,
    group: "Jugar",
    question: "¿Cómo saco mi Player ID para jugar torneos de Pokémon?",
    answer:
      "Crea tu cuenta del Club de Entrenadores Pokémon en join.pokemon.com, verifica tu correo y, en tu perfil, entra a «Play! Pokémon Settings», pide que te asignen un Player ID nuevo y acepta los términos: ahí aparece tu número. Si es para un menor, primero crea tu cuenta como madre, padre o tutor y desde ella añade la del menor; su Player ID se genera en su propio perfil. Con ese número completas tu perfil en rk9.gg (una cuenta por jugador) y ya puedes registrarte a Regionales. El Trainer ID de Pokémon GO no es el Player ID.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P19',
    core: true,
    group: "Jugar",
    question: "¿Qué es el prerelease de Delta Reign y cuándo sale el set?",
    answer:
      "El prerelease no es un torneo ni un evento: es el primer momento en que se puede conseguir cartas de un set nuevo. Las cajas Build & Battle de Delta Reign se pueden conseguir desde el 24 de octubre de 2026 en tiendas Play! Pokémon seleccionadas, y el set completo tiene fecha de salida el 6 de noviembre de 2026 en inglés. Para México o en español no tenemos fecha oficial confirmada; lo que tengamos en tcghunt.mx lo ves en producto sellado.",
    validThrough: '2026-11-20',
  },
  {
    id: 'P20',
    core: false,
    group: "Jugar",
    question: "¿Qué es la rotación de Standard? ¿Mi carta sigue siendo legal?",
    answer:
      "Standard es el formato oficial de torneos con las cartas más recientes, y la rotación es el momento en que un bloque deja de ser legal. Desde el 10 de abril de 2026 las cartas con marca de regulación G ya no son legales en Standard; las marcas H, I y J sí. La marca se mira impresa abajo a la izquierda de cada carta, no el set del que viene.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P21',
    core: false,
    group: "Jugar",
    question: "¿Qué es un Regional, una League Cup y un League Challenge? ¿Cómo me inscribo?",
    answer:
      "Son torneos oficiales de Play! Pokémon ordenados por tamaño: League Challenge (pequeño, en tienda, solo rondas suizas), League Cup (local pero más grande) y Regional (grande, de fin de semana); todos dan puntos para el Mundial. Para jugar necesitas tu Player ID del Club de Entrenadores. Los torneos locales se buscan en events.pokemon.com y a los Regionales te inscribes en rk9.gg; cupo, costo y premios los publica cada organizador.",
    validThrough: '2027-01-22',
  },
  {
    id: 'P22',
    core: false,
    group: "Contacto",
    question: "¿Cómo los contacto?",
    answer:
      `Para cualquier duda o aclaración sobre un pedido, una venta o tu cuenta escríbenos a soporte@tcghunt.mx. Para vender producto sellado, a ${PUBLIC_CONTACT_EMAIL} con fotos. Para factura (CFDI), manda tus datos fiscales a facturacion@tcghunt.mx después de pagar, citando tu pedido.`,
    validThrough: '2027-01-22',
  },
];

/**
 * FAQ del manual §12.2 que la tienda NO publica todavía, con el motivo. Solo id + motivo: el texto
 * vive en el manual (un hecho, un documento). Hoy vacía: P8 (retenida por «No autenticamos…» en v5) se
 * publica con el texto de v7/v8.
 */
export const HELD_FAQS: readonly { id: string; reason: string }[] = [];
