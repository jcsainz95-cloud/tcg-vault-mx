> ⚠️ **Documento del humano, verbatim.** Lo escribió el dueño del negocio el 2026-09-08 y lo entregó
> el 2026-09-09. **Nadie lo edita**: es la entrada cruda del stream `decks-meta-v1`. Por el flujo de
> `CLAUDE.md` (paso 0), quien lo aterriza a requisitos accionables es **product-owner**, en
> `PROJECT.md`, y quien decide arquitectura y contrato es el **arquitecto**. Se guarda aquí para que
> sobreviva al reciclaje del contenedor y para que cualquier rol pueda citar la fuente original.

# Spec — Decks Meta (Fase 1)

**Proyecto:** TCG HUNT · tcghunt.mx
**Stream:** `decks-meta-v1`
**Fecha:** 2026-09-08
**Estado:** Para revisión de arquitecto antes de backend
**Zonas compartidas que toca:** catálogo, carrito/checkout (descuento de bundle), `API_CONTRACT.md` (nuevos recursos), `prisma/schema` (nuevas tablas), jobs programados, email transaccional
**Regla:** corre solo. No se abre en paralelo con `pricing-iva-v2.1` ni con ningún stream que toque `money.ts` o el contrato.

---

## 1. Problema

El jugador competitivo mexicano decide qué deck armar leyendo Limitless TCG en inglés, con precios en dólares y sin saber dónde conseguir las cartas en México. Termina comprando carta por carta a varios vendedores en Facebook o grupos de WhatsApp, sin garantía de condición ni de legalidad en Standard.

TCG HUNT tiene el inventario, la verificación de condición y el envío. Le falta el puente entre "este es el deck que gana" y "agregar al carrito".

## 2. Posicionamiento

**El meta de Pokémon TCG en pesos, con disponibilidad real y listo para completar.**

No es una traducción de Limitless (Limitless ya tiene interfaz en español). Lo que agregamos y nadie ofrece: precio en MXN con IVA incluido, disponibilidad real por carta, el diff cuando el deck cambia, y un botón para agregar todo lo disponible.

## 3. Objetivos

1. Que un jugador que llega desde Google a una página de deck pueda ver qué hay, cuánto cuesta y agregarlo al carrito en menos de un minuto, sin cambiar de página.
2. Que las 10 listas publicadas siempre correspondan al meta vigente sin intervención manual.
3. Que las cartas faltantes de los decks se conviertan en una lista de prioridad de compra semanal para JC.
4. Que el mismo dato alimente la serie "Deck de la semana" en Instagram sin producción manual.

## 4. Fuera de alcance (no negociable en fase 1)

- **Trade-in o vínculo con buylist.** No se promueve la venta de decks usados. La buylist compra solo NM y no se conecta desde esta sección.
- **Condición distinta de NM.** Un solo precio por deck, solo cartas NM.
- **Cartas en movimiento (precio).** Descartado como página pública. Si se hace, es dato privado de bóveda ("cómo se movió tu portafolio"), fuera de este stream.
- **Contenido editorial.** Nada de noticias, filtraciones, análisis de sets.
- **Expanded, formatos JP, otros juegos.**
- **Cupones o descuentos generales.** Solo el descuento de bundle definido abajo.
- **Fase 2** (toggle Lista top / Lista económica, calendario de torneos, rotación, correo por llegada de stock, historial de meta, pega tu lista). Diseñar el modelo de datos para que quepan, no construirlas.

## 5. Decisiones ya tomadas (no reabrir en Code)

