import { readFileSync } from 'fs';
import { join } from 'path';
import * as buylistTemplates from '../src/modules/buylist/buylist-mail.templates';
import { ctaRows, isSafeMailUrl } from '../src/modules/buylist/mail-shell';
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
 * ⚠️ **Qué cubre este pase y qué no.** El pase 1 de §31.15 está **completo del lado de buylist**: el
 * esqueleto compartido y **los seis correos 1–6**. Los **7 y 8** viven en `mail/mail.templates.ts`,
 * son de **otro work stream** («Cuentas y acceso», deuda BE-43) y **este pase no los toca**. Por eso
 * los candados siguen divididos en dos:
 * - los que valen **para los ocho** —ML-1 (por ablación), ML-2 (lo prohibido), ML-9 y ML-10— se corren
 *   sobre **todas** las plantillas, migradas o no;
 * - los que describen **el esqueleto nuevo** —ML-4…ML-8 y los candados N1…N8 de abajo— se corren sobre
 *   `MIGRADOS`, que ahora **son los seis de buylist**. *Un candado que se apaga solo cuando el correo
 *   migra no es un candado: es un recordatorio.*
 *
 * ⭐ **Los ocho correos, pero DIEZ renders.** Dos de ellos tienen dos variantes que son el mismo correo
 * con otra acción —el recordatorio (aceptar / enviar, §25.4.3) y la expiración (no respondió / no
 * envió, §25.4.4)— y **las dos se barren**: es exactamente el reparto donde un candado que solo mira
 * una variante deja media plantilla sin vigilar.
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

/** El recordatorio, en sus dos variantes: son el mismo correo con dos acciones (§25.4.3). */
function recordatorio(kind: 'accept' | 'ship'): Render {
  return (locale, name = NOMBRE) =>
    buylistTemplates.sellOfferReminderTemplate(
      {
        kind,
        folio: FOLIO,
        buyLineCount: 2,
        netCents: 84000,
        deadlineAt: new Date('2026-09-16T18:00:00-06:00'),
        carrier: kind === 'ship' ? 'Estafeta' : null,
        trackingNumber: kind === 'ship' ? '1234567890' : null,
        portalUrl: PORTAL,
      },
      name,
      locale,
    );
}

/** La expiración, en sus dos variantes (§25.4.4): «no respondiste» y «no salió el paquete». */
function expirada(kind: 'no_response' | 'not_shipped'): Render {
  return (locale, name = NOMBRE) =>
    buylistTemplates.sellRequestExpiredTemplate(
      { kind, folio: FOLIO, closedAt: new Date('2026-09-16T18:00:00-06:00'), portalUrl: PORTAL },
      name,
      locale,
    );
}

/**
 * Los correos que YA hablan el idioma de §31. ⭐ **Son los SEIS de buylist**: el pase que montó el
 * correo 1 dejó la constante escrita para que creciera, y esto es que creció. Los dos que faltan
 * (`mail/`) son de otro work stream y por eso **no** están aquí — pero sí en `TODOS_LOS_CORREOS`.
 */
