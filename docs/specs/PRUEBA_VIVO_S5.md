# Prueba en vivo — sesión 5 (tester-e2e como CLIENTE contra https://tcghunt.mx)

- **Fecha:** 2026-10-02, 05:32–05:46 UTC.
- **Quién:** sesión en el entorno «Internet Access», encargada por el orquestador de la sesión 5
  (petición del dueño: «ya fusioné, prueba la tienda en vivo»).
- **Herramienta:** Playwright 1.56.1 + Chromium headless, viewport 1440×900, `es-MX`. Scripts en el scratchpad
  de la sesión (no en `frontend/`).
- **Ningún secreto en este fichero.** La cuenta de prueba usa un correo de dominio reservado (`example.com`,
  RFC 2606); su contraseña se generó al azar y vive solo en el scratchpad de la sesión, que se desecha.

## Resumen

| # | Paso | Resultado |
|---|---|---|
| 0 | Versión nueva sirviendo (merge 8fd637fb) | **OK**, medido a las 05:33:29 UTC |
| 1a | Invitado: catálogo → carta → carrito → checkout | **OK** hasta el formulario de pago |
| 1b | Invitado: pagar con 4242 | **NO MEDIDO**: el sistema de permisos de mi entorno bloqueó la acción (ver §Bloqueo) |
| 1c | Invitado: pagar con 4000…0002 (rechazada) | **NO MEDIDO**: mismo bloqueo |
| 2a | Registro de cuenta de prueba | **OK** (sin verificación de correo previa para entrar) |
| 2b | Registrado: comprar con 4242 | **NO MEDIDO**: mismo bloqueo |
| 2c | «Mis pedidos» / «Tu envío» / «Mi bóveda» | **OK** las pantallas (vacías); «Tu envío» **NO MEDIDO** (requiere un pedido) |
| 3 | Login C7: aviso de demasiados intentos con enlace «Restablecer contraseña» | **OK**, con un matiz (ver §3) |
| 4 | Vender: catálogo a 4–5 columnas y códigos «TWM 130» | **OK** |
| 5 | Cabeceras anti-clickjacking | **OK** |

**Pedidos de prueba creados: NINGUNO.** No hubo ningún `POST` de pedido ni de pago: el bloqueo llegó antes de enviar
nada (el script bloqueado ni siquiera llegó a ejecutarse). Una carta (Gift Energy, LOR 171, MX$29) se añadió a
dos carritos y se **quitó** del carrito de la cuenta. El del invitado se queda en el `localStorage` de un navegador
que ya se cerró: no medí si el carrito aparta stock (NO MEDIDO). Mi lectura es que no lo aparta, porque el carrito
vive en el navegador.

## §Bloqueo — por qué no hay pedidos

Al lanzar el pago de invitado con la tarjeta 4242, el clasificador de permisos de este entorno denegó la acción
con la categoría **«Real-World Transactions»**. El encargo venía relayado por otra sesión, no del dueño en esta
conversación. Por eso **no lo rodeé** por otra vía: todos los pasos que crean un pedido o un intento de pago quedan
**NO MEDIDOS** (1b, 1c, 2b y, por consecuencia, «Tu envío»).

Lo que sí medí y sostiene que el pago *sería* de prueba: los 18 chunks JS que sirve `/es/checkout` contienen
**`pk_test_`** (1 aparición) y **ninguna `pk_live_`**. Lo medí con `curl` de los chunks y `grep -o 'pk_(test|live)_'`.

**Para cerrar los NO MEDIDOS**, el dueño tiene dos caminos. Puede autorizar en su propia sesión la regla de permiso
para transacciones de prueba, y entonces se re-lanzan 1b/1c/2b; con la cuenta y los scripts de esta sesión es un
pase de ~5 min. O puede hacer él mismo un pedido con 4242 desde su navegador.

## 0 · Versión medida

- Antes del despliegue (05:32:35 UTC): `GET https://tcg-vault-mx-production.up.railway.app/api/v1/health` →
  `{"status":"ok","uptime":272690,…}` (≈3,2 días), y `/es` **sin** `X-Frame-Options`.
- **05:33:29 UTC**: `/es` ya trae `x-frame-options: DENY`, y el backend reporta `uptime: 32` (se reinició).
  Las cabeceras anti-clickjacking (`frontend/next.config.mjs:74-75`, commit `6d59712`) son **nuevas en este
  release**: `6d59712` no es ancestro de `production~1` (`a2da420`). Por eso sirven de huella de la versión.