| Tema | Decisión |
|---|---|
| Nombre de la sección | **Decks Meta** |
| Ubicación | Entrada de primer nivel en el menú principal, junto a Comprar / Vender / Bóveda |
| URLs | `/decks-meta` (índice) y `/decks-meta/{slug}` por deck, ej. `/decks-meta/dragapult-ex` |
| Home | Módulo "Decks Meta esta semana" con los 5 decks tier 1 y botón "Ver los 10" |
| Comprar | Chip/filtro "Cartas de Decks Meta" que filtra el catálogo a cartas que aparecen en alguna de las 10 listas |
| Ficha de carta | Si la carta está en algún deck publicado: "Esta carta va en {deck1}, {deck2}" con links |
| Cantidad de decks | 10: tier 1 = posiciones 1–5 del meta, tier 2 = posiciones 6–10 |
| Fuente | Limitless TCG (`limitlesstcg.com/decks`, formato Standard vigente). Se cita en la UI como "Datos de Limitless TCG" |
| Condición | Solo NM |
| Descuento | 5% si 60/60 disponibles; 3% si todas las cartas marcadas *core* están disponibles; 0% en cualquier otro caso. Siempre sobre el total del bundle, nunca por carta |
| Piso de descuento | Si aplicar el descuento deja alguna línea por debajo de su costo de adquisición, el descuento se reduce hasta que ninguna línea quede por debajo. Automático, se registra en log |
| Visibilidad | Un deck **siempre se muestra**, tenga 60, 40 o 5 cartas disponibles. Nunca se oculta por incompleto |
| Botón | Siempre "Agregar las disponibles". Nunca un estado de "agotado" a nivel deck |
| Precio exhibido | Final, con IVA incluido, en todas las superficies de esta sección. Depende de `pricing-iva-v2.1`; ver dependencias |
| Fotos | Foto real de la carta física para las cartas de valor (umbral: definir en preguntas abiertas). Imagen de catálogo para el resto. Nunca imágenes generadas |
| Copy | Sujeto a MKT-1 a MKT-8. Prohibido "mejor precio", "pagamos más", "precio especial". El argumento es: un solo envío, condición verificada, legal en Standard |

## 6. Historias de usuario

**Jugador competitivo (persona principal)**

- Como jugador, quiero ver los 10 decks del meta con su porcentaje y tendencia, para decidir cuál armar sin leer fuentes en inglés.
- Como jugador, quiero ver las 60 cartas de un deck con precio en pesos y si están disponibles, para saber cuánto me cuesta completarlo aquí.
- Como jugador, quiero agregar al carrito todas las cartas disponibles de un deck en un clic, para no buscarlas una por una.
- Como jugador, quiero saber exactamente qué cartas faltan y que me avisen cuando lleguen, para completar el deck después sin revisar cada día.
- Como jugador que compró un deck, quiero saber cuándo la lista top cambió y qué cartas necesito, para no quedarme con una lista vieja.
- Como jugador que llega desde Google, quiero caer directo en la página del deck que busqué, con la información completa sin cargar JavaScript.

**Operador (JC)**

- Como operador, quiero un reporte semanal de cartas faltantes ordenado por impacto (en cuántos decks aparece × cuántos "Avísame" tiene), para saber qué comprar.
- Como operador, quiero marcar qué cartas son *core* en cada deck una sola vez, para que el descuento del 3% se calcule solo.
- Como operador, quiero que las listas se actualicen solas desde Limitless y que un deck que sale del top 10 se despublique sin que yo lo toque.
- Como operador, quiero poder pausar la publicación de un deck manualmente (ej. lista rara o error de parseo) sin borrarlo.

**Marketing-agent**

- Como agente, quiero leer el resultado del job semanal (deck, share, tendencia, precio, disponibilidad, diff) por API interna, para redactar el post "Deck de la semana" sin intervención.

## 7. Modelo de datos (propuesta, sujeta a arquitecto)

Nombres tentativos. Lo importante es la separación entre **lista** (inmutable, con fecha y fuente) y **deck** (arquetipo, persistente entre listas).

```
MetaArchetype
  id, slug, name, limitlessDeckId, tier (1|2|null),
  published (bool), pausedByOperator (bool),
  currentListId → MetaDeckList, createdAt, updatedAt

MetaDeckList            -- una lista concreta, inmutable
  id, archetypeId, sourceUrl, sourceTournament, sourceDate,
  format ("Standard 2026-27" / regulation marks vigentes),
  variant ("top" | "economica")   -- fase 2, solo "top" en fase 1
  fetchedAt, replacedByListId (nullable)

MetaDeckListCard
  listId, catalogCardId (nullable si no se pudo mapear),
  rawName, rawSetCode, rawNumber, quantity,
  group ("pokemon"|"trainer"|"energy"),
  isCore (bool, editable por operador, se hereda a la lista siguiente si la carta sigue)

MetaSnapshot            -- una corrida del job
  id, runAt, sourceUrl, formatLabel

MetaSnapshotEntry
  snapshotId, archetypeId, rank, sharePct, points

MetaDeckAlert           -- "Avísame" por carta
  id, userId (o email), archetypeId, catalogCardId, createdAt, notifiedAt

MetaDeckPurchase        -- para el correo "Qué cambió"
  id, userId, archetypeId, listId, orderId, createdAt
```

