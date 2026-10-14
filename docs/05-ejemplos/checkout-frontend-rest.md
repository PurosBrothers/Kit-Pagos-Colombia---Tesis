# Recorrido: el checkout de navegador contra la API REST

El patrón de integración 2, frontend hacia REST, vuelto ejecutable. Es el cliente del issue #109 y también el prototipo C de `docs/project-management/thesis-objectives.md` (§5.1): una página que cobra contra `/v1/api` sin instalar `kit-pagos-colombia` y sin saber qué pasarela hay detrás.

**Carpeta:** [prototypes/checkout-frontend-rest/](../../prototypes/checkout-frontend-rest/) · **Comandos:** `npm run build` y `npm start`

## Qué demuestra

Los doce ejemplos de este capítulo sirven al patrón 1: un backend que importa el SDK. Este sirve al patrón 2: un navegador que solo conoce las rutas y las formas JSON de `/v1/api`, y deja que la API arme el SDK con el perfil del servidor.

- **El mismo código para las cuatro pasarelas.** La lista de pasarelas sale de `GET /v1/api/gateways` y la de bancos de `GET /v1/api/pse-banks`. El código que llega al navegador no nombra ninguna pasarela, y una prueba lo comprueba (`test/no-gateway-names.test.ts`): falla si alguien agrega un `if (gateway === "wompi")`.
- **Ninguna credencial en el código.** Contra el ambiente `simulator`, la API usa el perfil del servidor y el cliente no manda cabeceras de credenciales ni `Authorization`. La llave pública que hace falta para tokenizar una tarjeta llega en tiempo de ejecución desde `/config.json`, que arma el servidor estático con sus variables de entorno.
- **CORS de verdad.** La página se sirve desde `localhost:4100` y la API está en `localhost:3000`: el navegador hace el preflight de `POST /v1/api/payments` antes de cada cobro.

## Cómo correrlo

En una terminal, la API de Simulación, sin `.env` y con valores de prueba que no son credenciales de ninguna pasarela:

```bash
cd simulator-api
unset API_AUTH_TOKEN SIMULATOR_API_AUTH_TOKEN
export WOMPI_PUBLIC_KEY=pub_test_kp109_simulador WOMPI_PRIVATE_KEY=prv_test_kp109_simulador
export WOMPI_INTEGRITY_SECRET=test_integrity_kit_pagos_simulator
export MERCADOPAGO_PUBLIC_KEY=TEST-kp109-simulador MERCADOPAGO_ACCESS_TOKEN=APP_USR-kp109-simulador
export KUSHKI_PUBLIC_MERCHANT_ID=kp109_kushki_publico KUSHKI_PRIVATE_MERCHANT_ID=kp109_kushki_privado
export RAPYD_API_ACCESS_KEY=kp109_rapyd_access RAPYD_API_SECRET_KEY=kp109_rapyd_secret
npm run dev
```

Son nueve variables, el mínimo medido: sin ninguna, las cuatro pasarelas responden `401`; sin `WOMPI_INTEGRITY_SECRET`, Wompi responde `401 INVALID_CREDENTIALS` porque el SDK no puede firmar la transacción. Mercado Pago creó la orden de PSE tanto con un `access token` que empieza por `TEST-` como con uno que empieza por `APP_USR-`.

En otra, el cliente:

```bash
cd prototypes/checkout-frontend-rest
npm ci
npm run build
CHECKOUT_PUBLIC_KEY_WOMPI=pub_test_kp109_simulador CHECKOUT_PUBLIC_KEY_MERCADOPAGO=TEST-kp109-simulador npm start
```

Y abrir `http://localhost:4100`. El tokenizador del SDK tiene fijo `http://localhost:3000` como destino del ambiente `simulator`, así que la API tiene que escuchar en ese puerto.

| Variable del cliente | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4100` | El puerto del servidor estático |
| `KIT_PAGOS_API_URL` | `http://localhost:3000/v1/api` | Dónde está la API |
| `TOKENIZATION_ENVIRONMENT` | `simulator` | El ambiente que se le pasa a `KitPagosBrowser.tokenizeCard()` |
| `CHECKOUT_PUBLIC_KEY_<PASARELA>` | Sin valor | La llave pública de cada pasarela que tokeniza en el navegador. Sin ella, el SDK rechaza la tokenización |

