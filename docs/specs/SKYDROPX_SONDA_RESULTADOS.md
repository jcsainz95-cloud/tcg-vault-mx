# Skydropx — resultados de la sonda de solo lectura en PRODUCCIÓN (D0, M-PRD-1…6)

- **Fecha de medición:** 2026-10-04.
- **Qué se corrió:** `scripts/skydropx/run-prod-probe.sh` (DEVOPS_NOTES §78) sobre el árbol `f999633`
  (rama `claude/skydropx-d`), contra `https://pro.skydropx.com` (URL de referencia; `SKYDROPX_BASE_URL` no estaba
  puesta). Autorización: el dueño, el 2026-10-04, para medir la cuenta de producción **sin gastar saldo**.
- **Orden y resultado:** `test` ⇒ **6/6 verde** · `dry-run` ⇒ 48 peticiones contra el doble, todas token,
  cotización o GET (1 `POST /oauth/token`, 18 `POST /quotations`, 29 GET) · `run` (completa) ⇒ **salida 0** ·
  `run --only M-PRD-1` (segunda tanda de valores) ⇒ **salida 0**.
- **Redacción:** este informe no lleva credenciales, token, ids de cotización/tarifa/plantilla (salen como huella
  `fp:` en el log de la sonda y aquí se omiten), ni datos de direcciones de la cuenta.

## Saldo (la garantía de cero gasto)

| Corrida | Saldo antes | Saldo después | ¿Cambió? |
|---|---|---|---|
| 1 · completa (M-PRD-1…6) | 965.16 MXN | 965.16 MXN | **No** |
| 2 · `--only M-PRD-1` | 965.16 MXN | 965.16 MXN | **No** |

`GET /api/v1/finance/credits` ⇒ HTTP 200 en las cuatro lecturas. Token: HTTP 200, `expires_in` 7200, `scope`
`default`, `token_type` `Bearer`.

## M-PRD-1 · Seguro (`package_protected: true` + `declared_value`)

Cotización 14210 → 06600, paquete 25×18×*h* cm, 1 kg, alto distinto por petición. **En las 24 filas** la cotización
volvió `201`, completa, con eco `package_protected: true` y `declared_value` igual al pedido, **sin reintentos**, y
todas las tarifas exitosas traían **un solo** `protection_value_total`, igual al `protection_value` del paquete
(el seguro no depende de la paquetería).

| Valor declarado (MXN) | Seguro (`protection_value`, MXN) | Cociente | Corrida |
|---:|---:|---:|:-:|
| 2,500 | 25.00 | 1.000 % | 1 |
| 2,501 | 25.01 | 1.000 % | 1 |
| 3,000 | 30.00 | 1.000 % | 1 |
| 5,000 | 50.00 | 1.000 % | 1 |
| 5,001 | 120.01 | 2.400 % | 2 |
| 5,500 | 125.00 | 2.273 % | 2 |
| 6,000 | 130.00 | 2.167 % | 2 |
| 6,500 | 135.00 | 2.077 % | 2 |
| 7,000 | 140.00 | 2.000 % | 2 |
| 7,499 | 144.99 | 1.933 % | 2 |
| 7,500 | 145.00 | 1.933 % | 1 |
| 10,000 | 170.00 | 1.700 % | 1 |
| 10,001 | 170.01 | 1.700 % | 1 |
| 15,000 | 220.00 | 1.467 % | 1 |
| 20,000 | 270.00 | 1.350 % | 1 |
| 30,000 | 370.00 | 1.233 % | 1 |
| 50,000 | 570.00 | 1.140 % | 1 |
| 100,000 | 1,070.00 | 1.070 % | 1 |
| 150,000 | **0** | — | 2 |
| 200,000 | **0** | — | 2 |
| 300,000 | **0** | — | 2 |
| 500,000 | **0** | — | 2 |
| 1,000,000 | **0** | — | 2 |
| 5,000,000 | **0** | — | 2 |

**Regla que encaja con las 18 filas con seguro** (inferida de esos puntos; no es una tabla publicada por Skydropx):

- **V ≤ 5,000:** seguro = **1 % de V**.
- **5,000 < V ≤ 100,000** (al menos): seguro = **1 % de V + 70 MXN**. El salto de +70 ocurre **entre 5,000 y 5,001**
  (medido en ambos lados). No hay más escalones: entre 5,001 y 100,000 todos los puntos caen exactamente en la recta.