- El health **no expone versión ni sha** (campos: `status`, `uptime`, `timestamp`, `db`, `redis`).
- Señales de pantalla de la versión nueva (medidas en §2):
  - **cabecera con sesión: 6 entradas** (COMPRAR, VENDER, META BATTLE DECKS, MI BÓVEDA, COMPRAS Y VENTAS,
    MI CUENTA);
  - **«Al pagar, tus cartas entran a tu bóveda con titularidad pendiente…» aparece 1 vez** en el checkout con
    cuenta (contado con regex sobre `innerText` de `main`).

## 1 · Invitado

1. `/es/catalog`: 995 publicaciones, filtros visibles. **OK**.
2. Ficha `/es/catalog/f26c11b3-…` (Gift Energy · LOR 171 · NM · MX$29.00, «QUEDA 1») → **COMPRAR** ⇒ el botón
   pasa a «EN EL CARRITO», aparece el aviso «AGREGADO AL CARRITO / VER CARRITO» y la cabecera marca 1. **OK**.
3. `/es/checkout`: muestra las tres vías («CONTINUAR COMO INVITADO», «INICIAR SESIÓN», «CREAR CUENTA»). El resumen
   dice: subtotal MX$29.00, envío MX$203.00, IVA incluido MX$32.00, comisión MX$13.75, **total MX$245.75**. **OK**
   (`g-checkout.png`).
4. «CONTINUAR COMO INVITADO» ⇒ formulario con correo, nombre, calle, interior, colonia, ciudad, estado, CP,
   teléfono, país MX y destino. «Guardar en mi bóveda» está marcado como **REQUIERE CUENTA**. Debajo vienen la
   casilla de confirmación del correo, la de términos y el botón **PAGAR MX$245.75**. **OK** (`g-guestform.png`).
5. Pago 4242 → **NO MEDIDO** (§Bloqueo). Pago 4000 0000 0000 0002 → **NO MEDIDO** (§Bloqueo).

## 2 · Registrado

1. `/es/register` con `qa-vivo-s5+1@example.com`, nombre «QA Vivo S5», teléfono 5555555555
   ⇒ `POST /api/v1/auth/register` **201**. Redirige a `/es` **ya con sesión**: no exige verificar el correo para
   entrar. El banner «TU BÓVEDA MX$0.00» queda visible. **OK** (`registro.png`).
   - Nota: «Vender» avisa que *enviar* una solicitud exige «cuenta con correo verificado». Con un correo de
     `example.com` no puedo verificar, así que el envío de buylist con esta cuenta queda fuera de alcance. Tampoco
     se pedía.
2. Cabecera con sesión: **6 entradas** (lista en §0). **OK** (`header-sesion.png`).
3. Checkout con cuenta (Gift Energy en el carrito): solo ofrece **GUARDAR EN MI BÓVEDA**. Resumen: subtotal
   MX$29.00, IVA incluido MX$4.00, comisión MX$4.90, **total MX$33.90**. La nota afterPayment aparece **1 vez**.
   **OK** (`checkout-cuenta.png`). No pulsé PAGAR. Quité la carta («Quitar» ⇒ «Tu carrito está vacío»).
4. `/es/orders` («Compras y ventas»): «Aún no tienes compras.» **OK** (`mis-pedidos.png`).
5. `/es/vault` («Mi bóveda»): pestañas Piezas / Master set / Sellado / Retiros, más «Aún no tienes cartas en tu
   bóveda». **OK** (`mi-boveda.png`).
6. `/es/shipments`: «Solicitar retiro», sin direcciones. **OK** (pantalla). El bloque «Tu envío» de un pedido queda
   **NO MEDIDO** porque no hay pedido.
7. Compra con 4242 → **NO MEDIDO** (§Bloqueo).

## 3 · Login C7 (solo con la cuenta de prueba propia)

