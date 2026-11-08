# La API de Simulación

Las cuatro pasarelas, falsas, delante de la misma URL que usan las reales. Sirve para probar un cobro de punta a punta —rechazos, pendientes, PSE, timeouts, errores de red— sin credenciales de sandbox, sin internet y sin las ventanas de caída de los sandboxes de verdad.

Vive bajo `/v1/sim/<pasarela>/` y **replica la forma de la ruta nativa**, así que apuntar el SDK al simulador es cambiar una URL y nada más.

> Esta página documenta `/v1/sim`. La otra cara del mismo servidor, `/v1/api`, está en [la referencia de la API REST](api-rest.md).

---

## 1. Cómo se levanta

```bash
cd sdk && npm install && npm run build   # el simulador consume el SDK compilado
cd ../simulator-api && npm install && npm run dev
curl http://localhost:3000/health        # {"status":"ok"}
```

Escucha en `http://localhost:3000`. Desplegado, en [`https://kit-pagos-colombia.onrender.com`](https://kit-pagos-colombia.onrender.com), con la misma forma de ruta.

**Para que el SDK lo use:**

```typescript
import { KitPagos, Gateway } from "kit-pagos-colombia";

// Local: es el ambiente por omisión, no hace falta configurar nada.
const sdk = new KitPagos({ gateway: Gateway.WOMPI, credentials: {} });

// Desplegado en Render: se apunta con baseUrl.
const sdkRemoto = new KitPagos({
  gateway: Gateway.WOMPI,
  credentials: { /* ... */ },
  baseUrl: "https://kit-pagos-colombia.onrender.com/v1/sim",
});
```

---

## 2. Las rutas

**35 endpoints** bajo el mismo servidor: 33 que imitan a las pasarelas, el disparador de webhooks y `/health`.

| Pasarela | Rutas |
|---|---|
| **Wompi** (7) | `POST /transactions`, `GET /transactions/:id`, `GET /merchants/:publicKey`, `GET /pse/financial_institutions`, `POST /tokens/cards`, `GET /pse/redirect`, `GET /terms` |
| **Mercado Pago** (9) | `POST /payments`, `GET /payments/:id`, `POST /orders`, `GET /orders/:id`, `GET /payment_methods`, `POST /card_tokens`, `GET /card_tokens/:id`, `GET /payment_methods/search`, `GET /payments/:paymentId/bank_transfer` |
| **Rapyd** (9) | `POST /payments`, `GET /payments/:paymentId`, `POST /checkout`, `GET /checkout/:checkoutId`, `GET /checkout/:checkoutId/pay`, `GET /checkout/:checkoutId/pagar`, `POST /customers`, `GET /payment_methods/country`, `GET /complete-bank-payment` |
| **Kushki** (8) | `POST /card/v1/tokens`, `POST /card/v1/charges`, `GET /charges/:ticketNumber`, `GET /transfer/v1/bankList`, `POST /transfer/v1/tokens`, `POST /transfer/v1/init`, `GET /transfer/v1/status/:token`, `GET /transfer/v1/agent` |
| **Webhooks** (1) | `POST /v1/sim/webhooks/trigger` |
| **Salud** (1) | `GET /health` |

El número de rutas no es arbitrario: cada pasarela necesita una cantidad distinta de llamadas para el mismo flujo. Rapyd tiene nueve porque su tarjeta va por checkout alojado y su PSE exige crear un cliente primero.

**Tres rutas existen solo porque el simulador las necesita:**

- `GET /checkout/:checkoutId/pay` de Rapyd es el botón que simula al pagador completando el pago. No existe en Rapyd real. Sin ella no habría forma de avanzar un checkout desde una prueba automatizada.
- `GET /charges/:ticketNumber` de Kushki responde `403` en Kushki real para cualquier identificador, igual que una ruta inventada. El simulador la implementa para poder mostrar el ciclo de vida completo de un cobro con tarjeta.
- Las cuatro páginas de banco del PSE apuntan al propio simulador, no al dominio de la pasarela: el identificador de un pago inventado no existe allá.

---

## 3. Cómo se elige el escenario

Esta es la parte que hay que entender bien, porque tiene una trampa.

### 3.1 La cabecera, y su límite

Las rutas de creación leen **`x-simulator-scenario`** y **`x-simulate-scenario`**, que son equivalentes. Sin cabecera, el escenario es `APPROVED`.

```bash
curl -X POST http://localhost:3000/v1/sim/wompi/transactions \
  -H 'Content-Type: application/json' \
  -H 'x-simulate-scenario: DECLINED' \
  -d @payload.json
```

> **La cabecera solo funciona llamando a `/v1/sim` directamente.** El SDK no la envía y no tiene forma de enviarla, así que si integra con el SDK esta cabecera no le sirve. Para elegir el desenlace desde el SDK se usan los datos de prueba, el monto y la credencial —secciones 3.3 a 3.6—, que es lo que el comercio sí controla.

Las dos cabeceras existen porque la primera se eligió tarde y el proyecto normalizó el nombre después. Ninguna está deprecada: reconocer ambas evita que un cliente que use la otra reciba un `APPROVED` silencioso, que es el peor resultado posible en una prueba.

### 3.2 El orden de precedencia

Cuando hay varias señales, gana la primera de esta lista:

1. **La cabecera de escenario**, si viene.
2. **Una marca en la credencial** (sección 3.6). Va antes que los datos de prueba porque la pasarela rechaza la llave antes de interpretar el cobro.
3. **El dato de prueba de la pasarela** (sección 3.3), el mismo que usa su sandbox real. Una tarjeta que declina, declina con cualquier monto.
4. **Un monto reservado** (sección 3.4), que es convención del simulador.
5. **`APPROVED`**, si no hay nada de lo anterior.

### 3.3 Los datos de prueba de cada pasarela

Son los mismos que usa el sandbox real, así que funcionan igual contra el simulador y contra la pasarela de verdad. El detalle completo, con payloads, está en [`docs/testing-data/`](../../testing-data/).

| Pasarela | Dato que decide | Desenlace |
|---|---|---|
| **Wompi, tarjeta** | El número tokenizado: `4111 1111 1111 1111` | Nace `PENDING` y la primera consulta la resuelve `DECLINED` |
| **Wompi, PSE** | El banco: `1`, `2` o `3` | `APPROVED`, `DECLINED` o `ERROR` |
| **Mercado Pago, tarjeta** | El nombre del titular, **por prefijo** y sensible a mayúsculas: `APRO` aprueba, `CONT` queda en proceso, `OTHE`/`CALL`/`FUND`/`SECU`/`EXPI`/`FORM` rechazan | `APRO Ruiz` cuenta como `APRO` |
| **Kushki, PSE** | El `documentNumber`: `123456789`, `999999990` o `100000002` | Aprobada, pendiente o declinada |
| **Kushki, tarjeta** | Las tarjetas de rechazo de [`testing-data/kushki.md`](../../testing-data/kushki.md) §1 | `400` con el código del banco en `details` |
| **Rapyd y el PSE de Mercado Pago** | Ningún dato llega al simulador: decide la página del banco | Montos reservados |

El simulador recuerda, por token, el desenlace que se derivó de la tarjeta, y el cobro con ese token lo aplica. **Guarda el desenlace, nunca el número ni el nombre del titular**: el token existe justamente para que el número no viva en ningún servidor del comercio.

### 3.4 Los montos reservados

Convención del simulador, sin equivalente en ninguna pasarela. Van en pesos enteros y se reconocen al crear un cobro con tarjeta o con PSE, en las cuatro.

| Monto (COP) | Escenario | Qué hace |
|---|---|---|
| `10100` | `DECLINED` | Devuelve el rechazo nativo de la pasarela |
| `10101` | `PENDING` | Se queda pendiente |
| `10102` | `EXPIRED` | Expira |
| `10409` | `DUPLICATE_PAYMENT` | El primer cobro se crea; el segundo con la misma referencia recibe el `409` nativo |
| `10429` | `RATE_LIMIT` | `429` |
| `10500`, `10502`, `10503` | `SERVER_ERROR`, `BAD_GATEWAY`, `SERVICE_UNAVAILABLE` | El error nativo correspondiente |
| `10504` | `TIMEOUT` | `504` inmediato |
| `10001` | `NETWORK_ERROR` | Cierra el socket |
| `10002` | `FLAPPING` | Dos `503` y, al tercer intento con la misma referencia, crea el cobro |
| `10003` | `SLOW` | Espera `SIMULATOR_SLOW_RESPONSE_MS` (35 s por omisión) y responde `504` |
| `10004` | `MALFORMED_JSON` | `200` con un cuerpo que no es JSON |
| `10005` | `MALFORMED_BODY` | `200` con la forma nativa incompleta |
| `10006` | `HTML_ERROR` | `502` con `text/html`, como la página de un proxy |

**Montos de consulta**, que hacen que la creación salga bien y que falle el `GET` de estado:

| Monto (COP) | Qué hace |
|---|---|
| `10602` | `503` en las dos primeras consultas y la transacción en la tercera |
| `10600` | `500` en cada consulta: el SDK termina en `MAX_RETRIES_EXCEEDED` |
| `10604` | `SLOW` en cada consulta: ídem |

Un monto con centavos distintos de cero no es un monto reservado.

### 3.5 Las fallas técnicas no crean estado

Un `TIMEOUT`, un `NETWORK_ERROR` o un `SERVER_ERROR` se resuelven **antes** de construir nada y devuelven el error nativo sin tocar ningún almacén. Un error de transporte no es un cobro en estado de error: quien reintenta después de un `504` tiene que poder hacerlo sin chocar con un registro fantasma.

### 3.6 Las marcas en la credencial

Una credencial que contenga `invalid`, `inexistente` o `not_found`, sin distinguir mayúsculas, recibe la respuesta de credencial inválida que se midió en su pasarela. Enviar el escenario `INVALID_CREDENTIALS` por cabecera produce lo mismo con una llave cualquiera.

| Pasarela | Lo que devuelve |
|---|---|
| Wompi | `401 INVALID_ACCESS_TOKEN` al crear; `404 NOT_FOUND_ERROR` en `GET /merchants` |
| Mercado Pago | `401 "user not found"` o `401 "invalid access token"`, según la ruta |
| Kushki | `403` de AWS API Gateway en transferencias; `400 K004` en tarjeta |
| Rapyd | `401 UNAUTHENTICATED_API_CALL` |

Que la llave lleve la marca en el texto es convención del simulador: el sandbox real no tiene una llave de prueba que se rechace.

### 3.7 Lo que responde `501`, a propósito

Si el escenario pedido no tiene evidencia de cómo lo responde la pasarela real, la ruta responde **`501 Not Implemented`** sin guardar nada. **Un `501` es mucho mejor que un `APPROVED` falso**: si el motor aprobara una petición que pidió `REJECTED`, una prueba de manejo de rechazos pasaría sin haber probado nada, y el defecto aparecería en producción.

Las combinaciones que responden `501`:

| Ruta | Escenario | Por qué |
|---|---|---|
| Rapyd `POST /checkout` | `PENDING` por cabecera, `EXPIRED`, `DUPLICATE_PAYMENT` | De una página vencida no hay medición |
| Rapyd `POST /payments` con tarjeta | `PENDING` | Ese pago nace cerrado |
| Kushki `POST /transfer/v1/tokens` | `EXPIRED`, `DUPLICATE_PAYMENT` | `expiredTransaction` solo aplica a México, y no hay medición de un duplicado |

### 3.8 El escenario se fija al crear; las consultas no lo aceptan

1. **El escenario de negocio se aplica en la creación.** El cobro nace con el estado que pidió la prueba.
2. **Las consultas no leen un escenario de negocio.** Responden el estado que ya tiene el registro. Lo único que una consulta aplica es la falla técnica que la creación registró con un monto de consulta, y la respuesta de credencial inválida.

Si una consulta aceptara el escenario, el mismo cobro sería aprobado y declinado según quién preguntara, y no habría forma de conciliar.

---

## 4. Elegir el escenario desde el SDK

Lo que sigue es la vía que sí funciona cuando se integra con el SDK: **no se manda cabecera, se eligen los datos**.

| Quiere probar | Haga esto |
|---|---|
| Un pago aprobado | Monto normal (por ejemplo `75000`) |
| Un rechazo de negocio | Tarjeta de rechazo de la pasarela, o titular `OTHE` en Mercado Pago |
| Un rechazo por monto | `10100` |
| Un pendiente | `10101` |
| Un timeout | `10003` — el SDK lo entrega como `GATEWAY_TIMEOUT` |
| Un error de red | `10001` — llega como `CONNECTION_FAILED` |
| Un error del servidor | `10500` — llega como `GATEWAY_SERVER_ERROR` |
| Una credencial inválida | Credencial que contenga `invalid` |
| Un reintento que termina bien | `10602` al consultar |

Para el primer caso hay un ejemplo ejecutable que recorre todo: `examples/simulate-scenarios.ts`, descrito en la sección 6b de [`examples/README.md`](../../05-ejemplos/README.md).

---

## 5. Los webhooks salientes

El simulador puede emitir la notificación que la pasarela mandaría al comercio, firmada con los secretos del servidor.

### 5.1 Disparo manual

```bash
curl -X POST http://localhost:3000/v1/sim/webhooks/trigger \
  -H 'Content-Type: application/json' \
  -d '{ "gateway": "wompi", "transactionId": "1234-5678" }'
```

El cuerpo lleva **solo** `gateway` y `transactionId`. Cualquier otra clave —`url`, `targetUrl`— responde `400`: el destino no lo elige quien llama, porque eso convertiría al simulador en un proxy hacia cualquier host.

Antes de firmar, la transacción avanza como en una consulta. La tarjeta `4111` de Wompi se notifica `DECLINED` sin que nadie haga un `GET`.

| HTTP | Cuándo |
|---|---|
| `200` | Se entregó: `{ delivered: true, receiverStatus, webhook }` |
| `409` | No hay destino configurado, falta el secreto de la pasarela, o la pasarela no documenta ese evento. Trae el webhook firmado para reenviarlo a mano |
| `502` | El destino no respondió a tiempo o rechazó la conexión |
| `404` | El simulador no tiene esa transacción |
| `400` | Cuerpo inválido o pasarela inexistente |

**El destino** sale solo de `SIMULATOR_WEBHOOK_TARGET_URL`, que admite el marcador `{gateway}` para separar pasarelas en el mismo receptor. Sin esa variable no sale ningún webhook.

**El token.** Con `API_AUTH_TOKEN` configurado, el trigger exige `Authorization: Bearer <token>`, a diferencia del resto de `/v1/sim`. La razón: su respuesta trae el webhook firmado, y abierto sería un oráculo de firma.

### 5.2 Emisión automática

Con `SIMULATOR_WEBHOOK_AUTO=true` **y** un destino configurado, el simulador emite un webhook en cada cambio de estado, como haría la pasarela.

El simulador **no tiene reloj**: las transiciones las dispara una consulta o la visita a la página de pago, así que el webhook automático sale en ese momento y no por el paso del tiempo. Está apagada por omisión.

---

## 6. Variables de entorno

| Variable | Por omisión | Qué hace |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `SIMULATOR_PUBLIC_ORIGIN` | — | Origen público de las URL que entrega el simulador: páginas de banco, checkout de Rapyd y términos de Wompi. Necesario detrás de un proxy que termina TLS, como Render |
| `SIMULATOR_SDK_BASE_URL` | el propio proceso | URL a la que llama el SDK interno en el ambiente `simulator` |
| `SIMULATOR_SLOW_RESPONSE_MS` | `35000` | Cuánto espera `SLOW` antes del `504` |
| `SIMULATOR_TRUST_FORWARDED_FOR` | apagada | Con `true`, la IP del pagador sale de `X-Forwarded-For`. Solo detrás de un proxy que escriba esa cabecera |
| `SIMULATOR_WEBHOOK_TARGET_URL` | — | Destino de los webhooks; admite `{gateway}` |
| `SIMULATOR_WEBHOOK_AUTO` | apagada | Emite un webhook en cada cambio de estado |
| `SIMULATOR_WEBHOOK_TIMEOUT_MS` | `5000` | Cuánto espera el envío de un webhook |
| `API_AUTH_TOKEN` | — | Protege `/v1/api` y el trigger de webhooks. Sin él, los dos quedan abiertos |

Gana el entorno sobre el `.env`, y el simulador no lee solo el de la raíz: también el del directorio desde el que arranca, el de su padre y `/etc/secrets/.env`.

---

## 7. Los límites de fidelidad

Un simulador que no declare en qué se aparta de la realidad es una trampa. Estos son los apartamientos que importan al integrar:

- **Las firmas de las peticiones se verifican como una sola cuenta de comercio.** Wompi exige su firma de integridad y Rapyd la suya; un cliente que firme con otro secreto recibe el rechazo de firma, como lo recibiría con otra cuenta. Sin perfil, usa los secretos por omisión `test_integrity_kit_pagos_simulator` y `rapyd_secret_kit_pagos_simulator`.
- **Los montos reservados y las marcas en la credencial son convención del simulador**, no datos de prueba de ninguna pasarela.
- **Wompi documenta que cualquier tarjeta distinta de la `4111` termina `ERROR`, y el simulador la aprueba.** Esa nota de Wompi es documentación oficial sin medir.
- **Kushki documenta que cualquier otro documento termina `Failed`, y el simulador no lo imita**, para no cambiar los cobros que ya usan otros documentos.
- **Un titular de Mercado Pago fuera de la tabla deja decidir al monto o a la cabecera.** La API real lo rechazó con `rejected_by_issuer`; imitarlo dejaría los montos reservados sin servir con tarjeta.
- **El PSE aprobado de Wompi necesita dos consultas**, aunque el sandbox publica la URL y el desenlace juntos.
- **Las páginas de banco del PSE y el checkout de Rapyd son del simulador.** Avisan que la redirección es simulada y ofrecen «Volver al comercio». No mueven el pago: el desenlace lo fija el dato de prueba o el escenario al crearlo, y se lee consultando el pago.
- **Los webhooks omiten lo que el simulador no conoce**, como `user_id` y `application_id` de Mercado Pago o `merchant_id` de Kushki.

**La lección detrás de todo esto:** el simulador solo es tan fiel como lo que se midió. En un momento afirmaba que las cuatro pasarelas cobraban con tarjeta servidor a servidor, y al medir resultó que ninguna lo hacía como decía. Por eso el proyecto tiene además **pruebas de contrato contra los sandboxes reales**, que son las que detectan cuándo el simulador se volvió optimista.

El detalle completo de cada apartamiento, con la fecha y la fuente de cada medición, está en [`02-arquitectura/3-api-de-simulacion.md`](../../02-arquitectura/3-api-de-simulacion.md) y en [`docs/testing-data/`](../../testing-data/).

---

## 8. Lo que el simulador no hace

- **No valida contra la pasarela real.** Verifica las firmas como lo haría una cuenta, pero no llama a ningún proveedor: nada de lo que aquí se aprueba o se rechaza existe en el mundo.
- **No tiene reloj.** Nada cambia de estado por el paso del tiempo. Las transiciones las dispara una consulta, la visita a la página de pago o el trigger de webhooks.
- **No reemplaza las pruebas de contrato.** Esas son las que detectan cuándo el simulador se apartó de la pasarela, y corren contra los sandboxes reales.
- **No emite webhooks sin destino configurado**, ni automáticamente sin `SIMULATOR_WEBHOOK_AUTO=true`.
- **No elegía el escenario por cabecera desde el SDK**, ni lo hace: el SDK no envía esa cabecera.
