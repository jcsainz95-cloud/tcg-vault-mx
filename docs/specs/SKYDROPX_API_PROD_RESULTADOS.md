# Skydropx PRO API (producción): resultados de la medición

> **Procedencia:** sesión `claude/skydropx-api-prod`, **2026-10-04, 03:58–04:03 UTC** (21:58–22:03 del
> 2026-10-03, hora de la Ciudad de México), encargo del orquestador con la autorización del dueño del
> 2026-10-04 (medir la API de producción **sin gastar saldo**). Solo `POST /oauth/token`, cotizaciones y
> lecturas `GET`. **No se creó ningún envío, guía, recolección ni orden.** Ninguna credencial ni token
> aparece en este fichero; los ejemplos están recortados y sin datos personales.
>
> **Saldo de la cuenta:** `GET /finance/credits` = **$965.16 MXN** al empezar (04:01:15Z) y al terminar
> (04:02:42Z). Es el mismo saldo que registró la prueba del panel (`SKYDROPX_PRUEBA_PANEL_RESULTADOS.md`).
>
> **Instrumento:** script Python (stdlib) en el scratchpad de la sesión, con ≥0.6 s entre peticiones
> (<2 req/s), redacción de credenciales y token en toda salida, y respuestas crudas guardadas solo en el
> scratchpad (no en el repo). Total: unas 120 peticiones.

## 0. Antecedente: primer intento fallido (2026-10-04, antes de esta medición)

| Fecha/hora (UTC) | Endpoint | HTTP | Respuesta |
|---|---|---|---|
| 2026-10-04 (ver `git log` de este fichero, commit `cc676be`) | `POST {SKYDROPX_BASE_URL}/oauth/token` (`grant_type=client_credentials`, form-urlencoded) | **401** | `{"error":"invalid_client","error_description":"La autenticación del cliente ha fallado por cliente desconocido, cliente no autenticado, o método de autenticación incompatible."}` |

Causa medida entonces: `SKYDROPX_CLIENT_ID` y `SKYDROPX_CLIENT_SECRET` medían 12 y 15 caracteres y eran texto
entre paréntesis con espacios (relleno). El dueño corrigió las variables el 2026-10-04.

## 1. Estado de las variables en esta medición (sin imprimir valores)

| Comprobación | Resultado |
|---|---|
| `env \| grep -c '^SKYDROPX_'` | **2** (no 3) |
| `SKYDROPX_CLIENT_ID` | 43 caracteres, sin espacios ni paréntesis |
| `SKYDROPX_CLIENT_SECRET` | 43 caracteres, sin espacios ni paréntesis |
| `SKYDROPX_BASE_URL` | **No está definida** en este entorno |

Como faltaba la URL base, se usó el host de producción de la referencia §1, **`https://pro.skydropx.com/api/v1`**,
que es el que tenía la variable en el intento anterior. **Pendiente para el dueño:** volver a añadir
`SKYDROPX_BASE_URL` a las variables del entorno (no es secreta).

## 2. Hallazgo de infraestructura: Cloudflare bloquea algunos User-Agent

| Hora (UTC) | Endpoint | HTTP | Respuesta |
|---|---|---|---|
| 03:58:18 | `POST /oauth/token` con el User-Agent por defecto de Python (`Python-urllib/3.x`) | **403** | Cloudflare `Error 1010: Access denied` · `browser_signature_banned` · «Do not retry» |
| 03:58:25 | La misma petición con `User-Agent: tcg-hunt-integration/0.1` | **200** | token (§3) |

**Consecuencia para backend:** el cliente HTTP de Skydropx debe mandar un `User-Agent` propio y explícito.
Si el User-Agent por defecto de `fetch`/undici de Node también está bloqueado es **NO MEDIDO**; mandarlo explícito
lo hace irrelevante.

## 3. Token — `POST /oauth/token`

| Hora (UTC) | HTTP | Tiempo | Campos de la respuesta |
|---|---|---|---|
| 03:58:25 | **200** | 261 ms | `access_token` (488 caracteres), `token_type`, `expires_in` = **7200**, `scope` = **`"default"`**, `created_at` (epoch) |

