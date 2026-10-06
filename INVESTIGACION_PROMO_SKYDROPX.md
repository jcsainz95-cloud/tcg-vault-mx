# Investigación — ¿llega la promo de $50 de Skydropx a la tienda?

> **Medido el 2026-10-06, 05:31:09–05:31:47 UTC**, contra la API de producción (`https://pro.skydropx.com/api/v1`),
> con las credenciales de `SKYDROPX_CLIENT_ID` / `SKYDROPX_CLIENT_SECRET` (valores y token **no** se imprimieron
> ni se guardaron). Solo lectura: **no se compró ninguna guía**, no se creó ningún envío, no se movió saldo.
> Código leído en el `HEAD` `3609125` (= `origin/production` `36091259`, 2026-10-05).

## 1. Qué peticiones se hicieron

| Petición | Veces | Resultado |
|---|---|---|
| `POST /oauth/token` | 10 (una por corrida del script) | 200 · `scope: "default"` · `expires_in: 7200` |
| `GET /address_templates?page=1&per_page=20` | 1 | 200 · 1 plantilla de origen, tipo `from`, CP 14210 (la que usa la tienda) |
| `GET /finance/credits` | 1 | 200 · campos `balance`, `currency` (el valor no se registró: no hacía falta) |
| `GET /user`, `/users/me`, `/account`, `/me`, `/plans`, `/companies/me` | 1 c/u | **404** las seis |
| `POST /quotations` | 9 | 1 rechazada (422: faltaba la colonia de 01780, no cuenta como cotización) + **8 cotizaciones** |
| `GET /quotations/{id}` (sondeo) | 11 | 200; todas completas en 1–2 consultas |

**No existe un endpoint de cuenta o planes que diga la vigencia de la promo** (los seis candidatos dan 404, y la
referencia `docs/specs/SKYDROPX_API_REFERENCIA.md` no documenta ninguno). La única pista de la promo es el campo
`plan_type` de cada tarifa. **Cuándo vence: NO MEDIDO.**

## 2. Cómo se cotizó (igual que la tienda)

- **Paquetes** (los de la tienda, `backend/prisma/migrations/20261007120000_m66_sdx_d_skydropx/migration.sql:313-315`):
  **A «Sobre»** 25×18×3 cm, 1 kg · **B «Caja»** 49×23×21 cm, 5 kg.
- **Seguro**: `package_protected: true`, `declared_value: 2500` (la tienda siempre lo manda explícito,
  `skydropx.adapter.ts:96-97`; $2,500 es el primer escalón ⇒ $25).
- **Origen**: CP 14210 (Jardines en la Montaña, Tlalpan). Se probó de dos formas: con la dirección escrita
  (como el informe del 2026-10-04) y con la **plantilla de origen** (`address_template_id`), que es como cotiza
  la tienda (`skydropx.adapter.ts:82`). **Dieron exactamente lo mismo** (Q1 = Q3, Q2 = Q4).
- Sin `requested_carriers`: todas las paqueterías de la cuenta. Siempre llegaron **33 tarifas**.

Precios en MXN, `total` de Skydropx (**con IVA, sin el seguro de $25**). «Recol.» = `pickup`. Se listan solo
las tarifas con precio; las demás (16–17 por cotización) llegan sin precio (`no_coverage` / `not_applicable`).
⭐ = `plan_type` de promoción.

## 3. Resultados por cotización

### Q1 — 14210 → 01780 (Olivar de los Padres, CDMX) · paquete A · dirección escrita · 05:31:15Z

| Paquetería · servicio | `plan_type` | Total | `success` | `status` | Días | Recol. |
|---|---|---|---|---|---|---|
| PuntoPost · Standard | ⭐ `PROMO_1_PESO_19082026` | 1.19 | true | price_found_internal | 2 | no (solo sucursal) |
| ampm · Plataformas | ⭐ `50PESOS_20052026` | 51.25 | true | price_found_internal | 2 | sí |
| Paquetexpress · Nacional | ⭐ `50PESOS_30042026` | 51.25 | true | price_found_internal | 3 | sí |
| FedEx · Express Saver | ⭐ `50PESOS_30042026` | 52.11 | true | price_found_internal | 3 | sí |
| Imile · Express | `ACQ_2026` | 63.02 | true | price_found_internal | 2 | no |
| 99minutos · Next Day | `ACQ_2026` | 70.15 | true | price_found_internal | 2 | no |
| Yaslan · Standard | `ACQ_2026` | 76.71 | true | price_found_external | 2 | no |
| Estafeta · Terrestre | `ACQ_2026` | 119.44 | true | price_found_internal | 3 | sí |
| FedEx · Standard Overnight | `ACQ_2026` | 121.41 | true | price_found_internal | 2 | sí |
| Estafeta · Servicio Express | `ACQ_2026` | 127.74 | true | price_found_internal | 1 | sí |
| Paquetexpress · Nacional Sin Recolección | `ACQ_2026` | 139.11 | true | price_found_internal | 1 | no |
| Paquetexpress · Express Second Day | `ACQ_2026` | 165.27 | true | price_found_internal | 2 | sí |
| DHL · Standard | `ACQ_2026` | 165.40 | true | price_found_internal | 1 | sí |
| DHL · Express | `ACQ_2026` | 175.64 | true | price_found_internal | 1 | sí |
| J&T Express · Standard Sin Recolección | ⭐ `50PESOS_20052026` | 51.25 | **false** | price_found_internal | 6 | no |
| J&T Express · Standard | `ACQ_2026` | 85.61 | **false** | price_found_internal | 6 | no |
| UPS · Express | `ACQ_2026` | 156.31 | **false** | price_found_internal | 1 | sí |

