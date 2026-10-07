/**
 * wishlist-mail.spec.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.6, DESIGN_SYSTEM §WSH-UX.5). Render PURO del correo
 * «Ya tenemos una carta de tu lista».
 *
 * WSH-T13 (unit, criterio 813) — `es` y `en`: P, máximo, cabe / no cabe / sin mercado, `catalog/{cardId}`, la frase de
 *   «no te la apartamos», los dos enlaces (quitar y dejar de recibir) y el pie de privacidad; sin `APP_PUBLIC_URL` ⇒ sin
 *   `href` a medias.
 * WSH-T36 (unit, Q-WSH-UX-9) — `<img src>` = `Card.imageSmallUrl` BYTE A BYTE, `alt=""`, `width`/`height` fijos; host fuera de
 *   `SET_IMAGE_HOSTS`, `http:`, con puerto, con credenciales o `null` ⇒ la línea SIN `<img>` y con el mismo texto; ningún
 *   `<img>` lleva query ni fragmento; los únicos hosts de imagen son el de la mira y los de la lista.
 * Canario (§WSH.9): añadir `?utm_source=` a la URL o quitar el filtro de host ⇒ T36 rojo.
 */
import { renderWishlistMail, safeCardImageUrl, WishlistMailInput } from '../src/modules/wishlist/wishlist-mail';
import { MAIL_MIRA_URL } from '../src/modules/buylist/mail-shell';
import { SET_IMAGE_HOSTS } from '../src/modules/catalog/catalog-sync.service';

const ORIGIN = 'https://tienda.example.test';
const IMG = 'https://images.pokemontcg.io/sv3/125.png';

const line = (over: Partial<WishlistMailInput['lines'][number]> = {}): WishlistMailInput['lines'][number] => ({
  wishlistItemId: 'wi-1',
  removeToken: 'tok-remove-1',
  cardId: 'card-1',
  cardName: 'Charizard ex',
  setName: 'Obsidian Flames',
  number: '125',
  finish: 'reverse_holo',
  imageSmallUrl: IMG,
  count: 1,
  priceDisplayCents: 133400,
  maxDisplayCents: 110000,
  fits: false,
  ...over,
});

const input = (locale: 'es' | 'en', lines = [line()]): WishlistMailInput => ({
  locale,
  mailId: 'mail-1',
  pauseToken: 'tok-pause-1',
  lines,
});

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved.APP_PUBLIC_URL = process.env.APP_PUBLIC_URL;
  saved.APP_BASE_URL = process.env.APP_BASE_URL;
  process.env.APP_PUBLIC_URL = ORIGIN;
  delete process.env.APP_BASE_URL;
});
afterEach(() => {
  for (const k of ['APP_PUBLIC_URL', 'APP_BASE_URL'] as const) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const imgTags = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];
const srcOf = (tag: string) => /\bsrc="([^"]*)"/.exec(tag)?.[1] ?? '';

