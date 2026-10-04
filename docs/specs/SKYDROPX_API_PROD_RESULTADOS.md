# Skydropx PRO API (producción): resultados de la medición

> **Procedencia:** sesión `claude/skydropx-api-prod`, **2026-10-04**, encargo del orquestador con la
> autorización del dueño del 2026-10-04 (medir la API de producción sin gastar saldo). Solo lectura y
> cotización. Ninguna credencial ni token aparece en este fichero.

## Resultado: no se pudo autenticar. Nada de la API quedó medido.

| Fecha/hora (UTC) | Endpoint | HTTP | Respuesta |
|---|---|---|---|
| 2026-10-04 (ver `git log` de este fichero) | `POST {SKYDROPX_BASE_URL}/oauth/token` (`grant_type=client_credentials`, form-urlencoded) | **401** | `{"error":"invalid_client","error_description":"La autenticación del cliente ha fallado por cliente desconocido, cliente no autenticado, o método de autenticación incompatible."}` |

Solo se hizo **esa petición**. No se reintentó con otro formato ni con otro host, porque la causa está en
las variables, no en la llamada:

- `env | grep -c '^SKYDROPX_'` = **3** (las tres variables existen).
- `SKYDROPX_BASE_URL` apunta a `https://pro.skydropx.com/api/v1` (producción, el host de la referencia §1).
- **`SKYDROPX_CLIENT_ID` y `SKYDROPX_CLIENT_SECRET` no tienen forma de credencial:** miden 12 y 15
  caracteres y son **texto entre paréntesis, con espacios** (medido por clase de carácter, sin imprimir el
  valor). Un `client_id` OAuth real es una cadena larga sin espacios. Son, con toda probabilidad, **texto de
  relleno** que quedó en la configuración del entorno en lugar de los valores del panel
  (*Conexiones → API*).

## Qué sigue NO MEDIDO (todo lo del encargo)

1. Token: duración real (`expires_in`).
2. Cotizaciones 14210 → 10 destinos: paqueterías, servicios, precios, IVA desglosado, nombres de campos,
   días, 99minutos (T7), seguro con $2,500 / $10,000 (T1).
3. Forma de la cotización (síncrona/asíncrona, `is_completed`), campos de tarifa, `tracking_url_provider`.
4. Carta Porte (`GET /shipments/consignment_notes`, `GET /shipments/packagings`) para cartas (T2/H4).
5. Webhooks / configuración legible por GET.

## Qué lo cierra

El dueño pega en las variables del entorno los valores reales de *Conexiones → API* del panel de
Skydropx PRO (`Client ID` y `Client Secret`) y se relanza el mismo encargo. Medición de comprobación
previa, sin gastar nada: que `POST /oauth/token` devuelva 200.
