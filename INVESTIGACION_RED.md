# Investigación de red — TCG HUNT (`tcghunt.mx`)

**Medido el 2026-10-05, ~20:20 UTC.** Solo lectura: consultas DNS públicas y GET. En total, **5 peticiones HTTP a producción** (3 a `tcghunt.mx`, 2 al backend). Sin formularios, sin login, sin escaneos.
Estado del repo al medir: `origin/production` = `fe2b58d`, `origin/main` = `bb239c0`.

Herramienta DNS: no hay `dig` en el contenedor; se usó el resolvedor público de Google por HTTPS:
```
curl -sS "https://dns.google/resolve?name=<NOMBRE>&type=<TIPO>"
```

---

## 1. DNS del correo

| Registro | Valor medido (resumido) | Juicio |
|---|---|---|
| `tcghunt.mx` MX | `1 aspmx.l.google.com` · `5 alt1` · `5 alt2` · `10 alt3` · `10 alt4` (`.aspmx.l.google.com`) | ✅ Google Workspace completo, sin MX de más. |
| `tcghunt.mx` TXT | `v=spf1 include:_spf.google.com ~all` + `google-site-verification=…` | ✅ **Un único SPF**, incluye `_spf.google.com`. |
| `_dmarc.tcghunt.mx` TXT | `v=DMARC1; p=none;` | ⚠️ Política **`none`**: solo observa, no rechaza ni manda a spam. Tampoco tiene `rua=` (nadie recibe informes). |
| `google._domainkey.tcghunt.mx` TXT | `v=DKIM1;k=rsa;p=MIIBIjAN…` (clave RSA 2048) | ✅ DKIM de Google publicado. |
| `send.tcghunt.mx` TXT | `v=spf1 include:amazonses.com ~all` | ✅ SPF propio de Resend (usa Amazon SES) en el subdominio. |
| `send.tcghunt.mx` MX | `10 feedback-smtp.us-east-1.amazonses.com` | ✅ El MX de rebotes que pide Resend. Vive en el subdominio, **no choca** con el MX de Google de la raíz. |
| `resend._domainkey.tcghunt.mx` TXT | `p=MIGfMA0G…` (clave RSA 1024) | ✅ DKIM de Resend publicado. |

**En llano:**
- El correo de personas (Google Workspace) y el correo automático de la tienda (Resend) están separados correctamente: Google en la raíz, Resend en `send.`. **No hay conflictos**: un solo SPF en la raíz, ningún MX sobrante.
- ¿Necesita Resend su propio SPF? **Sí, y lo tiene** en `send.tcghunt.mx`. Como el remitente visible es `@tcghunt.mx` y el de rebotes es `send.tcghunt.mx`, DMARC lo da por alineado (modo relajado, mismo dominio base).
- **Lo único mejorable es DMARC:** con `p=none` alguien puede suplantar `@tcghunt.mx` y los buzones no lo frenan. Siguiente paso típico: añadir `rua=mailto:…` para recibir informes unas semanas y luego subir a `p=quarantine`. *Esto es una recomendación, no una medición.*

---

## 2. Salud de producción

Comandos:
```
curl -sS -o out.html -D out.hdr -w "%{http_code}" https://tcghunt.mx/<ruta>
curl -sS https://tcg-vault-mx-production.up.railway.app/api/v1/health
curl -sS https://tcg-vault-mx-production.up.railway.app/health
```

| URL | Código | Detalle |
|---|---|---|
| `https://tcghunt.mx/es` | **200** | 379 KB, 1.4 s. Título «TCG HUNT — Compra y vende cartas Pokémon en México, con bóveda…». |
| `https://tcghunt.mx/es/privacidad` | **404** | Página genérica de Next «404: This page could not be found» (`x-matched-path: /404`). **No se ve el aviso de privacidad**, así que tampoco la fila «Skydropx». |
| `https://tcghunt.mx/en/privacidad` | **404** | Igual que la anterior. |
| Backend `/api/v1/health` | **200** | `{"status":"ok","uptime":2179,"db":"up","redis":"up", "timestamp":"2026-10-05T20:20:33.882Z"}` — base de datos y Redis arriba; el proceso llevaba ~36 min vivo. |
| Backend `/health` | 404 | Ruta inexistente (esperado; la buena es la de arriba). |

**Por qué da 404 la privacidad (medido en git, no en Vercel):** la ruta `frontend/src/app/[locale]/(storefront)/privacidad/page.tsx` **no existe** ni en `origin/production` (`fe2b58d`) ni en `origin/main` (`bb239c0`). Solo existe en la rama **no fusionada** `origin/claude/listo-real` (`7bca24ce`). Comando:
```
for b in $(git branch -r); do git ls-tree -r --name-only $b -- frontend/src/app | grep -qi privac && echo $b; done
→ origin/claude/listo-real
```
Qué commit sirve Vercel exactamente: **NO MEDIDO** (la respuesta no lo expone; lo cerraría mirar el despliegue activo en el panel de Vercel). Lo medido es coherente con que esté publicado `fe2b58d`.

Ojo, relacionado: la portada `/es` contiene el texto del checkout «Acepto los términos y el aviso de privacidad…», es decir, **se pide aceptar un aviso que hoy no tiene página pública**.

### Cabeceras de seguridad de `https://tcghunt.mx/es` (solo se reportan)

| Cabecera | Valor |
|---|---|
| Content-Security-Policy | `frame-ancestors 'none'` (solo eso; no limita scripts ni orígenes) |
| Strict-Transport-Security | `max-age=63072000` (2 años; sin `includeSubDomains` ni `preload`) |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Otras vistas | `x-content-type-options: nosniff` · `x-powered-by: Next.js` · `server: Vercel` |

