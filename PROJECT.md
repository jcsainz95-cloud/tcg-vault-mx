# PROJECT.md — Marketplace TCG con Bóveda (Pokémon, México)

> Estado: borrador para aprobación del humano. Todas las decisiones de alcance y de negocio están
> cerradas; no quedan preguntas abiertas bloqueantes. Lo único no fijado son las **metas de
> lanzamiento N/X/Y/Z**, que el humano define al momento de lanzar (no bloquean el desarrollo).
> Este documento manda sobre el contrato y sobre el código (ver `CLAUDE.md` › Regla de conflicto).

## Idea en una frase
Un marketplace de cartas Pokémon (TCG) en México que vende **cartas individuales** con
**precio de mercado visible** y una **BÓVEDA/CUSTODIA**: la plataforma guarda físicamente las
cartas compradas —autenticadas y con condición garantizada— y las envía solo cuando el usuario
lo pide, para completar colecciones sin envíos innecesarios.

## Problema que resuelve
Completar una colección de cartas hoy implica compras dispersas, envíos repetidos y caros, dudas
de autenticidad/condición y precios opacos. Este marketplace resuelve:
- **Precio real y transparente**: cada carta muestra un precio de referencia de mercado (commodity).
- **Cero envíos innecesarios**: las cartas compradas viven en la bóveda; el usuario acumula y pide
  el retiro cuando le conviene, pagando un solo envío.
- **Confianza**: cada carta se autentica una vez al ingresar a la bóveda; se garantiza autenticidad
  y condición (incluidas raw con estándar propio y fotos verificadas).
- **Portafolio visible**: el usuario ve el valor de su colección en custodia, valuado a mercado.

## Usuarios y roles de la app
- **Comprador (usuario final / cliente)**: se registra, navega catálogo con precio de referencia,
  compra cartas, ve su bóveda y el valor de su portafolio, pide retiros/envíos y crea solicitudes
  de venta (buylist). No opera dinero de la plataforma ni ve back-office.
- **Súper-admin (dueño del negocio)**: acceso total al back-office (M1–M10). Es el único que
  **toca dinero que sale** (pagos SPEI de buylist, reembolsos), edita configuración/diales y ve
  finanzas. Fija precios "pendientes" a mano. En el MVP, el negocio ES el admin.
- **Operador de bóveda**: rol de back-office limitado. Opera M1 (inventario/bóveda), M4
  (retiros/envíos) y M5 (buylist) **hasta la etapa de verificación**. **No** toca dinero,
  configuración ni finanzas. Toda su actividad queda en bitácora.

## Funcionalidades del MVP

### A. Storefront / catálogo (comprador)
- [ ] Catálogo navegable de cartas con búsqueda y filtros (set, rareza, condición, tipo).
- [ ] Ficha de carta con **precio de referencia** visible, convertido a MXN, refresco diario. Fuente
      según tipo de producto (ver "Fuentes de precio" en Restricciones técnicas):
      - **raw / singles**: TCGPlayer "Market Price" vía **pokemontcg.io**.
      - **gradeadas (PSA/CGC) y sellado**: **PokemonPriceTracker** o **PokeTrace** (free tier),
        con **override manual del admin** siempre disponible como respaldo.
- [ ] Tipos de producto vendibles: **gradeadas (PSA/CGC)**, **producto sellado** y **raw**
      (con estándar de condición propio + fotos verificadas anverso/reverso).
- [ ] Solo se prician las cartas **que tenemos en bóveda** (no el catálogo completo), con **cache diario**,
      para que los free tier alcancen.
- [ ] Cartas sin precio en la web de referencia: se muestran como **"precio pendiente"** (no se ocultan);
      el dueño las fija a mano antes de ponerlas a la venta.
- [ ] Registro/login de usuario.

