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
  version: '0.2-provisional-2026-10-05',
  pendingOwnerData: ['razonSocial', 'rfc', 'domicilio'],
  updatedAt: '5 de octubre de 2026',
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
            '**De forma automática:** dirección IP en algunas acciones registradas por seguridad, e información que tu navegador guarda para mantener tu sesión y tu carrito (ver punto 8).',
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
      ],
    },
    {
      id: 'finalidades-secundarias',
      title: '4. Finalidades secundarias.',
      blocks: [
        {
          type: 'p',
          text:
            '**Hoy no usamos tus datos para finalidades secundarias** (no enviamos ' +
            'publicidad ni compartimos datos con fines comerciales). Si algún día lo hacemos, actualizaremos este aviso y te ' +
            'daremos un medio para negarte **antes** de usarlos así; negarte nunca afectará tus compras ni tus ventas.',
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
            ['**Paqueterías**', 'Nombre de quien recibe, dirección y teléfono', 'Entregar o recoger el paquete'],
            ['**Skydropx**', 'Nombre de quien recibe, dirección, teléfono y correo', 'Cotizar y generar la guía de envío con la paquetería'],
            ['**Resend**', 'Tu correo y el contenido del aviso', 'Enviarte los correos de la tienda'],
            ['**Cloudflare (R2)**', 'Imagen de tu INE', 'Guardarla en almacenamiento privado'],
            ['**Railway y Vercel**', 'Los datos de la tienda', 'Alojar el servidor, la base de datos y el sitio'],
            ['**Google**', 'Lo necesario para el acceso con Google', 'Iniciar sesión, si eliges esa opción'],
          ],
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
            'Si consideras que tu derecho no fue atendido, puedes acudir a la **autoridad competente en materia de protección ' +
            'de datos personales**.',
        },
      ],
    },
    {
      id: 'cookies',
      title: '8. Cookies y tecnologías similares.',
      blocks: [
        {
          type: 'p',
          text:
            'Para mantener tu sesión abierta, recordar tu carrito y proteger tu cuenta de intentos de acceso, guardamos ' +
            'información en el **almacenamiento local de tu navegador**. **No usamos cookies de publicidad ni de analítica.** ' +
            'Nuestro procesador de pagos (**Stripe**) y, si eliges entrar con Google, **Google**, pueden usar sus propias cookies ' +
            'para prevenir fraudes y para el acceso; se rigen por sus avisos de privacidad. Puedes borrar esta información desde ' +
            'la configuración de tu navegador; si lo haces, se cerrará tu sesión y se vaciará tu carrito.',
        },
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