describe('WSH-T13 — el correo dice lo que tiene que decir (criterio 813)', () => {
  it('es: asunto, P, máximo, «está arriba», ficha, no te la apartamos, quitar, dejar de recibir, aviso de privacidad', () => {
    const m = renderWishlistMail(input('es'));
    expect(m.subject).toBe('Ya tenemos una carta de tu lista: Charizard ex');
    for (const s of [
      'Precio: $1,334.00 IVA incluido',
      'Tu máximo de hoy: $1,100.00 IVA incluido',
      'Está arriba de tu máximo.',
      'No te la apartamos: si varias personas la esperan, se la lleva quien pague primero.',
      'Ver la carta',
      'Quitar esta carta de mi lista',
      'Dejar de recibir estos avisos',
    ]) {
      expect(m.html).toContain(s);
      expect(m.text).toContain(s);
    }
    expect(m.html).toContain(`href="${ORIGIN}/es/catalog/card-1"`);
    expect(m.html).toContain(`${ORIGIN}/es/lista-de-deseos/aviso?a=remove&amp;id=wi-1&amp;t=tok-remove-1`);
    expect(m.html).toContain(`${ORIGIN}/es/lista-de-deseos/aviso?a=pause&amp;id=mail-1&amp;t=tok-pause-1`);
    expect(m.text).toContain(`${ORIGIN}/es/lista-de-deseos/aviso?a=remove&id=wi-1&t=tok-remove-1`);
    expect(m.html).toContain(`href="${ORIGIN}/es/privacidad"`);
    expect(m.html).toContain('Reverse Holo');
    // ⛔ No dice cuántas personas la esperan; ⛔ no va a la campana (no es una plantilla de §R).
    expect(m.html).not.toMatch(/personas? la (busca|espera)n? \d/);
  });

  it('en: asunto y frases con paridad', () => {
    const m = renderWishlistMail(input('en', [line({ fits: true, maxDisplayCents: 134560 })]));
    expect(m.subject).toBe('We found a card from your wishlist: Charizard ex');
    for (const s of [
      'Price: $1,334.00 VAT included',
      'Your max today: $1,345.60 VAT included',
      'It fits your max.',
      "We don't hold it for you: if several people are waiting, whoever pays first gets it.",
      'See the card',
      'Remove this card from my wishlist',
      'Stop these alerts',
    ]) {
      expect(m.html).toContain(s.replace(/'/g, '&#39;'));
      expect(m.text).toContain(s);
    }
    expect(m.html).toContain(`href="${ORIGIN}/en/catalog/card-1"`);
    expect(m.html).toContain(`href="${ORIGIN}/es/privacidad"`);
  });

  it('sin mercado: «Hoy no hay precio de mercado» y ⛔ ninguna línea de máximo ni $0.00 (807)', () => {
    const m = renderWishlistMail(input('es', [line({ maxDisplayCents: null, fits: null })]));
    expect(m.html).toContain('Hoy no hay precio de mercado: no pudimos calcular tu máximo.');
    expect(m.html).not.toContain('Tu máximo de hoy');
    expect(m.html).not.toContain('$0.00');
  });

  it('cabe: «Cabe en tu máximo.»', () => {
    const m = renderWishlistMail(input('es', [line({ fits: true, maxDisplayCents: 134560 })]));
    expect(m.html).toContain('Cabe en tu máximo.');
    expect(m.html).not.toContain('Está arriba de tu máximo.');
  });

  it('n cartas: asunto «Ya tenemos 2 cartas de tu lista»; varias piezas del mismo deseo ⇒ «Precio desde» y «3 disponibles»', () => {
    const m = renderWishlistMail(
      input('es', [line(), line({ wishlistItemId: 'wi-2', removeToken: 't2', cardId: 'card-2', cardName: 'Pikachu', count: 3 })]),
    );
    expect(m.subject).toBe('Ya tenemos 2 cartas de tu lista');
    expect(m.html).toContain('3 disponibles');
    expect(m.html).toContain('Precio desde: $1,334.00 IVA incluido');
    expect(m.html).toContain('Charizard ex');
    expect(m.html).toContain('Pikachu');
  });

  it('sin APP_PUBLIC_URL: ⛔ ningún href a medias (ni ficha ni enlaces de baja) y la instrucción en texto', () => {
    delete process.env.APP_PUBLIC_URL;
    const m = renderWishlistMail(input('es'));
    expect(m.html).not.toContain('lista-de-deseos/aviso');
    expect(m.html).not.toContain('/catalog/card-1');
    expect(m.html).toContain('Para verla, entra a TCG HUNT › Mi cuenta › Mi lista de deseos.');
    for (const href of m.html.match(/href="([^"]*)"/g) ?? []) expect(href).toMatch(/^href="https?:\/\//);
  });

  it('S15-B1: el nombre hostil sale escapado en el HTML', () => {
    const m = renderWishlistMail(input('es', [line({ cardName: 'X <script>alert(1)</script> "Y"' })]));
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('X &lt;script&gt;alert(1)&lt;/script&gt; &quot;Y&quot;');
  });
});

describe('WSH-T36 — la foto del correo (Q-WSH-UX-9)', () => {
  it('`src` = `imageSmallUrl` byte a byte, `alt=""`, `width="56" height="78"`', () => {
    const m = renderWishlistMail(input('es'));
    const cards = imgTags(m.html).filter((t) => srcOf(t) !== MAIL_MIRA_URL);
    expect(cards).toHaveLength(1);
    expect(srcOf(cards[0])).toBe(IMG);
    expect(cards[0]).toContain('alt=""');
    expect(cards[0]).toContain('width="56"');
    expect(cards[0]).toContain('height="78"');
  });

  it.each([
    ['host fuera de la lista', 'https://evil.example/x.png'],
    ['subdominio parecido', 'https://images.pokemontcg.io.evil.com/x.png'],
    ['http:', 'http://images.pokemontcg.io/x.png'],
    ['con puerto', 'https://images.pokemontcg.io:8443/x.png'],
    ['con credenciales', 'https://u:p@images.pokemontcg.io/x.png'],
    ['con query', 'https://images.pokemontcg.io/x.png?utm_source=mail'],
    ['con fragmento', 'https://images.pokemontcg.io/x.png#a'],
    ['basura', 'no es una url'],
  ])('%s ⇒ la línea SIN <img> y con el mismo texto', (_n, url) => {
    const base = renderWishlistMail(input('es'));
    const m = renderWishlistMail(input('es', [line({ imageSmallUrl: url })]));
    expect(imgTags(m.html).filter((t) => srcOf(t) !== MAIL_MIRA_URL)).toHaveLength(0);
    expect(m.text).toBe(base.text);
    expect(safeCardImageUrl(url)).toBeNull();
  });

  it('`null` ⇒ sin <img>', () => {
    const m = renderWishlistMail(input('es', [line({ imageSmallUrl: null })]));
    expect(imgTags(m.html).filter((t) => srcOf(t) !== MAIL_MIRA_URL)).toHaveLength(0);
  });

  it('el host scrydex también está en la lista', () => {
    expect(safeCardImageUrl('https://images.scrydex.com/a/b.png')).toBe('https://images.scrydex.com/a/b.png');
  });

  it('ningún <img> lleva query ni fragmento; los únicos hosts son el de la mira y los de `SET_IMAGE_HOSTS`', () => {
    const m = renderWishlistMail(
      input('es', [line(), line({ wishlistItemId: 'wi-2', cardId: 'c2', imageSmallUrl: 'https://images.scrydex.com/a/b.png' })]),
    );
    const mira = new URL(MAIL_MIRA_URL).host;
    for (const tag of imgTags(m.html)) {
      const u = new URL(srcOf(tag).replace(/&amp;/g, '&'));
      expect(u.search).toBe('');
      expect(u.hash).toBe('');
      expect(u.host === mira || SET_IMAGE_HOSTS.has(u.host)).toBe(true);
    }
  });
});
