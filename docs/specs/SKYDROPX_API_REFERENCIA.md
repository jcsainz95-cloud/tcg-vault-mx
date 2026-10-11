# Skydropx PRO API — Referencia para integración

> **Procedencia:** el dueño la compiló de la doc oficial (https://pro.skydropx.com/es-MX/api-docs) y la
> entregó en la conversación del **2026-09-29**. El orquestador la guarda **tal cual**. **No la ha contrastado
> contra la fuente oficial**, porque la red de este entorno bloquea los dominios de Skydropx. Lo marcado con ⚠️
> lo marca así la propia referencia. Análisis y contraste con el código: `SKYDROPX_LEVANTAMIENTO.md` §8.

> Contexto para el proyecto: integración de paquetería nacional (México) vía Skydropx PRO.
> Fuente oficial: https://pro.skydropx.com/es-MX/api-docs — compilado sept 2026.
> Soporte técnico: api@skydropx.com

---

## 0. Qué versión usar (IMPORTANTE)

- **Usar SOLO Skydropx PRO API** (OAuth2, `/api/v1/...`).
- La API clásica (`https://api.skydropx.com/v1`, header `Authorization: Token token=API_KEY`) está deprecada: Skydropx anunció que deja de funcionar en abril 2026. **No usar**, aunque aparezca en tutoriales viejos, blogs o respuestas de LLMs.
- Radar API (`radar-api.skydropx.com`) también es legacy.

## 1. Ambientes y credenciales

| Ambiente | Base URL | Dónde sacar credenciales |
|---|---|---|
| Sandbox | `https://sb-pro.skydropx.com/api/v1` | https://sb-pro.skydropx.com/merchant_stores/applications |
| Producción | `https://pro.skydropx.com/api/v1` | https://pro.skydropx.com/merchant_stores/applications |

- En el panel: **Conexiones > API** → copiar `Client ID` y `Client Secret`.
- Nota: la doc también menciona el host `api-pro.skydropx.com`, mientras todos los ejemplos usan `pro.skydropx.com`. Probar primero con `pro.skydropx.com`; si hay problemas, validar el host con soporte.
- Guardar credenciales en variables de entorno, nunca en el cliente/frontend:
  ```
  SKYDROPX_BASE_URL=https://sb-pro.skydropx.com/api/v1
  SKYDROPX_CLIENT_ID=...
  SKYDROPX_CLIENT_SECRET=...
  ```

## 2. Autenticación (OAuth2 client_credentials)

### POST /oauth/token
```
POST /api/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=CLIENT_ID&client_secret=CLIENT_SECRET
```
(También acepta JSON con `client_id`, `client_secret`, `grant_type`; opcionales `scope`, `refresh_token`, `redirect_uri`.)

Respuesta 200:
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
  "token_type": "Bearer",
  "expires_in": 7200,
  "scope": "read write",
  "created_at": 1790645186
}
```
Errores: `400` credenciales faltantes, `401` credenciales inválidas → `{ "error": "...", "error_description": "..." }`

Todas las demás llamadas:
```
Authorization: Bearer {access_token}
Content-Type: application/json
```

### POST /oauth/revoke
Body: `client_id`, `client_secret`, `token`, `token_type_hint` (`access_token` | `refresh_token`). 200 → `{}`. 403 cliente no autorizado.

### POST /oauth/introspect
Mismo body que revoke. Respuesta: `{ "active": true, "scope", "client_id", "token_type", "exp", "iat" }`

### Reglas operativas
- **Token expira en 2 horas (7200 s)** → cachear en servidor y renovar ~5 min antes de `created_at + expires_in`. No pedir token por request.
- **Rate limit: 2 requests/segundo** → implementar cola/throttle y retry con backoff en 429.

---

## 3. Flujo principal: cotizar → elegir rate → crear envío

1. `POST /quotations` → crea cotización, devuelve `id`.
2. `GET /quotations/{id}` → leer `rates`. **La cotización se llena progresivamente**: hacer polling hasta `is_completed: true` (p. ej. cada 1–2 s, respetando el rate limit, con timeout).
3. Elegir un rate (precio + carrier + servicio) y guardar su `id`. **Los rates son válidos 24 horas.**
4. `POST /shipments` con `rate_id` + direcciones completas + paquetes → genera guía y **descuenta créditos** de la cuenta.
5. Obtener guía (label PDF) y tracking number del envío (`GET /shipments/{id}`).

### 3.1 POST /quotations (nacional MX)
```json
{
  "quotation": {
    "order_id": "uuid-opcional-de-orden",
    "address_from": {
      "address_template_id": "uuid-opcional",
      "country_code": "MX",
      "postal_code": "64000",
      "area_level1": "Nuevo León",
      "area_level2": "Monterrey",
      "area_level3": "Monterrey Centro",
      "tax_id_number": "XAXX010101000"
    },
    "address_to": {
      "country_code": "MX",
      "postal_code": "64000",
      "area_level1": "Nuevo León",
      "area_level2": "Monterrey",
      "area_level3": "Monterrey Centro"
    },
    "parcels": [
      {
        "length": 10,
        "width": 10,
        "height": 10,
        "weight": 2,
        "package_protected": true,
        "declared_value": 100
      }
    ],
    "requested_carriers": ["fedex", "dhl"]
  }
}
```
Campos de dirección en cotización:
- `country_code` (ISO alpha-2), `postal_code`, `area_level1` = estado, `area_level2` = ciudad/municipio, `area_level3` = colonia — todos requeridos.
- `address_template_id` opcional: si se manda, rellena los campos no enviados.
- `tax_id_number` opcional (RFC).

Parcels: `length`, `width`, `height` (int, cm), `weight` (float, kg) requeridos. `package_protected` y `declared_value` opcionales (seguro).
`requested_carriers` opcional: limita qué paqueterías cotizar.
Multipaquete: mandar varios objetos en `parcels`.

### 3.2 GET /quotations/{id}
- Revisar `is_completed` (polling hasta `true`).
- Cada rate trae su `id` (el que se usa como `rate_id`), carrier, servicio y precio total.
- `shipment_creation_type` del rate:
  - `single` → 1 paquete, 1 envío
  - `multipackage` → 1 envío con varios paquetes
  - `multishipment` → varios envíos (uno por paquete)
- Internacional: rate incluye `import_duty_amount` (aranceles, NO incluidos en el total).
- ⚠️ El esquema exacto de campos del rate (nombres de precio, días de entrega, etc.) no está completo aquí: loguear una respuesta real de sandbox y mapear desde ahí.

### 3.3 POST /quotations V2 → `POST /api/v2/quotations`
Mismo body que v1. Diferencia: devuelve también rates `multishipment` (carriers sin multipaquete nativo) para ver qué tipo de envío produce cada rate. Recomendado si se manejan multipaquetes.

### 3.4 POST /shipments (crear envío / guía)
```json
{
  "shipment": {
    "rate_id": "uuid-del-rate",
    "printing_format": "thermal",
    "address_from": {
      "address_template_id": "uuid-opcional",
      "street1": "Calle y número",
      "name": "Nombre remitente",
      "company": "Empresa",
      "phone": "5512345678",
      "email": "envios@ejemplo.com",
      "reference": "Entre calles / referencia",
      "tax_id_number": "XAXX010101000"
    },
    "address_to": {
      "street1": "Calle y número",
      "name": "Nombre destinatario",
      "company": "Empresa o nombre",
      "phone": "5587654321",
      "email": "cliente@ejemplo.com",
      "reference": "Casa azul",
      "further_information": "Dejar con el vecino"
    },
    "packages": [
      {
        "package_number": "1",
        "package_protected": true,
        "declared_value": 2500.0,
        "consignment_note": "CODIGO_CARTA_PORTE_SAT",
        "package_type": "4G"
      }
    ]
  }
}
```
Campos:
- `rate_id` (req): del paso 3.2.
- `printing_format`: `standard` | `thermal`.
- `original_shipment_id` (opc): ID de envío original (reexpediciones).
- `address_from` requeridos: `street1`, `name`, `company`, `phone`, `email`, `reference`. `address_to` requeridos: `street1`, `name`, `company`, `phone`, `email`; `reference` opcional.
- `further_information` (opc, máx 70 caracteres): se imprime en la guía si el carrier lo soporta.
- Nota: CP, estado, ciudad y colonia ya vienen de la cotización; aquí se mandan calle, nombre y contacto.
- `packages[]`: `package_number` = índice del paquete cotizado; `declared_value` en MXN; `consignment_note` = código **Carta Porte SAT** del contenido; `package_type` = código de **tipo de empaque**.
  - En México **consignment_note y package_type suelen ser obligatorios en la práctica** (Carta Porte). Catálogos:
    - Códigos Carta Porte: https://help.skydropx.com/articulos-cda/codigos-carta-porte
    - Códigos de empaque: https://help.skydropx.com/articulos-cda/codigos-de-tipos-de-empaques
    - Códigos de paquetería (carrier_name): https://help.skydropx.com/subcategorias-cda/api
    - Vía API: `GET /shipments/consignment_notes` y `GET /shipments/packagings`

Respuesta (formato JSON:API):
```json
{
  "data": {
    "id": "uuid",
    "type": "shipment",
    "attributes": {
      "carrier_name": "fedex",
      "workflow_status": "...",
      "payment_status": "...",
      "total": "123.45",
      "source": "api",
      "master_tracking_number": null,
      "error_detail": {
        "error_code": null,
        "error_message": null,
        "error_message_detail": null
      },
      "created_at": "...",
      "updated_at": "..."
    },
    "relationships": {
      "packages": { "data": [{ "id": "uuid", "type": "package" }] },
      "address_from": { "data": { "id": "uuid", "type": "address" } },
      "address_to": { "data": { "id": "uuid", "type": "address" } }
    }
  },
  "included": []
}
```
- La generación de guía puede ser **asíncrona**: si `master_tracking_number` viene `null`, consultar `GET /shipments/{id}` (o esperar webhook) hasta que aparezca tracking y URL de guía.
- Si falla, revisar `error_detail`.

### 3.5 POST /api/v2/shipments
Mismo body que v1. **Siempre devuelve un arreglo de envíos** (1 elemento para single/multipackage, N para multishipment). Recomendado para código nuevo.

### 3.6 Envío internacional (solo si aplica)
- Origen solo MX; destinos: Canadá, China, Colombia, España, EE. UU., Francia, Reino Unido.
- Cotización requiere `products[]`: `hs_code`, `description_en`, `country_code`, `quantity`, `price`.
- Envío requiere además: `customs_payment_payer` (quién paga aranceles; si pagas tú se descuenta de créditos), `shipment_purpose`, y `products[]` dentro de cada package (`name`, `description_en`, `quantity`, `price`, `sku`, `hs_code`, `hs_code_description`, `product_type_code`, `product_type_name`, `country_code`).

---

## 4. Resto de endpoints (todos bajo `/api/v1` salvo indicado)

### Envíos
| Método | Path | Uso |
|---|---|---|
| GET | `/shipments` | Listar envíos |
| GET | `/shipments/{id}` | Detalle de envío (tracking, guía, estado) |
| POST | `/shipments` | Crear envío (v1) |
| POST | `/api/v2/shipments` | Crear envío (v2, devuelve arreglo) |
| POST | `/rate/shipments` | Crear envío **sin cotizar** (precio calculado internamente) |
| POST | `/api/v2/rate/shipments` | Ídem v2 |
| POST | `/shipments/{shipment_id}/cancellations` | Cancelar envío/guía |
| POST | `/shipments/{shipment_id}/protect` | Contratar protección (seguro) a un envío |
| GET | `/shipments/tracking?tracking_number=X&carrier_name=Y` | Rastrear envío |
| GET | `/shipments/carrier_services` | Servicios disponibles por carrier |
| GET | `/shipments/consignment_notes` | Catálogo Carta Porte |
| GET | `/shipments/packagings` | Catálogo tipos de empaque |

`POST /rate/shipments` body (sin cotización previa):
```json
{
  "timeout": 8,
  "quotation": {
    "printing_format": "thermal",
    "carrier": { "name": "fedex", "service_name": "..." }
  },
  "address_from": { "name": "", "street1": "", "company": "", "phone": "", "email": "", "reference": "" },
  "address_to": { "name": "", "street1": "", "company": "", "phone": "", "email": "", "reference": "" },
  "parcels": [
    { "weight": 1, "height": 10, "width": 10, "length": 10, "package_number": "1",
      "declared_value": 2500.0, "package_protected": true,
      "consignment_note": "CODIGO_SAT", "package_type": "4G" }
  ]
}
```

### Direcciones guardadas (address templates)
| Método | Path | Uso |
|---|---|---|
| GET | `/address_templates?page=1&per_page=20` | Listar (máx 20 por página) |
| GET | `/address_templates/{id}` | Detalle |
| POST | `/address_templates` | Crear |
| PATCH | `/address_templates/{id}` | Actualizar |
| DELETE | `/address_templates/{id}` | Eliminar |
| POST | `/address_templates/{id}/verify_by_carriers` | Validar dirección con carriers (body: `{ "carriers": ["fedex"] }`, responde 202) |

Crear dirección:
```json
{
  "address_template": {
    "alias_name": "Bodega Principal",
    "address_type": "from",
    "default": true,
    "address_attributes": {
      "name": "Juan Perez",
      "company": "Acme INC",
      "street1": "Insurgentes Sur 1234",
      "apartment_number": "4B",
      "postal_code": "06600",
      "area_level1": "Ciudad de Mexico",
      "area_level2": "Cuauhtemoc",
      "area_level3": "Juarez",
      "country_code": "MX",
      "phone": "5215555555555",
      "email": "juan@example.com",
      "reference": "Cerca del parque",
      "rfc": "XAXX010101000"
    }
  }
}
```
- `address_type`: `from` (origen) | `to` (destino). Requeridos: `alias_name`, `address_type`, y en `address_attributes`: `name`, `street1`, `postal_code`, `area_level1/2/3`, `country_code`, `phone`, `email`, `reference`.
- En MX el número exterior va dentro de `street1`.
- Tip: guardar la dirección de origen (bodega) como template y usar su `address_template_id` en cotizaciones y envíos.

### Recolecciones (pickups)
| Método | Path | Uso |
|---|---|---|
| GET | `/pickups/coverage` | Fechas disponibles de recolección |
| POST | `/pickups` | Programar recolección |
| POST | `/pickups/reschedule` | Reprogramar |
| GET | `/pickups` | Listar |
| GET | `/pickups/{id}` | Detalle |

⚠️ Body exacto de pickups no incluido aquí: consultar la sección "Recolecciones" de la doc oficial antes de implementar.

### Órdenes
| Método | Path | Uso |
|---|---|---|
| GET | `/orders?page=&per_page=` | Listar (máx 20) |
| GET | `/orders/{id}` · `/api/v2/orders/{id}` | Detalle |
| GET | `/orders/{order_id}/labels` | URLs de guías de la orden → `{ data: { order_id, label_urls: [] } }` |
| POST | `/orders` | Crear orden |
| PATCH | `/orders/{order_id}` | Actualizar |

Las órdenes son opcionales para el flujo de cotizar/enviar; útiles si quieres que Skydropx lleve el registro/automatizaciones. `reference_number` debe ser único si se envía.

### Finanzas
- `GET /finance/credits` → `{ "data": { "balance": 1500.5, "currency": "MXN" } }` — **validar saldo antes de crear envíos** (cada guía descuenta créditos prepagados).
- `GET /finance/extra-charges?page=&per_page=&start_date=2026-01-01&end_date=2026-03-31` → cargos extra (sobrepeso, etc.) por envío: `shipment_id`, `tracking_number`, `amount`, `charge_type` (ej. `ExtraCharge::Overweight`), `status`.

### Otros
- `GET /office_points?rate_id=X&direction=delivery&limit=15` → sucursales para entregar/recoger (`direction`: `delivery` | `pickup`). Usar el `id` como `office_delivery_point_id` / `office_pickup_point_id` al crear el envío.
- `PATCH /settings/printing_formats` → formato de impresión por default.
- `GET /products` → productos.
- `GET /transaction_stats` → movimientos.
- Envíos externos (guías generadas fuera de Skydropx): `POST /external_shipments` (`tracking_number` + `carrier_name`), importación masiva `POST /external_shipments/imports` (CSV/XLSX ≤500 filas) y `GET /external_shipments/imports/{id}`.
- Flota propia: `POST /shipments/tracking` para reportar eventos.

---

## 5. Estados de tracking
Valores de estado documentados: `created`, `picked_up`, `in_transit`, `last_mile`, `delivery_attempt`, `delivered_to_branch`, `delivered`, `exception`, `in_return`, `canceled`, `destroyed`, `retained`.

## 6. Webhooks
- Skydropx notifica cambios de estado de envíos vía HTTP POST a un endpoint tuyo (configurable en el panel / sección "Webhooks" de la doc).
- ⚠️ Payload, eventos y firma no incluidos aquí: consultar https://pro.skydropx.com/es-MX/api-docs#webhooks antes de implementar. Mientras tanto, se puede hacer polling con `GET /shipments/{id}`.
- Buenas prácticas: responder 200 rápido, procesar en background, idempotencia por shipment id + estado.

## 7. Errores
- `400` parámetros/credenciales faltantes · `401` token inválido/expirado (renovar token y reintentar 1 vez) · `403` no autorizado · `404` recurso no encontrado · `422` validación (ej. paquetería no disponible en la cuenta) · `429` rate limit.
- Errores de generación de guía llegan en `attributes.error_detail` del envío.
- Referencia oficial: https://pro.skydropx.com/es-MX/api-docs#errors

---

## 8. Checklist de implementación
1. Módulo `skydropxClient` server-side con cache de token (2 h) + throttle 2 req/s + retry en 401/429.
2. Crear address template de la bodega de origen; guardar su id en config.
3. Checkout: `POST /quotations` → polling `GET /quotations/{id}` hasta `is_completed` → mostrar rates al usuario (o elegir el más barato/rápido por regla de negocio).
4. Al pagar: validar saldo (`/finance/credits`) → `POST /api/v2/shipments` con `rate_id` (vigente < 24 h; si expiró, recotizar).
5. Guardar en DB: `shipment_id`, `rate_id`, carrier, costo, tracking, label URL, estado.
6. Tracking: webhook + fallback de polling. Mapear estados a los del sistema.
7. Cancelación: `POST /shipments/{id}/cancellations`.
8. Carta Porte: definir `consignment_note` y `package_type` por tipo de producto desde los catálogos oficiales.
9. Declarar valor y activar `package_protected` para envíos de alto valor.
10. Probar todo en sandbox (`sb-pro`) antes de producción.

## 9. Tip: spec completa en OpenAPI
En la doc oficial (sección "Guía para importar API a Postman") hay un botón **"Copiar URL de la colección"** con la especificación OpenAPI completa. Descargar ese JSON y agregarlo al proyecto da los esquemas exactos de todos los endpoints (pickups, webhooks, respuestas de rates) que aquí están marcados con ⚠️.