const MIGRADOS: Record<string, Render> = {
  '1 · oferta': (locale, name) => oferta(locale, {}, name),
  '2a · recordatorio (aceptar)': recordatorio('accept'),
  '2b · recordatorio (enviar)': recordatorio('ship'),
  '3 · oferta cancelada': (locale, name = NOMBRE) =>
    buylistTemplates.sellOfferCancelledTemplate(
      { folio: FOLIO, offerSentAt: new Date('2026-09-10T18:00:00-06:00'), portalUrl: PORTAL },
      name,
      locale,
    ),
  '4 · carta no aceptada': (locale, name = NOMBRE) =>
    buylistTemplates.sellItemRejectedTemplate(
      {
        folio: FOLIO,
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
  '5a · vencida (no respondió)': expirada('no_response'),
  '5b · vencida (no envió)': expirada('not_shipped'),
  '6 · solicitud cerrada': (locale, name = NOMBRE) =>
    buylistTemplates.sellRequestNotPursuedTemplate({ folio: FOLIO, portalUrl: PORTAL }, name, locale),
};

/** Los ocho (en diez renders), migrados o no: sobre esta lista corren ML-1, ML-2, ML-9 y ML-10. */
const TODOS_LOS_CORREOS: Record<string, Render> = {
  ...MIGRADOS,
  // ⚠️ 7 y 8 viven en `mail/mail.templates.ts`, de **otro work stream**. Aquí solo se LEEN: este spec
  // no los toca ni los migra (pase 2 de §31.15, con BE-43). Pero la marca y los cinco prohibidos son
  // de **todo correo que salga del producto**, así que entran al barrido igual.
  '7 · verificar correo': (locale, name = NOMBRE) =>
    accountTemplates.emailVerificationTemplate('https://tcghunt.mx/es/verify?token=t', name, locale),
  '8 · restablecer contraseña': (locale, name = NOMBRE) =>
    accountTemplates.passwordResetTemplate('https://tcghunt.mx/es/reset?token=t', name, locale),
};

/** Los que llevan botón. El correo 4 no lleva: §31.7 le asigna «el de coordinación» y §31 no lo define. */
const CON_CTA = Object.keys(MIGRADOS).filter((k) => !k.startsWith('4 ·'));

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
  /**
   * El texto que una persona VE: sin `<head>`, sin `<style>` y **sin el preheader**, que está oculto
   * y no cuenta como marca en pantalla.
   */
  const soloTexto = (html: string) =>
    html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<div style="display:none[\s\S]*?<\/div>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  for (const [correo, render] of Object.entries(TODOS_LOS_CORREOS)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: quitados TODOS los <img>, «TCG HUNT» sigue en el texto visible`, () => {
        const texto = soloTexto(sinImagenes(render(locale).html));
        expect(texto).toContain('TCG HUNT');
        // ⭐ Y **en el PRIMER GOLPE DE VISTA**, no solo en el pie. Sin esta mitad, la aserción la
        // aprueba el wordmark del pie y la mutación —meter la marca de la cabecera dentro de la
        // imagen— pasaría en verde: el hueco gris estaría arriba, que es donde se mira.
        expect(texto.slice(0, 200)).toContain('TCG HUNT');
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

  it.each(Object.keys(MIGRADOS))(
    'CONTROL POSITIVO: %s lleva EXACTAMENTE un <img>, y su src es de tcghunt.mx',
    (correo) => {
      // Una aserción de ablación que pasara porque no hay imágenes no mediría nada. Aquí la mira SÍ
      // existe, es **una sola** (§31.2: imágenes casi cero) y se sirve del mismo dominio del remitente.
      for (const locale of LOCALES) {
        const imgs = MIGRADOS[correo](locale).html.match(/<img\b[^>]*>/gi) ?? [];
        expect(imgs).toHaveLength(1);
        const mira = imgs[0] ?? '';
        expect(/src="([^"]+)"/.exec(mira)?.[1] ?? '').toMatch(/^https:\/\/tcghunt\.mx\/branding\//);
        // Decorativa a propósito: el wordmark de al lado ya porta la marca (§31.5a).
        expect(mira).toContain('alt=""');
        // `width`/`height` explícitos: el hueco reservado tiene que ser aire deliberado, no un salto.
        expect(mira).toMatch(/width="72"/);
        expect(mira).toMatch(/height="72"/);
      }
    },
  );
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
  // ⭐ Extendido a **los seis** correos migrados que llevan botón: el respaldo del CTA no es del
  // correo 1, es de §31.6g, y un correo migrado a medias sería exactamente el que se queda sin ruta a
  // la acción bajo inversión forzada.
  for (const correo of CON_CTA) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: la URL vive también fuera del href, en el HTML y en el texto`, () => {
        const msg = MIGRADOS[correo](locale);
        expect(msg.html.replace(/<[^>]*>/g, ' ')).toContain(PORTAL);
        expect(msg.text).toContain(PORTAL);
      });
    }
  }

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
  for (const [correo, render] of Object.entries(TODOS_LOS_CORREOS)) {
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
  for (const [correo, render] of Object.entries(TODOS_LOS_CORREOS)) {
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
      // La regla es sobre **la serif**: el 3, 4, 5, 7 y 9 de Georgia bajan de la línea base.
      expect(celda).not.toContain('Georgia');
    }
    // Y la COLUMNA de dinero —la que tiene que alinear, y que alinea por tabla y no por fuente
    // (`tabular-nums` no existe en correo)— es mono sin excepción.
    const columna = celdas.filter((c) => c.includes('align="right"'));
    expect(columna.length).toBeGreaterThanOrEqual(3); // bruto, envío y neto
    for (const celda of columna) expect(celda).toContain('JetBrains Mono');
    // ⚠️ Las cifras que van DENTRO de la prosa (§25.4.2 decisión 5/8: el envío y el neto se dicen
    // dos veces, en la tabla y en el texto) van en la sans y **así debe ser**: no son una columna,
    // no alinean con nada, y sacarlas de la prosa para meterlas en mono partiría la frase.
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
    const msg = MIGRADOS['6 · solicitud cerrada']('es');
    expect(msg.text).toContain(
      'No hay nada pendiente de tu parte: no mandes ninguna carta y no se generó ninguna guía.',
    );
    expect(msg.text).not.toContain('no nos debes nada');
    // El tuteo se comprueba explícitamente: el dueño lo dictó de usted y §31.10 lo devuelve a tú.
    expect(msg.text).toContain('tu parte');
    expect(msg.text).not.toMatch(/de su parte|puede volver a cotizar/);
  });

  it('EN: misma frase, misma razón', () => {
    const msg = MIGRADOS['6 · solicitud cerrada']('en');
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

// =================================================================================================
// LOS CANDADOS NUEVOS DEL PASE DE LOS CORREOS 2–6 (N1…N8)
//
// §31.14 escribió once mutaciones pensando en el correo 1. Montar los otros cinco abre superficies
// que ML-1…ML-11 **no miraban**, y cada una de las de abajo existe porque **su mutación pone rojo**:
// no hay aquí ninguna aserción que siga en verde con el arreglo quitado.
// =================================================================================================

/** El preheader, tal y como viaja: oculto, y por eso invisible en cualquier revisión visual. */
function preheaderDe(html: string): string {
  const crudo = /<div style="display:none[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
  return crudo.replace(/(&zwnj;|&nbsp;)+/g, '');
}

/**
 * **La banda de tinta ENTERA**, no su última línea. Se ancla en el `padding:28px` de §31.6h —el único
 * del documento— y no en `bgcolor="#1A1A18"`, que también lo llevan la regla de tinta de la resta y
 * el CTA en tinta: anclar ahí dejaba **tres cuartas partes del pie sin mirar**.
 */
function pieDe(html: string): string {
  return html.slice(html.lastIndexOf('padding:28px'));
}

/** Toda cifra de dinero que aparece en un texto, sin duplicados. */
function dineroEn(texto: string): string[] {
  return [...new Set(texto.match(/\$\s?[\d,]+\.\d\d/g) ?? [])];
}

// =================================================================================================
// N1 ⭐ — R3: EL BLOQUE DE MARCA LO EMITE EL ESQUELETO, NO CADA PLANTILLA
// =================================================================================================
/**
 * Hasta el correo 1, `mailShell` emitía **el pie solo** y cada plantilla tenía que acordarse de poner
 * `brandRows()` de primer bloque. Esa asimetría **falla en silencio**: el correo que la olvida se
 * manda **sin marca** y ningún tipo lo impide — ML-1 lo cazaría, sí, pero *después* de escribirlo.
 * Ahora las tres partes fijas de §31.3 (preheader, marca y pie) las pone el shell.
 *
 * **Las dos mitades, y la segunda es la que mata la mutación:** ninguna plantilla nombra `brandRows`
 * (si vuelve, es que alguien la puso a mano) **y** cada correo tiene **exactamente un** wordmark de
 * cabecera — porque el modo obvio de «arreglar» la primera mitad es dejar la llamada y quedarse con
 * **dos marcas**, que en un correo se ve como un error de envío.
 */
describe('⭐ N1 (R3) — la marca la pone el esqueleto, y exactamente una vez', () => {
  it('⚠️ ninguna plantilla de buylist llama a `brandRows` (código, sin comentarios)', () => {
    const codigo = readFileSync(
      join(__dirname, '..', 'src', 'modules', 'buylist', 'buylist-mail.templates.ts'),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(codigo).not.toContain('brandRows');
  });

  for (const correo of Object.keys(MIGRADOS)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: un solo wordmark de cabecera, en serif 30px y texto vivo`, () => {
        const html = MIGRADOS[correo](locale).html;
        const wordmarks = html.match(/font-size:30px[^>]*>TCG HUNT</g) ?? [];
        expect(wordmarks).toHaveLength(1);
        // Y la regla `#AEACA7` que va debajo de la marca, que es constante en los ocho (§31.9).
        expect(html).toContain('bgcolor="#AEACA7"');
      });
    }
  }
});