### Q2 — 14210 → 01780 · paquete B · dirección escrita · 05:31:20Z

| Paquetería · servicio | `plan_type` | Total | `success` | `status` | Días | Recol. |
|---|---|---|---|---|---|---|
| PuntoPost · Standard | ⭐ `PROMO_1_PESO_19082026` | 1.19 | true | price_found_internal | 2 | no (solo sucursal) |
| Paquetexpress · Nacional | ⭐ `50PESOS_30042026` | 51.25 | true | price_found_internal | 3 | sí |
| ampm · Plataformas | ⭐ `50PESOS_20052026` | 51.25 | true | price_found_internal | 2 | sí |
| Sendex by Coordi · Reg | ⭐ `50PESOS_20052026` | 51.25 | true | price_found_external | 1 | sí |
| FedEx · Express Saver | ⭐ `50PESOS_30042026` | 52.25 | true | price_found_internal | 3 | sí |
| Imile · Express | `ACQ_2026` | 63.02 | true | price_found_internal | 2 | no |
| Yaslan · Standard | `ACQ_2026` | 95.26 | true | price_found_external | 2 | no |
| Coordi · Reg | `ACQ_2026` | 115.33 | true | price_found_external | 1 | sí |
| Estafeta · Terrestre | `ACQ_2026` | 119.44 | true | price_found_internal | 3 | sí |
| 99minutos · Next Day | `ACQ_2026` | 121.28 | true | price_found_internal | 2 | no |
| FedEx · Standard Overnight | `ACQ_2026` | 138.27 | true | price_found_internal | 2 | sí |
| DHL · Standard | `ACQ_2026` | 165.56 | true | price_found_internal | 1 | sí |
| DHL · Express | `ACQ_2026` | 176.22 | true | price_found_internal | 1 | sí |
| Estafeta · Servicio Express | `ACQ_2026` | 185.66 | true | price_found_internal | 1 | sí |
| J&T Express · Standard Sin Recolección | ⭐ `50PESOS_20052026` | 51.25 | **false** | price_found_internal | 6 | no |
| J&T Express · Standard | `ACQ_2026` | 93.93 | **false** | price_found_internal | 6 | no |
| UPS · Express | `ACQ_2026` | 210.49 | **false** | price_found_internal | 1 | sí |

### Q3 / Q4 — 14210 → 01780 · paquetes A y B · **con la plantilla de origen (como la tienda)** · 05:31:28Z / 05:31:33Z

**Idénticas a Q1 y Q2**: mismas 17 tarifas con precio, mismos `plan_type`, mismos totales, mismos `success`.
La respuesta confirma que se usó la plantilla (`address_template_from_id` no nulo). Conclusión: **la forma de
mandar el origen no quita la promo.**

### Q5 — 14210 → 06600 (Juárez, CDMX) · paquete A · 05:31:38Z