- **Duración: 7200 s (2 h)**, como dice la referencia. El `scope` real es `"default"`, no `"read write"` como
  en el ejemplo de la referencia.
- Formato que funcionó: `application/x-www-form-urlencoded` con `grant_type`, `client_id`, `client_secret`.
- Ejemplo redactado:
  ```json
  {"access_token":"[REDACTADO, 488 caracteres]","token_type":"Bearer","expires_in":7200,"scope":"default","created_at":1791086306}
  ```
- Las respuestas no traen cabeceras de rate limit (`X-RateLimit-*`, `Retry-After`) en las peticiones exitosas.
  Cómo se comporta un 429 es **NO MEDIDO** (no se forzó).

## 4. Cotizaciones — `POST /quotations` y `GET /quotations/{id}`

### 4.1 Forma de la respuesta (cierra la duda de la referencia §3.2)

- `POST /quotations` → **HTTP 201**, 400–900 ms. Devuelve la cotización **completa en su forma**, con
  `is_completed: false` y todas las tarifas ya listadas en `status: "pending"` (`amount`, `total`, etc. en `null`).
- **Es asíncrona con polling:** `GET /quotations/{id}` (HTTP 200) hasta `is_completed: true`. Con consultas cada
  1.5 s: **1 consulta (≈1.9 s) en la mayoría**, 2–4 consultas (3.7–7.4 s) en 5 de las 20 de §4.5; el máximo
  fue 7.4 s (29200, paquete B).
- **⚠️ La API reutiliza cotizaciones:** al repetir la misma ruta con las mismas medidas, `POST` devolvió **el
  mismo `id`** ya completado, **ignorando que cambió el seguro** (`package_protected`, `declared_value`). Se vio
  en 06600, 22000 y 64000, también entre `/api/v1` y `/api/v2`. Para medir el seguro hubo que cambiar el alto
  del paquete (§4.4). Cuánto dura esa reutilización es **NO MEDIDO**. **Consecuencia para backend:** no se puede
  confiar en que un cambio de valor declarado produzca una cotización nueva; hay que comprobar `packages[]` en
  la respuesta.
- Campos de primer nivel: `id`, `quotation_scope.carriers_scoped_to` (`"ALL_AVAILABLE"` sin
  `requested_carriers`), `is_completed`, `cash_on_delivery`, `recipient_pays_shipping`, `on_delivery_amount`,
  `address_template_from_id`, `address_template_to_id`, **`requires_origin_verification: true`**, `rates[]`,
  `packages[]` (este último aparece en el `GET`).
- **`requires_origin_verification: true`** en todas las cotizaciones desde 14210 sin plantilla de dirección. Qué
  exige al crear el envío es **NO MEDIDO** (no se creó ninguno). Probable relación con
  `POST /address_templates/{id}/verify_by_carriers` (referencia §4) — sin medir.
- Siempre se devolvieron **33 tarifas** por cotización (todas las combinaciones paquetería/servicio de la
  cuenta), con `success` y `status` por tarifa. `status` vistos: `price_found_internal`, `price_found_external`,
  `not_applicable` (con `error_messages[]`, p. ej. «max_weight debe ser mayor que o igual a 61»),
  `no_coverage` (p. ej. `CARRIER_COVERAGE_NOT_FOUND`), `pending` (antes de completar).
- Errores de validación: `422`-tipo con cuerpo `{"errors":{"parcel":{"weight":["no puede estar en blanco",…]}}}`
  (se vio con HTTP **422** al mandar `packages` en vez de `parcels`; la clave correcta es **`parcels`**).

### 4.2 Campos de cada tarifa (nombres exactos)

