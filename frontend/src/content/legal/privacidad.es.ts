/**
 * LIVE-8 (API_CONTRACT §14 tabla, ARCHITECTURE §4.63.7) — texto del AVISO DE PRIVACIDAD.
 *
 * ⚠️ PROVISIONAL — HECHOS.md fila 2026-10-05 (sesión 6): «Salir en vivo SIN datos fiscales del aviso
 * de privacidad; se regulariza después» (riesgo legal ACEPTADO por el dueño). Norma: API_CONTRACT
 * §14.17 (LIVE-E4, errata v1.84.4) y ARCHITECTURE §4.63.14. Base: el borrador del product-owner
 * (`PROJECT.md §LEG.2`), con los marcadores no fiscales resueltos como dice la tabla E4-2 (quitados o
 * sustituidos por una frase cierta sin el dato; ⛔ ningún dato inventado). NO está validado por el
 * abogado.
 *
 * Qué falta (y se regulariza en la casilla «Regularización legal» de §14.10):
 *  - P-LEG-1…3: razón social, RFC y domicilio del responsable (`pendingOwnerData`; mientras tanto el
 *    apartado 1 lleva `PROVISIONAL_FISCAL_TEXT`) y el correo de privacidad (hoy `soporte@tcghunt.mx`,
 *    el buzón que se midió que recibe).
 *  - P-LEG-11: plazo concreto de conservación de pedidos sin cuenta y solicitudes no cerradas.
 *  - P-LEG-4: revisión del abogado (las preguntas que eran notas al abogado siguen en P-LEG-10/12/13).
 *
 * 🔒 Candados (`legal-gate.ts`, `publish-check.ts`): cualquier marcador ⇒ 404 en producción y sin
 * enlace; `pendingOwnerData` y la frase fija tienen que ser coherentes. `npm run check:legal:provisional`
 * es la puerta de hoy; `npm run check:legal` (final) sigue ROJO hasta que lleguen P-LEG-1…3. Al
 * regularizar: se pone el dato, `pendingOwnerData: []`, se quita la frase fija y se sube
 * `version`/`updatedAt`.
 *
 * Vive aquí y no en `messages/*.json` (§4.63.7): es largo, se valida palabra por palabra, no pasa
 * por la paridad de traducciones y no choca con las ramas que editan `messages/`.
 * Formato mínimo de los textos: `**negrita**` y `[marcador]`.
 */

import { WISHLIST_PRIVACY_ES } from './privacy-wishlist';
import { MEASUREMENT_DISCLOSURE, type MeasurementDisclosure } from './measurement-disclosure';

export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] };

export interface LegalSection {
  id: string;
  title: string;
  blocks: LegalBlock[];
}

/**
 * §14.17 E4-3 — datos del dueño que el aviso TODAVÍA no publica (unión CERRADA: nada más compila;
 * `provisionalProblems` lo vuelve a comprobar en tiempo de ejecución). P-LEG-1 = razón social y RFC;
 * P-LEG-2 = domicilio.
 */
export type PendingOwnerDatum = 'razonSocial' | 'rfc' | 'domicilio';

export interface LegalDocument {
  /** Versión del texto (sube con cada cambio de fondo). */
  version: string;
  /**
   * Datos fiscales del responsable que faltan (§14.17). `[]` = documento final. Mientras no esté
   * vacío, el apartado `responsable` DEBE llevar `PROVISIONAL_FISCAL_TEXT` literal; vacío, NO debe.
   */
  pendingOwnerData: readonly PendingOwnerDatum[];
  /** Fecha de última actualización que se publica (criterio 500). */
  updatedAt: string;
  /**
   * ARCHITECTURE §14.1 (D-MKT2-0b): `null` = el aviso no declara la medición de la Fase 2. Con el
   * modo `on`, `null` hace fallar el build (`publish-check.ts`). Fuente: `measurement-disclosure.ts`.
   */
  measurementDisclosure: MeasurementDisclosure | null;
  title: string;
  sections: LegalSection[];
}

