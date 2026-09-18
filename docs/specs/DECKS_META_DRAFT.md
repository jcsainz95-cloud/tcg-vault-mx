# Borrador — Decks Meta para jugar

> **Qué es este documento.** Un **borrador del product-owner** para que **el dueño lo apruebe**. No es
> diseño técnico ni código: es la idea del dueño aterrizada a historias, criterios de aceptación, fases,
> riesgos y preguntas. **Nada se construye hasta que el dueño diga.** Después de la aprobación entra el
> arquitecto (diseño + contrato) y recién entonces backend/frontend.
>
> **Fecha:** 2026-09-18 · **Autor:** product-owner · **Estado:** BORRADOR, en espera de aprobación del dueño.
>
> **Relación con `docs/specs/DECKS_META_V1.md`:** aquel documento es la **entrada cruda y verbatim del dueño**
> (2026-09-08) y **nadie lo edita**. Este borrador aterriza la **idea más reciente** del dueño (el top-10
> pingado de Limitless, el click→disponibilidad→carrito y el "pegar lista"), incorpora el requisito nuevo de
> **legalidad/vigencia** y refleja las **restricciones medidas** del entorno. Donde V1 y este borrador
> difieran, **manda lo que el dueño apruebe aquí**.

---

## 1. El problema y el valor, en una frase

El jugador decide qué deck armar mirando el meta en Limitless (en inglés, en dólares, sin stock local); **TCG
HUNT le muestra el top-10 del meta con lo que tenemos en la tienda y un botón para agregar de jalón lo
disponible — y garantiza que solo ofrece cartas legales para jugar en el formato vigente.**

---

## 2. Historias de usuario

Escritas como las viviría el cliente, en lenguaje llano.

**H1 · Ver el top-10 del meta.**
Como jugador, quiero ver el **top-10 de decks del meta** (tomado de Limitless y actualizado seguido) para
decidir cuál armar sin leer fuentes en inglés.

**H2 · Click en un deck → qué tenemos → al carrito de jalón.**
Como jugador, quiero **hacer click en un deck** y ver **qué cartas de ese deck tenemos disponibles en la
tienda**, con su precio, para **agregar de un jalón todo lo disponible al carrito**.

**H3 · Pegar una lista → qué tenemos.**
Como jugador, quiero **pegar una lista en formato Limitless** (el texto que Limitless deja descargar) y ver
**qué de esa lista tenemos disponible**, para armar cualquier deck, no solo los del top-10.

> **El "pegar lista" es el motor reusable.** Ver la disponibilidad de un deck del top-10 (H2) y ver la de una
> lista pegada (H3) son **el mismo mecanismo** por dentro: leer una lista de cartas → emparejarla con nuestro
> catálogo/inventario → decir qué hay. Construir bien H3 hace casi todo el trabajo de H2.

---

## 3. Criterios de aceptación por historia

> **Criterio DURO transversal a TODAS las historias (requisito del dueño, no negociable): legalidad/vigencia.**
> Toda carta que se **ofrezca o se agregue al carrito** desde un deck meta o desde "pegar lista" debe ser
> **legal en el formato vigente** (Pokémon = **Standard**, con rotación por "regulation mark"). Una carta
> **rotada** (que dejó de ser legal) **NO se ofrece como jugable**: se excluye o se muestra marcada como "no
> legal" (ver Pregunta abierta P5). Esto aplica a las tres historias y a la sustitución por edición (§5, Fase 3).

**H1 · Ver el top-10:**
- [ ] La página muestra **10 decks** ordenados por su posición en el meta, con nombre y, si el dato existe, su
  peso/tendencia.
- [ ] Se ve **cuándo se actualizó** la lista y se **cita la fuente** ("Datos de Limitless TCG").
- [ ] Si el traído automático de Limitless falla o trae basura, la página **no queda rota ni muestra datos
  falsos**: conserva la última lista buena y/o muestra el top-10 curado a mano de respaldo (ver Fase 1).

**H2 · Click → disponibilidad → carrito:**
- [ ] Al abrir un deck se ve **cada carta de la lista** con: cantidad pedida, **cuántas tenemos disponibles**,
  precio, y si falta.
- [ ] Un botón **agrega de un jalón** todas las unidades **disponibles y legales** al carrito.
- [ ] Las cartas **no disponibles** o **no legales** no se agregan al carrito (se muestran, pero no se venden
  como jugables).
- [ ] El deck **siempre se puede ver**, tenga 60, 40 o 5 cartas disponibles (no se oculta por incompleto).

**H3 · Pegar lista → disponibilidad:**
- [ ] Una caja de texto acepta una lista en **formato de exportación de Limitless** (líneas tipo
  `4 Dragapult ex TWM 130`).
