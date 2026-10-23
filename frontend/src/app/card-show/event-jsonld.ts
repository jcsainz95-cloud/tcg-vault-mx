import { CARD_SHOW, CARD_SHOW_GAMES } from '@/content/card-show';

/**
 * ⭐ MKT-E5 — JSON-LD `Event` (schema.org) de la landing `/card-show`. Puro: lo pinta `page.tsx` con
 * `<JsonLd>` (que escapa `<`, igual que el resto del JSON-LD de la tienda) y lo prueba `event-jsonld.test.tsx`.
 *
 * TODO dato sale de `content/card-show.ts` (una sola fuente): fechas (`countdownTargetIso` +
 * `evento.horarios[].cierre`), sede (`evento.direccion`: `calle`, `alcaldia`, `postalCode`, `region` — campos
 * estructurados, sin partir textos, TL-CS-1), juegos (`CARD_SHOW_GAMES`), organizadores (TCG HUNT + el
 * colaborador público).
 *
 * ⛔ Lo que NO lleva, a propósito:
 *  - Sin `offers` ni precio: la entrada es libre (`isAccessibleForFree`); el precio del torneo de Pokémon es
 *    de un torneo, no del evento, y un `Offer` con cifra obliga a la regla «precio final con IVA, con fecha».
 *  - Sin `sponsor`/`funder`: los nombres de patrocinador son el ÚNICO secreto del Card Show (`card-show.ts`).
 *  - Sin premios («por anunciar» en varios torneos), sin montaje de vendedores (horario «se confirma») y sin
 *    `sameAs`/URL del colaborador (decisión del dueño: sin enlaces a sus redes).
 */

const OFFSET = CARD_SHOW.countdownTargetIso.slice(-6); // «-06:00» (America/Mexico_City)

/** `YYYY-MM-DD` + `n` días (calendario puro, sin zona). */
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Inicio = apertura del primer día; fin = cierre del último día de `evento.horarios` (días consecutivos). */
export function cardShowDates(): { startDate: string; endDate: string } {
  const horarios = CARD_SHOW.evento.horarios;
  const firstDay = CARD_SHOW.countdownTargetIso.slice(0, 10);
  const lastClose = horarios[horarios.length - 1].cierre; // «18:00»
  return {
    startDate: CARD_SHOW.countdownTargetIso,
    endDate: `${addDays(firstDay, horarios.length - 1)}T${lastClose}:00${OFFSET}`,
  };
}

export function cardShowEventJsonLd(): Record<string, unknown> {
  const c = CARD_SHOW;
  const dir = c.evento.direccion;
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: `${c.hero.titulo} ${c.hero.lineaDos}`,
    description: c.hero.lede,
    url: c.canonicalUrl,
    image: [`${c.homeUrl}/card-show/og.png`],
    inLanguage: c.lang,
    ...cardShowDates(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: true,
    location: {
      '@type': 'Place',
      name: c.hero.sede,
      address: {
        '@type': 'PostalAddress',
        streetAddress: dir.calle,
        addressLocality: dir.alcaldia,
        addressRegion: dir.region,
        postalCode: dir.postalCode,
        addressCountry: 'MX',
      },
    },
    organizer: [
      { '@type': 'Organization', name: c.footer.marca, url: c.homeUrl },
      { '@type': 'Organization', name: c.colaborador.nombre },
    ],
    about: CARD_SHOW_GAMES.map((g) => ({ '@type': 'Thing', name: g.label })),
  };
}