/**
 * Contacto publicado para todo lo relativo a datos personales (§14.17 E4-1): el buzón que se midió que
 * recibe (`DEVOPS_NOTES.md:6226-6227`). Se usa en §1 y §7. ⛔ `privacidad@…` no: nadie midió que exista.
 */
export const OWNER_EMAIL = 'soporte@tcghunt.mx';

/**
 * §14.17 E4-1 punto 2 — frase FIJA del modo provisional (copiada literal del contrato). Va en el
 * apartado `responsable` si y solo si `pendingOwnerData` no está vacío (`provisionalProblems`).
 */
export const PROVISIONAL_FISCAL_TEXT =
  '**Nombre o razón social, RFC y domicilio del responsable:** todavía no están publicados en este aviso. Los ' +
  'añadiremos aquí en cuanto estén disponibles, con su fecha de actualización. Mientras tanto, puedes dirigir ' +
  'cualquier solicitud sobre tus datos personales al correo de abajo.';

export const privacyNoticeEs: LegalDocument = {
  version: '0.6-provisional-2026-10-26',
  pendingOwnerData: ['razonSocial', 'rfc', 'domicilio'],
  updatedAt: '26 de octubre de 2026',
  measurementDisclosure: MEASUREMENT_DISCLOSURE,
  title: 'Aviso de privacidad integral — TCG HUNT',
  sections: [
    {
      id: 'responsable',
      title: '1. Quién es el responsable de tus datos.',
      blocks: [
        {
          type: 'p',
          text:
            'El responsable del tratamiento de tus datos personales cuando usas **tcghunt.mx** es quien opera la tienda ' +
            '**TCG HUNT** (en adelante, «TCG HUNT»).',
        },
        { type: 'p', text: PROVISIONAL_FISCAL_TEXT },
        { type: 'p', text: `Contacto para todo lo relacionado con tus datos: **${OWNER_EMAIL}**.` },
      ],
    },
    {
      id: 'datos',
      title: '2. Qué datos recabamos.',
      blocks: [
        {
          type: 'list',
          items: [
            '**Si creas una cuenta:** correo, nombre, contraseña (la guardamos cifrada de forma irreversible; nadie puede leerla) y, si lo das, teléfono. Si entras con Google: correo, nombre, identificador de Google y foto de perfil.',
            '**Para entregarte:** nombre de quien recibe, dirección y teléfono.',
            '**Si compras sin cuenta:** correo, nombre de quien recibe, teléfono y dirección de envío.',
            '**Al pagar:** **no recibimos ni guardamos los datos de tu tarjeta**; los capturas directamente en el formulario de nuestro procesador de pagos, Stripe. Solo conservamos la marca de la tarjeta y sus últimos 4 dígitos.',
            '**Si pides factura:** RFC, nombre o razón social, régimen fiscal, uso de CFDI, código postal y correo de facturación.',
            '**Si nos vendes cartas:** tu **CLABE** interbancaria y tu **nombre legal** (para pagarte a tu nombre) y, cuando el monto lo requiere, **imagen de tu INE por ambos lados**.',
            '**Si pides que te avisemos cuando un producto vuelva:** tu correo.',
            '**Si te registras para el Card Show o te preinscribes a un torneo:** tu correo y tu tipo de interés (asistir, vender o patrocinar); y, para la preinscripción al torneo, el nombre del jugador, el Player ID y, si el jugador es menor de edad, el consentimiento de su padre, madre o tutor.',
            '**De forma automática:** dirección IP en algunas acciones registradas por seguridad; información que tu navegador guarda para mantener tu sesión y tu carrito; y, **solo si lo aceptas**, datos de cómo usas la tienda para medir visitas y publicidad (ver punto 8).',
          ],
        },
        {
          type: 'p',
          text:
            '**Datos financieros y patrimoniales.** La CLABE y los datos de facturación son datos **financieros o ' +
            'patrimoniales**; los tratamos con tu **consentimiento expreso**. **No recabamos datos personales sensibles**.',
        },
      ],
    },
    {
      id: 'finalidades-primarias',
      title: '3. Para qué usamos tus datos — finalidades primarias (necesarias para darte el servicio):',
      blocks: [
        {
          type: 'list',
          items: [
            'a) Crear y administrar tu cuenta y tu acceso.',
            'b) Procesar tus compras, cobrarlas a través de Stripe y enviarte confirmaciones.',
            'c) Guardar tus cartas en tu bóveda y entregarte tus pedidos y retiros a domicilio.',
            'd) Cotizar, recibir, verificar y **pagarte por SPEI** las cartas que nos vendes.',
            'e) Verificar tu identidad cuando nos vendes por encima de cierto monto y cotejarla con la dirección de recolección o entrega, para prevenir fraudes.',
            'f) Atender reembolsos, aclaraciones y lo que nos escribas a soporte.',
            'g) Emitir tus facturas (CFDI) cuando las pidas, y cumplir obligaciones fiscales y legales.',
            'h) Avisarte por correo y en tu cuenta de cambios en tus pedidos, solicitudes y tu verificación de identidad.',
            'i) Mantener la seguridad de la tienda (registro de acciones, límite de intentos de acceso).',
          ],
        },
        // §WSH.5 · criterio 824: párrafo propio, literal de PROJECT.md (`privacy-wishlist.ts`).
        { type: 'p', text: WISHLIST_PRIVACY_ES },
      ],
    },
    {
      id: 'finalidades-secundarias',
      title: '4. Finalidades secundarias.',
      blocks: [
        {
          type: 'p',
          text:
            '**Marketing del Card Show.** Si te registras en la landing del Card Show o te preinscribes a un torneo y lo ' +
            'aceptas, usamos tu correo para enviarte información del evento y de TCG HUNT. Es una finalidad **secundaria**: ' +
            'puedes negarte sin que afecte tu registro ni tu preinscripción. Cada correo lleva un enlace para **darte de ' +
            'baja** y, si no reconoces el registro, un enlace de **«No fui yo»** que suprime tu correo de estos envíos hasta ' +
            'el fin de la campaña.',
        },
        {
          type: 'p',
          text:
            '**Medición de visitas y publicidad (solo si la aceptas).** Con tu permiso medimos cómo se usa la tienda y qué ' +
            'publicaciones y anuncios nos traen visitas y compras, para saber qué funciona y mejorar la tienda. Son dos permisos ' +
            'separados: **analítica** (Google Analytics) y **publicidad** (Meta, la empresa de Facebook e Instagram). Puedes ' +
            'aceptar uno, los dos o ninguno; negarte no afecta tus compras ni tus ventas. El detalle está en el punto 8.',
        },
        {
          type: 'p',
          text:
            'Fuera de esto, **no usamos tus datos para otras finalidades secundarias** y **no vendemos tus datos**. Si algún día ' +
            'ampliamos estos usos, actualizaremos este aviso y te daremos un medio para negarte **antes** de usarlos así; negarte ' +
            'nunca afectará tus compras ni tus ventas.',
        },
      ],
    },
    {
      id: 'remisiones',
      title: '5. Con quién compartimos tus datos.',
      blocks: [
        {
          type: 'p',
          text:
            'Para darte el servicio, compartimos datos con proveedores que los tratan **por cuenta nuestra** y solo para ese fin:',
        },
        {
          type: 'table',
          head: ['Proveedor', 'Qué recibe', 'Para qué'],
          rows: [
            ['**Stripe**', 'Monto y datos del pago que tú capturas en su formulario', 'Procesar el cobro y los reembolsos'],
            ['**Paqueterías**', 'Nombre, dirección y teléfono de quien recibe; si nos vendes cartas, también tu nombre, dirección y teléfono como remitente', 'Entregar o recoger el paquete'],
            ['**Skydropx**', 'Nombre, dirección, teléfono y correo de quien recibe; si nos vendes cartas, también tu nombre, dirección y teléfono como remitente', 'Cotizar y generar la guía de envío con la paquetería'],
            ['**Resend**', 'Tu correo y el contenido del aviso', 'Enviarte los correos de la tienda'],
            ['**Cloudflare (R2)**', 'Imagen de tu INE', 'Guardarla en almacenamiento privado'],
            ['**Railway y Vercel**', 'Los datos de la tienda', 'Alojar el servidor, la base de datos y el sitio'],
            ['**Google**', 'Lo necesario para el acceso con Google', 'Iniciar sesión, si eliges esa opción'],
            [
              '**Google (Google Analytics)**',
              'Si aceptas la analítica: páginas que visitas, productos que ves, agregas o compras, montos, de qué publicación ' +
                'llegaste y un identificador de tu navegador. Si no la aceptas: solo el aviso de que hubo una compra o una ' +
                'solicitud de venta, sin nada que te identifique',
              'Saber qué páginas y publicaciones llevan a compras',
            ],
            [
              '**Meta (Facebook e Instagram)**',
              'Solo si aceptas la publicidad: productos que ves, agregas o compras, montos y el identificador de Meta de tu navegador',
              'Saber qué publicaciones y anuncios llevan a visitas y compras',
            ],
          ],
        },
        {
          type: 'p',
          text:
            'Google y Meta pueden usar estos datos también según sus propios avisos de privacidad; por eso solo se los ' +
            'compartimos si das tu permiso en el aviso de cookies (punto 8).',
        },
        {
          type: 'p',
          text:
            'Cuando te preinscribes al torneo del Card Show, compartimos tus datos de preinscripción (nombre del jugador, ' +
            'Player ID y día) con **Jakomi**, organizador del torneo, para que gestione tu participación.',
        },
        {
          type: 'p',
          text:
            'Algunos de estos proveedores pueden guardar datos **fuera de México**. Además, entregamos datos a **autoridades** ' +
            '(por ejemplo, el SAT) cuando la ley lo exige. **No vendemos tus datos.**',
        },
      ],
    },
    {
      id: 'conservacion',
      title: '6. Cuánto tiempo los conservamos.',
      blocks: [
        {
          type: 'list',
          items: [
            '**Imagen de la INE:** la borramos **180 días** después de que se cierre tu última venta con nosotros, si no tienes otra abierta.',
            '**Datos de tu cuenta:** mientras tengas cuenta. Si pides borrarla, la eliminamos; si ya hiciste operaciones, **anonimizamos** tus datos de contacto y borramos tus direcciones, datos de factura, CLABE e INE, y **conservamos** solo los registros de tus compras y ventas (incluida la dirección de entrega, datos fiscales y la CLABE cifrada de esas operaciones) **por el plazo que exigen las disposiciones fiscales aplicables**.',
            '**Pedidos sin cuenta y solicitudes que no se cerraron:** los conservamos mientras sean necesarios para atender aclaraciones y cumplir obligaciones legales; publicaremos aquí el plazo concreto.',
            '**Card Show y torneo:** el correo del registro de avisos lo conservamos hasta que te des de baja; los datos de preinscripción al torneo, el tiempo necesario para gestionar tu participación y cumplir obligaciones legales (publicaremos aquí el plazo concreto).',
            '**Medición (solo si la aceptaste):** Google Analytics guarda los datos de visitas y compras **14 meses** y después los borra. En nuestros servidores, los identificadores de Google y de Meta de tu navegador se borran a los **7 días**. Con tu pedido o tu solicitud de venta guardamos tu elección y, si aceptaste la analítica, de qué publicación llegaste, por el mismo plazo que ese pedido o solicitud. Meta conserva lo que recibe según su propio aviso. Los plazos de las cookies están en el punto 8.',
          ],
        },
      ],
    },
    {
      id: 'arco',
      title: '7. Tus derechos ARCO y cómo ejercerlos.',
      blocks: [
        {
          type: 'p',
          text:
            'Tienes derecho a **Acceder** a tus datos, **Rectificarlos** si son inexactos, **Cancelarlos** (pedir que los ' +
            'borremos) y **Oponerte** a su uso para fines específicos. También puedes **revocar tu consentimiento** y **limitar el ' +
            'uso o divulgación** de tus datos.',
        },
        {
          type: 'p',
          text:
            `Para hacerlo, escribe a **${OWNER_EMAIL}** con: (i) tu nombre y el correo de tu cuenta o tu ` +
            'número de pedido; (ii) una copia de tu identificación (o la de tu representante y el documento que lo acredite); ' +
            '(iii) qué derecho quieres ejercer y sobre qué datos; y (iv) cualquier documento que ayude a localizarlos.',
        },
        {
          type: 'p',
          text:
            'Te responderemos en un máximo de **20 días hábiles** y, si procede, lo haremos efectivo dentro de los **15 días ' +
            'hábiles** siguientes.',
        },
        {
          type: 'p',
          text:
            'Muchos datos los puedes corregir tú mismo en «Mi cuenta» (nombre, teléfono, direcciones, datos de factura). ' +
            'Revocar el consentimiento para una finalidad primaria puede impedirnos seguir dándote ese servicio (por ejemplo, ' +
            'pagarte una venta sin CLABE).',
        },
        {
          type: 'p',
          text:
            '**Medición:** para retirar tu permiso de analítica o de publicidad no necesitas escribirnos: usa «Preferencias de ' +
            'cookies» (punto 8). Como no enviamos a Google ni a Meta tu nombre ni tu correo, no podemos ubicar en sus sistemas ' +
            'los datos de tu navegador; para borrarlos, borra las cookies de tu navegador y consulta los avisos de privacidad de ' +
            'Google y de Meta.',
        },
        {
          type: 'p',
          text:
            'Si consideras que tu derecho no fue atendido, puedes acudir a la **autoridad competente en materia de protección ' +
            'de datos personales**.',
        },
      ],
    },
    {
      id: 'cookies',
      title: '8. Cookies, medición y tecnologías similares.',
      // Texto literal aprobado por el dueño (docs/specs/AVISO_MEDICION_APROBADO.md, HECHOS 2026-10-26). El botón
      // «Preferencias de cookies» NO va aquí: lo añade `CookiePreferencesNoticeSlot` al final del apartado (D-MKT2-6).
      blocks: [
        { type: 'p', text: '**Lo necesario (siempre activo).** Para mantener tu sesión abierta, recordar tu carrito y proteger tu cuenta de intentos de acceso, guardamos información en el **almacenamiento local de tu navegador**. Cuando respondes al aviso de cookies, guardamos tu elección en la cookie **th_consent** durante **180 días**; después, o si cambiamos este aviso en lo que toca a la medición, te volvemos a preguntar. Contamos cuántas personas aceptan o rechazan, sin guardar quién.' },
        { type: 'p', text: '**Medición, solo si la aceptas.** Al entrar a la tienda verás un aviso con tres opciones: «Aceptar», «Solo lo necesario» y «Configurar», donde puedes activar por separado la analítica y la publicidad. **Antes de que elijas no se carga nada de Google ni de Meta** y no guardamos nada para medir.' },
        {
          type: 'list',
          items: [
            '**Analítica: Google Analytics (Google).** Nos dice qué páginas y publicaciones llevan a compras. Usa las cookies **_ga** y **_ga_…** de Google. Además guardamos en la cookie **th_first_utm**, durante **90 días**, de qué publicación o campaña llegaste la primera vez. Google conserva estos datos **14 meses** y después los borra. Lo tenemos configurado sin las funciones de publicidad de Google.',
            '**Publicidad: Meta (Facebook e Instagram).** Mide qué publicaciones y anuncios llevan a visitas y compras. Usa las cookies **_fbp** y **_fbc** de Meta.',
          ],
        },
        { type: 'p', text: '**Qué se mide:** las páginas que visitas (sin datos personales en la dirección), los productos que ves, agregas al carrito o compras, el monto, el envío y la forma de pago que eliges (por ejemplo, tarjeta), los clics para escribirnos por WhatsApp o mensaje, cuánto tarda en aparecer el botón de compra, cuántos resultados da una búsqueda (no lo que buscaste) y de qué publicación llegaste. Cuando completas una compra o una solicitud de venta, nuestro servidor también avisa a Google y a Meta, según lo que hayas aceptado, con el número interno del pedido o de la solicitud, los productos y el monto.' },
        { type: 'p', text: '**Qué no se envía nunca:** tu nombre, correo, teléfono, dirección, código postal, datos de tarjeta, CLABE, INE, RFC, el número de pedido que tú ves (TCG-…) ni lo que escribes en los formularios. **Tampoco se envían cifrados** (lo que a veces se llama «hash»): simplemente no salen. Como pasa en cualquier sitio que usa estas herramientas, cuando tu navegador se conecta con Google o con Meta, ellos ven tu dirección IP y el tipo de navegador; desde nuestros servidores no les enviamos tu IP.' },
        { type: 'p', text: '**Dónde se mide y dónde no:** solo medimos en la portada, el catálogo y las fichas de cartas y sellado, el carrito y el pago, las guías, las preguntas frecuentes, «Cómo funciona» y el cotizador de venta. **No hay ninguna herramienta de medición** en tu cuenta, tu bóveda, el paso donde capturas tu CLABE y tu INE para vendernos cartas, el detalle de tus solicitudes de venta, el inicio de sesión y las contraseñas, el seguimiento de tus pedidos ni en este aviso. En la página de pago las herramientas están configuradas para no recoger lo que escribes. En la página del **Card Show** solo usamos Google Analytics para contar visitas: no usamos Meta y no medimos lo que escribes en sus formularios.' },
        { type: 'p', text: '**Si eliges «Solo lo necesario»:** no se carga nada de Google ni de Meta. Solo cuando completas una compra o una solicitud de venta, nuestro servidor le avisa a Google Analytics que ocurrió (productos y monto), con un identificador al azar que no es tuyo ni de tu navegador, para que nuestras cifras de ventas cuadren. A Meta no le avisamos nada.' },
        { type: 'p', text: '**Cambiar de opinión:** puedes cambiar tu elección cuando quieras con el botón «Preferencias de cookies», que está al final de este apartado y en el pie de la tienda. Si quitas un permiso, borramos las cookies de esa medición que podemos borrar (th_first_utm, _ga, _fbp, _fbc) y la página se recarga sin esas herramientas. Lo que ya se envió antes de cambiar queda con Google o con Meta según sus propios avisos.' },
        { type: 'p', text: '**Cookies de otros servicios:** nuestro procesador de pagos (**Stripe**) y, si eliges entrar con Google, **Google**, pueden usar sus propias cookies para prevenir fraudes y para el acceso; en la página del Card Show, el mapa de Google también puede usarlas. Se rigen por sus avisos de privacidad. Puedes borrar todo desde la configuración de tu navegador; si lo haces, se cerrará tu sesión, se vaciará tu carrito y te volveremos a preguntar por las cookies.' },
      ],
    },
    {
      id: 'cambios',
      title: '9. Cambios a este aviso.',
      blocks: [
        {
          type: 'p',
          text:
            'Publicaremos cualquier cambio en **tcghunt.mx/privacidad**, con su fecha de actualización. Si el cambio afecta ' +
            'finalidades o transferencias que requieran tu consentimiento, te lo pediremos de nuevo.',
        },
      ],
    },
    {
      id: 'aceptacion',
      title: '10. Aceptación.',
      blocks: [
        {
          type: 'p',
          text:
            'Al crear tu cuenta, comprar o vendernos cartas, reconoces haber leído este aviso.',
        },
      ],
    },
  ],
};