### B. Compra y checkout (Stripe)
- [ ] Carrito y checkout con **Stripe**.
- [ ] Precios en catálogo/ficha se muestran **sin IVA**.
- [ ] **Costo de procesamiento trasladado al comprador**: línea visible y desglosada en el checkout.
- [ ] **IVA 16% desglosado como línea aparte** en el checkout; el total cobrado lo incluye.
- [ ] Cobrar IVA implica **facturación CFDI**: registrar los datos necesarios para emitir factura
      (ver bandera fiscal en Riesgos) y guardar el IVA cobrado para M7 Finanzas.
- [ ] Al pagar, la carta comprada entra a la **bóveda del usuario** con titularidad `pending`.
- [ ] Cuando el pago se liquida, la titularidad pasa a `settled`.
- [ ] **Sin wallet de saldo**: el dinero se liquida por transacción; la plataforma no guarda saldo del usuario.
- [ ] **Contracargo**: revierte la carta al inventario de la plataforma y refleja el estado de la orden.

### C. Bóveda y portafolio (comprador)
- [ ] Vista de "Mi bóveda": todas las cartas en custodia del usuario, con su estado de titularidad.
- [ ] **Valor del portafolio** calculado contra el precio de referencia (TCGPlayer, MXN, refresco diario).
- [ ] Cartas del portafolio sin precio en la web → **"precio pendiente"**, escaladas al dueño para fijar a mano.
- [ ] **Almacenamiento gratis y sin límite explícito en el MVP** (sin tope de meses ni de cartas). En los
      términos se declara únicamente el **derecho genérico de la plataforma a cobrar custodia en fase 2**.

### D. Retiro / envío (comprador)
- [ ] Solicitud de retiro de una o varias cartas de la bóveda (**sin mínimo de cartas**).
- [ ] **Tarifa fija de envío pagada por el comprador**: **MX$175** por paquete (con seguro), configurable en M10.
- [ ] **Envío/retiro solo nacional (todo México)** en el MVP; internacional queda fuera de alcance.
- [ ] Solo se pueden retirar cartas con titularidad **`settled`**.
- [ ] Ejecución de guía **manual** en el MVP (el admin/operador captura el número de guía).

### E. Buylist — compra de raw a usuarios (cotizador público + solicitud)
- [ ] **Cotizador público**: el usuario elige carta + condición y ve una cotización automática:
      - comunes: **MX$0.50**
      - reverse holo: **MX$1.50**
      - EX o superior: **40% del precio de referencia**
- [ ] Crear una **solicitud de venta** a partir de la cotización.
- [ ] Cartas sin precio en la web → **cola de "precio pendiente"** para que el dueño las fije.
- [ ] Recepción física, verificación de condición, aprobación/ajuste y **pago (SPEI)** los opera el
      admin a mano (ver back-office M5). El dueño **decide carta por carta** (cherry-pick).
- [ ] **Límites anti-fraude/KYC** (defaults configurables en M10): tope por solicitud **MX$3,000** y por
      mes **MX$10,000**; pago solo por SPEI a una cuenta **a nombre del propio usuario**; **INE** requerido
      cuando se supera el tope.

### F. Back-office / herramienta de administración (M1–M10) — parte central del MVP
Principio: cada objeto (carta física, orden, solicitud, envío, disputa) es una **cola con estados**.
- [ ] **M1 — Inventario y bóveda**: alta de items con **fotos verificadas** (anverso/reverso),
      ubicación jerárquica tipo **CAJA/FILA/SLOT**, **folio legible por item** (ej. `INV-000123`),
      estados, **mover con historial**, marcar **pérdida/daño**.
- [ ] **M2 — Catálogo y precios**: **sync de precios** de las cartas en bóveda desde las fuentes según tipo
      (pokemontcg.io para raw/singles; PokemonPriceTracker/PokeTrace para gradeadas y sellado), **override
      manual** de precio siempre disponible, **cache diario**, **tipo de cambio USD→MXN con colchón**
      configurable, tabla **rareza → categoría del buylist**. El proveedor de precios es **intercambiable
      (`PricingProvider`)** para poder subir a un plan de pago sin tocar el resto del sistema.