| Paquetería · servicio | `plan_type` | Total | `success` | Días | Recol. |
|---|---|---|---|---|---|
| PuntoPost · Standard | ⭐ `PROMO_1_PESO_19082026` | 1.19 | true | 2 | no (solo sucursal) |
| ampm · Plataformas | ⭐ `50PESOS_20052026` | 51.25 | true | 1 | sí |
| Paquetexpress · Nacional | ⭐ `50PESOS_30042026` | 51.25 | true | 3 | sí |
| FedEx · Express Saver | ⭐ `50PESOS_30042026` | 52.11 | true | 2 | sí |
| Imile · Express | `ACQ_2026` | 63.02 | true | 2 | no |
| 99minutos · Next Day | `ACQ_2026` | 70.15 | true | 2 | no |
| Yaslan · Standard | `ACQ_2026` | 76.71 | true | 2 | no |
| Estafeta · Terrestre | `ACQ_2026` | 119.44 | true | 4 | sí |
| FedEx · Standard Overnight | `ACQ_2026` | 121.41 | true | 1 | sí |
| Estafeta · Servicio Express | `ACQ_2026` | 127.74 | true | 3 | sí |
| Paquetexpress · Nacional Sin Recolección | `ACQ_2026` | 139.11 | true | 1 | no |
| Paquetexpress · Express Second Day | `ACQ_2026` | 165.27 | true | 2 | sí |
| DHL · Standard | `ACQ_2026` | 165.40 | true | 1 | sí |
| DHL · Express | `ACQ_2026` | 175.64 | true | 1 | sí |
| J&T Express · Standard Sin Recolección | ⭐ `50PESOS_20052026` | 51.25 | **false** | 6 | no |
| J&T Express · Standard | `ACQ_2026` | 85.61 | **false** | 6 | no |
| UPS · Express | `ACQ_2026` | 156.31 | **false** | 1 | sí |

(`status`: todas `price_found_internal` salvo Yaslan, `price_found_external`.)

### Q6 — 14210 → 06600 · paquete B · 05:31:41Z

| Paquetería · servicio | `plan_type` | Total | `success` | Días | Recol. |
|---|---|---|---|---|---|
| PuntoPost · Standard | ⭐ `PROMO_1_PESO_19082026` | 1.19 | true | 2 | no (solo sucursal) |
| Sendex by Coordi · Reg | ⭐ `50PESOS_20052026` | 51.25 | true | 1 | sí |
| Paquetexpress · Nacional | ⭐ `50PESOS_30042026` | 51.25 | true | 3 | sí |
| ampm · Plataformas | ⭐ `50PESOS_20052026` | 51.25 | true | 1 | sí |
| FedEx · Express Saver | ⭐ `50PESOS_30042026` | 52.25 | true | 2 | sí |
| Imile · Express | `ACQ_2026` | 63.02 | true | 2 | no |
| Yaslan · Standard | `ACQ_2026` | 95.26 | true | 2 | no |
| Coordi · Reg | `ACQ_2026` | 115.33 | true | 1 | sí |
| Estafeta · Terrestre | `ACQ_2026` | 119.44 | true | 4 | sí |
| 99minutos · Next Day | `ACQ_2026` | 121.28 | true | 2 | no |
| FedEx · Standard Overnight | `ACQ_2026` | 138.27 | true | 1 | sí |
| DHL · Standard | `ACQ_2026` | 165.56 | true | 1 | sí |
| DHL · Express | `ACQ_2026` | 176.22 | true | 1 | sí |
| Estafeta · Servicio Express | `ACQ_2026` | 185.66 | true | 3 | sí |
| J&T Express · Standard Sin Recolección | ⭐ `50PESOS_20052026` | 51.25 | **false** | 6 | no |
| J&T Express · Standard | `ACQ_2026` | 93.93 | **false** | 6 | no |
| UPS · Express | `ACQ_2026` | 210.49 | **false** | 1 | sí |

(`status`: `price_found_external` en Sendex by Coordi, Coordi y Yaslan; el resto `price_found_internal`.)

### Q7 — 14210 → 64000 (Monterrey Centro, foráneo) · paquete A · 05:31:44Z

| Paquetería · servicio | `plan_type` | Total | `success` | Días | Recol. |
|---|---|---|---|---|---|
| PuntoPost · Standard | ⭐ `PROMO_1_PESO_19082026` | 1.19 | true | 4 | no (solo sucursal) |
| Paquetexpress · Nacional | ⭐ `50PESOS_30042026` | 51.25 | true | 3 | sí |
| ampm · Plataformas | ⭐ `50PESOS_20052026` | 51.25 | true | 2 | sí |
| FedEx · Express Saver | ⭐ `50PESOS_30042026` | 52.26 | true | 2 | sí |
| Imile · Express | `ACQ_2026` | 78.47 | true | 2 | no |
| 99minutos · Next Day Nacional | `ACQ_2026` | 87.99 | true | 2 | no |
| Yaslan · Standard | `ACQ_2026` | 90.63 | true | 7 | no |
| Estafeta · Terrestre | `ACQ_2026` | 138.15 | true | 4 | sí |
| Paquetexpress · Nacional Sin Recolección | `ACQ_2026` | 139.11 | true | 1 | no |
| FedEx · Standard Overnight | `ACQ_2026` | 141.86 | true | 1 | sí |
| Estafeta · Servicio Express | `ACQ_2026` | 147.05 | true | 2 | sí |
| Paquetexpress · Express Second Day | `ACQ_2026` | 165.27 | true | 2 | sí |
| Paquetexpress · Express Next Day | `ACQ_2026` | 165.27 | true | 2 | sí |
| DHL · Standard | `ACQ_2026` | 165.48 | true | 1 | sí |
| DHL · Express | `ACQ_2026` | 175.91 | true | 3 | sí |
| J&T Express · Standard Sin Recolección | ⭐ `50PESOS_20052026` | 51.25 | **false** | 6 | no |
| J&T Express · Standard | `ACQ_2026` | 99.88 | **false** | 6 | no |
| UPS · Express | `ACQ_2026` | 164.75 | **false** | 4 | sí |

