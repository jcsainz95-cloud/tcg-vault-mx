# Aviso al cliente cuando se rechaza su INE (P-94) y qué pasa al rechazar dos veces (P-95)

**Borrador de decisiones para el dueño — NO es un diseño técnico.**
Autor: product-owner. Base: `origin/production` (`187b1d40`). Fecha: 2026-09-17.

Este documento **no decide nada**: pone sobre la mesa las opciones para que **tú** elijas en la
mañana. Cuando contestes las preguntas del final, el arquitecto ya puede diseñar y backend/frontend
construir. Todo lo que aquí digo que "está medido" viene de lo que el orquestador midió el
2026-09-13 (ver P-94/P-95 en `PENDIENTES.md`); lo que no está medido lo marco **(por confirmar)**.

---

## El problema en una frase

Cuando un admin **rechaza la identificación (INE)** de un cliente, hoy **el cliente no recibe
ningún aviso**: solo se entera si entra al portal por su cuenta y lo ve ahí (P-94). Y como el
sistema **no comprueba el estado antes de rechazar**, un admin puede rechazar la misma INE varias
veces seguidas (P-95). Hoy eso es inofensivo **solo porque no se manda ningún aviso**; el día que
exista el correo, serían varios correos de rechazo en un minuto a alguien que aún no ha podido
reaccionar.

**Lo que ya funciona (medido, no hay que rehacerlo):**

- El cliente **sí ve** en el portal "INE rechazada, vuelve a subirla", **con el motivo del
  rechazo** (el motivo ya se captura: es obligatorio, entre 3 y 500 caracteres).
- **El circuito cierra:** cuando el cliente vuelve a subir la INE, su estado (`kycStatus`) regresa
  a "pendiente" automáticamente. **Falta el aviso, no el circuito.**
- Ya existe un **sistema de plantillas de correo bilingüe (español/inglés)** que elige el idioma
  según la preferencia del cliente. Hoy tiene cuatro correos: verificar correo y restablecer
  contraseña, cada uno en los dos idiomas. **No hay ninguno de KYC.**

---

## 1) P-94 — ¿Por qué canal se le avisa al cliente?

El cliente tiene que enterarse de que su INE fue rechazada **y del motivo**, para poder corregir y
volver a subirla. Hoy no se le empuja el aviso por ningún lado. Estas son las tres formas de
resolverlo.

### Opción (a) — Solo correo

Reutilizar el sistema de plantillas que ya existe: se añade un correo nuevo de "INE rechazada" (en
español e inglés) que se dispara cuando el admin rechaza.

- **Pros:** es el camino más corto porque la maquinaria de correo ya está hecha y probada (mismo
  formato, mismo bilingüe, misma marca). El aviso **llega al cliente aunque no entre al portal** —
  es el único canal que lo busca a él. Puede llevar el motivo del rechazo dentro.
- **Contras:** un correo se puede perder en spam, o el cliente puede ignorarlo. Si en el futuro
  hay más tipos de avisos (bóveda, solicitudes de venta, etc.), el correo por sí solo no da un
  lugar donde el cliente vea "qué cambió en mi cuenta".
- **Esfuerzo relativo: BAJO.** Es el más barato porque solo se añade una plantilla al sistema que
  ya existe y se engancha al momento del rechazo. **(el número exacto de horas lo estima el
  arquitecto — por confirmar)**

### Opción (b) — Solo portal (mejorar lo que ya se ve)

Hoy el portal ya muestra "INE rechazada" con su motivo. Esta opción **no añade un canal nuevo**:
refuerza el que existe con un aviso visible o una insignia (por ejemplo, un punto rojo o un
mensaje destacado al entrar) para que el cliente no tenga que buscarlo.

- **Pros:** el motivo ya está ahí; solo se hace más visible. No depende de que llegue un correo.
- **Contras:** **sigue exigiendo que el cliente entre por su cuenta.** Si no entra, no se entera —
  que es exactamente el problema que reportaste. Por sí sola, esta opción **no cierra P-94**:
  mejora la experiencia de quien ya entró, pero no avisa a quien no entró.
- **Esfuerzo relativo: BAJO a MEDIO**, según cuánto se quiera pulir la insignia/aviso. **(por
  confirmar con ux-ui y el arquitecto)**

### Opción (c) — Ambos (correo + portal)

Correo que sale al rechazar **y** aviso visible en el portal cuando el cliente entra.

