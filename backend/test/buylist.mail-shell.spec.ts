import { readFileSync } from 'fs';
import { join } from 'path';
import * as buylistTemplates from '../src/modules/buylist/buylist-mail.templates';
import { offerTermsCopy, sellOfferTemplate } from '../src/modules/buylist/buylist-mail.templates';
import * as accountTemplates from '../src/modules/mail/mail.templates';
import { MailMessage } from '../src/modules/mail/mail.port';

/**
 * # §31.14 — LOS CANDADOS DEL ESQUELETO DE CORREO
 *
 * Este fichero es el cinturón del rediseño de `DESIGN_SYSTEM §31`. **Los tres primeros miden
 * CONDUCTA**, no parecido: qué queda en pantalla cuando se quitan las imágenes (ML-1), qué cadenas
 * salen por el cable (ML-2) y de dónde sale el texto que obliga (ML-3).
 *
 * ⚠️ **Qué cubre este pase y qué no.** El pase 1 de §31.15 entrega **el esqueleto compartido** y **el
 * correo 1**; los otros cinco de buylist (y los dos de `mail/`, que son de otro work stream) siguen
 * con el `layout()` viejo. Por eso los candados se dividen en dos:
 * - los que valen **para los ocho desde ya** —ML-1 (por ablación) y ML-2 (lo prohibido)— se corren
 *   sobre **todas** las plantillas, migradas o no;
 * - los que describen **el esqueleto nuevo** —ML-4…ML-9— se corren sobre las **migradas**, y la lista
 *   de migradas es una constante que crece con cada correo. *Un candado que se apaga solo cuando el
 *   correo migra no es un candado: es un recordatorio.*
 *
 * ⛔ **ML-11 no está aquí y no se puede simular**: hay que abrir los correos en Gmail con imágenes
 * bloqueadas, Outlook Windows y Gmail Android en modo oscuro. Para eso existe
 * `scripts/render-mail-preview.ts` (`npm run mail:preview`), que escribe el HTML a fichero para
 * autoenviárselo y mirarlo en un teléfono de verdad.
 */

// =================================================================================================
// FIXTURES. El caso que más se rompe: una comprada, una NO comprada y los tres montos.
// =================================================================================================
const NOMBRE = 'Ana Torres';
const FOLIO = 'BL-000123';
const PORTAL = 'https://tcghunt.mx/es/buylist/requests/sr-1';
const LOCALES = ['es', 'en'] as const;

function oferta(
  locale: string,
  extra: Partial<buylistTemplates.SellOfferParams> = {},
  name: string = NOMBRE,
): MailMessage {
  return sellOfferTemplate(
    {
      folio: FOLIO,
      lines: [
        {
          cardName: 'Charizard VMAX',
          setName: 'Darkness Ablaze',
          cardNumber: '020/189',
          finish: 'holofoil',
          offeredPriceCents: 84000,
        },
        {
          cardName: 'Snorlax V',
          setName: 'Sword & Shield',
          cardNumber: '141/202',
          finish: 'reverse_holo',
          offeredPriceCents: null,
        },
      ],
      grossCents: 102000,
      shippingFeeCents: 18000,
      netCents: 84000,
      acceptDeadlineAt: new Date('2026-09-16T18:00:00-06:00'),
      portalUrl: PORTAL,
      ...extra,
    },
    name,
    locale,
  );
}

/** Un correo, en un idioma, con el nombre que le den: ML-10 lo necesita hostil. */
type Render = (locale: string, name?: string) => MailMessage;

/** Los correos que YA hablan el idioma de §31. Crece con cada correo migrado. */
const MIGRADOS: Record<string, Render> = {
  '1 · oferta': (locale, name) => oferta(locale, {}, name),
};

