/**
 * LIVE-8 (API_CONTRACT §14 tabla, ARCHITECTURE §4.63.7) — texto del AVISO DE PRIVACIDAD.
 *
 * ⚠️⚠️ HOY ES EL BORRADOR DEL PRODUCT-OWNER (`PROJECT.md §LEG.2`, 2026-10-05), transcrito verbatim
 * (solo se quitaron los `*` de cursiva). NO está validado por el dueño ni por su abogado y le faltan
 * los datos del dueño (P-LEG-1…3: razón social, RFC, domicilio, correo de privacidad; P-LEG-11:
 * plazos; fecha de publicación). Cada hueco va entre corchetes `[…]` y se pinta resaltado.
 *
 * 🔒 Candado: mientras `findLegalMarkers(privacyNoticeEs)` encuentre algo, la página NO se sirve en
 * producción (404) ni se enlaza desde el pie (`legal-gate.ts`), y `npm run check:legal` sale con
 * código 1 (criterio 501 de PROJECT.md: rojo hasta que estén los datos). Cuando el abogado entregue
 * el texto final, se sustituye ESTE fichero entero, verbatim, y se sube `version`/`updatedAt`.
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

export interface LegalDocument {
  /** Versión del texto (sube con cada cambio de fondo). */
  version: string;
  /** Fecha de última actualización que se publica (criterio 500). */
  updatedAt: string;
  title: string;
  sections: LegalSection[];
}

const OWNER_EMAIL = '[DATO DEL DUEÑO: correo de privacidad]';

export const privacyNoticeEs: LegalDocument = {
  version: '0.1-borrador-po-2026-10-05',
  updatedAt: '[FECHA DE PUBLICACIÓN]',
  title: 'Aviso de privacidad integral — TCG HUNT',
  sections: [
    {
      id: 'responsable',
      title: '1. Quién es el responsable de tus datos.',
      blocks: [
        {
          type: 'p',
          text:
            '**[DATO DEL DUEÑO: razón social o nombre completo de la persona física]** (en adelante, «TCG HUNT»), con RFC ' +
            '**[DATO DEL DUEÑO: RFC]** y domicilio en **[DATO DEL DUEÑO: calle, número, colonia, CP, municipio/alcaldía, estado, ' +
            'México]**, es responsable del tratamiento de tus datos personales cuando usas **tcghunt.mx**. TCG HUNT es la marca ' +
            'comercial que opera **[DATO DEL DUEÑO: razón social]**.',
        },
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
            'patrimoniales**; los tratamos con tu **consentimiento expreso** [nota para el abogado: definir cómo se recaba — ' +
            'P-LEG-10]. **No recabamos datos personales sensibles** [nota para el abogado: confirmar si la imagen de la INE ' +
            '—que incluye fotografía— debe tratarse con algún requisito adicional].',
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
            '[SUPUESTO / default de P-LEG-8:] **Hoy no usamos tus datos para finalidades secundarias** (no enviamos ' +
            'publicidad ni compartimos datos con fines comerciales). Si algún día lo hacemos, actualizaremos este aviso y te ' +
            'daremos un medio para negarte **antes** de usarlos así; negarte nunca afectará tus compras ni tus ventas.',
        },
        {
          type: 'p',
          text:
            '[Nota para el abogado: si el dueño decide mandar promociones o usar la navegación para estadística de demanda ' +
            '—HECHOS.md 2026-10-04 «Rotación nivel siguiente»—, este apartado cambia y necesita el mecanismo de negativa.]',
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
            ['**Paqueterías** [y **Skydropx**, cuando opere]', 'Nombre de quien recibe, dirección y teléfono', 'Entregar o recoger el paquete'],
            ['**Resend**', 'Tu correo y el contenido del aviso', 'Enviarte los correos de la tienda'],
            ['**Cloudflare (R2)**', 'Imagen de tu INE', 'Guardarla en almacenamiento privado'],
            ['**Railway y Vercel**', 'Los datos de la tienda', 'Alojar el servidor, la base de datos y el sitio'],
            ['**Google**', 'Lo necesario para el acceso con Google', 'Iniciar sesión, si eliges esa opción'],
          ],
        },
        {
          type: 'p',
          text:
            'Algunos de estos proveedores pueden guardar datos **fuera de México** [nota para el abogado: confirmar país y ' +
            'contratos de cada uno]. Además, entregamos datos a **autoridades** (por ejemplo, el SAT) cuando la ley lo exige. ' +
            '**No vendemos tus datos.** [Nota para el abogado: decidir cuáles de estos son «remisiones» a encargados y cuáles ' +
            '«transferencias», y si alguna requiere consentimiento — P-LEG-12.]',
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
            '**Datos de tu cuenta:** mientras tengas cuenta. Si pides borrarla, la eliminamos; si ya hiciste operaciones, **anonimizamos** tus datos de contacto y borramos tus direcciones, datos de factura, CLABE e INE, y **conservamos** solo los registros de tus compras y ventas (incluida la dirección de entrega, datos fiscales y la CLABE cifrada de esas operaciones) por el tiempo que exigen las leyes fiscales: **[DATO DEL DUEÑO / CONTADOR: plazo]**.',
            '**Pedidos sin cuenta y solicitudes que no se cerraron:** **[DATO DEL DUEÑO: plazo — P-LEG-11]**.',
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
            'hábiles** siguientes. [Nota para el abogado: confirmar plazos contra la ley vigente.]',
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
            'Si consideras que tu derecho no fue atendido, puedes acudir a la autoridad en materia de protección de datos ' +
            '**[nota para el abogado: nombrar la autoridad vigente]**.',
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
        { type: 'p', text: '[Lista exacta: se completa con la revisión del criterio 509.]' },
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
            'finalidades o transferencias que requieran tu consentimiento, te lo pediremos de nuevo. [SUPUESTO: además, aviso ' +
            'por correo a clientes con cuenta cuando el cambio sea de fondo — P-LEG-13.]',
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
            'Al crear tu cuenta, comprar o vendernos cartas, reconoces haber leído este aviso. [Nota para el abogado: definir ' +
            'qué acto constituye aceptación y si se guarda constancia — hoy el sistema no guarda la aceptación del invitado ' +
            '(guest-checkout.dto.ts:99, sin columna).]',
        },
      ],
    },
  ],
};