- [ ] **M3 — Ventas / órdenes**: estados `pending / settled / fallida / reembolsada / contracargo`,
      **desglose con línea de Stripe**, **reembolso**.
- [ ] **M4 — Retiros / envíos**: cola `solicitado → picking → guía → enviado → entregado`,
      **lista de picking por ubicación**, **captura de guía**, solo sobre cartas `settled`.
- [ ] **M5 — Buylist**: pipeline `cotizada → recibida → verificación → aprobada → pagada`,
      **decisión carta por carta**, **cola de precio pendiente**, **conversión a inventario en un clic**.
- [ ] **M6 — Usuarios / KYC ligero**: **ficha 360°** del usuario, **CLABE**, **INE**, límites, **bloquear**.
- [ ] **M7 — Finanzas**: **P&L** (ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia),
      **valor de inventario a referencia vs costo**, **valor en custodia de clientes**, **IVA cobrado
      registrado** (para conciliación/CFDI), **export CSV**.
- [ ] **M8 — Disputas**: **comparador de fotos** (ingreso vs reclamo), **recompra** como remedio.
- [ ] **M9 — Reportes mínimos**: métricas de lanzamiento + **export**.
- [ ] **M10 — Config y bitácora**: **diales editables sin deploy** + **auditoría global** (quién / qué / cuándo).
      Diales con **valores por defecto** (todos configurables): tarifa de envío **MX$175**, % de aportación
      en especie **70%**, IVA **16%**, tope de buylist **MX$3,000/solicitud** y **MX$10,000/mes**, umbral de
      **INE = el tope**, **tope de reposición por carta** (definido por el dueño), tipo de cambio USD→MXN con
      colchón, selección de **`PricingProvider`** por tipo de producto.
- [ ] **Dashboard** con ~8 tarjetas: ganancia del periodo, ventas, cola de trabajo, valor de inventario,
      valor en custodia, buylist del periodo, salud de datos, progreso de lanzamiento.
- [ ] **Roles del back-office**: súper-admin (todo) y operador de bóveda (M1, M4, M5 hasta verificación;
      sin dinero/config/finanzas). **Regla de oro**: el dinero que sale solo lo toca el súper-admin;
      todo queda en bitácora.
- [ ] **Panel responsive** con **captura de fotos desde móvil** (para el flujo de bóveda/verificación).

### G. Inventario inicial (operación de arranque)
- [ ] Alta del **inventario propio**: colección del humano + adquisiciones con presupuesto.
- [ ] **Costo por carta propia** = precio de referencia del día × **% configurable** (default **70%**),
      **editable**, registrado como **"aportación en especie"**.

### H. Reglas de negocio transversales (aplican a varios módulos)
- [ ] **Titularidad en bóveda**: `pending → settled`; retiro solo sobre `settled`; contracargo revierte al inventario.
- [ ] **Regla general de valuación**: toda carta se valúa contra la web de referencia; si no hay precio,
      se marca **"precio pendiente"** y se **escala al dueño** (aplica a buylist, inventario y portafolio).
      Nunca se descarta una carta por falta de dato.
- [ ] **Responsabilidad por pérdida/daño en custodia**: reposición al **precio de referencia del día del
      incidente**, con **tope por carta configurable por el dueño** (M10). Seguro formal = bandera legal, no
      bloquea MVP técnico.
- [ ] **Disputas de condición (raw)**: las **fotos de ingreso a bóveda son la evidencia canónica**;
      decide el admin; remedio = **recompra al precio pagado dentro de 7 días de recibido el envío**.
- [ ] **Buylist — plazos**: sin respuesta del usuario a un ajuste: **7 días → rechazo**;
      **abandono a 30 días → pasa a inventario**.