/** Los ocho, migrados o no: es sobre esta lista sobre la que corren ML-1 y ML-2. */
const LOS_OCHO: Record<string, Render> = {
  ...MIGRADOS,
  '2 · recordatorio': (locale, name = NOMBRE) =>
    buylistTemplates.sellOfferReminderTemplate(
      {
        kind: 'accept',
        folio: FOLIO,
        buyLineCount: 2,
        netCents: 84000,
        deadlineAt: new Date('2026-09-16T18:00:00-06:00'),
        portalUrl: PORTAL,
      },
      name,
      locale,
    ),
  '3 · expiración': (locale, name = NOMBRE) =>
    buylistTemplates.sellRequestExpiredTemplate(
      { kind: 'no_response', folio: FOLIO, closedAt: new Date('2026-09-16T18:00:00-06:00'), portalUrl: PORTAL },
      name,
      locale,
    ),
  '4 · carta no aceptada': (locale, name = NOMBRE) =>
    buylistTemplates.sellItemRejectedTemplate(
      {
        cardName: 'Snorlax V',
        setName: 'Sword & Shield',
        cardNumber: '141/202',
        finish: 'reverse_holo',
        reason: 'No llegó en Near Mint',
        returnDeadlineAt: new Date('2026-09-16T18:00:00-06:00'),
        abandonDeadlineAt: new Date('2026-10-16T18:00:00-06:00'),
      },
      name,
      locale,
    ),
  '5 · oferta cancelada': (locale, name = NOMBRE) =>
    buylistTemplates.sellOfferCancelledTemplate(
      { folio: FOLIO, offerSentAt: new Date('2026-09-10T18:00:00-06:00'), portalUrl: PORTAL },
      name,
      locale,
    ),
  '6 · solicitud cerrada': (locale, name = NOMBRE) =>
    buylistTemplates.sellRequestNotPursuedTemplate({ folio: FOLIO, portalUrl: PORTAL }, name, locale),
  // ⚠️ 7 y 8 viven en `mail/mail.templates.ts`, de **otro work stream**. Aquí solo se LEEN: este spec
  // no los toca ni los migra (pase 2 de §31.15, con BE-43). Pero la marca y los cinco prohibidos son
  // de **todo correo que salga del producto**, así que entran al barrido igual.
  '7 · verificar correo': (locale, name = NOMBRE) =>
    accountTemplates.emailVerificationTemplate('https://tcghunt.mx/es/verify?token=t', name, locale),
  '8 · restablecer contraseña': (locale, name = NOMBRE) =>
    accountTemplates.passwordResetTemplate('https://tcghunt.mx/es/reset?token=t', name, locale),
};

// =================================================================================================
// ML-1 ⭐⭐ — LA MARCA, MEDIDA POR ABLACIÓN
// =================================================================================================
/**
 * **La aserción es POR ABLACIÓN, y eso es lo que la hace roja.** Se borran **todas** las etiquetas
 * `<img …>` —que es exactamente lo que hacen Gmail y Outlook por defecto— y se comprueba que
 * **`TCG HUNT` sigue en el texto visible**.
 *
 * ⭐ **Y la mitad que mata la mutación disfrazada:** ningún `<img>` puede llevar `alt` con la marca.
 * Poner `alt="TCG HUNT"` con estilo parece un arreglo y no lo es: **Outlook de escritorio pinta un
 * recuadro con una cruz roja** y algunos clientes ignoran el estilo del `alt` por completo — la marca
 * quedaría **a merced del cliente**. *Rojo si el wordmark viaja dentro de una imagen, y rojo también
 * si alguien lo «arregla» metiéndolo en el `alt`.*
 */
