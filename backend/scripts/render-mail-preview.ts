/**
 * # Vista previa de los correos — para abrirlos en un teléfono de verdad
 *
 * ```bash
 * cd backend && npm run mail:preview          # escribe backend/tmp/mail-preview/*.html
 * cd backend && npm run mail:preview -- /ruta/donde/quiero
 * ```
 *
 * **Por qué existe.** `DESIGN_SYSTEM §31.14 ML-11` es el único candado de los once que **no se puede
 * automatizar**: hay que ver los correos en **Gmail web con imágenes bloqueadas**, **Outlook Windows**
 * y **Gmail Android en modo oscuro**, y desde aquí no hay salida a internet ni cliente de correo. Los
 * diez candados automáticos miden el HTML; **este script produce el objeto que una persona mira**.
 *
 * Deja un fichero por (correo × idioma) más un `index.html`. Se autoenvían como adjunto o se abren
 * directamente; el HTML es autocontenido salvo **la mira**, que se sirve desde `tcghunt.mx` a
 * propósito (§31.5b: mismo dominio que el remitente). Si la mira no carga, es que
 * `frontend/public/branding/mail-mira-180.png` todavía no está publicada — y **el correo tiene que
 * verse bien igual**: eso es justo lo que ML-1 exige y lo que este fichero deja comprobar de un
 * vistazo.
 *
 * Los datos son de ejemplo y **cubren el caso que más se rompe**: una carta que **sí** compramos, una
 * que **no** (con nombre y **sin monto** — §31.0 regla 3), y **los tres montos** con su resta.
 *
 * ⭐ **Salen los SEIS correos de buylist, en ocho renders**: el recordatorio y la expiración tienen
 * dos variantes cada uno y **las dos se escriben**, porque son justo donde un vistazo a una sola deja
 * media plantilla sin mirar. ⛔ Los correos **7 y 8** no están: viven en `mail/mail.templates.ts`, de
 * otro work stream (§31.15, BE-43).
 */

import { mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  sellItemRejectedTemplate,
  sellOfferCancelledTemplate,
  sellOfferReminderTemplate,
  sellOfferTemplate,
  sellRequestExpiredTemplate,
  sellRequestNotPursuedTemplate,
} from '../src/modules/buylist/buylist-mail.templates';

const OUT = resolve(process.argv[2] ?? join(__dirname, '..', 'tmp', 'mail-preview'));

const PORTAL = 'https://tcghunt.mx/es/buylist/requests/8f21c0d4-3b17-4b0a-9a55-2e0f7c1a44de';

/** Un caso realista y adverso: una comprada, una NO comprada, y los tres montos. */
const OFERTA = {
  folio: 'BL-000123',
  lines: [
    {
      cardName: 'Charizard VMAX',
      setName: 'Darkness Ablaze',
      cardNumber: '020/189',
      finish: 'holofoil' as const,
      offeredPriceCents: 84000,
    },
    {
      cardName: 'Pikachu VMAX',
      setName: 'Vivid Voltage',
      cardNumber: '044/185',
      finish: 'normal' as const,
      offeredPriceCents: 18000,
    },
    {
      // La que NO compramos: va con nombre y **sin monto**. ⛔ Jamás `MX$ 0.00` (criterio 118).
      cardName: 'Snorlax V',
      setName: 'Sword & Shield',
      cardNumber: '141/202',
      finish: 'reverse_holo' as const,
      offeredPriceCents: null,
    },
  ],
  grossCents: 102000,
  shippingFeeCents: 18000,
  netCents: 84000,
  acceptDeadlineAt: new Date('2026-09-16T18:00:00-06:00'),
  portalUrl: PORTAL,
};

const NOMBRE = 'Ana Torres';

const DEADLINE = new Date('2026-09-16T18:00:00-06:00');
const CERRADA = new Date('2026-09-18T12:00:00-06:00');

/** El portal, con el prefijo de idioma que le toca: un correo tiene UN idioma y el botón lo comparte. */
const portal = (locale: 'es' | 'en') => PORTAL.replace('/es/', `/${locale}/`);

/**
 * ⭐ **Los OCHO renders de los SEIS correos de buylist.** Dos tienen dos variantes que son el mismo
 * correo con otra acción (§25.4.3 y §25.4.4) y **las dos se escriben a fichero**: el dueño tiene que
 * poder mirar el recordatorio de envío, que es el único con guía en mono, y las dos expiraciones.
 * ⛔ Los correos **7 y 8** no están: viven en `mail/`, son de otro work stream y este pase no los
 * migra (§31.15, BE-43).
 */
