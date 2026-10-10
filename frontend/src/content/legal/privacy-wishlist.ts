/**
 * §WSH.5 · criterio 824 (I-2 de QA sobre 503cf07) — párrafo «Lista de deseos» del aviso de privacidad, COPIADO LITERAL
 * de `PROJECT.md §WSH.5` «Texto exacto de la línea del aviso de privacidad» (commit aba09760; P-WSH-6 con la
 * recomendación). ⛔ No se edita aquí: se cambia en PROJECT.md y se vuelve a copiar (candado `privacy-wishlist.test.ts`,
 * que lo lee de PROJECT.md). «Mi cuenta» / "My account" son los nombres visibles de la sección de perfil
 * (`messages/*.json` `nav.myAccount`), así que el SUPUESTO de PROJECT se cumple sin cambiar nada.
 *
 * - `WISHLIST_PRIVACY_ES` va dentro del aviso (`privacidad.es.ts`, apartado 3, finalidades), que es el texto que se
 *   publica en /es y en /en (ARCHITECTURE §4.63.7: aviso en español).
 * - `WISHLIST_PRIVACY_EN` se pinta además en /en, con `lang="en"`, justo debajo del español (criterio 824 pide el
 *   párrafo también en inglés y PROJECT da su texto literal).
 */
export const WISHLIST_PRIVACY_ES =
  '**Lista de deseos.** Si agregas cartas a tu lista de deseos, guardamos qué cartas son (y en qué acab' +
  'ado), el porcentaje sobre el precio de mercado que elegiste como máximo para cada una y el correo de' +
  ' tu cuenta para avisarte. Lo usamos para (i) avisarte por correo cuando consigamos una de esas carta' +
  's, con su precio y si cabe en tu máximo, y (ii) saber qué cartas buscar para la tienda. Para esto úl' +
  'timo usamos solo totales (cuántas personas buscan cada carta y hasta cuánto pagarían), sin tu nombre' +
  ' ni tu correo. Puedes quitar una carta o dejar de recibir estos avisos desde cualquiera de esos corr' +
  'eos, sin entrar a tu cuenta, o desde "Mi cuenta". Si borras tu cuenta, tu lista se borra.';

export const WISHLIST_PRIVACY_EN =
  '**Wishlist.** If you add cards to your wishlist, we store which cards they are (and in which finish)' +
  ', the percentage over market price you chose as your maximum for each one, and your account email so' +
  ' we can notify you. We use this to (i) email you when we get one of those cards, with its price and ' +
  'whether it fits your maximum, and (ii) know which cards to look for for the store. For the latter we' +
  ' only use totals (how many people want each card and up to how much they would pay), without your na' +
  'me or email. You can remove a card or stop these notices from any of those emails, without signing i' +
  'n, or from "My account". If you delete your account, your wishlist is deleted.';
