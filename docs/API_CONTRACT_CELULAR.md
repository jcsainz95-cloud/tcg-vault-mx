# API_CONTRACT_CELULAR — celular obligatorio (§CELULAR en `docs/DECISIONES.md`; 2026-11-22)

## 1. Helper (única fuente; `backend/src/modules/users/phone-mx.ts`)
- `normalizeMxPhone(raw: unknown): string | null` — solo strings; quita espacios, `-`, `.`, `(`, `)`; quita `+52`; quita `52` solo si quedan 12 dígitos; quita `521` si quedan 13; devuelve los 10 dígitos o `null` si no cumple `^\d{10}$` o es falso obvio (dígitos todos iguales, `1234567890`, `0123456789`, primer dígito 0 o 1).
- `isValidMxPhone(raw)` = `normalizeMxPhone(raw) !== null`. El front tiene su copia en `frontend/src/lib/phone.ts` con la misma tabla de casos (misma lista de pruebas en ambos).
- Tabla de pruebas: `55 1234 5678`→`5512345678`; `+52 55-1234-5678`→ídem; `525512345678`→ídem; `5215512345678`→ídem; `5212345678`→`5212345678` (10 dígitos, no se recorta); `0000000000`/`1234567890`/`1555555555`/`abc`/`""`/`null`/`123`→inválido.

## 2. Cambios de contrato
| Ruta | Rol | Cambio |
|---|---|---|
| `POST /auth/register` | público | `phone` OBLIGATORIO (string); inválido ⇒ 422 `PHONE_INVALID`. Respuesta: `user.phoneRequired:false`. |
| `POST /auth/register/email-only` | público | `phone` OPCIONAL (el del domicilio del checkout); válido ⇒ se guarda normalizado; ausente/inválido ⇒ se crea con `phone:null` y `phoneRequired:true` (NO 422: no se pierde la compra). |
| `POST /auth/login`, `POST /auth/google` | público | El `user` devuelto incluye `phoneRequired: boolean`. Google crea con `phone:null`. |
| `GET /users/me` | cuenta | Agrega `phoneRequired: boolean` (derivado). `phone` se devuelve tal cual está guardado. |
| `PATCH /users/me` | cuenta | `phone`: si viene, string que normaliza a válido; se guarda normalizado. Vacío, null, no-string o inválido ⇒ 422 `PHONE_INVALID` `details:{field:"phone"}`. Nunca anula. Respuesta incluye `phoneRequired`. |
| `PATCH /admin/users/:id/phone` | admin | Body `{phone}`; misma validación; no vacía; escribe auditoría con valor enmascarado. 404 si no existe. |
| Alta de cliente M6 (`admin.service.ts:805`) | admin | `phone` obligatorio y válido; si no ⇒ 422 `PHONE_INVALID`. |
| `GET /admin/users/:id` | staff | Devuelve `phone` completo (ya dato de contacto del cliente) y `phoneRequired`. |
| `POST /checkout/quote`, `POST /checkout/session`, crear retiro, crear solicitud de buylist | cuenta | Guard `@RequirePhone()`: `!isValidMxPhone(user.phone)` ⇒ 422 `PHONE_REQUIRED` `details:{field:"phone"}` antes de cualquier efecto. Buylist (`buylist.service.ts:1674-1690`) sustituye su revisión nulo/vacío por el helper. |
Códigos nuevos en `error-codes.ts`: `PHONE_INVALID` (422). `PHONE_REQUIRED` ya existe (422). Sin schema ni migración.

## 3. Pantalla «Completa tu celular» (frontend dibuja ambas; el dueño elige con renders)
Contenido común: título «Completa tu celular»; texto «Lo usamos para avisarte de tus pedidos, retiros y ventas. Solo lo ve TCG HUNT.»; campo de teléfono con prefijo fijo «+52» visible, `inputMode="tel"`, `autoComplete="tel-national"`, normaliza al escribir y al pegar (`52…`, `+52…`, guiones, espacios), tope 10 dígitos; prellenado con el celular de la dirección predeterminada si es válido; error en línea (`PHONE_INVALID`: «Escribe tu celular de 10 dígitos»); botón primario «Guardar y continuar» (deshabilitado hasta 10 dígitos válidos; llama `PATCH /users/me`); enlace secundario «Cerrar sesión» (único escape). Textos en `es.json` y `en.json`. Foco inicial en el campo; Enter envía; `role="dialog"`/`aria-live` para el error.
- **Variante A — pantalla completa:** ruta `/completa-celular?next=<ruta relativa>` (`next` validado: empieza con `/`, no `//`, sin esquema; si no, `/cuenta`). Encabezado mínimo con logo, sin menú; tarjeta centrada en móvil y escritorio. Un guard de layout redirige a esta ruta toda ruta con sesión cuando `phoneRequired`. Al guardar, `router.replace(next)`.
- **Variante B — modal sobre la página:** overlay a nivel de layout, sin cambiar la URL; fondo atenuado y desenfocado, sin botón de cerrar ni cierre por Esc/clic fuera; focus trap. Al guardar se cierra y la página debajo ya está donde el usuario iba (checkout intacto). Mismo componente `PhoneGateForm` en ambas.
- Recomendación del arquitecto: B (no toca la URL ni el flujo del checkout, menos código de retorno); A es más simple de probar. Ambas deben pasar: carrito conservado, Google/correo/solo-correo, sesión vieja con 422.

## 4. Medición y privacidad
El celular no va a `dataLayer`, GA4, Meta Pixel/CAPI ni a la URL. Eventos permitidos sin valor: `phone_gate_shown`, `phone_gate_done`. Logs y auditoría enmascaran (`******1234`). Prueba de CI: ningún `dataLayer.push`/`fbq` recibe un objeto con `phone`.

## 5. Reparto
- **backend:** helper + pruebas; DTOs de registro/PATCH/alta solo-correo/alta M6; `phoneRequired` en `/users/me` y respuestas de auth; guard `@RequirePhone()` en las 4 rutas de dinero; `PHONE_INVALID`; `PATCH /admin/users/:id/phone` + auditoría; seeds con celular válido; pruebas de las tablas de §1 y de «no se puede vaciar».
- **frontend:** `lib/phone.ts` y `PhoneGateForm`; la variante elegida (ambas se dibujan primero); guard de layout; `AuthForm.tsx` pide celular en el registro; `ProfileSection.tsx` y `BuylistKycForm.tsx` sin `maxLength`, con normalización, sin permitir vaciar; formulario de vender con reintento de un clic ante 422; M6 muestra/edita celular y el alta lo pide; mock de buylist con `PHONE_REQUIRED`; tipos en `api.ts`; eventos sin valor.
- **qa + seguridad-lead:** gates por `orders`/`buylist`; pruebas de IDOR en `PATCH /admin/users/:id/phone` y de fuga a medición.
