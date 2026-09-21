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
MERCADOPAGO_PUBLIC_KEY=TEST-xxxxxxxx
MERCADOPAGO_ACCESS_TOKEN=TEST-xxxxxxxx
MERCADOPAGO_WEBHOOK_SECRET=xxxxxxxx
```

El *access token* va como `privateKey` en el SDK. La clave secreta de webhooks se genera en la configuración de notificaciones del panel, y es un valor distinto del token.

**Advertencia de alcance:** el PSE de Mercado Pago necesita la Orders API, que **responde `401` con credenciales de prueba**. Para probar PSE de Mercado Pago hacen falta credenciales de producción, o el simulador del proyecto.

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
- **`baseUrl`** admite una cadena o un mapa por pasarela. Si se omite, el SDK apunta al simulador en `http://localhost:3000/v1/sim/{pasarela}`.

---

## 3. La tokenización, que va en el frontend

**El número de la tarjeta nunca debe llegar al servidor del comercio.** No es una recomendación del SDK: es lo que define si el servidor entra en el alcance de PCI DSS. El SDK recibe **tokens**, y por eso `PaymentMethod.card()` no acepta un número de tarjeta.

El flujo es siempre el mismo, con la librería de cada pasarela:

1. El pagador escribe la tarjeta en un formulario del navegador, manejado por la librería de la pasarela (el widget de Wompi, el *card form* de Mercado Pago, Kushki.js, Rapyd Collect).
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
```

**Los códigos son opacos y solo valen en la pasarela que los dio.** El mismo Bancolombia es `1` en el sandbox de Wompi, `1007` en Mercado Pago y `co_pse_bancolombia_bank` en Rapyd. Cambiar de pasarela obliga a volver a pedir la lista; el SDK garantiza que no haya que saber cómo la publica cada una.

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

### Tres reglas más del manejador

**Responder rápido.** Las pasarelas reintentan si no reciben un `200` pronto. El trabajo pesado va a una cola, no dentro del manejador.

**Tolerar duplicados.** El mismo webhook puede llegar varias veces. El manejador tiene que ser idempotente: si la orden ya está aprobada, aprobarla otra vez no debe hacer nada.

**Manejar el webhook que no trae el estado.** El de Mercado Pago solo trae un identificador. El SDK devuelve `PENDING`, y el comercio completa con `getPaymentStatus()`:

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

Rapyd incluye **la URL del webhook configurada en su panel** dentro del texto que firma, y esa URL no se puede derivar de la petición entrante. Hay que pasarla como un header sintético:

```ts
const evento = sdk.validateWebhook(cuerpoCrudo, {
  ...headers,
  "x-webhook-url": "https://mitienda.com/webhooks/rapyd", // exactamente como está en el panel
});
```

Tiene que coincidir carácter por carácter con lo configurado en Rapyd. Una barra final de más y la firma no coincide.

---

## 9. Pasar a producción

**Configurar `baseUrl`.** Si se omite, el SDK apunta al simulador local y no cobra nada real. La tabla de URLs productivas está en el [README, sección de despliegue](../../sdk/README.md#1-urls-base-producción-vs-simulador-integrado):

| Pasarela | Producción |
|---|---|
| Wompi | `https://production.wompi.co/v1` |
| Mercado Pago | `https://api.mercadopago.com/v1` |
| Kushki | `https://api.kushkipagos.com` |
| Rapyd | `https://api.rapyd.net/v1` |

**Cambiar las llaves de prueba por las productivas**, incluidos los secretos de webhook, que son distintos por entorno.

**Registrar las URLs de webhook en cada panel** y verificar que lleguen. Un webhook que no llega es un pago de PSE que queda pendiente para siempre.

**Revisar el reloj del servidor.**

**Y probar con montos chicos y reales antes de abrir.** Un sandbox no es producción: la diferencia entre los dos es, literalmente, uno de los motivos por los que existe este proyecto.

---

## 10. El catálogo de errores

Los doce códigos, con cuáles se reintentan solos, están en [1-recorrido-de-una-llamada.md](1-recorrido-de-una-llamada.md) §4, y con su descripción en el [README](../../sdk/README.md#catálogo-de-códigos-de-error-kitpagoserrorcode).

Lo que conviene recordar al escribir el manejo de errores: cada `KitPagosError` trae `code` para programar, `gateway` para saber quién falló, y `originalPayload` para depurar. Programar contra `code` y no contra `message`: los mensajes pueden cambiar, el catálogo de códigos es estable.

---

## 11. Verificar la integración

Antes de considerar que la integración está lista:

1. Cobrar con tarjeta y confirmar el estado.
2. Cobrar con una tarjeta que **rechaza**, y confirmar que el código lo trata como rechazo y no como error.
3. Cobrar con PSE, redirigir, y confirmar el estado **por consulta** (no confiar en la URL de retorno).
4. Recibir un webhook real y verificar que la firma valide.
5. Reenviar el mismo webhook y confirmar que no se duplique el efecto.
6. Cambiar `gateway` por otra pasarela y repetir los pasos 1 y 3, con sus propios datos de prueba.

El paso 6 es el que verifica lo que este proyecto afirma. Los diez ejemplos de [examples/](../../examples/) hacen exactamente esto contra el simulador, y el de intercambiabilidad hace el paso 6 con las cuatro.

---

## Qué sigue

- Qué mejora de verdad frente a integrar a mano: [5-comparacion-con-integracion-directa.md](5-comparacion-con-integracion-directa.md).
- Los ejemplos ejecutables: [05-ejemplos](../05-ejemplos/).
- Los datos de prueba: [testing-data](../testing-data/).
