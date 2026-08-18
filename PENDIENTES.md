# PENDIENTES — TCG Vault MX

Lista viva de cosas que el humano va observando en el producto. Se van moviendo a "En curso" /
"Hecho" cuando se aborden. Añade nuevos como `P-#`.

---

## Abiertos

### P-1 · Botón de "Cerrar sesión" en admin
- **Observado:** no hay forma de cerrar sesión desde el panel de admin.
- **Qué implica:** añadir un botón "Cerrar sesión" en el header del admin (limpia el token/sesión y
  redirige a login). Frontend (layout/topbar de admin). Tamaño: pequeño.

### ~~P-2 · Barra de avance al sincronizar catálogo~~ ✅ HECHO Y EN `main`
- **Observado:** al sincronizar no se sabía cuánto faltaba ni cuándo terminaba ("a ciegas") y el
  banner "encolado" se leía como "listo".
- **Resuelto:** `GET /admin/catalog/sync-status` expone `{running, total, done, startedAt, finishedAt}`
  (estado en memoria; no audita ni pega a pokemontcg.io; documentado en contrato §M2 v1.10). M2 lo
  pollea cada 3 s mientras corre, pinta una barra honesta `done/total` + "corre en segundo plano", y al
  terminar muestra "completada". La columna Cartas ahora muestra `cardCount / printedTotal` por set.
  Triple veredicto APROBADO (qa+techlead+seguridad) y promovido a `main`. Deuda: BE-11/BE-12, FE-9/FE-10.

### P-3 · No aparecen todas las versiones/acabados de la misma carta al dar de alta
- **Observado:** al **dar de alta** inventario, en el set **"Pitch Black"** salen **pocas opciones**,
  pero aparecen **120 sincronizadas**. Hay desajuste entre lo sincronizado y lo que ofrece el alta.
- **Qué implica:** revisar el flujo de alta (M1): el selector no está mostrando todas las cartas/
  versiones/acabados del set aunque estén en catálogo. Investigar backend (qué devuelve el buscador de
  alta: ¿filtra de más? ¿no pagina? ¿no trae los acabados?) y frontend (cómo lo pinta). Bug real.
  Relacionado con el tema recurrente de "acabados/versiones" del cotizador.

### Nota 2026-08-18 · Variantes/orden del master set — HECHO Y EN `main` (rama `fix/variantes-y-orden-master-set`)
- **Qué se cerró (doble veredicto QA+techlead, verificado en navegador):** cada carta del binder
  (cotizador, M1, bóvedas) muestra **una casilla de imagen por variante real** (normal izquierda,
  reverse holo derecha; sin relleno); el orden es **por número** (M-26, persistido en BD, paginación
  determinista); en admin el alta dice y hace **«Dar de alta al inventario»** con resultado visible
  dentro del modal (antes el paso de confirmación quedaba tapado por el overlay: por eso «no pasaba nada»).
- **Causa de fondo de que solo se pintara una variante:** `availableFinishes` se derivaba de PRECIOS
  (y el price-ingest lo sobrescribía con solo lo que tenía precio). Ahora la única autoridad es el
  sync de catálogo. **⚠ ACCIÓN REQUERIDA EN PROD:** los sets ya importados siguen en `['normal']`
  hasta re-sincronizar: `POST /api/v1/admin/catalog/sync-all` con body `{"force": true}` como
  super_admin (detalle en `docs/BACKEND_NOTES.md §49.7`). Sin ese re-sync, Pitch Black seguirá
  mostrando una sola casilla por carta.
- **Relación con P-3/P-4:** ataca la parte de «acabados/versiones» de P-3 y el patrón de «no pasa
  nada» de P-4 en el flujo del master set; el alta clásica (formulario «Alta de item») y el resto de
  P-3/P-5 siguen abiertos como están anotados.

### P-4 · Al crear inventario y dar "Crear" no pasa nada (sin confirmación)
- **Observado:** das de alta un item, clic en **Crear**, y **no hay ningún mensaje** (ni éxito ni error);
  no se sabe si se creó.
- **Qué implica:** puede ser (a) el guardado **falla en silencio** (error no mostrado), o (b) sí crea
  pero **falta el aviso de confirmación** y/o refrescar la lista. Frontend (manejo de la respuesta del
  submit + toast) y backend (¿responde OK o error?). **Bug real.**

### P-5 · Alta masiva (varias cartas a la vez, no una por una)
- **Observado:** hoy el alta es **de una en una**; debería poder darse de alta **varias al mismo tiempo**.
- **Qué implica:** selección múltiple / carga por lote en el alta (M1). Frontend (UI de multi-selección)
  + backend (endpoint de alta en lote, o reusar el actual en bucle). Tamaño: mediano.

