# HECHOS — <nombre del proyecto>

> **Qué es este fichero:** lo que el dueño ya estableció y **no se vuelve a preguntar**, más los hechos de
> infraestructura **medidos** (con fecha y cómo). Toda sesión lo lee al arrancar, antes que `PENDIENTES.md`.
> Se edita solo cuando el dueño cambia un hecho o una medición nueva lo refuta (regla O-2). Un hecho sin fecha
> ni fuente no entra aquí: va a `PENDIENTES.md` como «NO MEDIDO».
>
> Última revisión: <fecha> (<quién>).

## Hechos del negocio (establecidos por el dueño)

| Hecho | Establecido | Consecuencia operativa |
|---|---|---|
| <lo que el dueño dijo, literal si se puede> | <fecha, dónde lo dijo> | <qué hace o deja de hacer el equipo por eso> |

## Hechos de infraestructura (medidos)

| Hecho | Medido | Cómo se midió |
|---|---|---|
| <p. ej. «solo la rama X publica»> | <fecha, quién> | <comando, run de CI, captura> |

## Hechos del equipo (medidos sobre la plantilla)

- `arquitecto`, `ux-ui` y `product-owner` **no tienen Bash**: no pueden commitear. Su trabajo lo commitea el
  orquestador, acotado a sus rutas (regla O-13).