### Q8 — 14210 → 64000 · paquete B · 05:31:47Z

| Paquetería · servicio | `plan_type` | Total | `success` | Días | Recol. |
|---|---|---|---|---|---|
| PuntoPost · Standard | ⭐ `PROMO_1_PESO_19082026` | 1.19 | true | 4 | no (solo sucursal) |
| Paquetexpress · Nacional | ⭐ `50PESOS_30042026` | 51.25 | true | 3 | sí |
| Sendex by Coordi · Reg | ⭐ `50PESOS_20052026` | 51.25 | true | 2 | sí |
| ampm · Plataformas | ⭐ `50PESOS_20052026` | 51.25 | true | 2 | sí |
| FedEx · Express Saver | ⭐ `50PESOS_30042026` | 52.47 | true | 2 | sí |
| Imile · Express | `ACQ_2026` | 78.47 | true | 2 | no |
| Coordi · Reg | `ACQ_2026` | 115.33 | true | 2 | sí |
| Yaslan · Standard | `ACQ_2026` | 121.54 | true | 7 | no |
| Estafeta · Terrestre | `ACQ_2026` | 138.15 | true | 4 | sí |
| 99minutos · Next Day Nacional | `ACQ_2026` | 158.14 | true | 2 | no |
| DHL · Standard | `ACQ_2026` | 165.58 | true | 1 | sí |
| FedEx · Standard Overnight | `ACQ_2026` | 165.95 | true | 1 | sí |
| DHL · Express | `ACQ_2026` | 176.55 | true | 3 | sí |
| Estafeta · Servicio Express | `ACQ_2026` | 232.73 | true | 2 | sí |
| J&T Express · Standard Sin Recolección | ⭐ `50PESOS_20052026` | 51.25 | **false** | 6 | no |
| J&T Express · Standard | `ACQ_2026` | 114.14 | **false** | 6 | no |
| UPS · Express | `ACQ_2026` | 230.94 | **false** | 4 | sí |

## 4. Respuestas

**¿Aparece hoy algún `plan_type` de promoción?** Sí, en **las 8 de 8** cotizaciones: `50PESOS_30042026`,
`50PESOS_20052026` y `PROMO_1_PESO_19082026`. Los tres códigos son los mismos que el 2026-10-04.

**¿En qué paquetería y a qué precio?** (siempre igual, con los dos paquetes y los tres destinos)

| Paquetería · servicio | `plan_type` | Total | ¿Disponible? |
|---|---|---|---|
| PuntoPost · Standard | `PROMO_1_PESO_19082026` | $1.19 | sí, pero **solo sucursal** (sin recolección) |
| Paquetexpress · Nacional | `50PESOS_30042026` | $51.25 | sí, con recolección |
| ampm · Plataformas | `50PESOS_20052026` | $51.25 | sí, con recolección |
| FedEx · Express Saver | `50PESOS_30042026` | $52.11–$52.47 (el «$50» + combustible) | sí, con recolección |
| Sendex by Coordi · Reg | `50PESOS_20052026` | $51.25 | sí, **solo con el paquete B** (caja) |
| J&T Express · Standard Sin Recolección | `50PESOS_20052026` | $51.25 | **no**: `success: false` siempre (como el 04) |

Todas las demás (Estafeta, DHL, 99minutos, Imile, Yaslan, UPS, Coordi Reg, etc.) llegan con **`ACQ_2026`**, la
tarifa normal. **99minutos nunca tiene promo.**

**¿Ha cambiado respecto al 2026-10-04?** Casi nada (comparado con `docs/specs/SKYDROPX_API_PROD_RESULTADOS.md` §4.5):

- 06600 A: mismas 14/33 tarifas exitosas y mismos precios (PuntoPost $1.19, ampm $51.25, Paquetexpress $51.25,
  99minutos $70.15, FedEx Express Saver $52.11 — igual que el ejemplo de §4.6).
