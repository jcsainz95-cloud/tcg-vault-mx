# Aviso de privacidad — cambios para encender la medición (APROBADO por el dueño el 2026-10-26)

Solo cambian los apartados 2, 4, 5, 6, 7 y 8. Lo demás queda igual.

Mantengo los diez apartados en su orden. `legal-gate.test.ts:98-111` exige exactamente ese orden y esos ids, así que no hay apartado nuevo: la medición se reparte entre los apartados 2, 4, 5, 6, 7 y 8. Lo que no menciono aquí (apartados 1, 3, 9, 10 y el resto de los bloques) queda igual.

El texto no lleva corchetes ni las palabras que bloquean la publicación (`legal-gate.ts:10-19`). Sí nombra los siete términos que exige el candado: Google Analytics, Meta, `_fbp`, `_fbc`, `th_first_utm`, `th_consent` y 14 meses.

### Apartado 2 · `datos`: cambia la viñeta «De forma automática»
> **De forma automática:** dirección IP en algunas acciones registradas por seguridad; información que tu navegador guarda para mantener tu sesión y tu carrito; y, **solo si lo aceptas**, datos de cómo usas la tienda para medir visitas y publicidad (ver punto 8).

### Apartado 4 · `finalidades-secundarias`
El párrafo 1 (Card Show) queda igual. Se añade el párrafo 2 y el párrafo 3 sustituye al actual, que decía «no compartimos datos con fines comerciales» y deja de ser cierto.

> **Medición de visitas y publicidad (solo si la aceptas).** Con tu permiso medimos cómo se usa la tienda y qué publicaciones y anuncios nos traen visitas y compras, para saber qué funciona y mejorar la tienda. Son dos permisos separados: **analítica** (Google Analytics) y **publicidad** (Meta, la empresa de Facebook e Instagram). Puedes aceptar uno, los dos o ninguno; negarte no afecta tus compras ni tus ventas. El detalle está en el punto 8.

> Fuera de esto, **no usamos tus datos para otras finalidades secundarias** y **no vendemos tus datos**. Si algún día ampliamos estos usos, actualizaremos este aviso y te daremos un medio para negarte **antes** de usarlos así; negarte nunca afectará tus compras ni tus ventas.

### Apartado 5 · `remisiones`: dos filas nuevas en la tabla y un párrafo después de la tabla
| Proveedor | Qué recibe | Para qué |
||||
| **Google (Google Analytics)** | Si aceptas la analítica: páginas que visitas, productos que ves, agregas o compras, montos, de qué publicación llegaste y un identificador de tu navegador. Si no la aceptas: solo el aviso de que hubo una compra o una solicitud de venta, sin nada que te identifique | Saber qué páginas y publicaciones llevan a compras |
| **Meta (Facebook e Instagram)** | Solo si aceptas la publicidad: productos que ves, agregas o compras, montos y el identificador de Meta de tu navegador | Saber qué publicaciones y anuncios llevan a visitas y compras |

> Google y Meta pueden usar estos datos también según sus propios avisos de privacidad; por eso solo se los compartimos si das tu permiso en el aviso de cookies (punto 8).

La fila «Google / acceso con Google» que ya existe se queda: el criterio 502 la exige (`legal-gate.test.ts:118-123`).

### Apartado 6 · `conservacion`: viñeta nueva
> **Medición (solo si la aceptaste):** Google Analytics guarda los datos de visitas y compras **14 meses** y después los borra. En nuestros servidores, los identificadores de Google y de Meta de tu navegador se borran a los **7 días**. Con tu pedido o tu solicitud de venta guardamos tu elección y, si aceptaste la analítica, de qué publicación llegaste, por el mismo plazo que ese pedido o solicitud. Meta conserva lo que recibe según su propio aviso. Los plazos de las cookies están en el punto 8.

### Apartado 7 · `arco`: párrafo nuevo antes del de «autoridad competente»
> **Medición:** para retirar tu permiso de analítica o de publicidad no necesitas escribirnos: usa «Preferencias de cookies» (punto 8). Como no enviamos a Google ni a Meta tu nombre ni tu correo, no podemos ubicar en sus sistemas los datos de tu navegador; para borrarlos, borra las cookies de tu navegador y consulta los avisos de privacidad de Google y de Meta.

### Apartado 8 · `cookies`: sustituye entero al texto actual
Con esto desaparece la frase vieja «No usamos cookies de publicidad ni de analítica».

**Título:** `8. Cookies, medición y tecnologías similares.`

> **Lo necesario (siempre activo).** Para mantener tu sesión abierta, recordar tu carrito y proteger tu cuenta de intentos de acceso, guardamos información en el **almacenamiento local de tu navegador**. Cuando respondes al aviso de cookies, guardamos tu elección en la cookie **th_consent** durante **180 días**; después, o si cambiamos este aviso en lo que toca a la medición, te volvemos a preguntar. Contamos cuántas personas aceptan o rechazan, sin guardar quién.