## El flujo

1. La página pide las pasarelas y, para la elegida, sus bancos de PSE.
2. `POST /v1/api/payments` con un solo cuerpo para las cuatro: monto, divisa, referencia, el pagador completo (con documento, teléfono y dirección, que Mercado Pago exige para PSE), el método y `returnUrlConfig.returnUrl`. No lleva `ipAddress`: el navegador no conoce su IP pública, y la API toma la de la petición (ver «La IP del pagador»).
3. Si la respuesta es `REDIRECT_REQUIRED`, la página guarda el pago pendiente en `sessionStorage` y muestra el enlace a `redirectUrl`. Al volver a la URL de retorno (`/?retorno=1`), lee el pago pendiente y consulta. El enlace «Volver al comercio» de la página de banco del simulador lleva ahí. El botón «Ya pagué: consultar el estado» hace lo mismo sin pasar por el banco, para el pagador que cerró la pestaña del banco o regresó con «Atrás»: el navegador puede recargar la página en vez de restaurarla, y la página encuentra el pago pendiente y vuelve a ofrecer el botón.
4. Si es `TRANSACTION` y el estado no es final, consulta. En los dos casos, `GET /v1/api/payments/:id?gateway=` se repite hasta `isFinal`, con un tope de diez consultas.

Lo que cambia entre pasarelas está en las respuestas, no en el código. Medido el 13 de octubre de 2026 en memoria, con `buildApp()` y `app.inject()` sobre `kit-pagos-colombia@0.5.0`, el perfil de prueba de arriba y un cuerpo que sí llevaba `ipAddress` (punto 91 del [architecture-log](../architecture/architecture-log.md)):

| Pasarela | Respuesta del cobro con PSE | Destino de `redirectUrl` | Llamadas del SDK al simulador dentro del cobro | Consultas del cliente hasta el estado final |
|---|---|---|---|---|
| Wompi | `REDIRECT_REQUIRED`, `PENDING` | `http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=…`, una página del simulador | 3: el comercio, la transacción y la consulta que publica la URL del banco | 1, `APPROVED` |
| Mercado Pago | `REDIRECT_REQUIRED`, `action_required` | `http://localhost:3000/v1/sim/mercadopago/payments/<12 dígitos>/bank_transfer`, una página del simulador | 1: la orden | 1, `APPROVED` (`processed`) |
| Kushki | `REDIRECT_REQUIRED`, `initializedTransaction` | `http://localhost:3000/v1/sim/kushki/transfer/v1/agent?token=…`, una página del simulador | 2: el token y el `init` | 1, `APPROVED` (`approvedTransaction`) |
| Rapyd | `REDIRECT_REQUIRED`, `ACT` | `http://localhost:3000/v1/sim/rapyd/complete-bank-payment?…`, una página del simulador, con la URL de retorno en `complete_payment_url` | 2: el cliente y el pago | 1, `APPROVED` (`CLO`) |

Los destinos de Mercado Pago, Kushki y Rapyd son de la corrida del 14 de octubre de 2026: hasta entonces eran URL de los dominios reales de cada pasarela (punto 93). Las demás columnas son de la medición del 13.

En Wompi el cobro con PSE necesita dos consultas al simulador, pero la primera la hace el SDK dentro de `createPayment()` para obtener la URL del banco: al cliente le queda una. Con el banco `2` de Wompi, el cobro vuelve `TRANSACTION` y `DECLINED`, sin redirección.

## La salida, medida en el navegador

Dos corridas del 13 de octubre de 2026 (UTC−5), con el navegador de Cursor contra `http://localhost:4100` y la API de Simulación de la rama del issue encendida con los comandos de arriba. Cada cobro se hizo desde una página recién cargada. La primera, entre las 16:28 y las 16:31, encontró que el PSE de Mercado Pago fallaba por la IP del pagador. La segunda, entre las 16:59 y las 17:01, es después de que la API empezó a tomarla de la petición, y repite Wompi y Rapyd como regresión.

