# DESIGN_SYSTEM.md — TCG HUNT (dirección «5a»: papel, tinta y bermellón)

> **Estado vigente.** Destilado el 2026-11-06 de los tokens reales (`frontend/tailwind.config.ts`,
> `frontend/src/app/globals.css`, `frontend/src/lib/breakpoints.ts`). La versión anterior (33 858 líneas, §0…§60+ con
> cada pantalla y su copy) está congelada en `docs/archive/DESIGN_SYSTEM.md`: buscar ahí con `grep -n "§NN"` cuando un
> comentario la cite. **Si este documento y `globals.css` discrepan, manda `globals.css`** y se corrige aquí.
> Propiedad: **frontend** (fusiona el antiguo rol ux-ui).

## 1. Principios
1. **Confianza visible**: todo estado de propiedad o dinero lleva badge claro (titularidad `pending/settled`, condición
   NM o empresa+grado+certificado, fecha y fuente del precio). Nunca se esconde un cargo.
2. **Claridad sobre decoración**: jerarquía tipográfica fuerte, aire, cifras siempre etiquetadas; el dinero desglosado
   (subtotal + comisión de plataforma + envío + descuento). Cada línea se nombra por lo que es para quien paga.
3. **Coleccionismo serio**: la **carta es el héroe** (imagen grande de catálogo) sobre base editorial de papel; un solo
   acento bermellón usado con avaricia. ⛔ Sin degradados arcoíris, tipografías de juguete ni emojis en la UI.
4. **Operable con una mano**: «Pedidos por preparar» funciona en celular (quien prepara está en el estante); el resto
   del panel es de computadora. Objetivos táctiles grandes, acción primaria siempre visible.
5. **Bilingüe sin costuras**: ES por defecto, EN a un clic; el layout aguanta ES ~30 % más largo.
Tono: claro, directo, tranquilizador. Se explica el porqué de un cobro sin contar nuestra contabilidad.
Precio: lleva el IVA dentro y **no se rotula** «IVA incluido» al lado (dueño, 2026-11-03).

## 2. Color (tokens en `:root` de `globals.css`; clases Tailwind entre paréntesis)
| Token | Valor | Uso |
|---|---|---|
| `--color-bg`, `--color-surface` (`bg`, `surface`) | `#f4f1ea` | Papel: fondo y superficies |
| `--color-surface-2` (`surface-2`) | `#efebe2` | Superficie hundida |
| `--color-text` (`text`) / `--color-ink` (`ink`) | `#1a1a18` | Tinta: texto y bloques oscuros |
| `--color-text-muted`, `--color-text-subtle` (`muted`, `subtle`) | `#6e695e` | Texto secundario |
| `--color-border` / `-strong` / `-control` | tinta al 16 % / 32 % / 55 % | Reglas, bordes, bordes de control |
| `--color-primary` (`primary`) | `#1a1a18` (hover `#000`; fg `#f4f1ea`) | Botón primario = tinta |
| `--color-accent` = `--hunt-red` (`accent`) | `#b31217` (hover `#8f0e12`; fg `#f4f1ea`) | Bermellón de marca, CTA de acento, foco |
| `--hunt-wine` / `--hunt-wine-up` | `#4a0d0d` / `#6e1013` | Bloques de marca oscuros |
| `--hunt-red-up` / `--hunt-red-deep` | `#f0685f` / `#d0362c` | Subidas en gráficas / acento intenso |
| `--hunt-tint` | bermellón al 6 % | Fondo de resalte |
| `--hunt-red-on-ink` (`hunt-red-on-ink`) | `#e0353b` | Rojo legible sobre tinta |
| `--color-on-ink` / `-muted` / `-nav` / `-rule` | `#f4f1ea` / `#8a857a` / `#a39d91` / papel 14 % | Texto y reglas sobre tinta |
| `--color-success` (`success`) | `#4a7345` | Éxito (fondo transparente) |
| `--color-warning`, `--color-danger` | `#b31217` | Aviso y error usan el bermellón (fondo transparente) |
| `--color-info` | `#6e695e` | Información |
| `--color-neutral-warm` / `--color-photo-mat` | `#9a6c57` / `#ffffff` | Neutro cálido (sellado, notas) / tarjeta de foto de sellado (`SealedPhoto`: marco fino, p-8, sin 5:7, sin agrandar) |
| `--color-finish-reverse` / `--color-finish-holo` | bermellón / `#1f5c8f` | Badges de acabado (holo pendiente de ratificar) |
| `--color-focus-ring` | `#b31217` | Anillo de foco (`shadow-focus`: 2 px) |
Reglas: contraste **WCAG AA** mínimo en todo texto (4.5:1; 3:1 para texto grande y bordes de control). No se
introducen colores fuera de esta tabla; un color nuevo entra primero aquí y en `globals.css`.

