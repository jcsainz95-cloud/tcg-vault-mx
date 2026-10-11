/**
 * wishlist-mail.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.6, redacción final DESIGN_SYSTEM §WSH-UX.5). **Render PURO** del
 * correo «Ya tenemos una carta de tu lista», `es`/`en` con paridad, sobre el esqueleto de marca `mailShell` (pie de privacidad
 * de siempre, criterio 507).
 *
 * - Enlaces con `appUrl()`; sin origen ⇒ ni botón ni enlaces de baja (⛔ nunca un `href` a medias) y una instrucción en texto.
 * - La foto (Q-WSH-UX-9): `src` = `Card.imageSmallUrl` BYTE A BYTE, solo si pasa {@link safeCardImageUrl}; si no, la línea
 *   va sin `<img>` y con el mismo texto. ⛔ Sin proxy, sin `cid:`, sin parámetros añadidos (no medimos aperturas).
 * - ⛔ No dice cuántas personas la esperan; ⛔ no va a la campana (§R).
 */
import { Finish } from '@prisma/client';
import {
  appUrl,
  cardLineRows,
  ctaRows,
  eyebrowRow,
  headingRow,
  mailShell,
  proseRow,
  ruleRow,
  smallLinkRow,
  spacerRow,
  termsBoxRows,
} from '../buylist/mail-shell';
import { money } from '../buylist/buylist-mail.templates';
import { SET_IMAGE_HOSTS } from '../catalog/catalog-sync.service';

export interface WishlistMailLine {
  wishlistItemId: string;
  /** Token del enlace «Quitar» (`domainHmac('wsh-mail:v1:', 'remove:<id>')`). */
  removeToken: string;
  cardId: string;
  cardName: string;
  setName: string;
  number: string;
  finish: Finish;
  imageSmallUrl: string | null;
  /** Piezas vendibles de este deseo en el lote (≥ 1). */
  count: number;
  /** P de la pieza más barata (con IVA dentro). */
  priceDisplayCents: number;
  /** Máximo del cliente ese día, con IVA; `null` sin mercado. */
  maxDisplayCents: number | null;
  fits: boolean | null;
}

export interface WishlistMailInput {
  locale: 'es' | 'en';
  /** `WishlistMail.id`: el `id` del enlace «Dejar de recibir» (⛔ el `userId` no viaja en el correo). */
  mailId: string;
  pauseToken: string;
  lines: WishlistMailLine[];
}

const FINISH_LABELS: Record<Finish, string> = {
  normal: 'Normal',
  reverse_holo: 'Reverse Holo',
  holofoil: 'Holofoil',
  first_edition_holofoil: '1st Edition Holofoil',
};

const COPY = {
  es: {
    subject1: (c: string) => `Ya tenemos una carta de tu lista: ${c}`,
    subjectN: (n: number) => `Ya tenemos ${n} cartas de tu lista`,
    preheader: 'Está a la venta a su precio normal. Te decimos si cabe en tu máximo.',
    eyebrow: 'LISTA DE DESEOS',
    title1: 'Ya tenemos una carta de tu lista',
    titleN: (n: number) => `Ya tenemos ${n} cartas de tu lista`,
    intro1: 'La conseguimos y ya está a la venta en la tienda.',
    introN: 'Las conseguimos y ya están a la venta en la tienda.',
    available: (n: number) => `${n} disponibles · `,
    price: (p: string) => `Precio: ${p} IVA incluido`,
    priceFrom: (p: string) => `Precio desde: ${p} IVA incluido`,
    max: (m: string) => `Tu máximo de hoy: ${m} IVA incluido`,
    fits: 'Cabe en tu máximo.',
    above: 'Está arriba de tu máximo.',
    noMarket: 'Hoy no hay precio de mercado: no pudimos calcular tu máximo.',
    see: 'Ver la carta',
    remove: 'Quitar esta carta de mi lista',
    boxLabel: 'SIN APARTADO',
    box1: 'No te la apartamos: si varias personas la esperan, se la lleva quien pague primero.',
    box2: 'El precio es el normal de la tienda, el mismo para todos.',
    stop: 'Dejar de recibir estos avisos',
    why: 'Recibes este correo porque agregaste estas cartas a tu lista de deseos en TCG HUNT. Tu lista sigue guardada aunque dejes de recibir avisos.',
    noOrigin: 'Para verla, entra a TCG HUNT › Mi cuenta › Mi lista de deseos.',
  },
  en: {
    subject1: (c: string) => `We found a card from your wishlist: ${c}`,
    subjectN: (n: number) => `We found ${n} cards from your wishlist`,
    preheader: "It's on sale at its regular price. We'll tell you if it fits your max.",
    eyebrow: 'WISHLIST',
    title1: 'We found a card from your wishlist',
    titleN: (n: number) => `We found ${n} cards from your wishlist`,
    intro1: "We got it and it's now on sale in the store.",
    introN: "We got them and they're now on sale in the store.",
    available: (n: number) => `${n} available · `,
    price: (p: string) => `Price: ${p} VAT included`,
    priceFrom: (p: string) => `Price from: ${p} VAT included`,
    max: (m: string) => `Your max today: ${m} VAT included`,
    fits: 'It fits your max.',
    above: "It's above your max.",
    noMarket: "There's no market price today, so we couldn't work out your max.",
    see: 'See the card',
    remove: 'Remove this card from my wishlist',
    boxLabel: 'NOT ON HOLD',
    box1: "We don't hold it for you: if several people are waiting, whoever pays first gets it.",
    box2: "The price is the store's regular price, the same for everyone.",
    stop: 'Stop these alerts',
    why: "You're receiving this email because you added these cards to your TCG HUNT wishlist. Your list stays saved even if you stop these alerts.",
    noOrigin: 'To see it, go to TCG HUNT › My account › My wishlist.',
  },
} as const;