> **Medición, solo si la aceptas.** Al entrar a la tienda verás un aviso con tres opciones: «Aceptar», «Solo lo necesario» y «Configurar», donde puedes activar por separado la analítica y la publicidad. **Antes de que elijas no se carga nada de Google ni de Meta** y no guardamos nada para medir.

> - **Analítica: Google Analytics (Google).** Nos dice qué páginas y publicaciones llevan a compras. Usa las cookies **_ga** y **_ga_…** de Google. Además guardamos en la cookie **th_first_utm**, durante **90 días**, de qué publicación o campaña llegaste la primera vez. Google conserva estos datos **14 meses** y después los borra. Lo tenemos configurado sin las funciones de publicidad de Google.
> - **Publicidad: Meta (Facebook e Instagram).** Mide qué publicaciones y anuncios llevan a visitas y compras. Usa las cookies **_fbp** y **_fbc** de Meta.

> **Qué se mide:** las páginas que visitas (sin datos personales en la dirección), los productos que ves, agregas al carrito o compras, el monto, el envío y la forma de pago que eliges (por ejemplo, tarjeta), los clics para escribirnos por WhatsApp o mensaje, cuánto tarda en aparecer el botón de compra, cuántos resultados da una búsqueda (no lo que buscaste) y de qué publicación llegaste. Cuando completas una compra o una solicitud de venta, nuestro servidor también avisa a Google y a Meta, según lo que hayas aceptado, con el número interno del pedido o de la solicitud, los productos y el monto.

> **Qué no se envía nunca:** tu nombre, correo, teléfono, dirección, código postal, datos de tarjeta, CLABE, INE, RFC, el número de pedido que tú ves (TCG-…) ni lo que escribes en los formularios. **Tampoco se envían cifrados** (lo que a veces se llama «hash»): simplemente no salen. Como pasa en cualquier sitio que usa estas herramientas, cuando tu navegador se conecta con Google o con Meta, ellos ven tu dirección IP y el tipo de navegador; desde nuestros servidores no les enviamos tu IP.

> **Dónde se mide y dónde no:** solo medimos en la portada, el catálogo y las fichas de cartas y sellado, el carrito y el pago, las guías, las preguntas frecuentes, «Cómo funciona» y el cotizador de venta. **No hay ninguna herramienta de medición** en tu cuenta, tu bóveda, el paso donde capturas tu CLABE y tu INE para vendernos cartas, el detalle de tus solicitudes de venta, el inicio de sesión y las contraseñas, el seguimiento de tus pedidos ni en este aviso. En la página de pago las herramientas están configuradas para no recoger lo que escribes. En la página del **Card Show** solo usamos Google Analytics para contar visitas: no usamos Meta y no medimos lo que escribes en sus formularios.

> **Si eliges «Solo lo necesario»:** no se carga nada de Google ni de Meta. Solo cuando completas una compra o una solicitud de venta, nuestro servidor le avisa a Google Analytics que ocurrió (productos y monto), con un identificador al azar que no es tuyo ni de tu navegador, para que nuestras cifras de ventas cuadren. A Meta no le avisamos nada.

> **Cambiar de opinión:** puedes cambiar tu elección cuando quieras con el botón «Preferencias de cookies», que está al final de este apartado y en el pie de la tienda. Si quitas un permiso, borramos las cookies de esa medición que podemos borrar (th_first_utm, _ga, _fbp, _fbc) y la página se recarga sin esas herramientas. Lo que ya se envió antes de cambiar queda con Google o con Meta según sus propios avisos.

> **Cookies de otros servicios:** nuestro procesador de pagos (**Stripe**) y, si eliges entrar con Google, **Google**, pueden usar sus propias cookies para prevenir fraudes y para el acceso; en la página del Card Show, el mapa de Google también puede usarlas. Se rigen por sus avisos de privacidad. Puedes borrar todo desde la configuración de tu navegador; si lo haces, se cerrará tu sesión, se vaciará tu carrito y te volveremos a preguntar por las cookies.

El botón «Preferencias de cookies» **no** va en este texto: lo añade `CookiePreferencesNoticeSlot` como párrafo propio al final del apartado (D-MKT2-6, `measurement-gate.ts:60-61`).

### Metadatos (propuesta)
- `MEASUREMENT_DISCLOSURE = { version: '2026-10-medicion-1', approvedByOwnerOn: '<fecha en que el dueño apruebe>', legalReviewOn: ver B.1 }`. La versión cumple `^[A-Za-z0-9._-]{1,32}$`. Cambiarla después vuelve a preguntar a todos los visitantes (`th_consent`).
- `privacyNoticeEs.version`: `'0.6-provisional-<AAAA-MM-DD>'`. `updatedAt` es la fecha en que se publique. `pendingOwnerData` no cambia (ver C.1).