> **Nota:** P-3, P-4 y P-5 son todos del **flujo de alta de inventario (M1)** y apuntan a que esa
> pantalla tiene un problema de fondo (no muestra todo, no confirma, no permite lote). Conviene
> atacarlas juntas en una ronda cuando se decida.

### P-6 · El proveedor de precios de PAGA no escribe ni un precio: el adapter llama mal a su API
- **Observado:** con la API de paga (PokemonPriceTracker) ya contratada, la key en Railway,
  `POKEMONPRICETRACKER_MARKET_FORMAT=usd_dollars` puesta y el dial `price_provider` ya flipeado desde M2,
  el cotizador **sigue mostrando "Precio pendiente"**. El PO verificó que el proveedor **sí tiene** los
  precios del set. Las cartas que sí muestran importe (MX$1.00 / MX$0.50) son pisos fijos por rareza y
  **enmascaran** el problema: no pasan por el mercado.
- **Diagnóstico (devops, `DEVOPS_NOTES §23.9`):** el adapter hace
  `POST /api/v1/cards/bulk-price` con `{ set, limit, page }`, pero ese endpoint del proveedor espera una
  **lista explícita** `{ cardIds: [...] }`. El barrido por set es otro endpoint:
  `GET /api/prices?setId=<ids>&limit=<n>` → `{ data, pagination }`. Con el cuerpo no reconocido el
  proveedor responde 4xx, el `catch` money-safe devuelve **0 filas sin borrar nada**, y el resultado es
  cero `PriceReference` → todo lo que cotiza por regla `pct` queda pendiente. Son exactamente los tres
  `SUPUESTO (verificar 1ª corrida)` que el propio adapter dejó anotados.
- **Qué implica:** cambio **acotado en backend** (`modules/pricing/providers/pokemonpricetracker-bulk.provider.ts`):
  cambiar el request a `GET /api/prices?setId=…` paginando por `pagination`, verificar que `cardNumber`
  del proveedor empate con `resolveCardId` (`"104"` vs `"104/159"`) y ajustar el tope real de `limit`.
  El mapeo probablemente NO se toca (ya lee `marketPrice` y `printing`). Ninguna palanca de devops
  (dial, env, cron) puede arreglarlo: el request sale mal formado desde el código.
- **Estado de la verificación (honesto):** causa **probable**, no confirmada en runtime — el egress del
  sandbox bloquea el dominio del proveedor, así que la fuente es su documentación pública, no una corrida.
  **Confirmación barata (1 línea):** filtrar `PokemonPriceTracker` en los Deploy Logs de Railway →
  `set <id> falló: HTTP 400/404 … Se devuelven 0 filas` confirma el diagnóstico; si en cambio aparece
  `ejemplo de entrada cruda`, el request sí pasó y el problema sería de **mapeo**, no de endpoint.
- **A decidir por el humano:** (a) lanzar ya al rol **backend** con esta especificación, (b) pedir primero
  esa línea de log para confirmar antes de gastar el turno, o (c) dejarlo en cola y seguir con los
  pendientes de M1 (P-3/P-4/P-5). **Bloquea** que el catálogo tenga precios de referencia: hoy el
  proveedor legacy (pokemontcg.io) responde 500/502 en masa, así que sin este fix **no hay ninguna fuente
  de precios viva**. Lo ya configurado (dial, `MARKET_FORMAT`, scheduler) sirve tal cual cuando se arregle.
- **NO tocar:** las reglas de buylist (`BUYLIST_PRICE_RULES` / fallback) están como el PO las quiere —
  el problema es la referencia de mercado que alimenta la regla, no la regla.

---

## En curso / Hecho (referencia)
- **Gráfica pública de valor de set** — hecha y desplegada; falta encenderla con datos (runbook `DEVOPS_NOTES §17`).
- **Fix de seguridad (cifrado INE) + reparación de CI** — ✅ fusionado a `main`. Deuda de CI (poda de imagen
  Docker, self-host de fuente, E2E) aceptada y anotada.
- **P-11 · Gating temprano del flujo de venta** — ✅ triple veredicto APROBADO y en `main`. El cotizador
  comunica los requisitos (sesión, correo verificado, CLABE/INE) ANTES de enviar, en vez de reventar con
  un 403 críptico al final. Deuda menor anotada: FE-7, FE-8, FE-11.
- **Fix contrato `clabeMasked`** — ✅ en `main`. `GET /users/me/kyc` devolvía la CLABE enmascarada bajo la
  clave `clabe`; el contrato/front usan `clabeMasked`, así que el hint "CLABE ya registrada" nunca aparecía.
- **P-2 · Status del barrido de catálogo** — ✅ en `main` (ver arriba).