`id` (el `rate_id`), `success`, `status`, `rate_type`, `provider_name` (código, p. ej. `paquetexpress`,
`ninetynineminutes`, `punto_post`, `jtexpress`), `provider_display_name`, `provider_service_name`,
`provider_service_code`, `currency_code`, **`amount`**, **`extra_fees[]`** (`code`, `value`, `groupable`,
`group_code`; p. ej. `fuel_increase_fee`), **`vat_fee`**, **`service_fee`**, **`total`**, `external_price`,
`days`, `insurable`, `has_own_agreement`, `own_agreement_amount`, `zone`, `service_zone`, `country_code`,
`plan_type`, `packaging_type`, `error_messages`, `weight`, **`protection_value_total`**,
**`total_value_with_protection`**, `coupon`, **`pickup`**, `pickup_automatic`, `pickup_package_min`,
`pickup_ocurre`, **`pickup_via_support`**, `shipment_creation_type`, `office_delivery`, `office_pickup`,
**`office_delivery_only`**, `requires_origin_verification`.

Los importes vienen como **cadenas** (`"51.25"`), salvo `protection_value_total` (número) y `extra_fees[].value`
(número con 4–5 decimales).

### 4.3 El IVA viene desglosado (cierra §8.4 y M1 en la API)

Comprobado en las **283 tarifas exitosas** de las 23 cotizaciones de §4.5 y §4.4 (0 excepciones, tolerancia 1 centavo):

- **`vat_fee` = 16 % × (`amount` + suma de `extra_fees[].value`)**
- **`total` = `amount` + `extra_fees` + `vat_fee` + `service_fee`** — el `total` **trae el IVA incluido**.
- `service_fee` (la «tarifa de gestión» del panel) **no lleva IVA**.
- `external_price` = `total` − `service_fee`.

Ejemplo (FedEx Express Saver, 14210→06600, paquete A): `amount` 43.10 + combustible 0.7315 + `vat_fee` 7.01 +
`service_fee` 1.27 = **`total` 52.11**; `external_price` 50.84. Coincide con el desglose del panel.

Para el P&L: `shippingCostCents` ← `total`, `shippingCostIvaCents` ← `vat_fee` (la API **sí** expone la línea de IVA).
El seguro (`protection_value_total`) **no** está dentro de `total`; va aparte en `total_value_with_protection`.
Si el seguro lleva IVA es **NO MEDIDO**.

### 4.4 Seguro / valor declarado (T1)

| Hora (UTC, al guardar la respuesta) | Paquete (14210→44100) | `packages[]` devuelto | `protection_value_total` | Paquetexpress Nacional: `total` / `total_value_with_protection` |
|---|---|---|---|---|
| ≈04:00:56 | A, alto 4, `package_protected:true`, `declared_value:10000` | protegido, `declared_value "10000.0"`, `protection_value 170.0` | **170.0** | 51.25 / **221.25** |
| ≈04:01:00 | A, alto 5, `package_protected:false` | **no** protegido, `declared_value "2500.0"`, `protection_value 0.0` | **0.0** | 51.25 / **51.25** |
| ≈04:01:03 | A, alto 6, `package_protected:true`, `declared_value:2500` | protegido, `"2500.0"`, `25.0` | **25.0** | 51.25 / **76.25** |
| (todas las de §4.5) | **Sin** mandar `package_protected` ni `declared_value` | **protegido** con `declared_value "2500.0"` y `protection_value 25.0` | **25.0** | 51.25 / 76.25 |

- **La cotización acepta seguro y lo respeta** en cotizaciones nuevas: $2,500 → **$25**; $10,000 → **$170**.
- **Si no se manda nada, la API aplica protección de $2,500 (+$25) por defecto.** Es el ajuste «SOS Protección
  automática» del panel (M6): **sí aplica a la API**. Se **puede apagar por petición** con
  `package_protected: false` (→ $0). Que la guía creada respete ese `false` es **NO MEDIDO** (solo se cotizó).
- El seguro es igual para todas las paqueterías de una misma cotización (sale de Skydropx, no del carrier).
  `insurable` vino siempre `null`.

### 4.5 Paquete A y B a los 10 destinos (origen 14210 Jardines en la Montaña, Tlalpan, CDMX)

Paquete A = 25×18×3 cm, 1 kg (sobre de cartas). Paquete B = 49×23×21 cm, 5 kg (caja de 5 ETBs). Medidas del
panel (`SKYDROPX_PRUEBA_PANEL_RESULTADOS.md` paso 0). Sin `requested_carriers`. Precios en MXN con IVA, **sin**
el seguro de $25. «Recolección» = `pickup: true`. Cotizaciones de las 03:59:06–03:59:30 (A) y 03:59:37–04:00:08 (B) UTC (hora de envío del `POST`).

