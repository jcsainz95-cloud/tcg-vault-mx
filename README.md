# Equipo de desarrollo — Plantilla para Claude Code

Un equipo de **8 subagentes** de Claude Code con roles separados que llevan una idea
desde el concepto hasta el despliegue. Tú (la sesión principal) actúas como orquestador:
delegas en cada rol, no implementas directamente.

## Instalación
1. Copia el contenido de esta carpeta a la raíz de tu proyecto (incluida la carpeta oculta .claude/).
   - Si prefieres que el equipo esté disponible en TODOS tus proyectos, copia los archivos de .claude/agents/ a ~/.claude/agents/
   - O más fácil: usa `scripts/new-project.sh` para crear una carpeta nueva ya lista (ver "Cómo arrancar un proyecto nuevo").
2. Cuéntale tu idea al **product-owner** para que redacte PROJECT.md (o rellénalo tú mismo).
3. Abre Claude Code en la carpeta y pide, por ejemplo: "Usa al product-owner para aterrizar esta idea en PROJECT.md" o "Usa al arquitecto para definir la arquitectura según PROJECT.md".

## Cómo arrancar un proyecto nuevo
1. **Scaffold**: desde esta plantilla, ejecuta `./scripts/new-project.sh ../mi-proyecto` (crea una carpeta nueva con el equipo, un PROJECT.md en blanco y un docs/ limpio). Luego abre Claude Code en `../mi-proyecto`.
2. **Definir**: `Usa al product-owner para aterrizar esta idea en PROJECT.md: <tu idea>`. Responde sus preguntas hasta aprobar PROJECT.md.
3. **Diseñar**: `Usa al arquitecto para definir arquitectura y contrato según PROJECT.md`. Después `Usa a ux-ui para el sistema de diseño` (opcional: partiendo de un diseño hecho con Claude Design).
4. **Construir en paralelo**: delega en **backend**, **frontend** y **devops** (entorno).
5. **Verificar**: `Usa a qa para verificar…` y luego `Usa al techlead para revisar…`. Los rechazos vuelven al rol responsable.
6. **Entregar y cerrar**: **devops** despliega y verifica la Definición de Terminado (ver CLAUDE.md).

> Consulta `docs/team-overview.html` (ábrelo en el navegador) para ver el recorrido completo de forma visual.

## Ciclo de vida: un proyecto por carpeta
Separa **el equipo** del **proyecto**:

| | Qué es | ¿Cambia entre proyectos? |
|---|---|---|
| `.claude/agents/` + `CLAUDE.md` | El equipo (8 roles y sus reglas) | No, siempre igual |
| `PROJECT.md` + `docs/` + `backend/` + `frontend/` | El proyecto concreto y su código | Sí, único por proyecto |

Cada proyecto vive en su **propia carpeta/repo autocontenido**. Cuando termina (con la Definición de Terminado cumplida), **no se vacía**: queda como entregable completo. Para el siguiente proyecto arrancas una carpeta nueva desde la plantilla con `scripts/new-project.sh` y el equipo empieza de cero desde el product-owner. La plantilla `dev-team` se queda intacta y reutilizable.

## Los 8 roles
- **product-owner** -> aterriza la idea cruda y redacta `PROJECT.md` (el humano aprueba).
- **arquitecto**    -> define arquitectura y contrato de API (`docs/ARCHITECTURE.md`, `docs/API_CONTRACT.md`).
- **ux-ui**         -> define el sistema de diseño visual (`docs/DESIGN_SYSTEM.md`).
- **backend**       -> implementa servidor, API y BD según el contrato.
- **frontend**      -> implementa la UI según el contrato y el sistema de diseño.
- **qa**            -> verifica que funciona (tests, contrato); solo reporta.
- **techlead**      -> revisa que esté bien hecho (calidad, deuda técnica); solo reporta.
- **devops**        -> entorno, CI/CD y despliegue.

## Estructura
- `.claude/agents/`      -> definiciones de los 8 roles
- `CLAUDE.md`            -> reglas de coordinacion y propiedad de archivos
- `PROJECT.md`           -> plantilla de la idea (lo unico que cambia por proyecto)
- `docs/`                -> aqui viviran ARCHITECTURE.md, API_CONTRACT.md, DESIGN_SYSTEM.md, etc.
- `docs/team-overview.html` -> diagrama visual del equipo y su flujo (abrir en el navegador)
- `scripts/new-project.sh`  -> crea una carpeta nueva lista para arrancar el siguiente proyecto

## Flujo tipico
product-owner (PROJECT.md) -> arquitecto (contrato) -> ux-ui (diseño) + devops (entorno) + backend + frontend (en paralelo) -> qa (funciona) -> techlead (bien hecho) -> correcciones -> devops despliega

Consulta `docs/team-overview.html` para ver el flujo completo de forma visual.

## Diseño visual con Claude Design
Para que la UI quede atractiva, el flujo recomendado es:
1. Tú (humano) usas **Claude Design** (Anthropic Labs, dentro de Claude.ai) para crear los
   mockups y el look & feel a partir de un prompt, de tu código o de Figma.
2. El agente **ux-ui** toma ese diseño como insumo y lo codifica en `docs/DESIGN_SYSTEM.md`
   (tokens de color, tipografía, componentes) para dejarlo versionado en el repo.
3. El **frontend** implementa la UI siguiendo ese sistema de diseño.

Si no usas Claude Design, el agente ux-ui genera un sistema de diseño accesible desde cero.

Puedes verificar/editar los agentes dentro de Claude Code con el comando /agents.