/**
 * ⭐ Q-WSH-UX-9 — la URL de la foto, o `null`. Solo `https:`, sin puerto ni credenciales, sin query ni fragmento, y host EXACTO
 * en `SET_IMAGE_HOSTS` (`Set.has`, la misma lista cerrada del catálogo). Devuelve la cadena ORIGINAL (byte a byte), no la
 * normalizada: la URL es la misma para todos los destinatarios.
 */
export function safeCardImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (u.search || u.hash || url.includes('?') || url.includes('#')) return null;
  if (!SET_IMAGE_HOSTS.has(u.host)) return null;
  return url;
}

/** El enlace de la página que pide UN clic (`/{locale}/lista-de-deseos/aviso?a=&id=&t=`); `undefined` sin origen. */
export function mailActionUrl(action: 'remove' | 'pause', id: string, token: string, locale: 'es' | 'en'): string | undefined {
  return appUrl(`lista-de-deseos/aviso?a=${action}&id=${encodeURIComponent(id)}&t=${encodeURIComponent(token)}`, locale);
}

export function renderWishlistMail(input: WishlistMailInput): { subject: string; text: string; html: string } {
  const L = input.locale;
  const t = COPY[L];
  const n = input.lines.length;
  const subject = n === 1 ? t.subject1(input.lines[0].cardName) : t.subjectN(n);
  const title = n === 1 ? t.title1 : t.titleN(n);
  const intro = n === 1 ? t.intro1 : t.introN;
  const pauseUrl = mailActionUrl('pause', input.mailId, input.pauseToken, L);
  const hasOrigin = pauseUrl !== undefined;

  const blocks: string[] = [eyebrowRow(t.eyebrow), headingRow(title, 26), spacerRow(16), proseRow(intro), spacerRow(24), ruleRow()];
  const text: string[] = [title, intro, ''];

  for (const line of input.lines) {
    const p = money(line.priceDisplayCents, L);
    const priceLine = line.count > 1 ? t.priceFrom(p) : t.price(p);
    const meta = `${line.count > 1 ? t.available(line.count) : ''}${line.setName} · ${line.number} · ${FINISH_LABELS[line.finish]} · Near Mint`;
    const maxLine = line.maxDisplayCents == null ? null : t.max(money(line.maxDisplayCents, L));
    const verdict = line.maxDisplayCents == null || line.fits == null ? t.noMarket : line.fits ? t.fits : t.above;
    const cardUrl = appUrl(`catalog/${line.cardId}`, L);
    const removeUrl = mailActionUrl('remove', line.wishlistItemId, line.removeToken, L);

    blocks.push(spacerRow(16));
    blocks.push(cardLineRows({ title: line.cardName, meta, note: priceLine, amount: p, thumbUrl: safeCardImageUrl(line.imageSmallUrl) }));
    if (maxLine) blocks.push(proseRow(maxLine));
    blocks.push(proseRow(verdict));
    text.push(line.cardName, meta, priceLine);
    if (maxLine) text.push(maxLine);
    text.push(verdict);
    if (cardUrl && removeUrl) {
      blocks.push(spacerRow(16), ctaRows(cardUrl, t.see, 'ink'), spacerRow(8), smallLinkRow(removeUrl, t.remove));
      text.push(`${t.see}: ${cardUrl}`, `${t.remove}: ${removeUrl}`);
    }
    blocks.push(spacerRow(16), ruleRow());
    text.push('');
  }

  blocks.push(spacerRow(24), termsBoxRows(t.boxLabel, [t.box1, t.box2]), spacerRow(16));
  text.push(t.box1, t.box2, '');
  if (hasOrigin) {
    blocks.push(smallLinkRow(pauseUrl, t.stop));
    text.push(`${t.stop}: ${pauseUrl}`);
  } else {
    blocks.push(proseRow(t.noOrigin));
    text.push(t.noOrigin);
  }

  const html = mailShell({ locale: L, title, preheader: t.preheader, blocks, footerWhy: t.why });
  return { subject, text: text.join('\n'), html };
}
