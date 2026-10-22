# Guía de implementación, desde cero

Esta guía va del primer `npm install` a un cobro en producción, incluyendo las partes que suelen quedar fuera de la documentación: de dónde sale cada credencial, cómo conservar el cuerpo crudo del webhook en Express y en Fastify, y qué hacer con los webhooks de la pasarela vieja durante una migración.

> El [README del paquete](../../sdk/README.md) tiene los mismos ejemplos de código en formato de referencia rápida, y tiene una ventaja sobre este documento: **sus fragmentos se compilan automáticamente** con `npm run check:readme`. Si alguno de los dos se desactualiza, el que hay que creer es el README.

---

## 1. Instalación

```bash
npm install kit-pagos-colombia
```

Requiere Node 18 o superior. Arrastra una sola dependencia de producción (`big.js`, para la aritmética decimal exacta) y trae sus propios tipos: no hace falta instalar nada de `@types`.

---

## 2. El `.env` completo

Estas son todas las variables, por pasarela, con **de dónde sale cada una**. Es la parte de la integración que más tiempo consume la primera vez, porque cada panel las guarda en un lugar distinto y les pone nombres distintos.

### Wompi — cuatro valores, y son cuatro cosas diferentes

```bash
WOMPI_PUBLIC_KEY=pub_test_xxxxxxxx
WOMPI_PRIVATE_KEY=prv_test_xxxxxxxx
WOMPI_INTEGRITY_SECRET=test_integrity_xxxxxxxx
WOMPI_EVENTS_SECRET=test_events_xxxxxxxx
```

| Variable | De dónde sale | Para qué |
|---|---|---|
| `WOMPI_PUBLIC_KEY` | Panel de Wompi, sección de llaves | **Todas** las llamadas del SDK a Wompi usan esta llave como `Bearer`: token de aceptación, crear y consultar (`WompiAdapter.ts`, líneas 210 y 229) |
| `WOMPI_PRIVATE_KEY` | Misma sección | Campo exigido por el tipo `Credentials`; el `WompiAdapter` **no lo envía** en ninguna llamada (ver `WompiAdapter.test.ts`, línea 169) y solo queda como respaldo al verificar webhooks si falta `WOMPI_EVENTS_SECRET` |
| `WOMPI_INTEGRITY_SECRET` | Misma sección, valor aparte | Firmar lo que el comercio manda. **Sin esto Wompi responde `422` y no crea nada** |
| `WOMPI_EVENTS_SECRET` | Configuración de eventos o webhooks | Verificar lo que llega |

Los cuatro son valores distintos. Confundir el de integridad con el de eventos produce errores que parecen de otra cosa: el primero falla al crear, el segundo al verificar.

### Mercado Pago

```bash
MERCADOPAGO_PUBLIC_KEY=APP_USR-xxxxxxxx
MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxxxxxxx
MERCADOPAGO_WEBHOOK_SECRET=xxxxxxxx
```

El *access token* va como `privateKey` en el SDK y la llave pública como `publicKey`. Desde la versión 0.6.0 la llave pública no es decorativa en el servidor: el SDK la usa para deducir la marca de la tarjeta antes de cobrar (`GET /v1/payment_methods/search` no responde sin ella), y sin ella el cobro con tarjeta falla con `INVALID_REQUEST`. La clave secreta de webhooks se genera en la configuración de notificaciones del panel, y es un valor distinto del token.

**Advertencia de alcance:** desde la versión 0.6.0 tarjeta y PSE van por la Orders API, que **responde `401` con credenciales `TEST-`** (punto 45). Para probar en sandbox hacen falta las credenciales `APP_USR-` de un vendedor de prueba de una aplicación «Checkout API via Orders», con las que se cobró tarjeta el 15 de octubre de 2026, o el simulador del proyecto. Con esas credenciales la Payments API, por donde cobraba la 0.5.0, responde `401 "Unauthorized use of live credentials"`.