- **V ≥ 150,000:** la cotización **sigue diciendo `package_protected: true`** y hace eco del valor declarado, pero
  `protection_value` = **0** en el paquete y en todas las tarifas. ⚠️ Es decir: **por encima del tope Skydropx no
  rechaza; cotiza un seguro de 0**. Si el backend solo mira `package_protected` en el eco, creería que el envío va
  asegurado cuando no lo va.
- **Tope máximo:** está **entre 100,000 (asegura) y 150,000 (seguro 0)**. El valor exacto es **NO MEDIDO** (ver abajo).

## M-PRD-2 · Reutilización de cotizaciones

Cuatro cotizaciones idénticas (V = 2,500), las dos últimas con `order_id` distinto cada una: las cuatro `201` y las
**cuatro con el mismo id** (`controlReused: true`, `orderIdBreaksReuse: false`, `twoOrderIdsDiffer: false`).
⇒ **`order_id` no rompe la reutilización**; lo único que la rompió en esta sonda fue cambiar las dimensiones (el alto).
El estado para el seguimiento a +1 h y +25 h quedó guardado en el scratchpad de la sesión (no en el repo).

## M-PRD-3 · Plantillas de dirección y verificación de origen

- `GET /address_templates` ⇒ 200; la cuenta tiene **una** plantilla, de tipo `from`, **no** marcada como predeterminada.
- Cotizar con la plantilla de origen, en las dos formas:

| Forma | HTTP | `requires_origin_verification` (arriba) | Tarifas que la exigen | Eco de la plantilla | Tarifas exitosas |
|---|---|---|---|---|---|
| `address_template_from_id` arriba | 201 | `true` | 4 de 33 | **no** vuelve | 8 |
| `address_from.address_template_id` | 201 | `true` | 4 de 33 | **sí** vuelve | 8 |

⇒ La forma que la API reconoce (hace eco) es **`address_from.address_template_id`**. Aun con la plantilla, la cuenta
sigue con `requires_origin_verification: true` (4 de 33 tarifas lo exigen).

## M-PRD-4 · Cargos extra

`GET /api/v1/finance/extra-charges` (con guion) ⇒ **200**. Forma: `data` = lista **vacía**; `meta` =
`{current_page, next_page, prev_page, total_count, total_pages}` (números / null). No hizo falta probar `extra_charges`.

## M-PRD-5 · Puntos de entrega (`office_points`)

`GET /office_points?rate_id=…&direction=delivery` con una tarifa de M-PRD-1 ⇒ **200**, `data` = lista **vacía**,
`meta` = `{total}`. ⇒ El endpoint existe y responde, pero para 06600 con esa tarifa no devolvió puntos.

## M-PRD-6 · Búsqueda de envíos

`GET /api/v1/shipments` sin filtro y con `reference`, `q`, `search`, `filter[reference]`, `external_reference`
⇒ **200 en los seis**, `total_count` = **0** en los seis, `meta` con las mismas claves de paginación. Como la cuenta
**no tiene envíos**, esta medición **no distingue** qué parámetro filtra de verdad (un filtro ignorado y uno que
filtra dan ambos 0).

## Qué quedó sin medir

1. **El tope exacto del seguro** (entre 100,000 y 150,000 MXN). La tercera tanda (100,001 · 105,000 · 110,000 ·
   120,000 · 125,000 · 130,000 · 140,000 · 149,999, más 1 · 100 · 1,000 · 5,000.01) **no se corrió**: el entorno
   bloqueó esa ejecución por política de permisos. Cerrarla es una corrida más de cotizaciones:
   `run-prod-probe.sh run --only M-PRD-1 --height-base 60 --values 100001,105000,110000,120000,125000,130000,140000,149999`.
2. **El extremo bajo** (V < 2,500): ¿hay mínimo de seguro? NO MEDIDO (misma tanda).
3. **La duración de la reutilización** (M-PRD-2 a +1 h y +25 h): requiere `--followup` más tarde. NO MEDIDO.
4. **Qué parámetro de `/shipments` filtra por referencia** (M-PRD-6): no se puede medir con 0 envíos en la cuenta.
5. **Si un seguro de 0 por encima del tope protege algo** al comprar la guía: solo se sabría comprando. ⛔ No se
   compró nada (prohibido sin autorización del dueño guía por guía, `HECHOS.md:48`).