// =================================================================================================
// N2 ⭐ — §31.6h EN LOS SEIS: EN LA BANDA DE TINTA NO VIVE NADA QUE EL LECTOR NECESITE
// =================================================================================================
/**
 * El pie en tinta es **la única superficie ya invertida del correo** y la que más riesgo corre en modo
 * oscuro (§31.8). Por eso §31.6h prohíbe que lleve **nada necesario**: ni folio, ni importe, ni plazo,
 * ni enlace de acción, ni baja. El correo 1 ya tenía este candado; **los otros cinco no**, y el pie es
 * justo lo que se copia y pega de un correo al de al lado.
 */
describe('⭐ N2 — §31.6h: el pie en tinta de LOS SEIS no lleva nada que el lector necesite', () => {
  for (const correo of Object.keys(MIGRADOS)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: ni folio, ni importe, ni fecha, ni enlace, ni baja`, () => {
        const pie = pieDe(MIGRADOS[correo](locale).html);
        expect(pie).not.toContain(FOLIO);
        expect(dineroEn(pie)).toEqual([]);
        expect(pie).not.toMatch(/20\d\d/);
        expect(pie).not.toContain('<a ');
        expect(pie.toLowerCase()).not.toMatch(/unsubscribe|darte de baja|baja de/);
      });
    }
  }

  it('CONTROL: el pie SÍ lleva lo suyo — marca, descriptor y contacto (§31.6h)', () => {
    const pie = pieDe(MIGRADOS['3 · oferta cancelada']('es').html);
    expect(pie).toContain('TCG HUNT');
    expect(pie).toContain('bóveda de cartas Pokémon en México');
    expect(pie).toContain('tcghunt.mx · soporte@tcghunt.mx');
  });
});

// =================================================================================================
// N3 ⭐ — EL PREHEADER: 40–90 CARACTERES Y LA REGLA R1 DEL DINERO
// =================================================================================================
/**
 * El preheader es **texto oculto**: no se ve en ninguna revisión visual, no aparece en la parte de
 * texto plano y **es lo primero que lee la bandeja**. Es, exactamente, la superficie donde un dato se
 * cuela sin que nadie lo note.
 *
 * ⭐ **R1 de §25.4, y es la mitad que muerde:** *«el único monto que puede aparecer en un asunto o
 * preheader es el NETO»*. Un preheader que anuncie el **bruto** promete una cifra que no se va a
 * depositar, en la superficie donde más gente se queda.
 */
describe('⭐ N3 — el preheader de los seis: 40–90 caracteres y, de dinero, SOLO el neto (R1)', () => {
  const NETO = 84000;
  for (const correo of Object.keys(MIGRADOS)) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: existe, mide 40–90 y no promete ninguna cifra que no sea el neto`, () => {
        const msg = MIGRADOS[correo](locale);
        const preheader = preheaderDe(msg.html);
        expect(preheader.length).toBeGreaterThanOrEqual(40);
        expect(preheader.length).toBeLessThanOrEqual(90);
        // ⛔ Ni el bruto ni el envío: R1 deja pasar **el neto y nada más**.
        const neto = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-MX', {
          style: 'currency',
          currency: 'MXN',
          minimumFractionDigits: 2,
        }).format(NETO / 100);
        // `Intl` prefija `MX$` en inglés y `$` en español: se compara **la cifra**, que es lo que R1
        // gobierna, contra el neto formateado en ese mismo idioma.
        for (const cifra of dineroEn(preheader)) expect(neto).toContain(cifra);
        // Y el relleno de §31.6a está puesto: sin él se cuela el principio del cuerpo en la bandeja.
        expect(msg.html).toContain('&zwnj;&nbsp;');
      });
    }
  }
});