### Kushki

```bash
KUSHKI_PUBLIC_MERCHANT_ID=xxxxxxxx
KUSHKI_PRIVATE_MERCHANT_ID=xxxxxxxx
KUSHKI_WEBHOOK_SECRET=xxxxxxxx
```

Kushki los llama *merchant id* en lugar de *key*, pero cumplen el papel de llave pública y privada. El secreto de webhooks se configura en la sección de notificaciones.

### Rapyd

```bash
RAPYD_API_ACCESS_KEY=xxxxxxxx
RAPYD_API_SECRET_KEY=xxxxxxxx
```

Dos valores y nada más: Rapyd es **la única** que firma sus webhooks con la misma llave de la API, así que no hace falta un `webhookSecret` aparte.

### Y cómo se arma el SDK con todo eso

El mapa completo de credenciales y opciones está en el [README del paquete](../../sdk/README.md#1-inicializar-el-sdk), sección 1. Lo esencial:

- **`credentials` acepta todas las pasarelas**, no solo la activa. Guardarlas todas es lo que permite validar webhooks de otra pasarela durante una migración.
- **`gateway` define la activa**, y es el único valor que hay que cambiar para conmutar.
- **`maxRetries`** ajusta la política de reintentos de las operaciones idempotentes.
- **`webhookToleranceSeconds`** ajusta la ventana anti-replay, 300 s por defecto.
- **`baseUrl`** admite una cadena o un mapa por pasarela. Si se omite, el SDK usa la URL del ambiente configurado en `environment`; sin `environment`, apunta al simulador local en `http://localhost:3000/v1/sim/{pasarela}`. Para usar el simulador desplegado, pase `baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim/{pasarela}"`.

---

## 3. La tokenización, que va en el frontend

**El número de la tarjeta nunca debe llegar al servidor del comercio.** No es una recomendación del SDK: es lo que define si el servidor entra en el alcance de PCI DSS. El SDK recibe **tokens**, y por eso `PaymentMethod.card()` no acepta un número de tarjeta.

El flujo es siempre el mismo, con la librería de cada pasarela:

1. El pagador escribe la tarjeta en un formulario del navegador: uno del comercio, si tokeniza con `KitPagosBrowser`, o el de la librería de la pasarela (el widget de Wompi, el *card form* de Mercado Pago, Kushki.js, Rapyd Collect). Con un formulario del comercio, la página tiene que protegerse (§9).
2. Esa librería usa la **llave pública** y devuelve un token.
3. El frontend le manda el token al servidor.
4. El servidor cobra con `PaymentMethod.card(token, { installments })`.

**Los tokens no son portables entre pasarelas.** Un token de Wompi no sirve en Mercado Pago, y eso el SDK no lo puede resolver. Si el comercio soporta varias pasarelas simultáneamente, el frontend tiene que tokenizar con la librería de la que vaya a cobrar.

Las tarjetas de prueba de cada pasarela, con qué desenlace produce cada una, están en [testing-data](../testing-data/).

---

## 4. Cobrar con tarjeta

El ejemplo completo está en el [README, sección 2](../../sdk/README.md#2-crear-una-transacción-con-tarjeta). Los tres puntos que importan:

**El monto va como cadena.** `new Amount("75000")`, no `new Amount(75000)`. El constructor rechaza `number` explícitamente, y la razón está en [2-clase-por-clase.md](2-clase-por-clase.md).

**Hay que manejar las dos ramas del resultado, siempre.** Incluso con tarjeta:

```ts
const resultado = await sdk.createPayment({ /* ... */ });

if (resultado.outcome === "REDIRECT_REQUIRED") {
  // Rapyd cobra en su página alojada, y cualquiera de las cuatro puede pedir 3DS.
  return redirigirA(resultado.redirect.redirectUrl);
}

const transaccion = resultado.transaction;
```

El compilador lo obliga: `transaction` no existe en la rama de redirección. Si el código compila, las dos ramas están manejadas.

**Un rechazo no lanza excepción.** Llega como una transacción con estado `DECLINED` y una razón de rechazo con su código nativo y su categoría normalizada. El bloque `try/catch` es para fallos técnicos.

---

## 5. Cobrar con PSE

PSE tiene un paso previo que la tarjeta no tiene: **el pagador elige su banco antes de que el pago exista.**

```ts
const bancos = await sdk.getPseBanks();
// Se muestran al pagador y se usa el código que elija, tal cual vino.

// O, si el banco ya se conoce, sin pedir la lista:
PaymentMethod.pse({ bankCode: PseBankCode.BANCOLOMBIA });
```

**`PseBankCode` sirve igual en las cuatro pasarelas.** Es el código de compensación de cuatro dígitos que publica el Banco de la República y que usa ACH Colombia (`1007` es Bancolombia). Mercado Pago, Wompi y Kushki lo reciben tal cual, y el SDK lo traduce para Rapyd, que nombra cada banco con un método propio (`co_pse_bancolombia_bank`). Cada banco de `getPseBanks()` trae además su `achCode` cuando lo tiene.

**El `code` de la lista, en cambio, solo vale en la pasarela que lo dio.** Los bancos de prueba de los sandboxes solo existen así: `1`, `2` y `3` en Wompi, y `0001` en Kushki. Tenga en cuenta que Wompi no valida el código al crear el pago, así que en su sandbox un código de `PseBankCode` no falla al crear, sino después. El razonamiento está en el punto 68 del `architecture-log.md`. Contra el sandbox de Rapyd la lista trae solo los 9 bancos que esa cuenta cobra; con los otros 41, el pago falla con `400 ERROR_GET_GATEWAY` (punto 102).

El ejemplo completo está en el [README, sección 3](../../sdk/README.md#3-crear-una-transacción-con-pse-redirección-bancaria). Lo que hay que tener presente:

**PSE exige el documento del pagador en las cuatro pasarelas**, y Mercado Pago exige además nombre, apellido, indicativo y número de teléfono separados, dirección y dirección IP. El SDK valida antes de salir a la red y lanza `INVALID_REQUEST` **listando qué falta**, en lugar de traducir un HTTP 400 ambiguo.

**`returnUrlConfig` es obligatorio en Mercado Pago, Kushki y Rapyd**, y opcional en Wompi. Admite una sola URL o una por desenlace; internamente cada adaptador resuelve la que su pasarela acepta.

**Guardar el identificador de la redirección es indispensable.** Si el pagador no vuelve —cierra la pestaña, se le corta internet, el banco tarda—, ese identificador es la única forma de consultar qué pasó:

```ts
if (resultado.outcome === "REDIRECT_REQUIRED") {
  await guardarEnLaOrden(resultado.redirect.gatewayTransactionId.value);
  return redirigirA(resultado.redirect.redirectUrl);
}
```

**Un PSE también puede volver como `TRANSACTION`.** Pasa cuando el desenlace ya existe al crear (un `402` de Mercado Pago llega `DECLINED`) y cuando la orden de Mercado Pago nace `processing` sin URL del banco: medido el 15 de octubre de 2026, esas órdenes terminaron rechazadas con `processing_error` unos 4 segundos después. Desde la 0.6.0-rc.2 llegan como `PENDING` con el identificador de la orden; se guarda igual y se consulta, sin redirigir a nadie.

**Y la advertencia más importante de PSE:** que el pagador vuelva a la URL de retorno **no significa que pagó.** La URL de retorno es una señal de interfaz. El resultado se obtiene por webhook o consultando.

---

## 6. Consultar el estado

```ts
const transaccion = await sdk.getPaymentStatus(idDeLaPasarela);

if (transaccion.isFinal()) {
  // Ya no va a cambiar: se puede cerrar la orden.
}
```

`isFinal()` es el método más útil para conciliar: devuelve verdadero para cualquier estado que no sea `PENDING`, y es lo que un trabajo periódico necesita para saber si tiene que volver a preguntar.

Esta operación **sí** se reintenta automáticamente ante fallos transitorios: hasta tres veces, con retroceso exponencial y fluctuación. Crear un pago no, por el riesgo de doble cobro.

**Antes de volver a cobrar, se consulta.** Si `createPayment()` falló sin una respuesta clara —un timeout, una conexión cortada—, el cobro puede haberse creado igual. Las pasarelas no lo evitan por usted: en Mercado Pago, dos cobros con la misma `orderReference` crearon dos órdenes y se cobraron los dos (medido el 15 de octubre de 2026). Antes de reintentar, confirme el desenlace del intento anterior con `getPaymentStatus()`, si tiene su identificador, o con el webhook.

---

## 7. El endpoint de webhook

Es la parte donde más cosas se rompen, y casi todas por la misma razón: **perder el cuerpo crudo.**

La firma se calculó sobre los bytes exactos que la pasarela envió. Si el framework parsea el JSON y el código lo vuelve a serializar, cualquier diferencia de orden de claves o de espacios invalida una firma legítima. Por eso `validateWebhook()` recibe un `string`.

### En Express

```ts
import express from "express";

const app = express();

// Este orden importa: el verificador de cuerpo crudo va ANTES del parser de JSON,
// y solo para la ruta del webhook.
app.post(
  "/webhooks/:pasarela",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const cuerpoCrudo = req.body.toString("utf8");
    const headers = req.headers as Record<string, string>;

    try {
      const evento = sdk.validateWebhook(cuerpoCrudo, headers);
      // Actualizar la orden con evento.newStatus, y responder rápido.
      res.status(200).send("OK");
    } catch (error) {
      res.status(400).send("verificación fallida");
    }
  },
);

app.use(express.json()); // El resto de la aplicación sí parsea JSON.
```

Si la aplicación ya tiene `express.json()` global, hay que excluir la ruta del webhook o guardar el crudo con la opción `verify` del parser. Registrar `express.json()` antes del webhook es el error más común, y produce un `WEBHOOK_SIGNATURE_INVALID` que parece un ataque.

### En Fastify

```ts
import Fastify from "fastify";

const app = Fastify();

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_req, body, done) => done(null, body), // Se entrega el texto sin parsear.
);

app.post("/webhooks/:pasarela", async (request, reply) => {
  const cuerpoCrudo = request.body as string;
  const headers = request.headers as Record<string, string>;

  const evento = sdk.validateWebhook(cuerpoCrudo, headers);
  return reply.status(200).send("OK");
});
```

### Cuatro reglas más del manejador

**Responder rápido.** Las pasarelas reintentan si no reciben un `200` pronto. El trabajo pesado va a una cola, no dentro del manejador.

**Tolerar duplicados y desorden.** El mismo webhook puede llegar varias veces. El manejador tiene que ser idempotente: si la orden ya está aprobada, aprobarla otra vez no debe hacer nada. Tampoco el orden está garantizado. Con 3DS, Rapyd manda en el mismo segundo un `PAYMENT_UPDATED` todavía pendiente y el `PAYMENT_COMPLETED` (medido el 21 de octubre de 2026), así que un `PENDING` que llega cuando la orden ya está aprobada o rechazada se guarda en el historial, pero no cambia el estado.

**Manejar el webhook que no trae el estado.** El de Mercado Pago solo trae un identificador firmado. El SDK devuelve siempre `PENDING`, aunque el cuerpo traiga un estado, y el comercio completa con `getPaymentStatus()`:

```ts
const evento = sdk.validateWebhook(cuerpoCrudo, headers);

if (evento.newStatus === "PENDING") {
  // Mercado Pago notifica sin estado: la firma es válida, el dato falta.
  const transaccion = await sdk.getPaymentStatus(evento.gatewayTransactionId);
  await actualizarOrden(transaccion);
} else {
  await actualizarOrdenDesdeEvento(evento);
}
```

**Buscar la orden también por su referencia.** Con tarjeta, Rapyd cobra en su página: `createPayment()` devuelve el id del checkout y el webhook trae el del pago, que no apunta al checkout (medido el 21 de octubre de 2026). Lo único que los une es la referencia de la orden que el comercio mandó al cobrar, y desde la 0.7.0-rc.1 el evento la trae en `orderReference` cuando la firma la cubre. Para guardar el estado sin traducir está `rawStatus`, que Mercado Pago no trae:

```ts
const orden =
  (await buscarOrdenPorTransaccion(evento.gatewayTransactionId)) ??
  (evento.orderReference ? await buscarOrden(evento.orderReference) : undefined);
await guardarEstado(orden, evento.newStatus, evento.rawStatus ?? evento.newStatus);
```

### Si el reloj está desfasado

La protección anti-replay rechaza notificaciones fuera de la ventana de 300 segundos. Un servidor con el reloj corrido va a rechazar webhooks legítimos con `WEBHOOK_SIGNATURE_INVALID`. Se puede ampliar la ventana con `toleranceSeconds`, pero **lo correcto es sincronizar el reloj**: ampliar la ventana debilita justo la protección que la hace útil.

---

## 8. El caso de migración: webhooks de la pasarela vieja

Cuando un comercio cambia de pasarela, durante semanas va a seguir recibiendo webhooks de la anterior: pagos que ya estaban en curso, conciliaciones, reembolsos. Con un tercer parámetro alcanza, y **no hace falta un segundo `KitPagos`**:

```ts
const PASARELAS = {
  wompi: Gateway.WOMPI,
  kushki: Gateway.KUSHKI,
} as const;

app.post("/webhooks/:pasarela", (req, res) => {
  const evento = sdk.validateWebhook(cuerpoCrudo, headers, {
    gateway: PASARELAS[req.params.pasarela as keyof typeof PASARELAS],
  });
  res.status(200).send("OK");
});
```

El único requisito es que esa pasarela esté en `credentials`; no hace falta que sea la activa. Una URL de webhook por pasarela es además una buena práctica independiente de esto: hace obvio de dónde viene cada notificación.

### El caso particular de Rapyd

Rapyd incluye **la URL del webhook configurada en su panel** dentro del texto que firma, y no la envía en la notificación. Se configura junto a las credenciales:

```ts
const sdk = new KitPagos({
  gateway: Gateway.RAPYD,
  credentials: {
    [Gateway.RAPYD]: {
      publicKey: process.env.RAPYD_API_ACCESS_KEY!,
      privateKey: process.env.RAPYD_API_SECRET_KEY!,
      webhookUrl: "https://mitienda.com/webhooks/rapyd", // exactamente como está en el panel
    },
  },
});
```

Tiene que coincidir carácter por carácter con lo configurado en Rapyd. Una barra final de más y la firma no coincide. Sin `webhookUrl`, `validateWebhook()` lanza `INVALID_CREDENTIALS` en vez de rechazar el webhook, para que el error apunte a la configuración.

Hasta la versión 0.1.0 el SDK pedía esa URL en una cabecera sintética `x-webhook-url`. Ya no la lee: si la URL viniera en la petición, quien la envía decidiría a qué destino queda atada la firma (punto 67 del `architecture-log.md`).

### El caso particular de Mercado Pago

Mercado Pago firma el `data.id` que viaja en **la URL** de la notificación (`?data.id=...&type=...`), no el del cuerpo. Hay que pasarle al SDK los parámetros de la URL:

```ts
const evento = sdk.validateWebhook(cuerpoCrudo, headers, {
  gateway: Gateway.MERCADOPAGO,
  query: req.query,
});
```

Sin `query` el SDK usa el `data.id` del cuerpo, que coincide en los pagos pero no en los ids alfanuméricos de la Orders API. Si la URL y el cuerpo traen ids distintos, el webhook se rechaza.

Tenga en cuenta además que Mercado Pago **no firma el cuerpo**: la firma cubre el id, el `x-request-id` y la marca de tiempo. Por eso el SDK no lee ningún estado del cuerpo, ni siquiera el `data.status` que traen las notificaciones de la Orders API, y reporta `PENDING`. El estado se confirma siempre con `getPaymentStatus()`, como en el ejemplo de la sección anterior (punto 70 del `architecture-log.md`).

---

## 9. Lo que el SDK no puede hacer por el comercio

El SDK nunca recibe el número de la tarjeta, y cobra exactamente lo que se le pide. Lo que queda alrededor le toca al comercio: quién decide el monto, qué scripts corren en la página donde se escribe la tarjeta y dónde viven los secretos. Si algo de eso falla, la integración queda abierta aunque el SDK esté bien usado. Salió de revisar los prototipos (punto 114 del `architecture-log.md`).

> **Los prototipos del proyecto no hacen esto, y no son plantillas para producción.** Ninguno de los tres manda Content-Security-Policy, y en el prototipo C el monto lo decide el navegador. Se dejaron así a propósito (decisión de Joan del 19 de octubre de 2026, punto 114). Si copia una de sus páginas, agréguele lo de esta sección.

### El monto lo decide el servidor

El navegador manda qué productos y cuántos, nunca el precio. El servidor saca los precios de su catálogo, calcula el total y cobra ese total:

```ts
// Lo que llega del navegador: [{ productId, quantity }]. Un precio que venga ahí se ignora.
const total = lineas.reduce((suma, linea) => suma + catalogo[linea.productId].precio * linea.quantity, 0);

const resultado = await sdk.createPayment({ amount: new Amount(String(total)), /* ... */ });
```

Si el monto viene del navegador, el pagador lo cambia con las herramientas del navegador y paga lo que quiera. Ni el SDK, ni la API REST, ni la pasarela conocen los precios de la tienda. La firma de integridad de Wompi solo garantiza que nadie cambió el monto **después** de que el servidor lo firmó. Se midió el 19 de octubre de 2026: `POST /v1/api/payments` contra el simulador de Render, con `amount: "1000.00"`, respondió `201`, y la consulta dio `APPROVED` por 1.000 COP.

Antes de despachar, la transacción aprobada se compara con la orden. `isApproved()` dice que la pasarela cobró, no que cobró lo que vale la orden:

```ts
const pagoCuadra =
  transaccion.isApproved() &&
  transaccion.amount.equals(orden.monto) &&
  transaccion.currency.equals(orden.moneda) &&
  transaccion.orderReference.equals(orden.referencia);
```

`Amount.equals()` compara por valor, así que `"68000"` y `"68000.00"` son el mismo monto.

**La API REST `/v1/api` no cambia esto.** Si el comercio la usa en vez de instalar el SDK, la llama su servidor, con el monto de su catálogo y sus credenciales en las cabeceras `x-gateway-*`. En `production` la API exige esas credenciales: sin ellas responde `401` sin tocar la red. Mandarlas desde el navegador las publicaría. El prototipo C llama a la API desde el navegador porque es una demostración con las cuentas de sandbox del equipo ([su recorrido](../05-ejemplos/checkout-frontend-rest.md#lo-que-este-ejemplo-no-cubre)).

### La página de la tarjeta lleva Content-Security-Policy

Con `KitPagosBrowser` el formulario es del comercio, y el número pasa por el DOM de su página antes de salir hacia la pasarela. Cualquier script que corra en esa página puede leerlo. A esto se le llama *web skimming*, y el script puede llegar de tres formas:

- inyectado por un XSS;
- en una dependencia comprometida;
- en un archivo que cambió en un CDN.

Por eso el comercio queda en SAQ A-EP. PCI DSS 4.0 pide además, en las páginas de pago, controlar los scripts (requisito 6.4.3) y detectar cuando cambian (11.6.1).

La cabecera `Content-Security-Policy` limita de dónde se cargan scripts y, sobre todo, a dónde puede mandar datos la página. Esta es la que se midió con `KitPagosBrowser` 0.6.0 cargado desde jsDelivr:

```http
Content-Security-Policy: default-src 'none'; script-src 'self' https://cdn.jsdelivr.net 'sha256-<hash del import map>'; connect-src 'self' https://sandbox.wompi.co https://api.mercadopago.com https://api-uat.kushkipagos.com; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

`connect-src` lleva solo los hosts de tokenización de las pasarelas que el comercio usa, más el origen de su API si no es el de la página. Cada tokenizador del SDK llama a un solo host, que sale de su catálogo cerrado:

| Pasarela | `sandbox` | `production` |
|---|---|---|
| Wompi | `https://sandbox.wompi.co` | `https://production.wompi.co` |
| Mercado Pago | `https://api.mercadopago.com` | `https://api.mercadopago.com` |
| Kushki | `https://api-uat.kushkipagos.com` | `https://api.kushkipagos.com` |

- **Rapyd no aparece** porque no tokeniza en el navegador. La tarjeta se escribe en su página alojada, y llevar al pagador allá es una navegación, que no pasa por `connect-src`.
- **El ambiente `simulator`** tokeniza en `http://localhost:3000`.
- **Los hosts de producción** salen del catálogo del SDK y no se midieron con la CSP.

**Lo medido** (19 de octubre de 2026, Chrome 148). Una página de prueba tokenizó la tarjeta 4242 con las llaves públicas de sandbox y después intentó mandar un dato a otro dominio, con `fetch` y con una imagen:

| La página | Tokenización con Wompi, Mercado Pago y Kushki | El dato hacia otro dominio |
|---|---|---|
| Sin CSP | Los tres tokens | Sale |
| Con la CSP de arriba | Los tres tokens | Bloqueado por `connect-src` y por `img-src` |
| Con la CSP y el hash de integridad del módulo alterado | El módulo no carga: no hay tokenización | Bloqueado |
| Con una CSP sin el hash del import map, y el hash de integridad alterado | **El módulo carga y tokeniza** (en tres de cuatro corridas) | Bloqueado |

**La trampa del import map.** Si el módulo se carga con integridad desde un import map, como en el prototipo C (punto 99), ese import map es un script en línea. Una CSP sin su hash `'sha256-…'` (o sin un nonce) lo bloquea, y con él se pierde la verificación de integridad sin ningún error en la página. Solo queda el reporte de la violación de `script-src-elem`.

En la medición, con el import map bloqueado y el hash del módulo alterado, el módulo cargó y tokenizó. La corrida en que no cargó fue la que vino justo después de una falla de integridad. El hash del import map cambia con cualquier carácter del import map, así que hay que recalcularlo cada vez que cambie la versión del SDK. Con `report-uri` o `report-to` en la CSP, el navegador le avisa al comercio lo que bloquea.

**Lo que la CSP no cierra.** No detiene un script que corra desde un origen permitido. Tampoco controla la navegación: un script puede llevar la página entera a otro sitio con el dato en la URL. Lo único que cierra del todo es que el número nunca entre a la página: que lo capturen los campos de la pasarela, en iframes que ella aloja (los Hosted Fields de Kushki, los campos de Core Methods de Mercado Pago, el widget de Wompi). Con eso el comercio puede aspirar a SAQ A. `KitPagosBrowser` no los envuelve ([6-tokenizacion-frontend.md](6-tokenizacion-frontend.md) §4).

### Los secretos y los datos se quedan en el servidor

- **Al navegador solo llegan las llaves públicas.** La llave privada, el secreto de integridad y el de eventos de Wompi, y el access token de Mercado Pago van solo en el servidor. Con una llave pública se tokeniza, pero no se cobra.
- **Ningún registro guarda cuerpos.** El de la tokenización lleva la tarjeta, y los del cobro llevan los datos del pagador. El SDK quita las credenciales de sus errores, pero no controla los registros del comercio.
- **Los datos del pagador sí pasan por el servidor**, porque las pasarelas los exigen: nombre, documento, correo y teléfono, y Mercado Pago pide también la dirección para PSE. No son datos de tarjeta, pero son datos personales, y su tratamiento lo rige la Ley 1581 de 2012.

---

## 10. Pasar a producción

**Configurar `environment: "production"`.** Si se omite, el SDK apunta al simulador local y no cobra nada real. Las URL salen del catálogo cerrado del SDK, y `baseUrl` queda solo para apuntar a otra dirección a propósito. La tabla de cada ambiente está en el [README, sección de despliegue](../../sdk/README.md#1-resolución-de-entornos-y-urls-oficiales):

| Pasarela | Producción |
|---|---|
| Wompi | `https://production.wompi.co/v1` |
| Mercado Pago | `https://api.mercadopago.com/v1` |
| Kushki | `https://api.kushkipagos.com` |
| Rapyd | `https://api.rapyd.net/v1` |

**Cambiar las llaves de prueba por las productivas**, incluidos los secretos de webhook, que son distintos por entorno.

**Registrar las URLs de webhook en cada panel** y verificar que lleguen. Un webhook que no llega es un pago de PSE que queda pendiente para siempre.

**Revisar el reloj del servidor.**

**Cambiar la CSP a los hosts de producción** de las pasarelas que se usan (§9).

**Y probar con montos chicos y reales antes de abrir.** Un sandbox no es producción: la diferencia entre los dos es, literalmente, uno de los motivos por los que existe este proyecto.

---

## 11. El catálogo de errores

Los trece códigos, con cuáles se reintentan solos, están en [1-recorrido-de-una-llamada.md](1-recorrido-de-una-llamada.md) §4, y con su descripción en el [README](../../sdk/README.md#catálogo-de-códigos-de-error-kitpagoserrorcode).

Lo que conviene recordar al escribir el manejo de errores: cada `KitPagosError` trae `code` para programar, `gateway` para saber quién falló, y `originalPayload` para depurar. Programar contra `code` y no contra `message`: los mensajes pueden cambiar, el catálogo de códigos es estable.

---

## 12. Verificar la integración

Antes de considerar que la integración está lista:

1. Cobrar con tarjeta y confirmar el estado.
2. Cobrar con una tarjeta que **rechaza**, y confirmar que el código lo trata como rechazo y no como error.
3. Cobrar con PSE, redirigir, y confirmar el estado **por consulta** (no confiar en la URL de retorno).
4. Recibir un webhook real y verificar que la firma valide.
5. Reenviar el mismo webhook y confirmar que no se duplique el efecto.
6. Cambiar `gateway` por otra pasarela y repetir los pasos 1 y 3, con sus propios datos de prueba.
7. Cambiar el precio en el navegador antes de pagar, y confirmar que se cobra el precio del catálogo (§9).
8. Pagar con tarjeta con la CSP puesta, y confirmar que la tokenización funciona y que la consola no reporta violaciones de la página propia (§9).

El paso 6 es el que verifica lo que este proyecto afirma. Los diez ejemplos de [examples/](../../examples/) hacen exactamente esto contra el simulador, y el de intercambiabilidad hace el paso 6 con las cuatro.

---

## Qué sigue

- Qué mejora de verdad frente a integrar a mano: [5-comparacion-con-integracion-directa.md](5-comparacion-con-integracion-directa.md).
- Los ejemplos ejecutables: [05-ejemplos](../05-ejemplos/).
- Los datos de prueba: [testing-data](../testing-data/).