Notas:
- `catalogCardId` se resuelve por **set code + número**, no por nombre. Si no hay match, la línea queda sin mapear, el deck se publica igual y la línea se marca "no identificada" en el reporte interno.
- Tendencia = share del snapshot actual − share del snapshot anterior para el mismo arquetipo.
- No se guardan precios en estas tablas. El precio se calcula en tiempo de render desde el motor de precios, como cualquier carta del catálogo.

## 8. Reglas de negocio

### 8.1 Disponibilidad y bundle
- Para cada línea: `disponible = min(quantity, stockNM(catalogCardId))`.
- Contador del deck: `sum(disponible) de 60`.
- "Agregar las disponibles" agrega exactamente las unidades disponibles de cada línea al carrito como líneas normales, más una línea de descuento de bundle si aplica.
- El descuento es una línea negativa del carrito referenciada al `archetypeId` y `listId`, para que devoluciones parciales recalculen si el bundle sigue cumpliendo la condición.
- Stock reservado en carrito se trata como no disponible para otros usuarios según la regla vigente del catálogo (no inventar una nueva).

### 8.2 Descuento
- `60/60` → 5%.
- Todas las líneas `isCore` con `disponible == quantity` → 3%.
- Si ambas se cumplen, aplica 5%.
- Piso: antes de aplicar, verificar línea por línea `precioConDescuento ≥ costoAdquisición`. Si alguna falla, reducir el porcentaje en pasos de 1 punto hasta que todas pasen o llegue a 0. Registrar en log con `archetypeId`, líneas afectadas y porcentaje final.
- Si el descuento termina en 0 por piso, no se muestra etiqueta de descuento.

### 8.3 Publicación y job semanal
- Job corre lunes 06:00 CDMX (configurable).
- Lee la tabla de meta de Limitless para el formato Standard vigente, con filtro de tiempo "past month" o equivalente.
- Toma las posiciones 1–10. Para cada arquetipo, obtiene la lista más reciente con mejor colocación en el periodo.
- Si la lista obtenida difiere de `currentListId` en al menos una línea (carta o cantidad), crea `MetaDeckList` nueva, la marca como actual, y dispara el flujo "Qué cambió".
- Un arquetipo que estuvo en top 10 y queda fuera **tres corridas consecutivas** se despublica (`published = false`). Sus datos se conservan.
- Un arquetipo nuevo en top 10 se publica automáticamente en tier 2 (o tier 1 si entra en 1–5) con `isCore` vacío; el reporte interno pide a JC marcar core.
- Si el job falla o el parseo devuelve menos de 8 arquetipos válidos, **no se aplica nada**, se conserva el snapshot anterior y se notifica por email `[TCG HUNT Marketing]`.
- `pausedByOperator = true` impide publicación aunque el job lo traiga.

### 8.4 "Qué cambió"
- Diff entre lista anterior y nueva: cartas que entran, salen, o cambian de cantidad.
- Se muestra en la ficha del deck durante 14 días: "Lista actualizada el {fecha}: entran X, salen Y".
- Email a cada `MetaDeckPurchase` cuyo `listId` sea la lista reemplazada: asunto `[TCG HUNT] Tu {deck} cambió`, cuerpo con el diff, disponibilidad y precio de las cartas que entran, y link a la ficha. Un solo email por usuario por actualización.

### 8.5 "Avísame"
- Disponible en cada línea con `disponible < quantity`.
- Al entrar stock NM de esa carta, email a las alertas pendientes, marca `notifiedAt`. (El disparador por entrada de stock es fase 2; en fase 1 basta con que el job semanal revise alertas contra stock actual y notifique.)
- Sin cuenta: se acepta email; con cuenta: se asocia a `userId`.

