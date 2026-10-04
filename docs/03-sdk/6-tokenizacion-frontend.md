# Tokenización de tarjeta en el navegador: ¿puede el SDK unificar también el frontend?

> **Estado:** Investigación completada — 27 de septiembre de 2026.  
> Responde el issue de investigación que encarga evaluar si el SDK puede abstraer
> la tokenización de tarjeta en el navegador igual que abstrae el cobro en el servidor.
> **Veredicto: implementación parcial recomendada.** Las razones siguen a continuación.

---

## 1. El hueco actual y por qué existe

`PaymentMethod.card()` acepta un `cardToken` opcional. El comentario en el código lo explica:

> «El SDK nunca recibe el número de tarjeta: tokenizar es responsabilidad del frontend contra la pasarela, y aceptar el número acá metería al SDK y a todo lo que lo integre dentro del alcance de PCI DSS.»
> — `PaymentMethod.ts`, línea 74–76

El token no lo produce el SDK: lo produce la librería de navegador de cada pasarela, y hoy un desarrollador tiene que conocer cuatro APIs distintas para obtenerlo. La unificación que el SDK ofrece en el servidor queda incompleta si en el navegador el comercio sigue operando directamente con cada pasarela.

---

## 2. Qué ofrece cada pasarela en el navegador

### 2.1 Wompi

**Librería oficial:** widget embebido + REST directo con clave pública.

