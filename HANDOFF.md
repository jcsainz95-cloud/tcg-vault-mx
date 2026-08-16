# TCG Vault MX — Handoff / Estado del proyecto

> Documento de traspaso para retomar el proyecto desde una sesión local en otra computadora.
> Última actualización: 2026-08-16.

---

## 1. Qué es el proyecto

**TCG Vault MX** es un **marketplace de cartas Pokémon TCG con bóveda/custodia** (vault) para México.
El negocio: los clientes **compran** cartas, las guardan en **custodia** (bóveda física de la plataforma),
las **venden** a la plataforma (buylist/cotizador), piden **envíos** de sus cartas, y pueden abrir
**disputas**. Hay back-office (admin) para operar inventario, precios, finanzas, usuarios, KYC y disputas.

- **Frontend:** Next.js 15 (App Router), next-intl (i18n ES/EN con test de paridad), TanStack Query, Tailwind.
- **Backend:** NestJS, Prisma + PostgreSQL, BullMQ + Redis (jobs diarios), argon2, Stripe, AWS SDK v3 (S3-compat).
- **Catálogo/precios:** API de **pokemontcg.io** (sync de sets/cartas + `tcgplayer.prices` por acabado).
- **Almacenamiento INE (KYC):** Cloudflare R2 (S3-compatible), bucket privado, presigned PUT/GET.
- **Correo transaccional:** Resend (verificación de email + recuperación de contraseña).

### Invariante de seguridad clave (SEC-A1)
El **monto de cualquier cotización/compra se deriva SIEMPRE server-side** de `(Card.rarity, finish)` validado
contra reglas — **nunca** de un precio/categoría/monto que mande el cliente. No romper esto.

---

## 2. Cómo se trabaja (equipo de subagentes)

Ver `CLAUDE.md`. La sesión principal **orquesta** y **delega**; no implementa directo. Roles:
`product-owner → arquitecto → (ux-ui ∥ devops) → (backend ∥ frontend) → qa → techlead → pentester → seguridad → devops(deploy)`.

- **El contrato manda sobre el código; `PROJECT.md` manda sobre el contrato.**
- Propiedad de archivos estricta (tabla en `CLAUDE.md`): cada rol escribe solo en sus rutas.
- Cambios a dinero/pricing/auth/PII pasan por **arquitecto (contrato) → implementación → verdictos (qa+techlead+seguridad)**.
- Docs vivos en `docs/`: `ARCHITECTURE.md`, `API_CONTRACT.md`, `DESIGN_SYSTEM.md`, `*_NOTES.md`,
  `PENTEST_NOTES.md`, `SECURITY_NOTES.md`, `TECH_DEBT.md`.

---

## 3. Despliegue (producción actual)

| Pieza | Dónde | Notas |
|---|---|---|
| **Frontend** | Vercel | Root Directory = `frontend`, preset Next.js. Auto-deploy desde `main`. |
| **Dominio** | Cloudflare DNS → Vercel | `www.tcgvaultmx.com` (canónico) + apex `tcgvaultmx.com` (redirect) + `tcg-vault-mx.vercel.app`. CNAME **DNS only** (nube gris). |
| **Backend** | Railway | `Dockerfile.backend`. Corre `prisma migrate deploy` en cada deploy. Auto-deploy desde `main`. |
| **DB** | Railway Postgres | `DATABASE_URL`. |
| **Redis** | Railway | `REDIS_URL` (habilita el scheduler BullMQ diario). |
| **INE (KYC)** | Cloudflare R2 | bucket `tcg-kyc-ine`, privado. CORS ya configurado con los dominios reales (PUT/GET, `content-type`). |
| **Correo** | Resend | dominio `tcgvaultmx.com` **Verified** (SPF/DKIM). |
| **Pagos** | Stripe | **claves de TEST por ahora** (falta pasar a live — ver pendientes). |
| **Catálogo** | pokemontcg.io | `POKEMONTCG_IO_API_KEY` puesta. |

