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
| Carga | `npm install @mercadopago/sdk-js` o `<script src="https://sdk.mercadopago.com/js/v2">` |
| Mecanismo de tokenización | Bricks (formulario visual completo) o Core Methods (control total) |
| Entrada Core Methods | `{ cardNumber, cardholderName, cardExpirationMonth, cardExpirationYear, securityCode, identificationType, identificationNumber }` |
| Salida | `token.id` — cadena opaca de un solo uso |
| Documentación | [mercadopago.com.co/developers](https://www.mercadopago.com.co/developers/es/docs) |

Mercado Pago ofrece dos variantes. Los **Bricks** renderizan un formulario completo y entregan el token en el callback `onSubmit`; son la opción recomendada por MercadoPago para integraciones nuevas. Los **Core Methods** dan control total sobre el formulario HTML pero exigen que el desarrollador maneje el ciclo de vida de los campos. Para una abstracción del SDK, Core Methods es la variante envolvible.

**Nivel de evidencia:** Nivel 3 — tomado de la documentación oficial. No se ejecutó contra el sandbox porque requiere un contexto de navegador.

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

La Opción A es la más coherente con el objetivo de la tesis. La Opción C no responde la pregunta.

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

## 7. Recomendación

**Alcance reducido, bien definido, como trabajo futuro.**

Implementar el SDK de navegador completo está fuera del alcance razonable de la tesis. La asimetría de Rapyd hace que la abstracción nunca pueda ofrecer la misma interfaz para las cuatro pasarelas, y esa limitación debería documentarse como resultado de diseño, no ocultarse.

Lo que sí tiene valor como entregable de tesis:

1. **Este documento** — que responde la pregunta del issue con evidencia y justificación. Es un resultado de investigación válido y publicable.

2. **Una implementación de prueba de concepto para Wompi** — que es el caso más simple (REST directo, sin librería propietaria) y que puede implementarse y probarse en 2–3 días. Demostraría que el patrón funciona para las pasarelas que lo permiten.

3. **Documentar el modelo de Rapyd como una limitación de diseño** — que es honesto y más valioso que ignorarlo. Una abstracción que declara sus límites es más útil que una que los esconde.

La pregunta que conviene resolver con el director: si el alcance de la tesis incluye la prueba de concepto de Wompi, o si el documento de investigación es suficiente como entregable.

---

## Referencias

| Pasarela | Documentación oficial de tokenización |
|---|---|
| Wompi | [docs.wompi.co — Tokens de tarjeta](https://docs.wompi.co) |
| Mercado Pago | [developers.mercadopago.com — Core Methods](https://www.mercadopago.com.co/developers/es/docs) |
| Kushki | [docs.kushkipagos.com — Hosted Fields](https://docs.kushkipagos.com) |
| Rapyd | [docs.rapyd.net — Hosted Checkout](https://docs.rapyd.net) |

Relacionado: punto 50 del `architecture-log.md` (por qué Rapyd no acepta token de tarjeta), punto 49 (por qué `CASH` se eliminó del tipo), issue #115 (objetivos de la tesis).