| Pasarela | Método | Hora | Lo que respondió | Vuelta | Consultas hasta el final | Resultado |
|---|---|---|---|---|---|---|
| Wompi | PSE, banco `1` | 16:28:42 y 17:00:06 | `201 REDIRECT_REQUIRED` a la página del banco del simulador | Se abrió la página del banco, se volvió con «Atrás» y con el botón de retorno | 1 | `APPROVED` (`APPROVED`) |
| Mercado Pago | PSE, banco `1001` | 16:29:16 | `400 INVALID_REQUEST`: «PSE en Mercado Pago requiere estos datos y no llegaron: ipAddress.» | — | — | Sin cobro |
| Mercado Pago | PSE, banco `1001` | 16:59:18 | `201 REDIRECT_REQUIRED` a `www.mercadopago.com.co`, con la IP tomada de la petición | Sin abrir el dominio real, con el botón de retorno | 1 | `APPROVED` (`processed`) |
| Kushki | PSE, banco `001` | 16:29:44 | `201 REDIRECT_REQUIRED` a `sandbox-pse.kushkipagos.com` | Sin abrir el dominio real, con el botón de retorno | 1 | `APPROVED` (`approvedTransaction`) |
| Rapyd | PSE, banco `co_pse_bancolombia_bank` | 16:29:59 y 17:00:29 | `201 REDIRECT_REQUIRED` a `sandboxcheckout.rapyd.net` | Sin abrir el dominio real, con el botón de retorno | 1 | `APPROVED` (`CLO`) |
| Wompi | Tarjeta `4242…` | 16:30:21 | `201 TRANSACTION`, `PENDING` | — | 1 | `APPROVED` (`APPROVED`) |
| Mercado Pago | Tarjeta, titular `APRO` | 16:30:40 | `201 TRANSACTION`, `approved` | — | 0 | `APPROVED` (`approved`) |
| Kushki | Tarjeta | 16:30:55 | `UNSUPPORTED_OPERATION` de `KitPagosBrowser`, sin ninguna petición | — | — | Sin cobro |
| Rapyd | Tarjeta | 16:30:58 | `UNSUPPORTED_OPERATION` de `KitPagosBrowser`, sin ninguna petición | — | — | Sin cobro |

En esas dos corridas las URL de banco de Mercado Pago, Kushki y Rapyd no se abrieron, y la vuelta se hizo con el botón de retorno de la página. Al abrirlas el 14 de octubre de 2026 (UTC−5), entre las 09:45 y las 09:49, con el navegador de Cursor, resultó que ninguna servía para un pagador:

| Pasarela | URL que entregó la API | Qué mostró el navegador |
|---|---|---|
| Mercado Pago | `https://www.mercadopago.com.co/payments/PAY01ILKVL8J29A/bank_transfer` | «Esta página no existe»: el identificador lo inventó el simulador |
| Kushki | `https://sandbox-pse.kushkipagos.com/transfer/v1/agent?token=5152ae2d…` | Pantalla en blanco: el dominio no resuelve (`Could not resolve host`) |
| Rapyd | `https://sandboxcheckout.rapyd.net/complete-bank-payment?token=payment_e379…` | La página real «Rapyd Bank Payment Simulation»; con «Success» y «Pay» no volvió a `localhost:4100`, porque Rapyd no conoce el token |

Por eso el criterio del issue, «PSE de punta a punta, incluida la redirección», no se cumplía con esas tres. El arreglo (punto 93) es que las cuatro páginas de banco sean del simulador y devuelvan al pagador a la URL de retorno. Repetido el recorrido entre las 10:10 y las 10:13, con las cuatro: cobro con PSE, enlace al banco, página de banco, «Volver al comercio» y consulta, el cliente mostró `APPROVED` en Mercado Pago (`processed`), Kushki (`approvedTransaction`), Rapyd (`CLO`) y Wompi (`APPROVED`). Wompi con el banco `2` mostró `DECLINED` sin redirección, y la tarjeta de Wompi y Mercado Pago siguió aprobando.

La traza de la página en el PSE de Wompi, tal como la mostró (horas en UTC). La página se recarga dos veces: al salir hacia el banco y al volver por la URL de retorno.