const CORREOS: {
  archivo: string;
  titulo: string;
  render: (locale: 'es' | 'en') => { subject: string; html: string; text: string };
}[] = [
  {
    archivo: 'correo-1-oferta',
    titulo: '1 · La oferta — la resta completa, la caja de términos y el CTA en bermellón',
    render: (locale) => sellOfferTemplate({ ...OFERTA, portalUrl: portal(locale) }, NOMBRE, locale),
  },
  {
    archivo: 'correo-2a-recordatorio-aceptar',
    titulo: '2a · Recordatorio (responder) — SOLO el neto, CTA en bermellón',
    render: (locale) =>
      sellOfferReminderTemplate(
        {
          kind: 'accept',
          folio: OFERTA.folio,
          buyLineCount: 2,
          netCents: OFERTA.netCents,
          deadlineAt: DEADLINE,
          portalUrl: portal(locale),
        },
        NOMBRE,
        locale,
      ),
  },
  {
    archivo: 'correo-2b-recordatorio-enviar',
    titulo: '2b · Recordatorio (enviar) — el mismo, con la guía en mono seleccionable',
    render: (locale) =>
      sellOfferReminderTemplate(
        {
          kind: 'ship',
          folio: OFERTA.folio,
          buyLineCount: 2,
          netCents: OFERTA.netCents,
          deadlineAt: DEADLINE,
          carrier: 'Estafeta',
          trackingNumber: '7712 3456 7890',
          portalUrl: portal(locale),
        },
        NOMBRE,
        locale,
      ),
  },
  {
    archivo: 'correo-3-oferta-cancelada',
    titulo: '3 · Oferta cancelada — sin montos, sin plazos, CTA en tinta («ver mi solicitud»)',
    render: (locale) =>
      sellOfferCancelledTemplate(
        { folio: OFERTA.folio, offerSentAt: new Date('2026-09-10T18:00:00-06:00'), portalUrl: portal(locale) },
        NOMBRE,
        locale,
      ),
  },
  {
    archivo: 'correo-4-carta-no-aceptada',
    titulo: '4 · Carta no aceptada — caja de términos con LOS DOS plazos, y sin CTA (ver notas)',
    render: (locale) =>
      sellItemRejectedTemplate(
        {
          folio: OFERTA.folio,
          cardName: 'Snorlax V',
          setName: 'Sword & Shield',
          cardNumber: '141/202',
          finish: 'reverse_holo',
          reason: 'No llegó en Near Mint: bordes con desgaste visible y una marca en la cara.',
          returnDeadlineAt: DEADLINE,
          abandonDeadlineAt: new Date('2026-10-16T18:00:00-06:00'),
        },
        NOMBRE,
        locale,
      ),
  },
  {
    archivo: 'correo-5a-vencida-no-respondio',
    titulo: '5a · Solicitud vencida (no respondió) — CTA en tinta',
    render: (locale) =>
      sellRequestExpiredTemplate(
        { kind: 'no_response', folio: OFERTA.folio, closedAt: CERRADA, portalUrl: portal(locale) },
        NOMBRE,
        locale,
      ),
  },
  {
    archivo: 'correo-5b-vencida-no-envio',
    titulo: '5b · Solicitud vencida (no salió el paquete) — CTA en tinta',
    render: (locale) =>
      sellRequestExpiredTemplate(
        { kind: 'not_shipped', folio: OFERTA.folio, closedAt: CERRADA, portalUrl: portal(locale) },
        NOMBRE,
        locale,
      ),
  },
  {
    archivo: 'correo-6-solicitud-cerrada',
    titulo: '6 · Solicitud cerrada — ni un plazo, ni un monto (§25.4.5) + el copy de §31.10',
    render: (locale) =>
      sellRequestNotPursuedTemplate({ folio: OFERTA.folio, portalUrl: portal(locale) }, NOMBRE, locale),
  },
];

mkdirSync(OUT, { recursive: true });

const indice: string[] = [];
for (const correo of CORREOS) {
  for (const locale of ['es', 'en'] as const) {
    const msg = correo.render(locale);
    const html = `${correo.archivo}.${locale}.html`;
    const txt = `${correo.archivo}.${locale}.txt`;
    writeFileSync(join(OUT, html), msg.html, 'utf8');
    // La parte de texto plano se escribe aparte porque **no es un resumen** (§31.12) y hay que poder
    // leerla: es la mitad del correo que ven algunos clientes, y donde ML-2 caza lo prohibido.
    writeFileSync(join(OUT, txt), `Asunto: ${msg.subject}\n\n${msg.text}\n`, 'utf8');
    indice.push(
      `<li><strong>${correo.titulo}</strong> [${locale}]<br/><code>${msg.subject}</code><br/>` +
        `<a href="./${html}">HTML</a> · <a href="./${txt}">texto plano</a></li>`,
    );
  }
}

writeFileSync(
  join(OUT, 'index.html'),
  `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>TCG HUNT · vista previa de correos</title></head>` +
    `<body style="font-family:Georgia,serif;background:#F4F1EA;color:#1A1A18;padding:24px">` +
    `<h1 style="font-weight:400">Vista previa de correos</h1>` +
    `<p style="font-family:Arial,sans-serif;font-size:14px">Generado por <code>npm run mail:preview</code>. ` +
    `Para la prueba de verdad (§31.14 ML-11) hay que <strong>autoenviarse el HTML</strong> y abrirlo en ` +
    `<strong>Gmail con imágenes bloqueadas</strong>, <strong>Outlook Windows</strong> y ` +
    `<strong>Gmail Android en modo oscuro</strong>.</p>` +
    `<ul style="font-family:Arial,sans-serif;font-size:14px;line-height:1.8">${indice.join('')}</ul>` +
    `</body></html>`,
  'utf8',
);

// eslint-disable-next-line no-console
console.log(`Vista previa escrita en: ${OUT}`);