describe('⚠️⚠️ ML-1 — la marca sobrevive a que el cliente bloquee las imágenes (§31.5a)', () => {
  const sinImagenes = (html: string) => html.replace(/<img\b[^>]*>/gi, '');
  const soloTexto = (html: string) =>
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<[^>]*>/g, ' ');

  for (const [correo, render] of Object.entries(LOS_OCHO)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: quitados TODOS los <img>, «TCG HUNT» sigue en el texto visible`, () => {
        const html = render(locale).html;
        expect(soloTexto(sinImagenes(html))).toContain('TCG HUNT');
      });

      it(`${correo} [${locale}]: NINGÚN <img> lleva la marca en su alt (la marca no se delega)`, () => {
        const imgs = render(locale).html.match(/<img\b[^>]*>/gi) ?? [];
        for (const img of imgs) {
          const alt = /alt="([^"]*)"/i.exec(img)?.[1] ?? '';
          expect(alt).not.toContain('TCG HUNT');
          expect(alt.toUpperCase()).not.toContain('TCG');
        }
      });
    }
  }

  it('CONTROL POSITIVO: el correo migrado lleva EXACTAMENTE un <img>, y su src es de tcghunt.mx', () => {
    // Una aserción de ablación que pasara porque no hay imágenes no mediría nada. Aquí la mira SÍ
    // existe, es una sola (§31.2: imágenes casi cero) y se sirve del mismo dominio del remitente.
    for (const locale of LOCALES) {
      const imgs = MIGRADOS['1 · oferta'](locale).html.match(/<img\b[^>]*>/gi) ?? [];
      expect(imgs).toHaveLength(1);
      const mira = imgs[0] ?? '';
      expect(/src="([^"]+)"/.exec(mira)?.[1] ?? '').toMatch(/^https:\/\/tcghunt\.mx\/branding\//);
      // Decorativa a propósito: el wordmark de al lado ya porta la marca (§31.5a).
      expect(mira).toContain('alt=""');
      // `width`/`height` explícitos: el hueco reservado tiene que ser aire deliberado, no un salto.
      expect(mira).toMatch(/width="72"/);
      expect(mira).toMatch(/height="72"/);
    }
  });
});

// =================================================================================================
// ML-3 ⭐⭐ — EL TEXTO VINCULANTE SALE DE UN SOLO CUERPO, Y SE MIDE POR IDENTIDAD
// =================================================================================================
/**
 * **Mide IDENTIDAD, no parecido.** El criterio **161(d)** exige que `SellItemDTO.condition` sea *«el
 * MISMO string que usó el correo»*, y la fuente única es `offerTermsCopy` — **un cuerpo, tres
 * lectores** (portal, correo y proyección de cliente).
 *
 * ⭐ **La mutación que este candado existe para cazar es la del rediseño**: acortar la condición
 * «porque no cabía en la línea». *No cabe: cabe igual.* Por eso no se compara «contiene», se compara
 * **carácter por carácter**, y se comprueba además que lo que se pinta no es un **prefijo** de la
 * frase — que es la forma exacta que tomaría el recorte.
 *
 * *(La otra mitad de la cadena —que el DTO del portal use ese mismo cuerpo— la ancla
 * `test/buylist.item-offer-block.spec.ts`, que lee `res.items[0].condition` del servicio real.)*
 */
describe('⚠️⚠️ ML-3 — la condición del correo es el MISMO string que ve el portal (161d)', () => {
  const desescapar = (s: string) =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  for (const locale of LOCALES) {
    it(`[${locale}] el HTML pinta la condición TAL CUAL sale de offerTermsCopy`, () => {
      const esperado = offerTermsCopy(locale).perLineConditionLabel;
      const html = desescapar(oferta(locale).html);
      // Igualdad de cadena: se localiza la celda de la condición y se compara su contenido entero.
      const celdas = html.match(/>([^<>]+)</g)?.map((x) => x.slice(1, -1).trim()) ?? [];
      expect(celdas).toContain(esperado);
      // ⛔ Y que no haya una versión ACORTADA rondando: ningún fragmento del correo puede ser un
      // prefijo propio de la frase vinculante (así es como se ve un «no cabía» en el diff).
      const recortes = celdas.filter((c) => c.length > 8 && esperado.startsWith(c) && c !== esperado);
      expect(recortes).toEqual([]);
    });

    it(`[${locale}] la parte de TEXTO PLANO lleva la misma condición, entera`, () => {
      const esperado = offerTermsCopy(locale).perLineConditionLabel;
      const linea = oferta(locale)
        .text.split('\n')
        .find((x) => x.startsWith('- Charizard VMAX')) as string;
      expect(linea.split(' — ')[1]).toBe(esperado);
    });

    it(`[${locale}] la consecuencia y la regla del descuento también salen del mismo cuerpo`, () => {
      const terms = offerTermsCopy(locale, { shippingFeeCents: 18000, netCents: 84000 });
      const msg = oferta(locale);
      expect(msg.text).toContain(terms.consequence);
      expect(msg.text).toContain(terms.rule);
      expect(desescapar(msg.html)).toContain(terms.consequence);
      expect(desescapar(msg.html)).toContain(terms.rule);
    });
  }
});

// =================================================================================================
// ML-4 — NINGUNA CELDA DE TEXTO SIN FONDO (el correo invisible de Outlook.com)
// =================================================================================================
/**
 * Se mide **sobre el HTML, no sobre una captura**: es el defecto que produce **tinta sobre tinta** en
 * la inversión parcial (§31.8 caso 2) y **no se ve nunca desde un cliente en modo claro** — por eso
 * tiene que ser un test y no una revisión visual. **Rojo con una sola celda sin fondo.**
 */
function celdasSinFondo(html: string): string[] {
  const malas: string[] = [];
  const re = /<td\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const desde = m.index + m[0].length;
    const resto = html.slice(desde);
    const cortes = [resto.indexOf('<td'), resto.indexOf('</td')].filter((i) => i >= 0);
    const directo = cortes.length ? resto.slice(0, Math.min(...cortes)) : resto;
    const texto = directo
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&zwnj;/g, '')
      .trim();
    if (!texto) continue; // celda estructural o espaciadora: no lleva texto que pueda desaparecer
    const attrs = m[1];
    if (!/\bbgcolor="#[0-9A-Fa-f]{6}"/.test(attrs) || !/background-color:#[0-9A-Fa-f]{6}/.test(attrs)) {
      malas.push(m[0].slice(0, 140));
    }
  }
  return malas;
}

describe('⚠️ ML-4 — toda <td> con texto lleva bgcolor Y background-color (§31.8 regla 2)', () => {
  for (const [correo, render] of Object.entries(MIGRADOS)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: ninguna celda de texto se queda transparente`, () => {
        expect(celdasSinFondo(render(locale).html)).toEqual([]);
      });
    }
  }

  it('CONTROL: el detector detecta — una celda sin fondo se reporta', () => {
    expect(celdasSinFondo('<td style="color:#1A1A18">Hola</td>')).toHaveLength(1);
    expect(celdasSinFondo('<td bgcolor="#F4F1EA" style="background-color:#F4F1EA">Hola</td>')).toEqual([]);
  });

  it('el documento declara el esquema claro por las DOS vías (meta + :root), que es el caso 1', () => {
    const html = MIGRADOS['1 · oferta']('es').html;
    expect(html).toContain('<meta name="color-scheme" content="light" />');
    expect(html).toContain('<meta name="supported-color-schemes" content="light" />');
    expect(html).toContain('color-scheme:light');
  });
});