- **Pros:** cubre las dos situaciones: al cliente que no entra lo alcanza el correo, y al que entra
  lo recibe el portal de forma clara. Es la base natural del "centro de avisos" que ya pediste como
  encargo aparte (P-96), donde el aviso es lo primero que ve el cliente al entrar a su cuenta.
- **Contras:** es más trabajo que cualquiera de las dos por separado, y **abre la pregunta de si
  esto ya es P-96** (el centro de avisos completo) en vez de un arreglo puntual de P-94. Conviene
  no construir dos veces lo mismo.
- **Esfuerzo relativo: MEDIO** (los dos frentes a la vez). **(por confirmar)**

### Qué diría el mensaje

En los dos canales, el contenido es el mismo y ya lo tenemos casi todo:

- **Qué pasó:** "Tu identificación (INE) fue rechazada."
- **Por qué:** el **motivo que escribió el admin** (ya se captura; se muestra tal cual).
- **Qué hacer:** "Vuelve a subir tu INE desde tu cuenta" con el enlace/botón al portal (el circuito
  de re-subida ya funciona).
- **Idiomas:** **español e inglés**, igual que los cuatro correos actuales; el sistema ya elige el
  idioma según la preferencia del cliente. La tienda es es/en, así que ambos son obligatorios.

### Recomendación del product-owner

**Opción (a), solo correo, como arreglo mínimo que cierra P-94 hoy** — porque es lo único que
**alcanza al cliente que no entra al portal**, reutiliza maquinaria ya probada y es el esfuerzo más
bajo. La opción (b) por sí sola no cierra el problema que reportaste.

**Matiz importante:** tú ya pediste por separado el **centro de avisos completo** (P-96: correo
**y** portal, para KYC y muchos otros eventos, "lo primero que ve el cliente al entrar"). Si vas a
construir P-96 pronto, entonces la opción (c) es en realidad "empezar P-96 por el evento de KYC", y
tendría sentido hacer el correo (a) ahora y sumar el portal cuando se haga P-96, **sin construir el
portal dos veces**. La decisión de fondo es: **¿arreglamos P-94 solo con correo ahora, o lo
tratamos como el primer evento del centro de avisos P-96?** (ver pregunta 3 al final).

---

## 2) P-95 — ¿Qué pasa cuando se rechaza algo que ya estaba rechazado?

Hoy, al rechazar, el sistema **no mira el estado actual**: guarda la decisión y **sella una entrada
de auditoría cada vez**, aunque la INE ya estuviera rechazada y el cliente no haya tocado nada. Tú
lo planteaste como "bloquear el status". Hay tres salidas posibles.

### (i) Error / bloqueo

Si el admin intenta rechazar una INE que **ya está rechazada**, el sistema lo impide y le avisa
("esta identidad ya está rechazada").

- **Pros:** es lo más claro para el admin y lo más seguro contra el problema de "N correos en un
  minuto". Deja una regla simple: no se rechaza dos veces.
- **Contras:** si el admin **quería corregir el motivo** (puso mal la razón la primera vez), un
  bloqueo duro se lo impide y tendría que haber otra vía para eso (ver opción iii).

### (ii) No-op silencioso

El segundo rechazo **no hace nada**: no cambia el estado, no vuelve a sellar auditoría, no manda
correo. El sistema simplemente lo ignora porque el estado ya es el que se pide.

- **Pros:** evita los correos repetidos y las filas de auditoría duplicadas sin mostrarle un error
  al admin. Es "idempotente": pedir dos veces lo mismo tiene el mismo efecto que pedirlo una vez.
- **Contras:** el admin no recibe señal de que su segundo clic no hizo nada; podría pensar que sí
  cambió algo. Y si de verdad quería **cambiar el motivo**, el no-op lo descartaría en silencio.

### (iii) Corrección legítima del motivo (re-emitir el mismo estado con motivo nuevo, sin re-notificar)

Se permite rechazar sobre rechazado **solo si cambia el motivo** (el admin corrige la razón). El
estado sigue siendo "rechazada", se actualiza el motivo y se deja rastro en auditoría, **pero no se
vuelve a notificar al cliente** (o se notifica una sola vez, agrupado — por confirmar).

- **Pros:** cubre el caso real de "escribí mal el motivo y lo quiero arreglar" sin castigar al
  cliente con otro correo. Es la más flexible.
- **Contras:** es la más compleja de definir: hay que decidir qué cuenta como "motivo nuevo", si se
  re-notifica o no, y cómo se ve en auditoría. Más reglas = más superficie para equivocarse.