| Aspecto | Detalle |
|---|---|
| Carga | `<script src="https://checkout.wompi.co/widget.js">` |
| Mecanismo de tokenización | `POST https://sandbox.wompi.co/v1/tokens/cards` con `Authorization: Bearer <PUBLIC_KEY>` |
| Entrada | `{ number, cvc, exp_month, exp_year, card_holder }` |
| Salida | `{ data: { id: "tok_staging_…" } }` |
| Documentación | [docs.wompi.co](https://docs.wompi.co) |

Wompi es el caso más simple: la tokenización es una llamada REST estándar que cualquier cliente HTTP puede hacer, sin librería propietaria. El widget HTML (`data-widget-operation="tokenize"`) es una alternativa con formulario visual, pero la tokenización pura no lo necesita.

**Nivel de evidencia:** Nivel 1 — medido contra el sandbox el 27 de septiembre de 2026. Un `POST /v1/tokens/cards` con la clave pública del sandbox devolvió un token `tok_staging_…` que se usó en un cobro exitoso de $5 000 COP.

---

### 2.2 Mercado Pago

**Librería oficial:** `@mercadopago/sdk-js` (npm) o CDN `https://sdk.mercadopago.com/js/v2`.

| Aspecto | Detalle |
|---|---|
| Carga | REST directo con `globalThis.fetch` (sin dependencias) o SDK oficial `npm install @mercadopago/sdk-js` |
| Mecanismo de tokenización | REST directo a `POST /v1/card_tokens?public_key=...` con CORS abierto, o Bricks / Core Methods |
| Entrada | `{ number, cvc, expMonth, expYear, cardHolder, docType, docNumber }` |
| Salida | `token.id` — cadena opaca de un solo uso (`tok_...` o hash hexadecimal) |
| Documentación | [mercadopago.com.co/developers](https://www.mercadopago.com.co/developers/es/docs) |

Mercado Pago admite tokenización directa vía REST con clave pública enviada como parámetro de consulta. Aunque la documentación oficial destaca **Bricks** (formulario visual prediseñado) y **Core Methods** (gestión de eventos de campos con iframes de hosted fields), la API HTTP de `/v1/card_tokens` cuenta con soporte CORS completo (`access-control-allow-origin: *`). Esto permite tokenizar directamente desde el navegador del pagador sin descargar scripts de terceros, reduciendo la superficie de ataque y el tamaño del bundle a solo ~7 KB en formato ESM.

La API de Mercado Pago emite el token aunque se omita la identificación (devuelve `identification: {}`, medido el 4 de octubre de 2026), y la documentación oficial marca `identificationType` e `identificationNumber` como opcionales en [`createCardToken`](https://github.com/mercadopago/sdk-js/blob/main/docs/core-methods.md) y `payer.identification` como opcional al [crear el pago](https://www.mercadopago.com.co/developers/en/reference/online-payments/checkout-api-payments/create-payment/post). Que el SDK exija `docType` y `docNumber` antes de la llamada es una decisión propia, no un requisito de la pasarela: un cobro en sandbox con documento y otro sin él fueron rechazados por antifraude por igual, así que no se sabe si el documento influye en la aprobación, y el formulario de ejemplo de [Core Methods para Colombia](https://www.mercadopago.com.co/developers/en/docs/checkout-api-payments/integration-configuration/card/integrate-via-core-methods) también pide los dos campos. El razonamiento está en el punto 78 del `architecture-log.md`.

**Nivel de evidencia:** Nivel 1 — medido contra el sandbox real el 27 de septiembre de 2026 (punto 72), CORS medido el 30 de septiembre de 2026 y validación de contrato completada el 4 de octubre de 2026 (punto 78). Un preflight OPTIONS a `https://api.mercadopago.com/v1/card_tokens` con `Origin: http://localhost:5173` responde 200 y `access-control-allow-origin: *`. Se verificó que el nombre del titular selecciona el desenlace en sandbox (`APRO` aprueba) y que el cobro real se ejecuta de punta a punta. Se asume el alcance regulatorio SAQ A-EP (ver punto 78 del log).

---

### 2.3 Kushki

**Librería oficial:** `@kushki/js-sdk` (npm) — Hosted Fields.

| Aspecto | Detalle |
|---|---|
| Carga | `npm install @kushki/js-sdk` |
| Mecanismo de tokenización | Hosted Fields: los campos de tarjeta viven en **iframes alojados por Kushki**, no en el DOM del comercio |
| Entrada | El comercio pasa selectores CSS; los iframes capturan los datos |
| Salida | `{ token: "abc123…" }` via `hostedFields.requestToken()` |
| Documentación | [docs.kushkipagos.com](https://docs.kushkipagos.com) |

Kushki es el modelo más restrictivo del conjunto. Los Hosted Fields son iframes: el número de tarjeta nunca entra al DOM del comercio, lo que reduce el alcance de PCI al mínimo posible. La consecuencia es que envolver la librería es más complejo: el SDK tendría que gestionar el ciclo de vida asíncrono de los iframes, que incluye eventos de enfoque, validación en tiempo real y errores de red del iframe.

**Nivel de evidencia:** Nivel 3 — tomado de la documentación oficial. No se ejecutó.

---

### 2.4 Rapyd

**Librería de navegador:** **no existe para tokenización de tarjeta.**

| Aspecto | Detalle |
|---|---|
| Modelo | Hosted Checkout Page — Rapyd genera una URL a la que redirigir al usuario |
| Tokenización inline | No disponible públicamente. Requiere certificación PCI Level 1 |
| Lo que el comercio recibe | Una URL de redirección, no un token |
| Documentación | [docs.rapyd.net](https://docs.rapyd.net) |

Este es el caso determinante. Rapyd no expone tokenización inline en el navegador: su modelo es que el comercio crea un checkout vía API de servidor (`POST /v1/checkout`) y redirige al usuario a la URL que recibe. Por eso `cardToken` es opcional en el contrato del SDK: para Rapyd no existe ese paso (punto 50 del `architecture-log.md`).

Intentar envolver Rapyd en la misma abstracción que las otras tres implicaría exponer una operación diferente (`createCheckout` que devuelve una URL de redirección) bajo la misma firma que `tokenizeCard`, lo que violaría el principio de que el puerto exprese el mínimo común denominador real.

**Nivel de evidencia:** Nivel 1 — medido el 27 de septiembre de 2026. Un intento de tokenización de tarjeta servidor-a-servidor con el número de tarjeta respondió `ERROR_CARD_NOT_AUTHENTICATED` en el sandbox de Rapyd, confirmando que el camino inline no existe.

---

## 3. El mínimo común denominador real

El ejercicio que se hizo con `PaymentGatewayPort` en el servidor aplica acá: buscar la operación común.

La operación «convertir datos de tarjeta en un token» **no es universal en las cuatro pasarelas**. Rapyd la excluye por diseño. El mínimo común denominador real en el navegador es:

> **«Iniciar el flujo de pago con tarjeta»** — que en tres pasarelas produce un token y en una produce una URL de redirección.

Este es el mismo asimétrico que ya existe en el servidor con `PaymentResult`: en lugar de asumir que el resultado es siempre una transacción, el tipo discrimina entre `TRANSACTION` y `REDIRECT_REQUIRED`. Un puerto frontend tendría que hacer la misma distinción.

---

## 4. Implicaciones de PCI-DSS

Envolver las librerías de las pasarelas **no amplía el alcance de PCI** siempre que se cumplan dos condiciones:

1. **El SDK de navegador nunca toca el número de tarjeta.** Si el SDK llama a los Hosted Fields de Kushki o al REST de Wompi pasando los datos de tarjeta, es la librería de la pasarela quien los procesa. El SDK solo coordina, no almacena ni transmite PANs.

2. **El SDK de navegador no expone una ruta para enviar el número de tarjeta al servidor del comercio.** Si el SDK publica una función que toma el número y lo manda al servidor propio, ese servidor entra en el alcance aunque no lo almacene.

Mientras el SDK actúe como coordinador de las librerías de las pasarelas (y no como destinatario de datos de tarjeta), **el alcance de PCI del comercio no cambia respecto a usar las librerías directamente**.

La excepción es Rapyd: si el comercio necesita tokenización inline en Rapyd, necesita certificación PCI Level 1 independientemente del SDK, porque ese camino exige enviar el PAN directamente a la API de Rapyd.

---

## 5. Cómo encajaría en la arquitectura hexagonal

Implementarlo como parte del paquete actual no es viable directamente: el SDK es Node.js (`CJS`), y el navegador necesita `ESM` + un bundle sin dependencias de Node. El `package.json` del SDK no tiene campo `exports`, lo que hoy hace imposible exponer un punto de entrada adicional como `kit-pagos-colombia/browser` sin reestructurar el build.

Las opciones son:

| Opción | Ventajas | Desventajas |
|---|---|---|
| **A. Sub-package en el mismo repo** exportado como `kit-pagos-colombia/browser` | Comparte tipos de dominio (`Gateway`, `Amount`) sin duplicar | Requiere agregar `exports` al `package.json`, un segundo `tsconfig.build.json` y un bundler para browser (esbuild o Rollup) |
| **B. Paquete separado** `kit-pagos-colombia-browser` | Build independiente, sin afectar el SDK actual | Duplica tipos o crea dependencia entre paquetes |
| **C. Solo guías + helpers de inicialización** | Cero complejidad de build | No unifica la experiencia; el comercio sigue conociendo las librerías de cada pasarela |

La Opción A es la más coherente con el objetivo de la tesis. La Opción C no responde la pregunta. La estructura de archivos propuesta para la Opción A:

```
sdk/
├── src/
│   ├── domain/          ← Sin cambios
│   ├── application/     ← Sin cambios
│   └── infrastructure/  ← Sin cambios
└── src-browser/         ← Módulo frontend (kit-pagos-colombia/browser)
    ├── tokenizers/
    │   ├── WompiTokenizer.ts
    │   └── MercadoPagoTokenizer.ts
    ├── KitPagosBrowser.ts   ← Fachada frontend
    ├── types.ts
    └── index.ts
```

> **Decisión de alcance (30 de septiembre de 2026):** No se crea `KushkiTokenizer.ts` como stub. Kushki exige Hosted Fields dentro de iframes y pretender que cabe en la misma interfaz sin implementarlo escondería la asimetría en vez de documentarla. Si un consumidor en JavaScript intenta invocar `KitPagosBrowser.tokenizeCard()` con Kushki o Rapyd, la fachada lanza de inmediato `UNSUPPORTED_OPERATION` sin realizar llamadas de red.

---

## 6. Qué aporta a los objetivos de la tesis

El issue #115 evalúa si este trabajo debería ser un objetivo específico. La respuesta depende de dos factores:

**A favor de implementarlo:**
- La unificación queda completa: un comercio puede usar `kit-pagos-colombia` sin tocar ninguna API de pasarela, ni en servidor ni en navegador.
- Wompi y Mercado Pago son los casos más directos de implementar y los de mayor penetración en el mercado colombiano.

**En contra de implementarlo (o a favor de dejarlo como trabajo futuro):**
- Kushki requiere gestionar iframes — complejidad desproporcionada para el alcance de la tesis.
- Rapyd no tiene tokenización inline — la abstracción nunca puede ser completa para las cuatro pasarelas con la misma interfaz.
- Agregar un bundle de browser al SDK actual requiere cambios de infraestructura de build que no son triviales y pueden introducir regresiones en el paquete de servidor.
- Las pruebas de un SDK de navegador requieren un entorno distinto (jsdom, Playwright, o un browser real) que la suite Jest actual no cubre.

---

## 7. Decisión y Alcance de Implementación

**Implementar Wompi y Mercado Pago. Excluir Kushki y Rapyd con `UNSUPPORTED_OPERATION`.**

> **Resolución formal (30 de septiembre de 2026, issues #126 y #127):** El SDK implementa el punto de entrada exportado `kit-pagos-colombia/browser` empaquetado como ESM independiente (~7 KB) mediante `esbuild`. Se incrementa la versión menor a `0.2.0` en `package.json` para reflejar la adición de la especificación de `exports`.

El alcance concreto de implementación:

1. **`WompiTokenizer.ts` (Issue #126)** — REST directo contra `POST /v1/tokens/cards` con la clave pública Bearer. Sin librerías propietarias. Soporta ambientes `sandbox`, `production` y `simulator` (con endpoint mock en `simulator-api`).

2. **`MercadoPagoTokenizer.ts` (Issue #127)** — REST directo contra `POST /v1/card_tokens?public_key=...` con la clave pública en query param, usando `fetch` nativo sin librerías externas. Se descartó la alternativa de envolver los Core Methods de `@mercadopago/sdk-js` para mantener el bundle ligero y autónomo (~7 KB) y evitar la carga de scripts de terceros en el DOM del comercio. Exige obligatoriamente el documento de identidad del titular (`docType` y `docNumber`), validado antes de la petición con `KitPagosError(INVALID_REQUEST)`. Un mismo formulario frontend (`CardData`) permite tokenizar de forma transparente en Wompi y Mercado Pago cambiando únicamente el valor de `gateway`.

3. **`KitPagosBrowser.ts`** — Fachada unificada que expone `tokenizeCard()` con la misma semántica, devolviendo un `CardTokenResult` con `{ token, gateway, lastFour, brand }`, cuyo `.token` es consumible en el backend con `PaymentMethod.card(result.token)`.

4. **Kushki y Rapyd no se proveen** — A diferencia de lo propuesto originalmente, no se deja stub de `KushkiTokenizer`: `KitPagosBrowser` rechaza activamente `Gateway.KUSHKI` y `Gateway.RAPYD` lanzando `KitPagosError(UNSUPPORTED_OPERATION)` sin abrir conexiones.

5. **Documentar Rapyd** — Queda evidenciado que Rapyd no provee tokenización inline para comercios sin certificación PCI Level 1; su modelo de integración es Hosted Checkout (`REDIRECT_REQUIRED`).

---

## Referencias

| Pasarela | Documentación oficial de tokenización |
|---|---|
| Wompi | [docs.wompi.co — Tokens de tarjeta](https://docs.wompi.co) |
| Mercado Pago | [developers.mercadopago.com — Core Methods](https://www.mercadopago.com.co/developers/es/docs) |
| Kushki | [docs.kushkipagos.com — Hosted Fields](https://docs.kushkipagos.com) |
| Rapyd | [docs.rapyd.net — Hosted Checkout](https://docs.rapyd.net) |

Relacionado: punto 50 del `architecture-log.md` (por qué Rapyd no acepta token de tarjeta), punto 49 (por qué `CASH` se eliminó del tipo), issue #115 (objetivos de la tesis).
