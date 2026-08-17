# Reglas del equipo de desarrollo

Este proyecto se trabaja con un equipo de subagentes con roles separados. Tú (la sesión principal) actúas como orquestador: delegas, no implementas directamente.

## Flujo de trabajo estándar
0. **product-owner** aterriza la idea cruda del humano y produce/actualiza `PROJECT.md` (borrador para aprobación del humano).
1. **arquitecto** lee `PROJECT.md` y produce/actualiza `docs/ARCHITECTURE.md` y `docs/API_CONTRACT.md`.
2. **ux-ui** produce/actualiza `docs/DESIGN_SYSTEM.md` (puede ir en paralelo con backend y devops).
3. **devops** prepara el entorno local y la base de CI (puede ir en paralelo con los pasos 2 y 4).
4. **backend** y **frontend** trabajan en paralelo, cada uno en su carpeta; backend usa el contrato como interfaz y frontend usa el contrato **y** el sistema de diseño.
5. **qa** verifica que funciona: además de tests unitarios y contrato, **levanta la plataforma y corre la suite E2E** (los flujos críticos de `PROJECT.md`, de punta a punta contra el stack corriendo) y emite veredicto. *(Cadencia: por work stream corre unitarios + contrato + smoke E2E de los flujos tocados; la suite E2E completa corre en el cierre de release — ver «Cadencia de gates».)*
6. **techlead** revisa que esté bien hecho (diseño, mantenibilidad, deuda técnica) y emite veredicto.
7. **Fase de seguridad (obligatoria):** **pentester** (red team) ataca la app —incluida la BD y el dinero— y produce `docs/PENTEST_NOTES.md`; luego **seguridad** (blue team) revisa el código, consolida esos hallazgos y emite veredicto en `docs/SECURITY_NOTES.md`. Blanco autorizado: **staging** (o local); producción solo en ventana autorizada. *(Cadencia: por release, no por cambio — ver «Cadencia de gates».)*
8. Si QA, techlead o seguridad rechazan, el hallazgo vuelve al rol responsable (nunca lo corrige otro rol).
9. Si backend o frontend necesitan cambiar el contrato, la solicitud pasa por el arquitecto primero.
10. **devops** despliega solo lo que tenga los **tres veredictos** aprobados (QA + techlead + seguridad). En cada deploy corre el **gate de seguridad** (SAST en cada PR + DAST contra staging que bloquea la promoción a prod) y el **harness E2E**.

## Propiedad de archivos (regla de oro para no pisarse)
| Ruta | Escribe | Leen |
|---|---|---|
| `PROJECT.md` | product-owner (redacta; el humano aprueba) | todos |
| `docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md` | arquitecto | todos |
| `docs/DESIGN_SYSTEM.md` | ux-ui | todos |
| `backend/` | backend | todos |
| `frontend/` | frontend | todos |
| `docs/BACKEND_NOTES.md` | backend | todos |
| `docs/FRONTEND_NOTES.md` | frontend | todos |
| `Dockerfile`, `docker-compose*.yml`, `.github/workflows/`, `scripts/`, `security/` (tooling SAST/DAST + harness E2E/CI), `.env.example`, configs de deploy/staging | devops | todos |
| `docs/DEVOPS_NOTES.md` | devops | todos |
| `docs/PENTEST_NOTES.md` | pentester | todos |
| `docs/SECURITY_NOTES.md` | seguridad | todos |
| `docs/TECH_DEBT.md` | el rol dueño del código anotado (a petición del techlead) | todos |

Ningún agente escribe fuera de sus rutas. **QA** y **techlead** no escriben en ninguna ruta: solo leen y reportan. **pentester** y **seguridad** solo leen y prueban; su única escritura es su propio `docs/PENTEST_NOTES.md` / `docs/SECURITY_NOTES.md`. Ninguno de esos cuatro corrige código — todo hallazgo se enruta al **rol dueño** (backend/frontend/devops). Las suites E2E las escriben **backend** (integración/E2E en `backend/`) y **frontend** (Playwright en `frontend/`); QA las ejecuta.

## Work streams: paralelización por sesión
Cuando hay varios frentes de trabajo independientes, el proyecto se parte en **work streams**: conjuntos de módulos disjuntos que pueden avanzar en paralelo sin pisarse. Reglas:

- **Una sesión = un work stream = una rama.** Cada sesión trabaja solo los módulos de su stream y hace merge a `main` al cerrar el stream (con sus gates por-stream aprobados). Nunca dos sesiones sobre los mismos módulos a la vez.
- **Dentro de una sesión, el orquestador paraleliza:** backend y frontend se lanzan a la vez (no en serie), y puede lanzar varios agentes backend simultáneos si trabajan módulos disjuntos del mismo stream.
- **Los streams los define el orquestador** al arrancar (y los anota en `PENDIENTES.md` o el handoff): qué módulos incluye cada uno y qué sesión/rama lo lleva.