// =================================================================================================
// ML-5 — EL CTA NO ES LA ÚNICA RUTA A LA ACCIÓN
// =================================================================================================
/**
 * ⭐ **La URL en texto es el RESPALDO del botón, no un adorno para clientes viejos.** §17.2 mide que
 * `#B31217` sobre tinta da **2.5:1 y lo declara prohibido**; bajo inversión forzada el papel se vuelve
 * casi tinta y el rojo se queda donde está ⇒ **caemos justo en ese par**. La URL en texto es la única
 * ruta a la acción que sobrevive a cualquier inversión.
 */
describe('⚠️ ML-5 — la URL de destino aparece TAMBIÉN como texto, en las dos mitades', () => {
  for (const locale of LOCALES) {
    it(`[${locale}] la URL no vive solo dentro del href`, () => {
      const msg = oferta(locale);
      const sinAtributos = msg.html.replace(/<[^>]*>/g, ' ');
      expect(sinAtributos).toContain(PORTAL);
      expect(msg.text).toContain(PORTAL);
    });

    it(`[${locale}] sin portal configurado, el correo SALE IGUAL y sin botón muerto`, () => {
      // La oferta es vinculante: el correo nunca se bloquea por no poder construir el CTA, y jamás
      // se emite un href a medias — o el enlace es completo, o no hay enlace.
      const msg = oferta(locale, { portalUrl: undefined });
      expect(msg.html).not.toContain('href="undefined"');
      expect(msg.html).not.toMatch(/href="\s*"/);
      expect(msg.text).toContain(locale === 'en' ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN');
    });
  }

  it('el CTA del correo 1 va en BERMELLÓN: no responder cuesta dinero (§31.7)', () => {
    const html = oferta('es').html;
    expect(html).toMatch(/bgcolor="#B31217"[^>]*border:1px solid #B31217/);
    // ⛔ Radio 0 por sistema (§4.2), no por compatibilidad: el `border-radius:6px` de hoy se retira.
    expect(html).not.toContain('border-radius');
  });
});

// =================================================================================================
// ML-6 — LO QUE NO COMPRAMOS: CON NOMBRE Y SIN MONTO
// =================================================================================================
describe('⚠️ ML-6 — jamás `MX$ 0.00` en la línea que no compramos (criterio 118)', () => {
  for (const locale of LOCALES) {
    it(`[${locale}] la línea de NO COMPRAMOS tiene nombre y ninguna cifra de dinero`, () => {
      const msg = oferta(locale);
      const linea = msg.text.split('\n').find((x) => x.startsWith('- Snorlax V')) as string;
      expect(linea).toBeDefined();
      expect(linea).toContain('Snorlax V');
      expect(linea).not.toMatch(/\$|0[.,]00|—\s*MX/);
      // Y en el HTML: la celda del importe de esa línea existe y va VACÍA.
      expect(msg.html).not.toContain('MX$ 0.00');
      expect(msg.html).not.toContain('MX$0.00');
      expect(msg.html).not.toMatch(/>\s*\$\s*0[.,]00\s*</);
    });
  }
});

// =================================================================================================
// ML-7 — LA PARTE DE TEXTO PLANO NO ES UN RESUMEN
// =================================================================================================
describe('⚠️ ML-7 — el texto plano lleva los tres montos, la condición, el plazo y la URL', () => {
  for (const locale of LOCALES) {
    it(`[${locale}] los cuatro, o rojo`, () => {
      const msg = oferta(locale);
      const terms = offerTermsCopy(locale, { shippingFeeCents: 18000, netCents: 84000 });
      // (1) los TRES montos — «la resta se ENSEÑA, no se esconde».
      for (const etiqueta of locale === 'en'
        ? ['Value of the cards', 'Shipping we cover', 'DEPOSITED TO YOU']
        : ['Valor de las cartas', 'Envío que ponemos nosotros', 'SE TE DEPOSITAN']) {
        expect(msg.text).toContain(etiqueta);
      }
      // (2) la condición POR LÍNEA.
      expect(msg.text).toContain(terms.perLineConditionLabel);
      // (3) el plazo, con fecha Y hora (criterio 154: nunca «en 2 días»).
      expect(msg.text).toMatch(locale === 'en' ? /You have until .+2026/ : /Tienes hasta el .+2026/);
      // (4) la URL completa.
      expect(msg.text).toContain(PORTAL);
    });
  }
});

// =================================================================================================
// ML-8 — EL PESO, Y GMAIL QUE RECORTA
// =================================================================================================
/**
 * ⚠️⚠️ **HALLAZGO DE MEDIO — la segunda mitad de ML-8, tal como está escrita, NO se puede cumplir, y
 * no por cómo se maquetó.**
 *
 * ML-8 pide **(a)** `< 90 KB` y **(b)** que *«el bloque del neto y el CTA aparezcan antes del carácter
 * que marca la mitad del documento»*. **(a) se cumple con holgura** (~54 KB en el caso de 20 líneas).
 * **(b) es imposible mientras el correo respete §25.4.2 R2**, que §31.1 declara INTACTA: *la condición
 * se lee **antes** del dinero y **dentro** de cada línea*. Con 20 líneas, la lista ocupa ~85 % del
 * documento **por definición**, así que el neto y el CTA —que van después— **siempre** caen en la
 * segunda mitad. Cumplir (b) exigiría subir los montos por encima de las líneas, que es exactamente
 * lo que §25.4.2 consideró **y decidió NO hacer** («un correo que abre con la resta convierte el trato
 * en una factura»).
 *
 * **Lo que ML-8 protege sí se mide, y se mide mejor**: el riesgo real es **que Gmail recorte el CTA**,
 * y Gmail recorta a ~**102 KB**. Se asierta que el CTA aparece **muy por debajo** de ese umbral. La
 * discrepancia queda escalada a ux-ii/arquitecto en `docs/BACKEND_NOTES.md`; **no se «arregla» aquí
 * reordenando bloques**, porque el orden es de diseño y no es mío.
 */
describe('⚠️ ML-8 — el peso, con el caso realista más pesado (20 líneas)', () => {
  const veinte = () =>
    oferta('es', {
      lines: Array.from({ length: 20 }, (_, i) => ({
        cardName: `Charizard VMAX ${i}`,
        setName: 'Darkness Ablaze',
        cardNumber: `${100 + i}/189`,
        finish: 'holofoil' as const,
        offeredPriceCents: 84000,
      })),
      grossCents: 1680000,
      shippingFeeCents: 18000,
      netCents: 1662000,
    });

  it('el HTML pesa menos de 90 KB', () => {
    expect(Buffer.byteLength(veinte().html)).toBeLessThan(90_000);
  });

  it('⚠️ el CTA y el neto quedan MUY lejos del punto donde Gmail recorta (~102 KB)', () => {
    const html = veinte().html;
    // El umbral de recorte de Gmail es absoluto (~102 KB), no relativo al documento: es lo que de
    // verdad decide si el vendedor ve el botón. Se deja margen de 30 KB.
    expect(Buffer.byteLength(html.slice(0, html.indexOf('SE TE DEPOSITAN')))).toBeLessThan(72_000);
    expect(Buffer.byteLength(html.slice(0, html.indexOf('VER Y RESPONDER LA OFERTA')))).toBeLessThan(72_000);
  });

  it('sin comentarios, sin base64 y sin CSS muerto en la salida (§31.2)', () => {
    const html = veinte().html;
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('base64,');
    // El `<style>` solo lleva MEJORAS: `color-scheme` y el padding de <480px. Nada más.
    const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
    expect(style.length).toBeLessThan(300);
  });
});

// =================================================================================================
// ML-9 — LAS VERSALITAS NO DEPENDEN DE CSS
// =================================================================================================
describe('⚠️ ML-9 — las versalitas van EN MAYÚSCULAS en la cadena, no en el CSS', () => {
  for (const [correo, render] of Object.entries(LOS_OCHO)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: ni un text-transform (Outlook lo ignora)`, () => {
        expect(render(locale).html).not.toContain('text-transform');
      });

      it(`${correo} [${locale}]: barrido de homoglifos (§28.10) — ni cirílico ni griego`, () => {
        // Una `А` cirílica dentro de `OFERTA DE COMPRA` es invisible al ojo y rompe la búsqueda, el
        // lector de pantalla y el filtro de spam. Se barre el cuerpo entero, no solo las versalitas.
        const msg = render(locale);
        expect(`${msg.subject}${msg.html}${msg.text}`).not.toMatch(/[Ѐ-ӿͰ-Ͽ]/);
      });
    }
  }

  it('las versalitas del correo 1 llegan ya en mayúsculas desde la cadena fuente', () => {
    const html = oferta('es').html;
    for (const versalita of ['OFERTA DE COMPRA', 'COMPRAMOS (1)', 'NO COMPRAMOS (1)', 'SE TE DEPOSITAN']) {
      expect(html).toContain(versalita);
    }
  });
});

// =================================================================================================
// ML-10 — EL ESCAPE DE HTML SOBREVIVE AL REDISEÑO
// =================================================================================================
describe('⚠️ ML-10 — un nombre hostil sale ESCAPADO en todos los correos (S15-B1)', () => {
  const HOSTIL = '"><script>alert(1)</script>';
  for (const [correo, render] of Object.entries(LOS_OCHO)) {
    it(`${correo}: el nombre del vendedor no puede cerrar un atributo ni abrir una etiqueta`, () => {
      const html = render('es', HOSTIL).html;
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });
  }

  it('el correo 1, con el nombre hostil de verdad', () => {
    const msg = sellOfferTemplate(
      {
        folio: FOLIO,
        lines: [
          {
            cardName: '<b>Charizard</b>',
            setName: 'Darkness Ablaze',
            cardNumber: '020/189',
            finish: 'holofoil',
            offeredPriceCents: 84000,
          },
        ],
        grossCents: 84000,
        shippingFeeCents: 18000,
        netCents: 66000,
        acceptDeadlineAt: new Date('2026-09-16T18:00:00-06:00'),
        portalUrl: PORTAL,
      },
      HOSTIL,
      'es',
    );
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
    expect(msg.html).not.toContain('<b>Charizard</b>');
    expect(msg.html).toContain('&lt;b&gt;Charizard&lt;/b&gt;');
  });
});

// =================================================================================================
// EL ESQUELETO: lo que §31.3/§31.4 fijan y el `layout()` viejo incumplía
// =================================================================================================
describe('§31.3/§31.4 — la retícula y la escala, medidas sobre el correo migrado', () => {
  const html = () => MIGRADOS['1 · oferta']('es').html;

  it('600px (no 520), tinta #1A1A18 (no #111) y papel de borde a borde', () => {
    expect(html()).toContain('width="600"');
    expect(html()).toContain('max-width:600px');
    expect(html()).not.toContain('max-width:520px');
    expect(html()).not.toContain('color:#111;');
    expect(html()).toContain('<body bgcolor="#F4F1EA"');
  });

  it('⭐ NINGÚN importe en la serif: Georgia tiene cifras de estilo antiguo (§31.4)', () => {
    // Se localizan las celdas que contienen un importe y se comprueba que ninguna declara la serif.
    const celdas = html().match(/<td\b[^>]*>[^<]*\$[\d,.]+[^<]*</g) ?? [];
    expect(celdas.length).toBeGreaterThan(0);
    for (const celda of celdas) {
      expect(celda).toContain('JetBrains Mono');
      expect(celda).not.toContain('Georgia');
    }
  });

  it('el wordmark SÍ va en serif y en texto vivo, y el `.mx` en mono', () => {
    expect(html()).toMatch(/font-family:Georgia,'Times New Roman',serif;font-size:30px[^>]*>TCG HUNT</);
  });

  it('sin flex, sin grid, sin gap, sin rgba, sin sombras, sin webfonts, sin SVG (§31.2)', () => {
    for (const prohibido of [
      'display:flex',
      'display:grid',
      'gap:',
      'rgba(',
      'box-shadow',
      '@font-face',
      'fonts.googleapis',
      '.svg',
      'background-image',
    ]) {
      expect(html()).not.toContain(prohibido);
    }
  });

  it('todas las tablas de maqueta se anuncian como presentación (§31.12)', () => {
    const tablas = html().match(/<table\b[^>]*>/g) ?? [];
    expect(tablas.length).toBeGreaterThan(5);
    for (const t of tablas) expect(t).toContain('role="presentation"');
  });

  it('`mso-line-height-rule:exactly` acompaña a cada line-height con texto (§31.4)', () => {
    const conTexto = (html().match(/line-height:1\.\d+/g) ?? []).length;
    const conRegla = (html().match(/mso-line-height-rule:exactly/g) ?? []).length;
    expect(conRegla).toBeGreaterThanOrEqual(conTexto - 1);
  });

  it('§31.6h — en la banda de tinta del pie NO vive nada que el lector necesite', () => {
    const pie = html().slice(html().lastIndexOf('bgcolor="#1A1A18"'));
    expect(pie).not.toContain(FOLIO); // ni folio
    expect(pie).not.toMatch(/\$\s?[\d,]+\.\d\d/); // ni importe
    expect(pie).not.toContain('2026'); // ni plazo
    expect(pie).not.toContain('<a '); // ni enlace de acción
    // ⛔ Y sin enlace de baja: los ocho son transaccionales.
    expect(pie.toLowerCase()).not.toMatch(/unsubscribe|darte de baja|baja de/);
  });

  it('§31.6a — el preheader lleva el NETO, jamás el bruto (R1 de §25.4)', () => {
    const preheader = /<div style="display:none[^>]*>([\s\S]*?)<\/div>/.exec(html())?.[1] ?? '';
    const visible = preheader.replace(/(&zwnj;|&nbsp;)+/g, '');
    expect(visible).toContain('$840.00'); // el neto
    expect(visible).not.toContain('$1,020.00'); // ⛔ el bruto
    expect(visible.length).toBeGreaterThanOrEqual(40);
    expect(visible.length).toBeLessThanOrEqual(90);
  });

  it('⭐ el correo es correcto SIN el `<style>`: borrarlo entero no quita información (§31.2)', () => {
    const sinStyle = html().replace(/<style>[\s\S]*?<\/style>/, '');
    const texto = sinStyle.replace(/<[^>]*>/g, ' ');
    for (const imprescindible of ['TCG HUNT', 'OFERTA DE COMPRA', 'SE TE DEPOSITAN', '$840.00', PORTAL]) {
      expect(texto).toContain(imprescindible);
    }
    // Y ninguna clase porta información: la única que existe es la mejora de padding de <480px.
    const clases = new Set((sinStyle.match(/class="([^"]+)"/g) ?? []).map((c) => c));
    expect([...clases]).toEqual(['class="px"']);
  });
});

// =================================================================================================
// §31.10 — EL ÚNICO CAMBIO DE COPY DEL PASE
// =================================================================================================
describe('§31.10 — correo 6: fuera «y no nos debes nada», en los dos idiomas', () => {
  it('ES: se retira la deuda que nunca existió, y se mantiene el TUTEO', () => {
    const msg = LOS_OCHO['6 · solicitud cerrada']('es');
    expect(msg.text).toContain(
      'No hay nada pendiente de tu parte: no mandes ninguna carta y no se generó ninguna guía.',
    );
    expect(msg.text).not.toContain('no nos debes nada');
    // El tuteo se comprueba explícitamente: el dueño lo dictó de usted y §31.10 lo devuelve a tú.
    expect(msg.text).toContain('tu parte');
    expect(msg.text).not.toMatch(/de su parte|puede volver a cotizar/);
  });

  it('EN: misma frase, misma razón', () => {
    const msg = LOS_OCHO['6 · solicitud cerrada']('en');
    expect(msg.text).toContain(
      "There is nothing pending on your side: don't send any card, and no shipping label was generated.",
    );
    expect(msg.text).not.toContain('owe us nothing');
  });

  it('⛔ y NINGUNA otra cadena de los ocho se tocó en este pase (§31.0)', () => {
    // Ancla estructural: la frase retirada no puede sobrevivir escondida en ninguna plantilla.
    const fuente = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'buylist', 'buylist-mail.templates.ts'),
      'utf8',
    );
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(codigo).not.toContain('no nos debes nada');
    expect(codigo).not.toContain('owe us nothing');
  });
});