## Fuera de alcance (por ahora — fase 2 o posterior)
- **Consignación / marketplace C2C** (cartas de terceros vendidas dentro de la bóveda).
- **Order-book / trading instantáneo** (compra/venta digital tipo bolsa dentro de la bóveda).
- **Wallet de saldo** para usuarios (el dinero se liquida por transacción).
- **Pagos y logística automatizados** (guías automáticas, pagos SPEI automáticos): en MVP son manuales.
- **Grading propio o integración directa con PSA/CGC**.
- **App móvil nativa** (el panel es web responsive; la captura de fotos es vía navegador móvil).
- **Cobro de almacenamiento en bóveda** (derecho genérico declarado en términos, pero no se cobra en MVP).
- **Envío/venta internacional**: el MVP es **solo nacional (México)**; internacional es fase 2.
- **PriceCharting**: **no se usa en el MVP** (las fuentes free + override manual cubren todo). Queda como
  opción futura si se decide.
- **Plan de pago de proveedor de precios** (~$9.99/mes): no se contrata en MVP; el `PricingProvider`
  intercambiable permite subir a él más adelante sin tocar el resto del sistema.

## Restricciones y preferencias técnicas
> Registradas como datos/preferencias del humano; el stack y la arquitectura los decide el arquitecto.
- **Pagos**: **Stripe**; **sin balance/saldo** de dinero en la plataforma (liquidación por transacción).
- **Impuestos**: precios mostrados **sin IVA**; **IVA 16%** se desglosa como **línea aparte en checkout** y
  se incluye en el total. Implica **facturación CFDI** (registrar datos y guardar IVA cobrado).
- **Fuentes de precio (MVP = 100% free tier)**, tras un **`PricingProvider` intercambiable**:
  | Tipo de producto | Fuente primaria | Respaldo |
  |---|---|---|
  | raw / singles | TCGPlayer "Market Price" vía **pokemontcg.io** | override manual del admin |
  | gradeadas (PSA/CGC) | **PokemonPriceTracker** (free 100/día) o **PokeTrace** (free 250/día) | override manual del admin |
  | sellado | **PokemonPriceTracker** / **PokeTrace** (free tier) | override manual del admin |
  - Solo se prician las cartas **en bóveda** (no el catálogo completo) + **cache diario**, para que el free
    tier alcance. **PriceCharting no se usa en el MVP.**
- **Valuación de portafolio del usuario**: base en las fuentes anteriores, en **MXN**, **refresco diario**.
- **Alcance geográfico**: **solo nacional (todo México)** en el MVP; internacional es fase 2.
- **Catálogo en inglés** en el MVP (sin localización del catálogo).
- **Panel de administración responsive** con **captura de fotos desde móvil**.
- **Pago de buylist**: solo **SPEI** a cuenta a nombre del propio usuario (sin otros métodos).
- **Branch de trabajo**: `claude/tcg-cards-marketplace-oijthj`.
- Stack, base de datos y despliegue: **a decisión del arquitecto** (nada predefinido por el humano).

## Criterios de aceptación
> QA usa esto como checklist. Cada criterio debe ser verificable.

**Catálogo y precio**
1. Un visitante puede navegar el catálogo y filtrar por al menos set, rareza y condición.
2. Una ficha de carta muestra el precio de referencia en MXN derivado de TCGPlayer/pokemontcg.io, con
   fecha del último refresco; el refresco ocurre al menos una vez al día.
3. Una carta sin precio en la web de referencia se muestra como **"precio pendiente"** y NO se puede
   comprar hasta que el dueño le fija precio a mano.

**Compra y bóveda**
4. Un comprador puede pagar con Stripe; el checkout muestra una **línea explícita** con el costo de
   procesamiento trasladado, y el total cobrado incluye ese costo.
5. Tras un pago exitoso, la carta aparece en la bóveda del comprador con titularidad `pending` y
   cambia a `settled` cuando el pago se liquida.