## 3. Tipografía (self-hosted con `next/font/local`, `frontend/src/app/[locale]/layout.tsx`)
| Familia | Variable | Uso |
|---|---|---|
| **Zen Old Mincho** 400/500/600 | `--font-serif` (`font-serif`) | Display, títulos, cifras grandes |
| **Archivo** 400–700 | `--font-sans` (`font-sans`) | Texto, UI, formularios |
| **JetBrains Mono** 400/500 | `--font-mono` (`font-mono`) | Folios `INV-000123`, certificados, claves de rastreo |
| marca | `--font-brand` (`font-brand`) | Wordmark TCG HUNT |
Escala: `display` 2.5rem/1.1 · `h1` 2rem/1.1 · `h2` 1.5rem/1.2 · `h3` 1.25rem/1.25 (peso 400 en títulos serif).
Tracking: `label` 0.14em · `eyebrow` 0.18em · `wordmark` 0.2em (etiquetas en versalitas pequeñas).

## 4. Forma, espacio y movimiento
- **Radios 0** en todo (`rounded-*` = 0px); la única excepción es `rounded-pill` (999px) para chips/píldoras.
- **Sombras: ninguna** (`shadow-*` = none). La profundidad se da con reglas finas y `surface-2`. Solo `shadow-focus`.
- Espaciado: escala por defecto de Tailwind (múltiplos de 4 px); generoso en tienda, denso en tablas del panel.
- Breakpoints (`lib/breakpoints.ts`): `sm` 640 · `md` 768 · `lg` 1024 · `xl` 1280 · `2xl` 1536. Diseño móvil primero.
- `prefers-reduced-motion: reduce` desactiva animaciones (`globals.css`). Animación sobria con `motion`.
- Iconos: `lucide-react`, trazo fino, siempre con texto o `aria-label`.

## 5. Componentes base (`frontend/src/components/ui/`)
`Button` (primario tinta, acento bermellón, secundario con borde, fantasma; estados hover/foco/deshabilitado/cargando;
clases en `button-classes.ts`) · `Input`, `Select`, `Textarea` (borde `border-control`, anillo de foco visible siempre) ·
`Modal`, `BodyPortal` · `Banner`, `Toast`, `VerdictNotice` · `Badge`, `StatusBadge` (estado → texto + color, nunca solo color) ·
`PriceTag`, `AmountBreakdown`, `IvaLabel` (desgloses de dinero; el frontend no multiplica) · `CardImage` (imagen de catálogo
optimizada; hosts permitidos en `lib/image-optimizer-hosts.mjs`) · `GradedCertChip`, `CertNumberField` · `DataTable`,
`StatCard`, `PipelineStepper`, `Skeleton`, `EmptyState`, `QueryState` (carga/error/vacío uniformes) · `PhotoUploader`
(solo INE y accesorios) · `LocaleToggle`.

## 6. Patrones de UX
- Toda acción que toca dinero muestra el importe final antes de confirmar y un resultado visible después (toast o banner).
- Errores: mensaje humano por código de error (`lib/error-audience.ts`), nunca el código crudo al cliente.
- Estados vacíos con siguiente paso; carga con `Skeleton`; reintentos visibles en `503 BUSY_TRY_AGAIN`.
- Formularios: etiqueta siempre visible, error bajo el campo, teléfono MX `+52`, colonia sugerida por CP (no bloquea).
- Panel: filtros en la URL; tablas con orden y paginación del servidor; folios copiables.
- Textos: todos en `frontend/messages/{es,en}.json` (paridad vigilada); sin cadenas sueltas en componentes.
- Apartado «Promos de la colección» (binder del Master Set; `MasterSetBinder.tsx`, `data-testid=collection-promos`): sección aparte DESPUÉS del Master Set, separada por regla `border-t`, `h3` + avance propio mono «x de y promos» (sin sesión solo «y promos») + nota «no cuentan en tu Master Set». Nunca suma al conteo, % ni valor del Master Set; reutiliza las tejas del binder. Ausente o vacío ⇒ no se pinta. No aplica en el cotizador.
- Estado del catálogo (M2): línea `text-xs text-muted` «Última actualización automática: hoy 01:12 · reintento 2 de 6» (hora en `America/Mexico_City`); solo informa. Cuarentena PSA (M2 revisión): aviso informativo + insignia «En cuarentena» por fila; la cifra no se muestra al cliente.

