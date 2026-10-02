# Brazo de red — sesión 5 (entorno «Internet Access»)

Medición hecha por la sesión-brazo en el entorno «Internet Access», a petición del orquestador de la sesión 5.
Solo medición; no se tocó código. Ningún valor de variable, token ni cabecera de autenticación aparece aquí.

**Fecha/hora de medición:** 2026-09-29T18:54:37Z (UTC) · árbol en `5321b8c` (rama `claude/brazo-red-s5`).

## 1. Alcance de red

Comando: `for u in …; do curl -sS -m 20 -o /dev/null -w '%{http_code}\n' $u; done`

| URL | Código HTTP | Lectura |
|---|---|---|
| `https://tcghunt.mx/` | **307** | Responde (redirección temporal; la red llega) |
| `https://sb-pro.skydropx.com/` | **302** | Responde (redirección; la red llega) |
| `https://docs.skydropx.com/` | **301** | Responde (redirección permanente; la red llega) |
| `https://api.stripe.com/` | **404** | Responde (404 esperado en la raíz de la API) |

Contraste con `HECHOS.md` fila «Entorno» (sesión 4): allí las tres primeras daban **000**. En este entorno
**las cuatro responden**. No se siguieron las redirecciones (fuera del encargo) — **NO MEDIDO** a dónde llevan.

## 2. Variables `SKYDROPX*`

- `env | grep -c SKYDROPX` → **0**
- Nombres: **ninguno**.

Las credenciales del sandbox (`SKYDROPX_CLIENT_ID`, `SKYDROPX_CLIENT_SECRET`, `SKYDROPX_BASE_URL`) **no están
cargadas** en este entorno a la fecha de esta medición. PS-SBX no puede correrse autenticado hasta que el dueño
las cargue en la configuración del entorno «Internet Access» (y arranque una sesión nueva, o se re-mida aquí).

## 3. Proxy de salida

- `HTTPS_PROXY` definida: **sí**.
- `__agentproxy/status` → `recentRelayFailures`: **`[]`** (sin fallos recientes).

## Re-medición 2026-10-02

**Fecha/hora de medición:** 2026-10-02T15:36:24Z (UTC) · árbol en `5815b6b` (rama `claude/brazo-red-s5`).
Solo medición; sin tocar código.

| Paso | Comando | Resultado |
|---|---|---|
| 1 | `env \| grep -c SKYDROPX` | **0** |
| 1 | `env \| grep SKYDROPX \| cut -d= -f1` | **ninguno** |
| 2 | `curl -sS -m 20 -o /dev/null -w '%{http_code}\n' https://sb-pro.skydropx.com/` | **302** (la red llega; igual que 2026-09-29) |
| 3 | Token OAuth `client_credentials` al sandbox | **NO CORRIDO** — faltan las tres variables (`SKYDROPX_CLIENT_ID`, `SKYDROPX_CLIENT_SECRET`, `SKYDROPX_BASE_URL`) |

**Lectura:** a esta hora las credenciales del sandbox **no están en el entorno de esta sesión**. Las variables
del entorno se leen al **arrancar** el contenedor: si el dueño las cargó en la configuración del entorno
«Internet Access» después de que arrancó esta sesión, aquí no aparecen y hace falta **una sesión nueva** para
verlas. **NO MEDIDO** si ya están guardadas en la configuración del entorno (desde dentro solo se ve `env`).
Medición que lo cerraría: repetir el paso 1 en una sesión creada después de guardarlas.

No se pidieron guías, cotizaciones ni compras.