### 8.6 Reporte interno de faltantes
- Semanal, tras el job. Guardado en Drive `TCG HUNT/Marketing/YYYY-MM-DD_faltantes_decks_meta.md` y visible en `/admin/marketing`.
- Columnas: carta (set + número), en cuántos decks publicados aparece, cantidad total requerida, stock NM actual, faltante, alertas "Avísame" pendientes, score = decks × faltante + alertas.
- Ordenado por score descendente. Incluye también líneas no mapeadas a catálogo.

## 9. UI

### `/decks-meta`
- Encabezado: "Decks Meta" + subtítulo con fecha del snapshot y "Datos de Limitless TCG".
- 10 tarjetas ordenadas por rank: imagen del Pokémon principal (imagen de catálogo de la carta, no arte externo), nombre, share, tendencia (▲ ▼ =), "desde MX$X" (precio de las disponibles con descuento aplicable), contador "X de 60".
- Tier 1 destacado visualmente; tier 2 igual pero en segunda fila. No etiquetar "tier" al usuario.

### `/decks-meta/{slug}`
- Cabecera: nombre, share, tendencia, fuente y torneo de la lista, fecha de verificación de legalidad ("Legal en Standard · verificado {fecha}").
- Bloque de compra fijo (sticky en móvil): contador, precio total de disponibles, etiqueta de descuento si aplica, botón "Agregar las disponibles".
- Lista por grupos Pokémon / Entrenadores / Energías. Por línea: foto (real si valor ≥ umbral), nombre, set y número, cantidad pedida, disponibles, precio unitario, y "Avísame" si falta.
- Bloque "Qué cambió" si hay diff reciente.
- Una línea de copy fija: "Un solo envío. Condición verificada. Legal en Standard."
- Todo el contenido anterior renderizado en servidor (SSR). Título y meta description con nombre del arquetipo.

### Home
- Módulo "Decks Meta esta semana": 5 tarjetas tier 1 + "Ver los 10".

### Comprar
- Chip "Cartas de Decks Meta". Filtra el catálogo a `catalogCardId` presentes en listas publicadas.

### Ficha de carta
- Si aplica: "Esta carta va en {deck}, {deck}" con links.

### `/admin/marketing`
- Vista de arquetipos: rank, tier, publicado/pausado, lista actual, fecha, líneas sin mapear.
- Marcado de `isCore` por línea.
- Reporte de faltantes.
- Log de descuentos reducidos por piso.

## 10. API interna para marketing-agent

Endpoint de solo lectura (o consulta directa acordada con arquitecto) que devuelva, por corrida: arquetipos publicados con rank, share, tendencia, precio de disponibles, contador, diff reciente y URL. Es lo que consume el writer del marketing-agent para "Deck de la semana".

## 11. Criterios de aceptación (fase 1)

- [ ] `/decks-meta` muestra 10 decks con share y tendencia tomados del último snapshot exitoso.
- [ ] Un deck con 40/60 disponibles se muestra, tiene botón "Agregar las disponibles" y no aplica descuento.
- [ ] Un deck con core completo y 52/60 aplica 3%; con 60/60 aplica 5%.
- [ ] El piso reduce el descuento cuando una línea quedaría bajo costo y lo registra en log.
- [ ] "Agregar las disponibles" agrega exactamente las unidades disponibles; el carrito muestra la línea de descuento referenciada al deck.
- [ ] Al cambiar una lista en el job, se crea lista nueva, se muestra "Qué cambió" y se envía un email por usuario con compra previa de ese deck.
- [ ] Un arquetipo fuera del top 10 tres corridas seguidas queda `published = false` sin intervención.
- [ ] Si el job obtiene menos de 8 arquetipos válidos, no cambia nada y notifica por email.
- [ ] Las páginas de deck son SSR: `curl` sin JS devuelve nombre, lista y precios.
- [ ] Ningún texto de la sección contiene "mejor precio", "pagamos más", "precio especial" ni equivalentes (test de copy contra lista de términos prohibidos de MKT-8).
- [ ] Todos los precios exhibidos incluyen IVA y coinciden con el total del checkout.
- [ ] El reporte de faltantes se genera semanalmente en Drive y en `/admin/marketing`.