- [ ] El sistema **parsea** cantidad + nombre + set + número por línea y devuelve **la misma vista de
  disponibilidad** que un deck del top-10.
- [ ] Una línea que **no se puede emparejar** con nuestro catálogo se muestra como **"no identificada"**, no se
  inventa una carta ni un precio.
- [ ] Solo se ofrecen al carrito las líneas **disponibles y legales en el formato vigente**.

---

## 4. Fuera de alcance (explícito)

A menos que el dueño lo pida, este feature **NO** incluye:

- **Armador de decks / recomendador** (sugerir qué deck te conviene, construir listas propias).
- **Comunidad / foro / comentarios** (eso es la idea "Hunter Pulls", aparte).
- **Otros juegos** (Magic, Yu-Gi-Oh, etc.) y **otros formatos** de Pokémon (Expanded, formatos JP). El feature
  se acota a **un formato: Standard** (ver §5 y Pregunta abierta P4).
- **Contenido editorial** (noticias, análisis, filtraciones de sets).
- **Trade-in / vínculo con buylist** desde esta sección.
- **Precio "en movimiento" / portafolio** como página pública.

> Nota: el **descuento de bundle**, las **fotos reales por umbral de valor**, el **reporte interno de
> faltantes** y el **correo "qué cambió"** que aparecían en `DECKS_META_V1.md` **no** los incluyo como
> obligatorios en este borrador; quedan como candidatos que el dueño decide si entran y en qué fase. No los
> doy por acordados.

---

## 5. Fases sugeridas (el dueño decide el orden y hasta dónde)

Ordenadas para **entregar valor sin depender del traído automático de Limitless al inicio** (ver riesgo de
egress en §6).

**Fase 1 — El motor + disponibilidad + carrito, con top-10 curado a mano de respaldo.**
- "Pegar lista" (H3) funcionando: pegar → emparejar → ver disponibilidad → agregar lo disponible y legal al
  carrito.
- Top-10 (H1/H2) **poblado a mano** por el operador al inicio (una lista curada como respaldo), reusando el
  mismo motor de disponibilidad.
- Ya entrega valor real **sin** depender de traer nada de Limitless en vivo.

**Fase 2 — Traído automático desde Limitless.**
- Un proceso que trae el top-10 del meta de Limitless de forma **automática y seguida**, con **respaldo**: si
  el traído falla o trae menos decks válidos de los esperados, **no se aplica** y se conserva lo último bueno.
- La fuente/formato de Limitless se **fija y se vigila** (ver §6, dependencia de tercero).

**Fase 3 — Sustitución por edición legal + "avísame cuando llegue".**
- **Sustitución por otra edición (legal):** en Pokémon, distintas impresiones de la misma carta suelen ser
  intercambiables — **pero solo cuenta como sustituto una impresión que siga siendo LEGAL en el formato
  vigente** (regulation mark vigente). No es "cualquier impresión": es **"cualquier impresión legal"**. Esto
  hace comprable más del deck usando lo que sí tenemos, sin ofrecer nada rotado.
- **"Avísame cuando llegue"** para las cartas faltantes: se enlaza con el **futuro Centro de Avisos (P-96)** —
  no se construye un sistema de avisos propio aquí; se usa el que P-96 defina (correo + portal).

**Extras opcionales (cualquier fase, el dueño decide):**
- **Precio total del deck armable** y **"% del deck que tenemos"** (ej.: "52 de 60, te faltan estas 8").

---

## 6. Riesgos y dependencias (restricciones medidas — no adornadas)

**R1 · Egress a Limitless BLOQUEADO en desarrollo (MEDIDO 2026-09-18).**
La política del entorno bloquea la salida a `limitlesstcg.com` y `play.limitlesstcg.com` (403
`connect_rejected`, igual que `tcgcsv.com` y las CDNs — `HECHOS.md`, regla O-17). Consecuencia: **el traído
real de Limitless solo se puede probar en PRODUCCIÓN, y lo mide el dueño**. Este borrador **asume esto** y no
plantea ninguna medición que dependa del egress en desarrollo. Por eso la Fase 1 no depende de traer nada en
vivo (curado a mano), y la Fase 2 (automático) se valida en prod.

**R2 · Dependencia de un tercero (Limitless) — hay que fijarla y vigilarla.**
El **formato y la fuente** de los datos de Limitless los controla un externo; puede cambiar o romperse sin
aviso. Es la misma clase de riesgo que ya vive el proyecto con precios de terceros. **Doctrina del proyecto
(`CLAUDE.md`): toda dependencia externa va fijada/versionada, con un candado que la vigile.** El diseño (del
arquitecto) debe fijar/versionar el formato de Limitless y avisar cuando cambie.
- **¿API oficial o scraping? — NO MEDIDO.** No puedo confirmarlo desde este entorno porque el egress a
  Limitless está bloqueado (R1). **Qué lo cerraría:** alcanzar `limitlesstcg.com` / `play.limitlesstcg.com`
  desde producción o desde la red del dueño y comprobar si hay **API documentada con términos de uso** o si es
  **HTML que hay que parsear**. La respuesta cambia la robustez y la doctrina de fijado, pero **en ambos casos
  la dependencia se fija y se vigila**.