6. Un usuario NO tiene saldo/wallet en ninguna vista; todo se maneja por transacción.
7. Un contracargo mueve la carta afectada de la bóveda del usuario de vuelta al inventario de la
   plataforma y la orden queda en estado `contracargo`.

**Portafolio**
8. "Mi bóveda" lista las cartas del usuario y muestra un **valor total de portafolio** en MXN,
   consistente con el precio de referencia diario; las cartas "precio pendiente" se identifican y no
   rompen el cálculo (se excluyen o marcan claramente).

**Retiro / envío**
9. Un usuario puede solicitar el retiro de 1 o más cartas `settled` sin mínimo de cantidad; el sistema
   cobra una **tarifa fija de envío** al comprador antes de generar la solicitud.
10. Una carta `pending` NO puede incluirse en una solicitud de retiro.
11. El admin/operador puede capturar un número de guía y la solicitud avanza por los estados
    `solicitado → picking → guía → enviado → entregado`.

**Buylist**
12. El cotizador público devuelve la cotización correcta por regla: común = MX$0.50, reverse holo =
    MX$1.50, EX o superior = 40% del precio de referencia.
13. Una carta de buylist sin precio de referencia entra a la **cola de precio pendiente** y no se cotiza
    automáticamente hasta que el dueño fija su precio.
14. El sistema bloquea solicitudes que excedan el **tope por solicitud** o el **tope mensual** del usuario,
    exige **INE** cuando se supera el tope configurado, y solo permite registrar pago SPEI a una CLABE a
    nombre del propio usuario.
15. En el pipeline de buylist el dueño puede **aceptar carta por carta** (cherry-pick), ajustar o
    rechazar, y una carta aprobada se **convierte a inventario en un clic**.
16. Una solicitud de buylist sin respuesta del usuario a un ajuste se **rechaza a los 7 días**; una
    solicitud abandonada **pasa a inventario a los 30 días**.

**Back-office (M1–M10) y roles**
17. En M1, cada item físico tiene **folio legible** (ej. `INV-000123`), **fotos anverso/reverso**,
    **ubicación CAJA/FILA/SLOT** y un **historial de movimientos**; se puede marcar pérdida/daño.
18. En M2 se puede sincronizar precios desde pokemontcg.io, hacer **override manual**, y configurar el
    **tipo de cambio USD→MXN con colchón** y la **tabla rareza→categoría de buylist**.
19. En M3 una orden refleja los estados `pending/settled/fallida/reembolsada/contracargo` con desglose
    que incluye la **línea de Stripe**, y el súper-admin puede emitir un **reembolso**.
20. En M4 existe una **lista de picking ordenada por ubicación**.
21. En M7 el P&L calcula **ingresos + envío − costo de lo vendido − comisiones Stripe = ganancia**, y
    muestra **valor de inventario (a referencia y a costo)** y **valor en custodia de clientes**, con **export CSV**.
22. En M8, ante una disputa de condición, el admin ve un **comparador de fotos (ingreso vs reclamo)** y
    puede ejecutar la **recompra** como remedio.
23. En M10 existe una **bitácora de auditoría global** (quién/qué/cuándo) y los **diales/config se editan
    sin necesidad de redeploy**.
24. El **dashboard** muestra las ~8 tarjetas definidas (ganancia del periodo, ventas, cola de trabajo,
    valor de inventario, valor en custodia, buylist del periodo, salud de datos, progreso de lanzamiento).
25. Un **operador de bóveda** puede operar M1, M4 y M5 hasta verificación, pero **no** puede acceder a
    finanzas (M7), configuración (M10) ni ejecutar pagos/reembolsos; el intento queda registrado y bloqueado.
26. **Ninguna** acción de dinero saliente (pago SPEI de buylist, reembolso) puede ejecutarla otro rol que
    no sea el **súper-admin**.
27. El panel de administración es **responsive** y permite **capturar fotos desde un dispositivo móvil**
    en el flujo de ingreso/verificación de bóveda.

