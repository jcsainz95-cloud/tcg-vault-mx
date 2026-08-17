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