## 12. Dependencias

- **`pricing-iva-v2.1`** debe estar resuelto antes de que esta sección salga a producción. Esta sección exhibe precios finales; si el motor sigue devolviendo base con IVA apilado después, el descuento y el total del bundle salen mal. Se puede construir en paralelo en rama, no se publica antes.
- Regla vigente de reserva de stock en carrito (no se modifica aquí).
- Email transaccional desde `marketing@tcghunt.mx` ya operativo.
- Acceso de lectura a Limitless. Ver preguntas abiertas.

## 13. Preguntas abiertas

**Bloqueantes (responder antes de backend)**
1. *Arquitecto:* ¿el descuento de bundle vive como línea negativa del carrito o como ajuste de precio por línea? La propuesta es línea negativa referenciada al deck. Impacta `API_CONTRACT.md` y checkout.
2. *Arquitecto:* ¿cómo se obtiene el dato de Limitless de forma estable: HTML parseado, exportación, o API/acuerdo? Si es parseo de HTML, definir tolerancia a cambios de estructura y el fallback (conservar snapshot anterior, ya especificado).
3. *JC:* umbral de valor a partir del cual una línea exige foto real de la carta física (propuesta: MX$300).

**No bloqueantes**
4. *JC:* marcado inicial de `isCore` para los 10 decks vigentes (se puede hacer después del primer job).
5. *Legal/JC:* términos de atribución a Limitless. Datos de torneo son públicos; no se copia texto ni análisis. Confirmar redacción de la cita.
6. *Diseño:* cómo se representa el Pokémon principal en la tarjeta del índice sin usar arte externo (propuesta: recorte de la carta de catálogo).

## 14. Métricas

**Semana 1–4**
- Visitas a `/decks-meta/*` y su origen (orgánico vs. directo vs. Instagram).
- % de visitas a ficha de deck que hacen "Agregar las disponibles".
- Alertas "Avísame" creadas por semana y por carta.
- Ticket promedio de órdenes con línea de bundle vs. sin.

**Mes 2–3**
- Órdenes con bundle / órdenes totales.
- Tasa de apertura y clic del email "Qué cambió".
- Cartas del reporte de faltantes que pasaron a stock en las 2 semanas siguientes (mide si el reporte sirve para comprar).
- Posición en Google para "deck {arquetipo} precio méxico" en los 10 arquetipos.

## 15. Fase 2 (contexto para el modelo de datos, no construir)

- Toggle **Lista top / Lista económica** por deck (`MetaDeckList.variant`).
- Calendario de torneos oficiales en México desde el buscador de eventos de Pokémon (sin "pide antes de").
- Rotación: aviso global desde el anuncio, etiqueta "Rota en abril" por carta según regulation mark, actualización automática con las listas post-rotación.
- Correo por llegada de stock en tiempo real para "Avísame".
- Historial de meta (share por deck, 8 semanas).
- **Pega tu lista:** caja de texto que acepta el formato de exportación de TCG Live / Limitless (`4 Dragapult ex TWM 130`), parsea cantidad + nombre + set + número, y devuelve la misma vista de disponibilidad y precio que una ficha de deck.

---

## Prompt para la sesión de Code

```
Stream: decks-meta-v1. Lee este spec completo antes de tocar nada.

Sesión 1 — solo diseño, sin escribir código de producto:
1. Propón el modelo de datos definitivo a partir de la sección 7 y explica
   cualquier desviación.
2. Responde las preguntas bloqueantes 1 y 2 de la sección 13 con opciones
   y una recomendación, indicando qué archivos de zona compartida se
   tocarían (API_CONTRACT.md, prisma/schema, checkout).
3. Propón el diseño del job semanal: fuente, parseo, validación (mínimo 8
   arquetipos), fallback, y cómo se guarda el snapshot.
4. Lista los cambios a API_CONTRACT.md como diff propuesto.
5. Entrega todo como documento para revisión de arquitecto. No abras PR.

No implementes hasta que el arquitecto apruebe el diseño y
pricing-iva-v2.1 esté cerrado.
```