```
21:28:40.675  GET /v1/api/gateways -> 200
21:28:40.678  GET /v1/api/pse-banks?gateway=wompi -> 200
21:28:42.016  POST /v1/api/payments -> 201
21:28:42.016  redirectUrl http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=3ed3b8d0d5104b82a70102a8998d53b8

21:29:01.412  GET /v1/api/gateways -> 200
21:29:01.417  GET /v1/api/pse-banks?gateway=wompi -> 200
21:29:01.417  retorno del pagador, orden C109-1791926922006
21:29:01.420  GET /v1/api/payments/3ed3b8d0-d510-4b82-a701-02a8998d53b8?gateway=wompi -> 200
21:29:01.420  final APPROVED/APPROVED id=3ed3b8d0-d510-4b82-a701-02a8998d53b8
```

Lo que mostró la red, con un espía de `fetch` en la página y el log del simulador:

- **El número de tarjeta solo viajó a la ruta de tokenización.** Con Wompi fue a `POST /v1/sim/wompi/tokens/cards` (campos `number`, `cvc`, `exp_month`, `exp_year` y `card_holder`), y con Mercado Pago a `POST /v1/sim/mercadopago/card_tokens`. A `POST /v1/api/payments` llegó solo `paymentMethod: { type: "CARD", token: "tok_sim_…", installments: 1 }`, sin `Authorization` y con `content-type` como única cabecera.
- **El preflight real.** El log del simulador registró, con `Origin: http://localhost:4100`, el `OPTIONS /v1/api/payments` con `Access-Control-Request-Headers: content-type`, que respondió `204`. Antes de él, el `OPTIONS /v1/sim/wompi/tokens/cards` con `authorization,content-type`, que respondió `200`. Las llamadas que el SDK hace desde la API a `/v1/sim` no llevan `Origin`. Con los mismos encabezados por `curl`, el preflight de `/v1/api/payments` responde `access-control-allow-origin: *`, `access-control-allow-methods: GET,HEAD,POST` y `access-control-allow-headers: content-type`.
- **El SDK, desde jsDelivr y solo al pagar con tarjeta.** El recurso `https://cdn.jsdelivr.net/npm/kit-pagos-colombia@0.5.0/dist/browser/index.js` aparece después de pulsar «Pagar», con 16 470 bytes descomprimidos y 4 905 transferidos. En el segundo cobro llegó de la caché HTTP. En los PSE no se cargó.

- **La página de pago de Rapyd.** Abierta directamente en el navegador a las 17:01:00, `GET /v1/sim/rapyd/checkout/:id/pay` respondió una página HTML del simulador («Página de pago simulada»). La consulta siguiente por `/v1/api` devolvió el checkout `APPROVED` (`CLO`), así que la visita conserva su efecto, y `/pagar` sigue respondiendo `308` hacia `/pay`.

### La IP del pagador

Mercado Pago exige la IP del pagador para PSE (punto 45), y el SDK rechaza el cobro antes de llamar a la pasarela si no llega. En la primera corrida el navegador no la mandaba, porque no conoce su IP pública, y el cobro falló. En el patrón 1 la pone el backend del comercio, que la lee de la petición del pagador. En el patrón 2 quien recibe esa petición es la API. Por eso, desde el issue #109, `POST /v1/api/payments` toma la IP de la petición cuando el cuerpo no la trae. Detrás de Render la toma de `X-Forwarded-For`. Si el cuerpo trae `ipAddress`, manda la del cuerpo (punto 92).

El valor que llegó a Mercado Pago no se ve desde afuera, porque el simulador no devuelve ese campo. Qué IP se manda en cada caso lo fijan las pruebas de `simulator-api/test/payer-ip.test.ts`.

## Por qué el número de tarjeta no pasa por la API

`/v1/api` no tiene dónde recibir un número de tarjeta, y es a propósito. Si lo recibiera, la API y quien la despliega procesarían datos del titular de la tarjeta, y quedarían dentro del alcance de PCI DSS. El SDK lo rechaza por diseño: con Kushki y sin token, `POST /v1/api/payments` responde `400 INVALID_REQUEST` con el mensaje «El SDK no acepta el número de tarjeta: recibirlo metería al comercio dentro del alcance de PCI DSS» (medido el 13 de octubre de 2026).