#### Paquete A

| Destino | Tarifas exitosas / total | 1.ª | 2.ª | 3.ª | 99minutos | Consultas (s) |
|---|---|---|---|---|---|---|
| 06600 | 14/33 | PuntoPost · Standard $1.19 (2 d, sin recolección, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day: $70.15 (2 d, sin recolección); Next Day Nacional: no_coverage | 0 (0.0)¹ |
| 64000 | 15/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (2 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $87.99 (2 d, sin recolección) | 1 (1.8) |
| 44100 | 14/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $87.99 (2 d, sin recolección) | 1 (1.9) |
| 72000 | 14/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $78.47 (2 d, sin recolección) | 1 (1.9) |
| 76000 | 14/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $78.47 (2 d, sin recolección) | 1 (1.9) |
| 97000 | 13/33 | ampm · Plataformas $51.25 (3 d, recolección) | Paquetexpress · Nacional $51.25 (4 d, recolección) | FedEx · Express Saver $52.45 (5 d, recolección) | Next Day Nacional: $133.17 (2 d, sin recolección) | 2 (3.7) |
| 77500 | 14/33 | Paquetexpress · Nacional $51.25 (4 d, recolección) | ampm · Plataformas $51.25 (4 d, recolección) | FedEx · Express Saver $52.45 (4 d, recolección) | Next Day Nacional: $133.17 (2 d, sin recolección) | 1 (2.0) |
| 22000 | 11/33 | Paquetexpress · Nacional $51.25 (5 d, recolección) | FedEx · Express Saver $52.52 (8 d, recolección) | Imile · Express $85.61 (2 d, recolección vía soporte) | **sin cobertura** | 1 (1.9) |
| 83000 | 12/33 | Paquetexpress · Nacional $51.25 (4 d, recolección) | ampm · Plataformas $51.25 (6 d, recolección) | FedEx · Express Saver $52.65 (4 d, recolección) | **sin cobertura** | 1 (1.9) |
| 29200 | 10/33 | Paquetexpress · Nacional $51.25 (4 d, recolección) | ampm · Plataformas $51.25 (7 d, recolección) | FedEx · Express Saver $52.32 (8 d, recolección) | **sin cobertura** | 1 (1.8) |

¹ Reutilizó la cotización de la primera prueba (03:58:37Z), que había tardado 1 consulta.

#### Paquete B

| Destino | Tarifas exitosas / total | 1.ª | 2.ª | 3.ª | 99minutos | Consultas (s) |
|---|---|---|---|---|---|---|
| 06600 | 12/33 | PuntoPost · Standard $1.19 (2 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day: $121.28 (2 d, sin recolección) | 3 (5.5) |
| 64000 | 12/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (2 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $158.14 (2 d) | 1 (1.9) |
| 44100 | 12/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $158.14 (2 d) | 1 (1.9) |
| 72000 | 12/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $137.92 (2 d) | 1 (1.9) |
| 76000 | 12/33 | PuntoPost · Standard $1.19 (4 d, solo sucursal) | ampm · Plataformas $51.25 (1 d, recolección) | Paquetexpress · Nacional $51.25 (3 d, recolección) | Next Day Nacional: $137.92 (2 d) | 1 (1.9) |
| 97000 | 11/33 | ampm · Plataformas $51.25 (3 d, recolección) | Paquetexpress · Nacional $51.25 (4 d, recolección) | FedEx · Express Saver $52.72 (5 d, recolección) | Next Day Nacional: $355.51 (2 d) | 1 (1.9) |
| 77500 | 11/33 | Paquetexpress · Nacional $51.25 (4 d, recolección) | ampm · Plataformas $51.25 (4 d, recolección) | FedEx · Express Saver $52.72 (4 d, recolección) | Next Day Nacional: $355.51 (2 d) | 2 (3.8) |
| 22000 | 9/33 | Paquetexpress · Nacional $51.25 (5 d, recolección) | FedEx · Express Saver $52.79 (8 d, recolección) | Imile · Express $85.61 (2 d, recolección vía soporte) | **sin cobertura** | 2 (3.8) |
| 83000 | 10/33 | Paquetexpress · Nacional $51.25 (4 d, recolección) | ampm · Plataformas $51.25 (6 d, recolección) | FedEx · Express Saver $52.96 (4 d, recolección) | **sin cobertura** | 1 (1.9) |
| 29200 | 9/33 | Paquetexpress · Nacional $51.25 (4 d, recolección) | ampm · Plataformas $51.25 (7 d, recolección) | FedEx · Express Saver $52.54 (8 d, recolección) | **sin cobertura** | 4 (7.4) |

Observaciones:

- **99minutos (T7):** aparece en la API con dos servicios, `Next Day` (solo local, 06600) y `Next Day Nacional`.
  **Cubre 7 de 10 destinos; no cubre TIJ, HMO ni SCLC.** Siempre `pickup: false` (sin recolección: hay que
  llevarlo a Punto99). Precio con paquete A: $70.15 (CDMX) a $133.17 (MID/CUN); con B: $121.28 a $355.51.
  **Nunca entre las 3 más baratas.** Siempre 2 días.
- **J&T Express no sale como disponible en la API.** Sus dos servicios llegan con precio (`Standard Sin
  Recolección` $51.25, igual que en el panel) pero con **`success: false`**, `status: "price_found_internal"`
  y `error_messages: null` en las 45 apariciones. El panel sí lo ofrecía. La causa es **NO MEDIDA**
  (¿no habilitado para API?). Se cierra preguntando a api@skydropx.com o al dueño en el panel.
- **ampm · Plataformas aparece con el paquete A** (sobre) en la API. En el panel solo salía con «Caja de cartón»
  (con «Saco (bolsa)» no aparecía). La cotización por API **no lleva tipo de empaque**; el empaque (`package_type`)
  se manda al crear el envío. Si ampm acepta luego un envío con empaque `5H4` (bolsa) es **NO MEDIDO**.
- Planes vistos en `plan_type`: `50PESOS_30042026` / `50PESOS_20052026` (la promo de $50), `PROMO_1_PESO_19082026`
  (PuntoPost $1.19) y `ACQ_2026` (tarifa normal). **Cuándo vence la promo es NO MEDIDO**, pero ese campo deja
  detectarlo en cada cotización.
- `pickup` / `pickup_via_support` / `office_delivery_only` vienen **en cada tarifa** (cierra la duda de M7:
  el dato «con/sin recolección» **sí lo expone la API**).
- Ningún `extra_fees` distinto de combustible (`fuel_increase_fee`, `fuel_increase_fee_1`) en ninguna
  cotización: **sin zona extendida** en los 10 destinos, igual que el panel (M4).

### 4.6 Ejemplo redactado — `GET /quotations/{id}` (14210→06600, A; 1 tarifa exitosa y 1 fallida de 33)

```json
{
  "id": "<uuid>",
  "quotation_scope": {"carriers_scoped_to": "ALL_AVAILABLE"},
  "is_completed": true,
  "cash_on_delivery": false, "recipient_pays_shipping": false, "on_delivery_amount": null,
  "address_template_from_id": null, "address_template_to_id": null,
  "requires_origin_verification": true,
  "packages": [{"package_number": 1, "weight": "1.0", "length": "25.0", "width": "18.0", "height": "3.0",
                "package_protected": true, "declared_value": "2500.0", "protection_value": 25.0}],
  "rates": [
    {"success": true, "id": "<uuid>", "rate_type": "default",
     "provider_name": "fedex", "provider_display_name": "FedEx",
     "provider_service_name": "Express Saver", "provider_service_code": "<código>",
     "status": "price_found_internal", "currency_code": "MXN",
     "amount": "43.10", "service_fee": "1.27", "vat_fee": "7.01", "total": "52.11", "external_price": "50.84",
     "extra_fees": [{"code": "fuel_increase_fee", "value": 0.7315, "groupable": false, "group_code": null}],
     "days": 2, "insurable": null, "has_own_agreement": false, "own_agreement_amount": null,
     "zone": "1", "service_zone": "1", "country_code": "MX", "plan_type": "50PESOS_30042026",
     "packaging_type": "package", "error_messages": null, "weight": "1.0",
     "protection_value_total": 25.0, "total_value_with_protection": "77.11", "coupon": null,
     "pickup": true, "pickup_automatic": false, "pickup_package_min": 0, "pickup_ocurre": true,
     "pickup_via_support": false, "shipment_creation_type": "single",
     "office_delivery": true, "office_pickup": false, "office_delivery_only": false,
     "requires_origin_verification": false},
    {"success": false, "id": "<uuid>", "provider_name": "paquetexpress",
     "provider_service_name": "Express Next Day", "status": "no_coverage",
     "amount": null, "total": null, "days": null,
     "error_messages": [{"module": "carser_response", "error_type": "CARRIER_COVERAGE_NOT_FOUND",
                         "error_message": "The service is not available for the specified postal codes."}]}
  ]
}
```

`POST /quotations` devuelve el mismo objeto con `is_completed: false` y las tarifas en `status: "pending"`.
`POST /api/v2/quotations` (una prueba, ≈04:00:41Z, HTTP 201) devolvió el mismo formato (y el mismo `id`
reutilizado, §4.1); la diferencia de v2 con multipaquete es **NO MEDIDA**.

### 4.7 `tracking_url_provider` (§12.3)

**No aparece** en ninguna respuesta de cotización ni de catálogo (búsqueda en todas las respuestas guardadas:
ni `tracking_url_provider`, ni `tracking_url`, ni `label_url`). Es un campo del **paquete de un envío**, y la
cuenta no tiene envíos por API (`GET /shipments` → `total_count: 0`). **Sigue NO MEDIDO**: solo se cierra
con el primer envío real.

## 5. Carta Porte y catálogos (H4)

### 5.1 `GET /shipments/consignment_notes`

- HTTP 200, 264 ms. Paginado de 20: **48,757 códigos en 2,438 páginas**. `per_page`, `q` y `search` **no**
  tienen efecto. **Filtros que sí funcionan:** `?description=<texto>` (subcadena) y `?consignment_note=<código>`.
- Formato: `{"data":[{"consignment_note":"60141103","description":"Naipes"}],"meta":{"current_page":1,"next_page":null,"prev_page":null,"total_pages":1,"total_count":1}}`

**Códigos candidatos para cartas coleccionables** (la elección es del dueño o su contador, no se decide aquí):

| Código | Descripción en el catálogo | Búsqueda que lo dio |
|---|---|---|
| **60141103** | Naipes | `description=naipes` |
| **49101600** | Coleccionables | `description=coleccionables` |
| 60141100 | Juegos | `consignment_note=60141100` |
| 60141102 | Juegos de mesa | `description=juegos de mesa` |
| 60141000 | Juguetes | `description=juguetes` |

`description=cartas` solo da códigos no aplicables (mapas, abrecartas, pancartas). `barajas`, `juego de cartas`
y `papel impreso` dan 0 resultados.

### 5.2 `GET /shipments/packagings`

HTTP 200, 3 páginas, **60 códigos**. Los del proyecto: **`4G` Caja de cartón** y **`5H4` Saco (bolsa) de
película de plástico** (los mismos nombres que el panel). Otros: `5M1` saco de papel, `7H1` bulto de plástico,
`4H2` caja de plástico rígido, `Z01` Otro. Formato: `{"data":[{"code":"4G","name":"Caja de cartón"}],"meta":{…}}`.

### 5.3 `GET /shipments/carrier_services`

HTTP 200, 3 páginas, **42 servicios**. Campos: `carrier_name`, `service_name`, `service_code`,
`min_delivery_packages`, `is_national`, `volumetric_weight_formula` (en todos: `(height * width * length) / 5000.00`),
`has_pickup`, `multi_packages_enabled`, `is_ltl`, `package_type`, `has_reschedule_pick`.
Ejemplo: `{"carrier_name":"ampm","service_name":"Plataformas","service_code":"<código>","min_delivery_packages":0,"is_national":true,"volumetric_weight_formula":"(height * width * length) / 5000.00","has_pickup":true,"multi_packages_enabled":true,"is_ltl":false,"package_type":"package","has_reschedule_pick":true}`

### 5.4 Otras lecturas

| Hora (UTC) | Endpoint | HTTP | Resultado |
|---|---|---|---|
| 04:01:15 | `GET /finance/credits` | 200 | `{"data":{"balance":965.16,"currency":"MXN"}}` |
| 04:01:17 | `GET /address_templates?page=1&per_page=20` | 200 | **1 plantilla**: alias «Verapaz», `address_type: "from"`, `default: false`. Campos de `address`: `name`, `company`, `street1`, `street_number`, `apartment_number`, `postal_code`, `area_level1/2/3`, `country_code`, `phone`, `email`, `reference`, `rfc`, `tax_id_number`, `tax_id_type` (valores omitidos: datos personales) |
| 04:01:18 | `GET /shipments?page=1&per_page=5` | 200 | `{"data":[],"included":[],"meta":{…,"total_count":0}}` |
| 04:01:19 | `GET /pickups/coverage` (sin parámetros) | 404 | `{"message":"El recurso buscado no se pudo encontrar."}` — probablemente requiere parámetros; **NO MEDIDO** cuáles |

## 6. Webhooks y configuración (R8)

| Hora (UTC) | Endpoint (GET) | HTTP |
|---|---|---|
| 04:01:15 | `/webhooks` | 404 `{"error":"Not Found"}` |
| 04:01:16 | `/settings/webhooks` | 404 |
| 04:01:17 | `/settings` | 404 |
| 04:02:41 | `/webhook_subscriptions` | 404 |
| 04:02:41 | `/settings/notifications` | 404 |

**No se encontró ningún endpoint de lectura de webhooks.** Eventos, payload y firma siguen **NO MEDIDOS**: se
cierran con la colección OpenAPI oficial (referencia §9) o con la sección Webhooks del panel. No se probaron
endpoints de escritura.

## 7. Qué quedó medido y qué no

**Medido (esta sesión, 2026-10-04):**

1. Token: 200, 7200 s, `scope: "default"`; hace falta un `User-Agent` propio (Cloudflare 1010).
2. Cotización asíncrona: `POST` 201 + `GET` hasta `is_completed`; 2–7 s; 33 tarifas siempre; reutiliza la
   cotización si se repiten ruta y medidas.
3. Nombres exactos de los campos de tarifa; **IVA desglosado** (`vat_fee`) y **`total` con IVA**; regla
   verificada en 283 tarifas.
4. Seguro: por defecto $2,500/$25 (el ajuste automático de la cuenta **sí aplica a la API**); $10,000 → $170;
   se apaga con `package_protected: false`.
5. 99minutos (T7): cubre 7 de 10 destinos, sin recolección, $70–$133 (A) / $121–$356 (B), nunca entre las 3
   más baratas.
6. J&T no disponible por API (`success: false` con precio).
7. Recolección y «solo sucursal» por tarifa: sí vienen en la API.
8. Carta Porte: el catálogo se puede filtrar por descripción; candidatos `60141103` Naipes y `49101600`
   Coleccionables. Empaques `4G` y `5H4` confirmados.
9. Saldo intacto: $965.16.

**Sigue NO MEDIDO:**

- `tracking_url_provider` y `label_url` (necesitan un envío real).
- Si la guía respeta `package_protected: false`; qué exige `requires_origin_verification: true`.
- Por qué J&T sale `success: false`.
- Webhooks (eventos, payload, firma).
- Comportamiento ante 429; duración de la reutilización de cotizaciones; si el seguro lleva IVA.
- Si el User-Agent por defecto de Node está bloqueado por Cloudflare.
- Parámetros de `GET /pickups/coverage`; si la recolección cuesta.
- Variable `SKYDROPX_BASE_URL` ausente en el entorno (el dueño debe volver a añadirla).
