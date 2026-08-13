# Reglas del equipo de desarrollo

Este proyecto se trabaja con un equipo de subagentes con roles separados. Tú (la sesión principal) actúas como orquestador: delegas, no implementas directamente.

## Flujo de trabajo estándar
0. **product-owner** aterriza la idea cruda del humano y produce/actualiza `PROJECT.md` (borrador para aprobación del humano).
1. **arquitecto** lee `PROJECT.md` y produce/actualiza `docs/ARCHITECTURE.md` y `docs/API_CONTRACT.md`.
2. **ux-ui** produce/actualiza `docs/DESIGN_SYSTEM.md` (puede ir en paralelo con backend y devops).
3. **devops** prepara el entorno local y la base de CI (puede ir en paralelo con los pasos 2 y 4).
4. **backend** y **frontend** trabajan en paralelo, cada uno en su carpeta; backend usa el contrato como interfaz y frontend usa el contrato **y** el sistema de diseño.
5. **qa** verifica que funciona (tests, contrato, seguridad básica) y emite veredicto.
6. **techlead** revisa que esté bien hecho (diseño, mantenibilidad, deuda técnica) y emite veredicto.
7. Si QA o techlead rechazan, el hallazgo vuelve al rol responsable (nunca lo corrige otro rol).
8. Si backend o frontend necesitan cambiar el contrato, la solicitud pasa por el arquitecto primero.
9. **devops** despliega solo lo que tenga ambos veredictos aprobados.

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
| `Dockerfile`, `docker-compose.yml`, `.github/workflows/`, `scripts/`, `.env.example`, configs de deploy | devops | todos |
| `docs/DEVOPS_NOTES.md` | devops | todos |
| `docs/TECH_DEBT.md` | el rol dueño del código anotado (a petición del techlead) | todos |

Ningún agente escribe fuera de sus rutas. QA y techlead no escriben en ninguna: solo leen y reportan.

## Comunicación entre roles
Los agentes no se hablan directamente: se comunican por los documentos en `docs/` y por sus resúmenes finales. El orquestador decide a quién delegar el siguiente paso según esos resúmenes.

## Regla de conflicto
Ante cualquier ambigüedad entre PROJECT.md, el contrato y el código: el contrato manda sobre el código, y PROJECT.md manda sobre el contrato. Si PROJECT.md es ambiguo, se pregunta al humano; no se asume.

## Definición de Terminado (DoD)
Un proyecto NO se declara listo hasta que se cumplan todos estos puntos. **devops** verifica el DoD antes de cerrar; si algo falta, el hallazgo vuelve al rol responsable.
- [ ] Todos los **criterios de aceptación** de `PROJECT.md` están cumplidos.
- [ ] **QA aprobó** (funciona) y **techlead aprobó** (bien hecho) — doble veredicto.
- [ ] `docs/` al día: `ARCHITECTURE.md`, `API_CONTRACT.md`, `DESIGN_SYSTEM.md` y las `*_NOTES.md` reflejan lo implementado.
- [ ] **devops desplegó** y dejó `docs/DEVOPS_NOTES.md` con despliegue y rollback documentados.
- [ ] Sin **deuda técnica bloqueante** (la no bloqueante queda registrada y aceptada en `docs/TECH_DEBT.md`).

## Ciclo de vida: un proyecto por carpeta
Esta plantilla (`.claude/agents/` + `CLAUDE.md`) es **el equipo** y no cambia entre proyectos. Lo que cambia por proyecto es `PROJECT.md`, `docs/`, `backend/` y `frontend/`. Cada proyecto vive en su propia carpeta/repo autocontenido: al terminar (DoD cumplido) NO se vacía. Para el siguiente proyecto se arranca una carpeta nueva desde la plantilla con `scripts/new-project.sh` y el equipo empieza de cero desde **product-owner**.