---

## 3. Vercel (documentación pública)

| Pregunta | Respuesta | Fuente |
|---|---|---|
| Publicaciones por día | **Hobby: 100/día. Pro: 6 000/día** (además, por API: Pro 450/hora y 120 cada 5 min; Hobby 100/hora y 60 cada 5 min). Si Hobby llega al tope, «hay que esperar otro día». | https://vercel.com/docs/limits (actualizada 2026-09-16) |
| Qué es «Vercel Agent» | Asistente de IA dentro de Vercel, **beta pública solo en Pro y Enterprise**. Hace: **Code Review** de PRs (busca vulnerabilidades, errores de lógica y de rendimiento, y valida sus arreglos en un sandbox con tus builds/tests); **Investigations** (analiza alertas, despliegues fallidos, errores en ejecución y costos, leyendo logs y métricas); chat en panel/Slack; e «Installation» (abre PRs para añadir productos Vercel). Se cobra por tokens usados. | https://vercel.com/docs/agent |
| Qué permisos pide | Usa **tus** permisos de Vercel y GitHub y **es de solo lectura por defecto**. Leer datos no sensibles (proyectos, despliegues, logs, métricas) se aprueba solo. **Requiere aprobación explícita de un plan**: leer datos sensibles (variables de entorno, tokens, repos privados), cambiar recursos de Vercel, y escribir en GitHub (abrir PR, comentar revisión). Cada aprobación vale solo para ese plan; los commits los firma la **GitHub App «Vercel Agent»** en ramas propias, contigo como coautor; todo queda en el historial de actividad del equipo. | https://vercel.com/docs/agent/chat/permissions (2026-09-18) |
| ¿MCP oficial de Vercel solo lectura? | Existe **MCP oficial** en `https://mcp.vercel.com` (OAuth, todos los planes; Claude Code y Claude.ai están en la lista de clientes admitidos). **No documenta un modo «solo lectura»**: incluye herramientas que escriben (despliegues, variables de entorno, dominios, compras/facturación) y «da a la IA el mismo acceso que tu usuario de Vercel». Lo que se puede acotar es **a qué equipos** autorizas la conexión. La única mención a «read-only» es una guía que da acceso de solo lectura a un agente vía «Vercel Connect». La alternativa realmente de solo lectura es el propio **Vercel Agent**, que lo es por defecto. | https://vercel.com/docs/agent-resources/vercel-mcp y `/tools` (2026-09-15) |

---

## 4. Railway: respaldos de Postgres

| Pregunta | Respuesta | Fuente |
|---|---|---|
| Cómo se activan | En el canvas del proyecto: clic en el servicio Postgres → **Settings** → pestaña **Backups** → elegir programación. Se pueden activar varias a la vez y cambiarlas cuando quieras; también hay respaldo **manual**. | https://docs.railway.com/reference/backups |
| Programaciones | **Diario** (se guarda 6 días) · **Semanal** (27 días) · **Mensual** (89 días). Respaldos manuales limitados al **50 % del tamaño del volumen**. | ídem |
| Cómo se restaura | 1) En la pestaña Backups, localizar el respaldo por su fecha y pulsar **Restore**. 2) Railway **deja el cambio «en escena»** (staged) para revisarlo. 3) Revisar con **Details** en el canvas. 4) Pulsar **Deploy**. Crea un **volumen nuevo** (con la fecha como nombre) montado en la misma ruta; el volumen original **se conserva desmontado**, así que se puede volver atrás. Tarda de segundos a minutos según tamaño. | ídem |
| ¿Cuesta aparte? | **Sí, se cobra el almacenamiento**, pero solo lo **incremental** (lo exclusivo de cada respaldo), por GB/minuto, facturado al mes. Precio de almacenamiento de volumen: **US$0.15 / GB / mes**. | backups + https://docs.railway.com/reference/pricing/plans |
| ¿Solo en Pro? | **NO MEDIDO**: ni la página de respaldos ni la de planes dicen qué planes lo incluyen. Lo cerraría abrir la pestaña Backups del Postgres en el panel del dueño (si aparece, está disponible). | — |

---

## Resumen

1. **Correo bien configurado y sin conflictos:** Google Workspace en la raíz (MX, SPF único con `_spf.google.com`, DKIM), Resend en `send.` con su propio SPF, MX de rebotes y DKIM. Único punto débil: **DMARC en `p=none` y sin `rua`**.
2. **Producción viva:** `/es` responde 200 y el backend reporta `ok` con BD y Redis arriba. Cabeceras: HSTS, `X-Frame-Options: DENY`, Referrer-Policy y una CSP mínima (solo `frame-ancestors`).
3. **El aviso de privacidad da 404** en `/es/privacidad` y `/en/privacidad`: la página solo existe en la rama no fusionada `claude/listo-real`, no en `production` ni `main`, y el checkout ya pide aceptarlo.
4. **Vercel:** Pro permite 6 000 publicaciones/día frente a 100 en Hobby. Vercel Agent (Pro/Enterprise, beta) es solo lectura por defecto y pide aprobación para cada escritura. El MCP oficial no tiene modo solo lectura.
5. **Railway:** respaldos en Settings → Backups (diario, semanal o mensual); al restaurar se crea un volumen nuevo y el original se conserva. Se cobra el almacenamiento incremental. Que el plan Pro sea requisito: NO MEDIDO.