**R3 · El corazón técnico es el EMPAREJADO (el riesgo/esfuerzo principal).**
Cruzar lo que dice Limitless (nombre / set / número) **contra nuestra carta e inventario** es la parte difícil
y donde se irá el esfuerzo. Es la **misma clase** de problema que el cruce de precios que el proyecto ya vivió
(P-72, P-46). El identificador fiable es **set + número de colección**, no el nombre. Este borrador **nombra**
este riesgo pero **no lo resuelve** — resolverlo es trabajo del arquitecto.
- Dato de apoyo ya medido en el proyecto: el catálogo **ya guarda** el código corto de set (`ptcgoCode`) y el
  número, pero **nadie lo lee/expone todavía** (P-71). Este feature y P-71 usan el mismo dato.

**R4 · Legalidad/vigencia: nuestro catálogo NO guarda hoy la legalidad ni el "regulation mark" (MEDIDO
2026-09-18).**
El requisito duro del dueño ("siempre asegurar que las cartas que ofrecemos son de las vigentes para jugar")
exige saber, por carta, si es **legal en Standard**. Medición: el modelo `Card` de nuestro catálogo
(`backend/prisma/schema.prisma`) **no tiene** campo de legalidad ni de regulation mark, y el cliente de
pokemontcg.io (`backend/src/modules/catalog/pokemontcg-io.client.ts`) **no mapea** `regulationMark` ni
`legalities` aunque la fuente los publique (grep de `regulation|legalit|standard|rotat` sobre `schema.prisma` y
`backend/src` = **0 ocurrencias**).
- **NO MEDIDO (por egress, R1):** que el **payload que ya descargamos** de pokemontcg.io/scrydex traiga hoy
  esos campos (`legalities.standard`, `regulationMark`). Se sabe que esas APIs los publican, pero confirmarlo
  en vivo requiere alcanzarlas.
- **Consecuencia / pregunta para el arquitecto:** **traer y almacenar la legalidad/regulation mark por carta
  es prerequisito de este feature.** Si no lo tenemos, ese trabajo entra antes o junto con Decks Meta.

**R5 · Dependencias con otras piezas del proyecto:**
- **Centro de Avisos (P-96):** el "avísame cuando llegue" (Fase 3) se apoya en P-96, que aún está en diseño de
  alcance. No se construye un avisador propio aquí.
- **Precios finales / carrito:** exhibir precio y agregar al carrito reusa el motor de precios y el carrito
  existentes. `DECKS_META_V1.md` condicionaba la sección a `pricing-iva-v2.1`; ese estado hay que **re-medirlo**
  con el arquitecto antes de comprometer precios de bundle (O-5).

---

## 7. Preguntas abiertas para el dueño

Estas son las que el arquitecto necesita respondidas para arrancar:

- **P1 · Formato y juego.** ¿Confirmamos **Pokémon, formato Standard** como el (único) formato de arranque?
- **P2 · Frecuencia del top-10.** ¿Cada cuánto se actualiza el top-10 (diario, semanal, "cuando cambie el
  meta")? Esto define el proceso automático de la Fase 2.
- **P3 · Cartas que NO tenemos.** Para una carta del deck que no está en inventario: ¿**ocultarla**,
  **mostrarla como "agotado"**, o **sugerir un sustituto** (Fase 3)?
- **P4 · Otros formatos.** ¿Queda **cerrado a Standard**, o dejamos la puerta abierta a otro formato más
  adelante? (La legalidad se evalúa siempre contra el formato elegido.)
- **P5 · Cartas rotadas (ya no legales).** Para una carta del deck meta que **rotó** y dejó de ser legal:
  ¿**ocultarla**, **mostrarla marcada como "no legal"**, o **sugerir un sustituto legal**?
- **P6 · Fase 1: ¿automático o curado a mano?** ¿Arrancamos con el **top-10 curado a mano** (respaldo, no
  depende de Limitless en vivo) y dejamos el **traído automático para la Fase 2**, o el dueño quiere el
  automático desde el principio (asumiendo que solo se prueba en prod, R1)?
- **P7 · Extras opcionales.** ¿Entran, y en qué fase, el **precio total + "% del deck que tenemos"**, el
  **descuento de bundle**, las **fotos reales**, el **correo "qué cambió"** y el **reporte de faltantes**?