### Recomendación del product-owner

**Combinar (ii) y (iii):** si el rechazo repetido trae **el mismo motivo**, es un **no-op
silencioso** (no re-sella, no re-notifica); si trae **un motivo distinto**, es una **corrección
legítima** (actualiza el motivo, deja auditoría, **no dispara un segundo aviso al cliente**). Así se
mata el problema de los correos repetidos **y** se respeta el caso real de corregir una razón mal
escrita. La opción (i) pura (bloqueo duro) es más simple pero le quita al admin la posibilidad de
corregir el motivo, que es un caso que sí ocurre.

**(Nota: cuál de las tres es "mejor" es una decisión tuya de producto, no técnica. El arquitecto
implementa la que elijas.)**

### Por qué el orden importa

Esto es lo más importante de P-95: **la guarda (i/ii/iii) tiene que entrar CON el aviso de P-94, o
antes — nunca después.**

- Hoy rechazar N veces es **inofensivo por casualidad**: como no se manda ningún aviso (P-94), que
  se re-selle la auditoría no molesta a nadie.
- El día que exista el correo (P-94) **sin la guarda (P-95)**, cada rechazo repetido dispara un
  correo. Un admin que rechaza dos veces en un minuto (como te pasó) generaría **dos correos de
  rechazo** a un cliente que no ha podido ni contestar el primero.
- Por eso **no se puede soltar el correo de P-94 y dejar P-95 "para después"**: se construyen
  juntos, o primero la guarda y luego el correo. Nunca al revés.

---

## 3) Las decisiones que el dueño debe tomar

Contesta estas para que el arquitecto pueda diseñar. Son cortas a propósito.

1. **Canal de aviso para el rechazo de INE (P-94):**
   ☐ (a) Solo correo &nbsp;·&nbsp; ☐ (b) Solo portal &nbsp;·&nbsp; ☐ (c) Ambos
   *(recomendación: (a) como mínimo que cierra el problema hoy)*

2. **¿Esto es un arreglo puntual o el arranque del centro de avisos P-96?**
   ☐ Arreglar P-94 solo con correo ahora, y el portal llega cuando se construya P-96
   ☐ Tratar el rechazo de INE como el **primer evento** del centro de avisos P-96 (correo + portal
   juntos desde ya)
   *(esto evita construir el portal dos veces)*

3. **Rechazar sobre una INE ya rechazada (P-95):**
   ☐ (i) Error/bloqueo &nbsp;·&nbsp; ☐ (ii) No-op silencioso &nbsp;·&nbsp; ☐ (iii) Corrección de
   motivo sin re-notificar &nbsp;·&nbsp; ☐ (ii)+(iii) combinadas
   *(recomendación: (ii)+(iii))*

4. **Confirmación de orden (P-95 con P-94):** ¿de acuerdo en que **la guarda de estado entra junto
   con el aviso, o antes, y nunca después**? ☐ Sí ☐ No

5. **Contenido y tono del mensaje:** el texto propuesto ("Tu INE fue rechazada" + motivo del admin +
   "vuelve a subirla", en es/en) ¿te sirve tal cual, o quieres cambiar el tono/las palabras?
   ☐ Sirve ☐ Quiero ajustar: __________

---

## Supuestos y lo que queda por confirmar

- **(SUPUESTO)** Que el correo de rechazo debe llevar el **motivo escrito por el admin** tal cual.
  El motivo ya se captura (medido); asumo que quieres que el cliente lo lea. Confírmalo.
- **(SUPUESTO)** Que "corrección de motivo" (opción iii) **no** debe re-notificar al cliente.
  Confírmalo o di si prefieres una sola notificación agrupada.
- **(por confirmar)** Los tiempos/esfuerzo exactos de cada opción los estima el arquitecto; aquí
  solo doy esfuerzo **relativo** (bajo/medio).
- **(por confirmar)** Si hay algún caso en el que quieras **rechazar de nuevo y SÍ volver a
  notificar** (por ejemplo, si el cliente re-subió y vuelve a estar mal — pero eso ya es un ciclo
  nuevo, no un doble rechazo del mismo, y el circuito ya lo maneja).
- **Fuera de alcance de este borrador:** el catálogo completo de eventos del centro de avisos
  (bóveda, solicitudes de venta, etc.) es P-96, un encargo tuyo aparte. Aquí solo trato el rechazo
  de INE (P-94) y la guarda de doble rechazo (P-95).
