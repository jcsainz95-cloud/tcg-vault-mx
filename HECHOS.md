# HECHOS — TCG HUNT

> **Qué es este fichero:** lo que el dueño ya estableció y **no se vuelve a preguntar**, más los hechos de
> infraestructura **medidos** (con fecha y cómo). Toda sesión lo lee al arrancar, antes que `PENDIENTES.md`.
> Se edita solo cuando el dueño cambia un hecho o una medición nueva lo refuta (regla O-2). Un hecho sin fecha
> ni fuente no entra aquí: va a `PENDIENTES.md` como «NO MEDIDO».
>
> Última revisión: 2026-09-11 (orquestador, sesión 2: añadida la decisión sobre la contraseña temporal). Origen: sección «HECHOS DEL NEGOCIO» de `PENDIENTES.md`, movida aquí.

> Esta sección existe porque el orquestador preguntó **cinco veces** lo mismo. Un hecho que el dueño ya
> estableció y que un agente vuelve a preguntar **le gasta su tiempo y le hace repetirse**. Antes de
> preguntarle cualquier cosa, se lee esta lista (regla **O-6**).

| Hecho | Establecido | Consecuencia operativa |
|---|---|---|
| **La tienda SIEMPRE ha estado en modo prueba de Stripe. NO se ha transaccionado dinero real. Se pasa a modo real cuando cierre todo.** | 2026-09-10 (repetido 5 veces por el humano) | `STRIPE_SECRET_KEY = sk_test_…` en producción **es correcto y deliberado**. ⛔ NO es una emergencia, NO hay ventas perdidas, NO se revierte. El cambio a `sk_live_…` —y el `whsec_` del endpoint de modo real, que es **distinto**— es un paso del **cierre**, no de hoy. |
| **No hay staging. Solo producción.** | 2026-09-10 | ⛔ No se piden credenciales de staging. El blanco de seguridad es **local**. |
| **Las claves de PRUEBA de Stripe YA ESTÁN en los secrets de GitHub** (`STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_PUBLISHABLE_KEY`), desde el **2026-09-07**. | 2026-09-10, con captura | ⛔ **NO se le vuelven a pedir.** El gate de dinero **puede correr**. Ver el error de medición abajo. |
| **El repositorio es PÚBLICO.** | briefing original | Ningún secreto, ni de mentira, puede vivir en el árbol. |
| **La contraseña temporal (reseteo por el admin) OBLIGA a cambiarla antes de dejar operar.** Decisión textual: «Que obligue a cambiarla». | 2026-09-11 (sesión 2, al presentarle P-75) | `mustChangePassword` pasa de aviso sin consecuencia a **bloqueo**: el contrato define el guard y el error (`docs/API_CONTRACT.md`, Stream A); el frontend lleva al usuario a la pantalla de cambio y no le deja esquivarla. No se vuelve a preguntar. |

## ⚠️ ERROR DE MEDICIÓN DEL EQUIPO — «los tres flujos de dinero nunca se han ejecutado»

**Es FALSO, y lo afirmamos cinco pases seguidos.** Lo midió el orquestador el 2026-09-10:

- Run **`34477885121`** (`e2e-real.yml`, nocturno, 2026-09-10 12:38 UTC, sobre `main` = `5f05b08`): **success**.
  - Paso 4 «Preflight Stripe — clasificar las claves de PRUEBA por su FORMA» → **success**
  - Paso 15 «**Playwright smoke — flujos críticos (REAL)**» → **success**
  - Variable de salida del job: **`MONEY_SKIPPED:` (vacío)** ⇒ **no se saltó nada**.

⇒ **Los flujos de dinero SÍ corren, y corrieron hoy, con las claves reales de prueba.**

**Causa del error, y es la lección:** QA y devops corrieron `scripts/stripe-test-key-preflight.sh` **en la máquina local**, donde `STRIPE_TEST_SECRET_KEY` sencillamente no está definida — los secrets de GitHub **solo existen dentro de un runner de Actions**. El script contestó «secret NO configurado en GitHub», que es lo único que podía contestar, y **el equipo entero leyó una medición local como si fuera una medición de GitHub**. El orquestador la relayó al humano cinco veces sin comprobarla.

> **Es la regla O-1 al revés:** no afirmé un estado sin medirlo — **acepté la medición de otro sin comprobar
> que medía lo que decía medir**. Un preflight corrido en el sitio equivocado no dice «no hay clave»: dice
> «aquí no la veo».

**Lo que SÍ está pendiente, y es otra cosa:** ese run fue sobre **`main`**, no sobre el candidato. Correr
`e2e-real.yml` contra la rama es lo que certifica los tres flujos **de este release** — lanzado por el
orquestador el 2026-09-10.

- **La rama que despliega es `production`, no `main`** (medido 2026-09-11 con la API de deployments de GitHub:
  los commits de `production` —`e117441`, `538ab51`, `f04f2dc`— reciben deployment **Production** (Vercel) y
  **«marvelous-kindness / production»** (Railway); los de `main` —`5f05b08`, `3b36f19`— solo reciben **Preview**
  de Vercel). Fusionar a `main` **no publica**; `git push origin production` **sí**. Resuelve la contradicción entre
  `docs/DEVOPS_NOTES.md:2280` (decía `main`) y `:3313` (decía `production`): gana `:3313`. `vercel.json` construye
  ambas ramas, por eso `main` genera una vista previa. Árbol de `production` == árbol de `main` (`git diff` vacío).