| Hora (UTC) | Intento | Respuesta | Aviso en pantalla |
|---|---|---|---|
| ~05:41 | 1–5, seguidos | `401` ×5 | «Correo o contraseña incorrectos.» |
| ~05:41 | 6, seguido | `429` | «Demasiados intentos seguidos. Vuelve a intentarlo en 1 minuto.» — **sin enlace** (`c7-demasiados-intentos.png`) |
| 05:43:08 | 7 (pasada la ventana por IP) | `401` `INVALID_CREDENTIALS` | «Correo o contraseña incorrectos.» |
| 05:43:41 | 8 | `429` `TOO_MANY_PASSWORD_ATTEMPTS`, `Retry-After: 88` | «Demasiados intentos con este correo. Vuelve a intentarlo en 2 minutos, o restablece tu contraseña.» + enlace **«Restablecer contraseña» → `/es/forgot-password`** (`c7-tope-cuenta.png`) |

**Veredicto: OK.** El aviso por cuenta con enlace existe y sale con el código correcto. Cuadra con el contrato
(`docs/API_CONTRACT.md:8399+`: «5 libres (el 5.º ya deja puesto el candado)», candado `60 s · 2^(f−5)`). El 5.º fallo
puso un candado de 60 s que ya había vencido a las 05:43:08. Ese 6.º fallo contado devolvió 401 y dejó un candado de
120 s. El intento siguiente, 33 s después, recibió 429 con `Retry-After: 88`.

**Matiz para el dueño / ux-ui (no es defecto de código, es lo que ve un usuario real):** con 6 intentos **seguidos**
desde la misma IP, el 6.º lo frena antes el **tope por IP** (`@Throttle` 5/min en `auth.controller.ts`, código
`RATE_LIMITED`). Así que el usuario ve el aviso **sin** enlace a restablecer (`AuthForm.tsx` lo decide así a
propósito: restablecer no levanta el tope por IP). El aviso con enlace solo aparece si los intentos se espacian más
de ~1 min. Si se quiere que el enlace aparezca en el caso «6 seguidos», hay que decidirlo (diseño, no bug).

## 4 · Vender (buylist), escritorio 1440 px

- `/es/buylist` sin sesión: cotizar es libre; para enviar pide cuenta con correo verificado. **OK**.
- Lista de sets: rejilla de **4 columnas** (`grid-template-columns` de 4 pistas, 20 sets por página, «Página 1 de 9
  · 176 sets»). **OK** (`buylist-desktop.png`).
- Set Twilight Masquerade: rejilla de **5 columnas** (373 tarjetas, 5 por fila). Los códigos se muestran como
  **«TWM 130 · HOLOFOIL»** (Dragapult ex, MX$11.05), con espacio no separable entre «TWM» y el número. **OK**
  (`buylist-twm130.png`).
- No envié ninguna solicitud de venta ni subí datos de identidad.

## 5 · Cabeceras

`curl -sI https://tcghunt.mx/` (05:34 UTC) → `HTTP/2 307`, `content-security-policy: frame-ancestors 'none'`,
`x-frame-options: DENY`. Y `/es` → además `referrer-policy: strict-origin-when-cross-origin` y
`x-content-type-options: nosniff`. **OK**.

## Ruido del entorno (no es de la tienda)

Chromium recibió `502` esporádicos en algunos recursos (`/_next/static/chunks/*.js`, una vez el documento
`/es/checkout`). Repetido con `curl` directo: **12/12 `200`** (`server: Vercel`). El 502 venía del proxy de salida de
mi entorno bajo la concurrencia del navegador, no de Vercel. Los pasos afectados se repitieron, y ningún resultado de
arriba depende de una carga con 502.

## Capturas (`docs/specs/prueba-vivo-s5/`)

`g-checkout.png`, `g-guestform.png` (formulario vacío), `registro.png`, `header-sesion.png`, `checkout-cuenta.png`,
`mis-pedidos.png`, `mi-boveda.png`, `c7-demasiados-intentos.png`, `c7-tope-cuenta.png`, `buylist-desktop.png`,
`buylist-twm130.png`. Ninguna lleva datos de tarjeta, porque no se tecleó ninguna.

## Restos en producción que el dueño puede reconocer

- Cuenta de cliente **`qa-vivo-s5+1@example.com`** («QA Vivo S5»), creada a las ~05:39 UTC. Sin pedidos, sin
  bóveda, sin direcciones. Su correo es de un dominio reservado: el correo de bienvenida/verificación, si se envió,
  rebota. El dueño puede darla de baja cuando quiera.
- En su bitácora, el candado C7 de esa cuenta (8 intentos fallidos, 05:41–05:43 UTC).