- 64000 A: mismas 15/33; mismos tres primeros y 99minutos $87.99.
- 06600 B y 64000 B: 99minutos igual ($121.28 / $158.14), pero hoy salen **14/33** exitosas en vez de 12/33:
  **aparece Sendex by Coordi · Reg a $51.25 con promo** y Coordi · Reg a $115.33. Es lo único nuevo.
- Los sufijos de los códigos (`30042026`, `20052026`, `19082026`) no cambiaron. Si son fechas de inicio,
  de fin o un número de campaña es **NO MEDIDO**; si fueran fechas de vencimiento ya habrían pasado y la promo
  seguiría saliendo, así que **probablemente no lo son** (inferencia, no medición).

**¿Hay un endpoint que diga la vigencia?** No encontrado: `/user`, `/users/me`, `/account`, `/me`, `/plans` y
`/companies/me` dan 404; `/finance/credits` solo trae saldo y moneda.

## 5. Conclusión

**La promo sí sigue llegando por la API**, hoy, en todas las rutas y con los dos paquetes de la tienda, y
también cuando el origen va por la plantilla, que es como cotiza la tienda. La tienda la lee
(`plan_type` → `isPromo`, `backend/src/modules/shipping-provider/promo-plan.ts`) y la marca con la etiqueta
«Promoción». El problema no es que Skydropx deje de mandarla.

**Por qué el dueño puede estar viendo precios normales.** Son razones encontradas en el código, ordenadas de
más a menos probable. Ninguna se comprobó en la pantalla de producción (**NO MEDIDO**: haría falta abrir
«Capturar guía» en la tienda y ver la lista):

1. **La tarifa que la tienda recomienda (la preseleccionada) es la de 99minutos, que no tiene promo.** El ajuste
   `shipping_preferred_carriers` vale `['ninetynineminutes']` por defecto (`backend/src/modules/settings/settings.constants.ts:545`),
   y la recomendada es la más barata **de la paquetería preferida**, no la más barata de todas
   (`backend/src/modules/shipping-provider/rate-normalization.ts:147-159`). Resultado: la recomendada es
   99minutos a **$70.15** (sobre, CDMX), **$121.28** (caja, CDMX) o **$158.14** (caja, Monterrey) + seguro, con
   `ACQ_2026`. Las de $51.25 sí están en la lista (ordenada de más barata a más cara), pero **no son la
   marcada**. El valor real de ese ajuste en producción es **NO MEDIDO** (se cierra viendo Ajustes en el panel
   o leyendo `shipping_preferred_carriers` en la BD).
2. **El precio que enseña la tienda lleva el seguro sumado.** `priceCents = total + seguro`
   (`backend/src/modules/shipments/label-quote.service.ts:93`). Una promo de $51.25 sale como **$76.25** con
   seguro de $2,500 ($25), y como **$221.25** si el pedido vale más y toca el escalón de $10,000 ($170). Eso ya no
   parece «$50».
3. **La de $1.19 (PuntoPost) va escondida** en el grupo de sucursal (`hidden` si es solo sucursal,
   `label-quote.service.ts:123`; `QuoteViews.tsx:92-93`), porque no tiene recolección.
4. **J&T «Sin Recolección» a $51.25 tiene la promo pero Skydropx la manda con `success: false`**; la tienda la
   trata como no disponible (`rate-normalization.ts:61`). Si el dueño la usaba en el panel, en la tienda no está.
   Por qué Skydropx la marca así es **NO MEDIDO** (se pregunta a Skydropx).
5. **Si lo que ve son los precios del checkout del cliente**, esos no salen de Skydropx: el envío al comprador
   es la tarifa fija `shipping_fee_cents` (MX$175 por defecto, `settings.constants.ts:359`).

**En qué casos llega la promo:** Paquetexpress Nacional, ampm Plataformas y FedEx Express Saver (~$51–52, con
recolección) en los tres destinos y con sobre y caja; Sendex by Coordi solo con caja; PuntoPost a $1.19 solo
en sucursal. **No llega** con 99minutos, Estafeta, DHL, UPS, Imile, Yaslan ni Coordi Reg.

**Cómo se cierra:** abrir «Capturar guía» en un pedido real de la tienda, comprobar que en la lista aparecen
Paquetexpress / ampm / FedEx con la etiqueta «Promoción», y mirar cuál está marcada como «Recomendada». Si es
99minutos, la causa es la 1 y se arregla cambiando la paquetería preferida (decisión del dueño, no de este
informe).