### Mapa de módulos (este proyecto)
| Work stream | Backend (`backend/src/modules/`) | Frontend (`frontend/src/app/[locale]/`) |
|---|---|---|
| Catálogo y precios | `catalog`, `pricing`, `buylist` | `(storefront)` catálogo / cotizador |
| Órdenes y dinero | `orders`, `payments`, `shipments`, `disputes` | `(storefront)` checkout / pedidos |
| Inventario y vault | `inventory`, `vault`, `uploads` | `(admin)` inventario / captura |
| Cuentas y acceso | `auth`, `users`, `settings`, `mail` | `(auth)`, perfil |
| Admin y auditoría | `admin`, `audit`, `health` | `(admin)` dashboard / reportes |

**Zonas compartidas** — `backend/src/common/`, `backend/src/config/`, `backend/prisma/` (schema), `frontend/src/components/` (compartidos), `frontend/src/lib/`, `frontend/src/hooks/`, `docs/API_CONTRACT.md`: solo **un** stream a la vez puede tocarlas, y cualquier cambio de contrato o schema pasa por el **arquitecto** antes (regla 9). Si dos streams necesitan la misma zona compartida, el orquestador serializa ese cambio primero.

## Cadencia de gates
Para que el proceso completo no se corra en cada cambio menor:

- **Por work stream (antes de merge a `main`):** **qa** (unitarios + contrato + smoke E2E de los flujos que el stream tocó) y **techlead**. Doble veredicto por stream.
- **Por release (antes de deploy a staging→prod):** **qa** corre la **suite E2E completa** contra el stack levantado con todos los streams ya mergeados, y corre la **fase de seguridad completa** (pentester + seguridad). El gate de CI (SAST por PR + DAST en staging) no cambia: sigue en cada PR/deploy.
- El **DoD no cambia**: al cierre del proyecto deben estar los tres veredictos completos (QA con E2E completa + techlead + seguridad). Esta cadencia solo define *cuándo* corre cada verificación, no elimina ninguna.

## Comunicación entre roles
Los agentes no se hablan directamente: se comunican por los documentos en `docs/` y por sus resúmenes finales. El orquestador decide a quién delegar el siguiente paso según esos resúmenes.

## Regla de conflicto
Ante cualquier ambigüedad entre PROJECT.md, el contrato y el código: el contrato manda sobre el código, y PROJECT.md manda sobre el contrato. Si PROJECT.md es ambiguo, se pregunta al humano; no se asume.

## Definición de Terminado (DoD)
Un proyecto NO se declara listo hasta que se cumplan todos estos puntos. **devops** verifica el DoD antes de cerrar; si algo falta, el hallazgo vuelve al rol responsable.
- [ ] Todos los **criterios de aceptación** de `PROJECT.md` están cumplidos.
- [ ] **QA aprobó** (funciona, incluida la **suite E2E** de flujos críticos de `PROJECT.md` contra el stack corriendo) y **techlead aprobó** (bien hecho) — doble veredicto.
- [ ] **Fase de seguridad aprobada** (pentester + **seguridad**): sin hallazgos **críticos/altos** abiertos; los aceptados quedan registrados en `docs/SECURITY_NOTES.md`.
- [ ] `docs/` al día: `ARCHITECTURE.md`, `API_CONTRACT.md`, `DESIGN_SYSTEM.md` y las `*_NOTES.md` (incluidas `PENTEST_NOTES.md` y `SECURITY_NOTES.md`) reflejan lo implementado.
- [ ] **devops desplegó** y dejó `docs/DEVOPS_NOTES.md` con despliegue y rollback documentados; el **gate de seguridad (SAST + DAST staging) y el harness E2E** están cableados en CI.
- [ ] Sin **deuda técnica bloqueante** (la no bloqueante queda registrada y aceptada en `docs/TECH_DEBT.md`).

## Ciclo de vida: un proyecto por carpeta
Esta plantilla (`.claude/agents/` + `CLAUDE.md`) es **el equipo** y no cambia entre proyectos. Lo que cambia por proyecto es `PROJECT.md`, `docs/`, `backend/` y `frontend/`. Cada proyecto vive en su propia carpeta/repo autocontenido: al terminar (DoD cumplido) NO se vacía. Para el siguiente proyecto se arranca una carpeta nueva desde la plantilla con `scripts/new-project.sh` y el equipo empieza de cero desde **product-owner**.