### Variables de entorno (los VALORES viven en Railway/Vercel, NO en el repo)
Backend (Railway): `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PII_ENCRYPTION_KEY`,
`PII_HMAC_KEY`, `APP_BASE_URL` (lista con `https://tcg-vault-mx.vercel.app,https://www.tcgvaultmx.com,https://tcgvaultmx.com`),
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `S3_ENDPOINT`/`S3_BUCKET`/`S3_REGION=auto`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_FORCE_PATH_STYLE=false`,
`KYC_UPLOAD_MAX_BYTES`, `INE_RETENTION_DAYS`, `DISPUTE_EVIDENCE_CONTACT=soporte@tcgvaultmx.com`,
`RESEND_API_KEY`, `MAIL_FROM=no-reply@tcgvaultmx.com`, `POKEMONTCG_IO_API_KEY`, `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`,
`SEED_OPERATOR_EMAIL`/`SEED_OPERATOR_PASSWORD`. (Falta `GOOGLE_CLIENT_ID` — ver pendientes.)
Frontend (Vercel): `NEXT_PUBLIC_API_BASE_URL` (…/api/v1), `NEXT_PUBLIC_USE_MOCKS=false`, `NEXT_PUBLIC_DEFAULT_LOCALE=es`.
(Falta `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — ver pendientes.) **`NEXT_PUBLIC_*` se hornea en build → requiere redeploy al cambiarla.**

> ⚠️ Nunca commitear secretos: el repo es público. Los valores se ponen en los dashboards.

---

## 4. Qué está construido y desplegado (`main`)

Historial de versiones (cada una con sus verdictos qa+techlead+seguridad y migración Prisma):

- **v1.1 / v1.2** — Base: catálogo, tienda (Compra), cotizador/buylist, checkout Stripe, bóveda/custodia, envíos,
  disputas (evidencia por correo), KYC/INE, back-office M1–M10, login email/contraseña + **Google** (ID token server-side),
  jobs diarios (fx, price-sync, portfolio-snapshot).
- **v1.3.x** — Reglas de precio de buylist por rareza oficial (editable desde admin M2); reset de contraseña por admin
  y **eliminar usuarios** (M-15, híbrido hard/soft); presets de rango en reportes; robustez del sync.
- **v1.4-finance (M-16)** — **Costo real de paquetería** en P&L (`ShipmentRequest.shippingCostCents`; se resta en finanzas M7).
- **v1.5 (M-17)** — **Verificación de email + recuperación de contraseña self-service** (Resend; tokens un-solo-uso SHA-256;
  `EmailVerifiedGuard` bloquea comprar/vender/retirar sin verificar).
- **v1.6-finish (M-18)** — **Acabados/versiones de carta** (Normal / Reverse Holo / Holofoil / 1st Edition) en toda la cadena:
  `Card.availableFinishes`, `finish` en clave de precio + inventario + sell-request; resolver finish→regla server-side;
  selector de acabado en cotizador; filtro/faceta en Compra; badge en bóveda/M1.
- **v1.7-admin-users** — **Crear usuarios por rol** desde admin (`POST /admin/users`, super_admin, auditado) +
  **historial 360° de usuario** (pestañas: compras/ventas/envíos/disputas/bóveda/actividad; filtros `?userId=`; `GET /admin/users/:id/audit`).

### Correcciones/mejoras de esta última tanda (todas en `main`)
- **INE "no se puede cargar"** → arreglado: `S3Client` con `requestChecksumCalculation:'WHEN_REQUIRED'` (el SDK v3 firmaba
  headers de checksum que el navegador no manda → 403); **CORS de R2** con dominios reales; **compresión de foto** client-side
  (canvas→JPEG, normaliza HEIC, evita el tope de 10 MB).
- **Versiones no salían en el cotizador** → causa: `sync-all` saltaba sets ya importados. Se añadió **modo `force`**
  (`POST /admin/catalog/sync-all` con `force=true`) + botón **"Re-sincronizar todo (forzar)"** en M2.
- **Idioma por defecto español** → `localeDetection:false` en next-intl (antes redirigía a `/en` por el navegador).
- **M1 alta de inventario por set** → el picker ahora usa el **catálogo real** con filtro por set (antes `mockCards`) + botón "Crear" cableado.
- **Bóveda por set + valor** → filtro por set con subtotales de valor por set y total filtrado.

---

## 5. ⚠️ Acciones operativas pendientes (dashboards / una sola vez)

1. **CORRER EL RE-SYNC FORZADO DEL CATÁLOGO** (crítico para que se vean los acabados):
   admin → **M2** → botón **"Re-sincronizar todo (forzar)"** (o `POST /api/v1/admin/catalog/sync-all` con `{force:true}` como super_admin).
   Hasta correrlo, las cartas ya importadas quedan en `['normal']` y el selector de acabado no aparece. Idempotente.
   Después, el price-sync diario mantiene los precios por acabado.
2. **Probar el INE** en producción (con el CORS ya puesto): subir foto de INE en el cotizador → debe cargar.

---

## 6. Pendientes de producto/config (backlog)