// =================================================================================================
// N4 ⭐⭐ — EL RECORDATORIO ENSEÑA EL NETO Y **NADA MÁS** (§31.9)
// =================================================================================================
/**
 * *«Repetir la resta entera en un recordatorio invita a releerla como si fuera una oferta nueva»*
 * (§31.9), y la propiedad que este ciclo más protege es que hay **una** oferta y **no se edita**.
 * El rediseño es el momento exacto en que alguien copia el bloque de montos del correo 1 al 2 porque
 * «ya está hecho»: eso es lo que este candado pone en rojo, **en las dos mitades del correo**.
 */
describe('⭐⭐ N4 — el correo 2 lleva el neto y ni una línea más de la resta (§31.9)', () => {
  for (const correo of ['2a · recordatorio (aceptar)', '2b · recordatorio (enviar)']) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: ni el bruto, ni el envío, ni una segunda cifra`, () => {
        const msg = MIGRADOS[correo](locale);
        const netLabel = locale === 'en' ? 'DEPOSITED TO YOU' : 'SE TE DEPOSITAN';
        expect(msg.html).toContain(netLabel);
        expect(msg.text).toContain(netLabel);
        for (const desglose of locale === 'en'
          ? ['Value of the cards', 'Shipping we cover']
          : ['Valor de las cartas', 'Envío que ponemos nosotros']) {
          expect(msg.html).not.toContain(desglose);
          expect(msg.text).not.toContain(desglose);
        }
        // ⭐ La aserción que no depende de las etiquetas: **una sola cifra de dinero en todo el
        // correo**, y es el neto. Un desglose maquetado de otra forma cae aquí igual.
        expect(dineroEn(msg.html)).toHaveLength(1);
        expect(dineroEn(msg.text)).toHaveLength(1);
      });
    }
  }
});

// =================================================================================================
// N5 ⭐⭐ — R2: EL RECORDATORIO NO SE LIMPIA DE LA CONDICIÓN
// =================================================================================================
/**
 * §25.4.3 la llama *«la regla que más fácil se rompe»*: la tentación de un recordatorio es ser ligero
 * y quedarse con la cifra. **Un correo que repite el neto sin decir «siempre que lleguen en Near
 * Mint» degrada la condición a letra chica por omisión** — que es exactamente lo que D30 vino a
 * impedir. Y la condición tiene que ir **pegada al conteo de cartas**, no perdida en otro bloque.
 */
describe('⭐⭐ N5 — el recordatorio repite la condición NM pegada al conteo (R2 de §25.4)', () => {
  for (const correo of ['2a · recordatorio (aceptar)', '2b · recordatorio (enviar)']) {
    for (const locale of LOCALES) {
      it(`${correo} [${locale}]: la condición viaja con el conteo, en el HTML y en el texto`, () => {
        const msg = MIGRADOS[correo](locale);
        const linea =
          locale === 'en'
            ? '2 card(s), only if they arrive Near Mint'
            : '2 carta(s), siempre que lleguen en Near Mint';
        expect(msg.html).toContain(linea);
        expect(msg.text).toContain(linea);
      });
    }
  }
});

// =================================================================================================
// N6 ⭐⭐ — EL CORREO 6 NO NOMBRA NINGÚN PLAZO NI NINGÚN MONTO (§25.4.5)
// =================================================================================================
/**
 * §25.4.5 le da al correo 4 de §25 —el 6 de §31— **la propiedad que lo hace verificable**: *«el correo
 * no menciona ningún plazo. Si en el texto aparece una fecha límite, un “7 días” o un “venció”, el
 * correo está mal.»* Y ningún monto, *«ni el total cotizado»*.
 *
 * ⭐ El rediseño le añade **tres superficies nuevas** por las que se colaría una fecha sin que nadie
 * mirara: el eyebrow, el preheader oculto y la línea del pie. Por eso el barrido es sobre
 * `subject + html + text` **enteros**, no sobre el cuerpo.
 */
describe('⭐⭐ N6 — el correo 6 cierra sin acusar: ni plazo, ni monto, ni «venció» (§25.4.5)', () => {
  for (const locale of LOCALES) {
    it(`[${locale}] ni una fecha, ni una cifra de dinero, ni la palabra que culpa`, () => {
      const msg = MIGRADOS['6 · solicitud cerrada'](locale);
      const todo = `${msg.subject}\n${msg.html}\n${msg.text}`;
      expect(todo).not.toMatch(/20\d\d/); // ninguna fecha, en ninguna superficie
      expect(dineroEn(todo)).toEqual([]); // ⛔ ningún monto, «ni el total cotizado»
      expect(todo).not.toMatch(/venci[óo]|expired\b/i); // aquí no venció nada suyo
      expect(todo).not.toMatch(/\b\d+\s*(días|days)\b/i); // ni «7 días»
    });
  }
});

// =================================================================================================
// N7 ⭐ — EL CORREO 3 NO CULPA AL VENDEDOR DE UN ACTO NUESTRO (§25.4.4-bis)
// =================================================================================================
/**
 * La cancelación es *«el único desenlace que NO cierra nada»*: **cancelamos nosotros** y la solicitud
 * sigue viva. §25.4.4-bis prohíbe aquí **la palabra «venció»**, **cualquier plazo del vendedor** y
 * **cualquier monto** (los de la oferta cancelada se limpiaron de la fila y no se resucitan), y exige
 * que el CTA sea **«Ver mi solicitud»** y no «cotizar de nuevo» —que lo mandaría a **duplicar una
 * solicitud abierta**—. El eyebrow nuevo (`OFERTA CANCELADA`) es justo donde se colaría un «venció».
 */
describe('⭐ N7 — el correo 3: sin «venció», sin montos, y con el CTA que NO duplica (§25.4.4-bis)', () => {
  for (const locale of LOCALES) {
    it(`[${locale}] ni la palabra que culpa ni una cifra, en ninguna superficie`, () => {
      const msg = MIGRADOS['3 · oferta cancelada'](locale);
      const todo = `${msg.subject}\n${msg.html}\n${msg.text}`;
      expect(todo).not.toMatch(/venci[óo]|vence|expire/i);
      expect(dineroEn(todo)).toEqual([]);
    });

    it(`[${locale}] el CTA dice «ver mi solicitud», jamás «cotizar de nuevo»`, () => {
      const html = MIGRADOS['3 · oferta cancelada'](locale).html;
      expect(html).toContain(locale === 'en' ? 'VIEW MY REQUEST' : 'VER MI SOLICITUD');
      expect(html).not.toMatch(/COTIZAR DE NUEVO|GET A NEW QUOTE/);
      // §31.7 — y va en TINTA: el bermellón es de los dos correos donde no responder cuesta dinero.
      expect(html).toMatch(/bgcolor="#1A1A18"[^>]*border:1px solid #1A1A18/);
      expect(html).not.toContain('bgcolor="#B31217"');
    });
  }
});

// =================================================================================================
// N8 ⭐ — EL CORREO 4 LLEVA LOS DOS PLAZOS DENTRO DE LA CAJA DE TÉRMINOS (§31.9)
// =================================================================================================
/**
 * §31.9 le da al correo 4 caja de términos *«(los dos plazos)»*, y **son dos**: devolución y abandono.
 * El vendedor decide entre las dos con las dos fechas y el canal delante; **una caja con un solo plazo
 * es una decisión que no se puede tomar**. Es la extensión que este pase le hizo al patrón
 * `termsBoxRows` —varios párrafos— y el candado que la sostiene.
 *
 * ⚠️ Y el rótulo en versalitas es **el portador** (§31.8 regla 4b): la regla bermellón de 3px es
 * decorativa, porque bajo inversión forzada cae en el par prohibido de §17.2.
 */
describe('⭐ N8 — la caja de términos del correo 4: los DOS plazos y el canal, dentro del pozo', () => {
  const pozoDe = (html: string) =>
    (html.match(/<td[^>]*bgcolor="#EFEBE2"[^>]*>([\s\S]*?)<\/td>/g) ?? []).join('\n');

  for (const locale of LOCALES) {
    it(`[${locale}] devolución y abandono, con sus dos fechas y el buzón, en la misma caja`, () => {
      const html = MIGRADOS['4 · carta no aceptada'](locale).html;
      const pozo = pozoDe(html);
      // El rótulo, EN MAYÚSCULAS EN LA CADENA (§31.2) y dentro del pozo: es el portador.
      expect(pozo).toContain(locale === 'en' ? 'YOUR OPTIONS' : 'TUS OPCIONES');
      expect(pozo).toMatch(locale === 'en' ? /Return:/ : /Devoluci[óo]n:/);
      expect(pozo).toMatch(locale === 'en' ? /Abandonment:/ : /Abandono:/);
      // **Los DOS plazos**, que son fechas distintas: 16 de septiembre y 16 de octubre.
      expect(pozo).toMatch(locale === 'en' ? /September 16, 2026/ : /16 de septiembre de 2026/);
      expect(pozo).toMatch(locale === 'en' ? /October 16, 2026/ : /16 de octubre de 2026/);
      // Y el canal de coordinación, que es lo que convierte la opción en algo que se puede hacer.
      expect(pozo).toContain('soporte@tcghunt.mx');
      // §31.6d — la regla bermellón de 3px existe y es DECORATIVA (el portador es el rótulo).
      expect(html).toContain('bgcolor="#B31217"');
      expect(html).not.toMatch(/bgcolor="#B31217"[^>]*border:1px solid #B31217/); // ⛔ no es un CTA
    });
  }
});

// =================================================================================================
// N9 ⭐ — EL ESQUEMA DEL `href` LO DECIDE EL ESQUELETO (defensa en profundidad, techlead/QA)
// =================================================================================================
/**
 * `escapeHtml` impide que una URL **rompa el atributo**; ⛔ **no impide que la URL SEA
 * `javascript:`**, que sobrevive al escape intacta y sigue siendo ejecutable al clic. Hoy todas las
 * URL de correo las construye el servidor, así que **no es explotable** — es defensa en profundidad
 * sobre **la base en la que van los ocho**, y es el mismo argumento por el que el escape vive en el
 * esqueleto: *que ocho plantillas no tengan que acordarse.*
 *
 * ⭐ **Y la mitad que impide arreglarlo rompiendo otra cosa:** con una URL insegura el botón **sigue
 * pintándose** (la maqueta no se descuadra) y **la URL en texto de debajo se sigue emitiendo** — la
 * ruta a la acción de §31.6g/ML-5 no depende de esta guarda.
 */
describe('⭐ N9 — `ctaRows` acota el esquema del href: allowlist http(s), no denylist', () => {
  it('CONTROL POSITIVO: una URL https sí produce un `<a href>`', () => {
    const html = ctaRows('https://tcghunt.mx/es/buylist/requests/sr-1', 'VER', 'ink');
    expect(html).toContain('<a href="https://tcghunt.mx/es/buylist/requests/sr-1"');
    expect(html).toContain('>VER</a>');
  });

  it('⛔ `javascript:` y `data:` NO producen href — y el botón y la URL de respaldo siguen ahí', () => {
    for (const hostil of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x']) {
      const html = ctaRows(hostil, 'VER', 'ink');
      expect(html).not.toContain('<a href');
      expect(html).not.toContain('href=');
      expect(html).toContain('>VER</span>'); // el rótulo se pinta igual: la maqueta no se descuadra
      // §31.6g / ML-5 — el respaldo en texto se emite SIEMPRE, pase lo que pase con el botón.
      expect(html.replace(/<[^>]*>/g, ' ')).toContain(hostil.split(':')[0]);
    }
  });

  it('⛔ una URL relativa, vacía o basura tampoco: no se emite un href a medias (BL-21)', () => {
    for (const mala of ['/es/buylist', '', 'tcghunt.mx', 'undefined']) {
      expect(isSafeMailUrl(mala)).toBe(false);
      expect(ctaRows(mala, 'VER', 'ink')).not.toContain('href=');
    }
  });

  it('la allowlist deja pasar `http:` — es lo que vale `APP_PUBLIC_URL` en local', () => {
    expect(isSafeMailUrl('http://localhost:3000/es/buylist/requests/sr-1')).toBe(true);
    expect(isSafeMailUrl('https://tcghunt.mx/es')).toBe(true);
  });

  it('CONTROL: los seis correos migrados siguen emitiendo su href (no se rompió nada)', () => {
    for (const correo of CON_CTA) {
      expect(MIGRADOS[correo]('es').html).toContain(`<a href="${PORTAL}"`);
    }
  });
});