Por eso la página tokeniza en el navegador con `KitPagosBrowser.tokenizeCard()`: el número va de la página a la ruta de tokenización de la pasarela, cuyo host sale de un catálogo cerrado del SDK (puntos 77 y 78), y a `/v1/api` solo llega el token. El módulo se carga desde jsDelivr con la versión fija, `kit-pagos-colombia@0.5.0`, y solo al pagar con tarjeta: el cobro con PSE no descarga código del SDK. Dos pruebas lo sostienen, y las dos fallan con su mutación: una revisa que ninguna petición a la API lleve el número, y otra que el código no nombre pasarelas.

La traza de la página registra solo el método, la ruta y el código de cada llamada a `/v1/api`, nunca el cuerpo.

## Lo que el simulador no puede mostrar

- **La página real del banco.** Las cuatro páginas de banco del simulador dicen que son del simulador y ofrecen un enlace «Volver al comercio» a la URL de retorno que mandó el comercio. Es una convención (nivel 3, punto 93): no imitan la página del banco ni la de la pasarela, y contra un sandbox real quien devuelve al pagador es el banco. En Mercado Pago real la URL de banco lleva al portal de PSE de ACH Colombia, el pagador vuelve por un comprobante de Mercado Pago y la `callback_url` recibe `?payment_id=<id>`; la página del simulador solo repite ese último paso (medido el 14 de octubre de 2026, `docs/testing-data/mercado-pago.md`).
- **Mercado Pago real no acepta este cliente desde `localhost`.** El cliente manda `returnUrl` con su propio origen, `http://localhost:4100/…`, y Mercado Pago responde `402 processing_error` a una `callback_url` que apunta a la máquina local (medido el 14 de octubre de 2026). Contra el simulador funciona; contra el sandbox real hace falta servir el cliente desde un host público.
- **El desenlace por la visita.** En las cuatro, el estado del PSE avanza con la consulta y no con la visita a la página del banco (sección 4.1 de [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md)).

## Insumo para la Prioridad 3: Kushki y Rapyd no tokenizan en el navegador

`KitPagosBrowser` tokeniza solo con Wompi y Mercado Pago. Con Kushki y con Rapyd lanza `UNSUPPORTED_OPERATION` antes de enviar nada, y la página muestra ese error: el cliente no decide qué pasarela tokeniza, lo decide el SDK.

- **Kushki** exige un token emitido por su propia ruta de tokenización (`POST /card/v1/tokens`, según el mensaje del SDK). Cobrar con tarjeta desde este cliente obligaría a agregar un tokenizador de Kushki al módulo de navegador o a cargar el script de Kushki en la página. No se comprobó qué ofrece Kushki para el navegador.
- **Rapyd** cobra la tarjeta en su página alojada. Medido el mismo día: `POST /v1/api/payments` con tarjeta y sin token responde `REDIRECT_REQUIRED` hacia `/v1/sim/rapyd/checkout/:id/pay`, y después de la visita la consulta da `APPROVED` (`CLO`). Este cliente no usa ese camino, por decisión de Joan del 13 de octubre de 2026: el criterio de tarjeta del issue aplica a las pasarelas que tokenizan en el navegador, y la de Rapyd queda fuera del prototipo C.

Ese es el problema que motiva la Prioridad 3: un frontend que quiera cobrar con tarjeta por las cuatro tiene que cargar el SDK de navegador de cada pasarela o una página alojada, y la API REST no lo resuelve.

## Lo que este ejemplo no cubre

- **Los webhooks.** El estado final se lee por consulta. Recibir la notificación necesita un servidor del comercio, que es lo que tienen los prototipos A y B.
- **Las pasarelas reales.** Para ir a un sandbox, el cliente tendría que mandar `x-kit-pagos-environment: sandbox`, y la API usaría las credenciales del servidor con una advertencia (punto 69). Este cliente no manda esa cabecera, así que siempre va al simulador.
- **El token de la API.** Si la API corre con `API_AUTH_TOKEN`, exige `Authorization: Bearer`. Este cliente no lo manda, porque sería una credencial en el navegador; contra una API con el token configurado no funciona tal cual.