- **Stripe live:** cambiar `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` a claves reales y **probar con sandbox** primero.
- **Google sign-in:** crear OAuth Client ID (Web) en Google Cloud; **Authorized JavaScript origins** = los 3 dominios;
  `NEXT_PUBLIC_GOOGLE_CLIENT_ID` en Vercel (**rebuild**) + `GOOGLE_CLIENT_ID` (mismo valor) en Railway. Hoy el botón cae a mock → falla.
- **Buzones que reciben** (`soporte@` / `facturacion@tcgvaultmx.com`): Cloudflare **Email Routing** → reenviar a un Gmail
  (Resend solo ENVÍA, no recibe). Opcional: "Send as" en Gmail vía SMTP de Resend.
- **Diseño (Claude Design):** import de `Pantallas.dc.html` + `support.js` — se está trabajando en **otra sesión** (Claude Code Web).
  Si esa sesión empuja a `main`, hacer `git pull` antes de continuar aquí.

## 7. Deuda técnica / seguridad (ver `docs/TECH_DEBT.md` y `docs/SECURITY_NOTES.md`)

- **Cablear los jobs de barrido al scheduler** (hoy NINGUNO corre solo): `ine-retention` (borrado PII), `buylist-sweep`
  (plazos 7d/30d), `dispute-deadline`, `auth-token-sweep`. **Necesario antes de operar con dinero/clientes reales.**
- **Historial de usuario — pestaña Bóveda:** enriquecer `AdminUserOwnedItemRef` con `finish` + `referenceValue`
  (o `GET /admin/users/:id/holdings`) para mostrar acabado y valor (hoy solo carta+folio+titularidad). → arquitecto + backend + frontend.
- **`PendingPriceEntry` sin `finish`** (higiene de cola de precios pendientes; no afecta dinero). → arquitecto + backend.
- Bajas aceptadas (no bloqueantes): dinero en `Int32` (topes lejanos), timing en forgot-password, token en URL,
  cap en `approvedPriceCents`, dep `@nestjs/core` (no explotable). Todas registradas.
- **Antes de dinero real:** **DAST contra staging** (no hay staging aún), pentest de tercero, MFA en back-office, validación legal de custodia/PII.

---

## 8. Cómo retomar en local (otra computadora)

```bash
git clone https://github.com/jcsainz95-cloud/tcg-vault-mx.git
cd tcg-vault-mx

# Infra local (Postgres + Redis + MinIO como S3 local):
docker compose up -d            # ver docker-compose.yml

# Variables: copiar y ajustar (valores locales, NO los de prod)
cp .env.example .env            # rellenar según .env.example / docs/DEVOPS_NOTES.md

# Backend
cd backend && npm install
npx prisma migrate deploy        # aplica M-1..M-18
npm run start:dev                # NestJS en :3001 (o el que use la config)

# Frontend (otra terminal)
cd ../frontend && npm install
npm run dev                      # Next.js en :3000  (NEXT_PUBLIC_USE_MOCKS=false para pegar al backend real)
```

Gates por paquete (déjalos verdes antes de commitear): `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
Estado actual: **backend 325 tests / frontend 163 tests**, todos verdes.

### Flujo de trabajo al continuar
- `git pull` primero (por si la sesión de diseño empujó cambios).
- Usa el **equipo de subagentes** (`CLAUDE.md`): arquitecto para cambios de contrato, luego backend/frontend, luego verdictos.
- Cualquier cambio a dinero/pricing/auth/PII → contrato primero + verdictos qa/techlead/seguridad.
- Tras desplegar algo que toque catálogo/precios por acabado → **re-sync forzado** (§5).

---

## 9. Punteros rápidos de código

- Contrato/verdad: `docs/API_CONTRACT.md` · Arquitectura/migraciones: `docs/ARCHITECTURE.md` (§11 lista M-1..M-18).
- Pricing por acabado: `backend/src/common/money.ts` (resolver finish→regla) + `backend/src/modules/pricing/`.
- INE upload: `backend/src/modules/uploads/uploads.service.ts` + `frontend/src/components/ui/PhotoUploader.tsx`.
- Sync catálogo: `backend/src/modules/catalog/catalog-sync.service.ts` (+ `force`).
- Usuarios admin: `backend/src/modules/admin/admin.controller.ts` + `admin.service.ts`; UI `frontend/.../admin/m6/M6View.tsx`.
- Cotizador (carrito + acabados): `frontend/.../(storefront)/buylist/BuylistView.tsx`.
- Jobs/scheduler: `backend/src/jobs/scheduler.service.ts` (⚠️ los sweeps aún no están cableados aquí).