**Inventario inicial**
28. El alta de una carta propia calcula su costo como **precio de referencia del día × % configurable**
    (default ej. 70%), el % es editable, y el registro queda marcado como **"aportación en especie"**.

**Transversal — valuación**
29. En cualquier módulo (buylist, inventario, portafolio), una carta sin precio en la web nunca se
    descarta: se marca "precio pendiente" y se **escala al dueño** para fijarlo a mano.

## Riesgos y banderas para el humano
> No bloquean el desarrollo técnico del MVP, pero deben resolverse antes de operar con público real.
- **Legal — custodia/depositario**: la bóveda implica guardar bienes de terceros. Validar con abogado la
  figura de **depositario**, el **contrato de custodia**, la responsabilidad por pérdida/daño y el **tope
  por carta**. Definir si hay **seguro formal** del inventario en custodia.
- **Fiscal — buylist**: comprar cartas a particulares y pagar por SPEI tiene implicaciones fiscales
  (comprobación, retenciones, límites). Validar con contador; los topes por solicitud/mes y el requisito
  de INE son mitigaciones iniciales, no una postura fiscal completa.
- **ToS de las APIs de precio**: revisar los **términos de uso de pokemontcg.io / TCGPlayer** (y
  PriceCharting) para confirmar que está permitido mostrar precios de referencia y valuar portafolios
  comercialmente, y bajo qué atribución/límites de rate.
- **Fiscal/legal — valuación en MXN a mercado**: confirmar que mostrar valor de portafolio a clientes no
  crea expectativa contractual de recompra a ese valor (más allá del remedio de recompra ya definido).

## Métricas de éxito del MVP / definición de "lanzado"
El MVP se considera "lanzado" cuando, en una **beta cerrada**, se cumple en un periodo de **30–60 días**:
- **N** usuarios activos en la beta cerrada. *(N: PENDIENTE de fijar por el humano.)*
- **X** ventas completadas (pago `settled`). *(X: PENDIENTE de fijar por el humano.)*
- **Y** solicitudes de buylist aprobadas y pagadas. *(Y: PENDIENTE de fijar por el humano.)*
- **Z** retiros enviados sin disputa. *(Z: PENDIENTE de fijar por el humano.)*
- El back-office opera el ciclo completo (compra → bóveda → retiro y cotización → recepción → pago) sin
  intervención fuera de la herramienta.

## Preguntas abiertas para el humano
> Ambigüedades reales no cubiertas por las decisiones cerradas. No se asumen; se preguntan.
1. **Parámetros de lanzamiento N/X/Y/Z**: ¿qué valores concretos definen "lanzado" (usuarios, ventas,
   buylist aprobadas, retiros sin disputa) y en qué ventana exacta (30 o 60 días)?
2. **Límite de almacenamiento gratis**: ¿cuál es el límite declarado del MVP — **meses** (ej. 12),
   **tope de cartas por usuario**, o ambos? Definir el número exacto.
3. **Tarifa fija de envío**: ¿monto exacto dentro del rango MX$150–200 y qué cubre el seguro (tope de
   valor asegurado por paquete)?
4. **Tope por carta en pérdida/daño**: ¿cuál es el monto/regla del tope de reposición por carta?
5. **% de costo de aportación en especie**: ¿el default es 70% u otro valor de arranque?
6. **Topes de buylist e INE**: confirmar montos definitivos (¿MX$3,000 por solicitud, MX$10,000/mes,
   INE sobre qué umbral exacto?).
7. **PriceCharting en MVP**: ¿se incluye desde el inicio para gradeada/sellado, o se pospone y el
   sellado se precia 100% por override manual?
8. **Alcance geográfico y de envío**: ¿el envío/retiro es solo nacional (México) en el MVP? ¿Aplica a
   todo el país o a zonas específicas?
9. **Impuestos al comprador**: ¿el precio y checkout deben incluir/desglosar **IVA** u otros impuestos,
   o el precio de referencia se muestra tal cual sin impuestos?
