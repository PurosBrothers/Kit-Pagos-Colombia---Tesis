# Recorrido: el checkout de navegador contra la API REST

El patrón de integración 2, frontend hacia REST, vuelto ejecutable. Es el cliente del issue #109 y también el prototipo C de `docs/project-management/thesis-objectives.md` (§5.1): una página que cobra contra `/v1/api` sin instalar `kit-pagos-colombia` y sin saber qué pasarela hay detrás.

**Carpeta:** [prototypes/checkout-frontend-rest/](../../prototypes/checkout-frontend-rest/) · **Comandos:** `npm run build` y, para correrlo, `npm start` (los sandboxes oficiales) o `npm run start:local` (un simulador en la máquina)

## Qué demuestra

Los doce ejemplos de este capítulo sirven al patrón 1: un backend que importa el SDK. Este sirve al patrón 2: un navegador que solo conoce las rutas y las formas JSON de `/v1/api`, y deja que la API arme el SDK con el perfil del servidor.

- **El mismo código para las cuatro pasarelas.** La lista de pasarelas sale de `GET /v1/api/gateways` y la de bancos de `GET /v1/api/pse-banks`. El código que llega al navegador no nombra ninguna pasarela, y una prueba lo comprueba (`test/no-gateway-names.test.ts`): falla si alguien agrega un `if (gateway === "wompi")`.
- **Ninguna credencial en el código.** Contra el ambiente `simulator`, la API usa el perfil del servidor y el cliente no manda cabeceras de credenciales ni `Authorization`. La llave pública que hace falta para tokenizar una tarjeta llega en tiempo de ejecución desde `/config.json`, que arma el servidor estático con sus variables de entorno.
- **CORS de verdad.** La página se sirve desde `localhost:4100` y la API está en otro origen, `localhost:3000` o la de Render: el navegador hace el preflight de `POST /v1/api/payments` antes de cada cobro.
- **Sin simulador local.** Por omisión la página cobra contra la API de Simulación desplegada en Render, y con una opción contra el sandbox real de cada pasarela. Encender el simulador en la máquina es una tercera opción, no un requisito (punto 94).

## Cómo se ve

Desde el 17 de octubre de 2026 la página es una tienda pequeña, «Tostadero Ceiba», con tres productos (dos cafés y una taza), un carrito y el checkout al lado (punto 103). El comprador elige productos, revisa sus datos de envío, que vienen precargados con datos de prueba, elige PSE o tarjeta y paga. La pasarela sigue siendo un valor del formulario («Pasarela»), con una nota que dice que en una tienda real la define el comercio. Ninguno de los precios cae en los montos que la API de Simulación reserva para escenarios de fallo, ni sumados (`test/store.test.ts`).

La tienda no muestra datos técnicos. Lo que antes era la «Traza de llamadas a la API» va a la consola del navegador con el prefijo `[tienda C]`: la API y el ambiente, cada llamada a `/v1/api` con su código, los avisos de la API, el estado nativo de cada pago con su motivo de rechazo y la URL a la que se redirige. El comprador lee mensajes de tienda (`src/messages.ts`): «¡Gracias! Tu pago fue aprobado», «Tu pago fue rechazado» con una pista según la categoría del motivo, «Tu pago está en proceso». Una franja arriba dice si los pagos son simulados o del sandbox.

Cuando la pasarela devuelve una URL de banco o de pago, la tienda lleva al comprador ahí directamente, sin mostrar un enlace.

Encima del catálogo, un recuadro «Este prototipo es» explica qué es la página y qué demuestra. En el checkout, la pasarela va antes del medio de pago y del banco, porque de ella dependen los dos: la lista de bancos y si se ofrece tarjeta (punto 105). Mientras llega la lista de bancos de la pasarela elegida, el banco y el botón de pagar quedan deshabilitados. La tarjeta se ofrece solo con las pasarelas cuya llave pública trae `/config.json`, que son las que `KitPagosBrowser` tokeniza; con las demás la opción aparece deshabilitada con el motivo. Mientras la tienda consulta el estado del pago, muestra el avance («Consultando con la pasarela (3 de 10)…»).

## Cómo correrlo

El cliente no necesita encender nada en la máquina. Desde el punto 94, el servidor estático decide al arrancar a qué API y a qué ambiente apunta. Por omisión, desde el punto 104, cobra en el sandbox oficial de cada pasarela a través de la API desplegada en Render:

```bash
cd prototypes/checkout-frontend-rest
npm ci
npm run build
npm start
```

Y se abre `http://localhost:4100`. La franja de arriba dice si los pagos son simulados o del sandbox; la API y el ambiente quedan en la consola del navegador. Hay dos modos:

| Comando | API | Ambiente | Para qué sirve |
|---|---|---|---|
| `npm start` | `https://kit-pagos-colombia.onrender.com/v1/api` | `sandbox` | Cobrar contra el sandbox oficial de cada pasarela sin encender nada: la API usa las credenciales de sandbox de su servidor y avisa con la cabecera `x-kit-pagos-warning`, que la página registra en la consola. La primera consulta puede tardar mientras Render despierta |
| `npm run start:local` | `http://localhost:3000/v1/api` | `simulator` | Trabajar contra un simulador encendido en la máquina (sección siguiente), tarjeta incluida |

El simulador de Render sigue disponible con `npm start -- --environment=simulator`, para el PSE de las cuatro pasarelas con las páginas de banco del simulador.

Las opciones se pasan como argumentos, que funcionan igual en bash, PowerShell y cmd. Con `npm run`, después de `--`:

```bash
npm start -- --api-url=https://otra-api.example/v1/api
npm start -- --port=4200 --public-key=wompi:pub_test_…
npm start -- --environment=simulator
npm start -- --help
```

También se pueden dar como variables de entorno (`KIT_PAGOS_API_URL`, `KIT_PAGOS_ENVIRONMENT`, `CHECKOUT_PUBLIC_KEY_<PASARELA>`, `PORT`), y un argumento gana sobre su variable. Cuidado en Windows: `set KIT_PAGOS_API_URL=…` define la variable en cmd pero no en PowerShell, donde hace falta `$env:KIT_PAGOS_API_URL="…"`. Es una causa posible de que el cliente apunte a `localhost:3000` aunque se haya pedido otra cosa (no se probó en Windows), y es la razón de que las opciones sean argumentos. Si falta el build, o el ambiente o la URL no son válidos, el servidor dice qué corregir y no arranca.

Las llaves públicas para tokenizar una tarjeta se leen del `.env` de la raíz del repositorio, el mismo que usa la API (punto 99). Del archivo solo se leen las variables `<PASARELA>_PUBLIC_KEY` (hoy `WOMPI_PUBLIC_KEY` y `MERCADOPAGO_PUBLIC_KEY`); los secretos no se leen y no llegan a `/config.json`. Para cada pasarela, `--public-key` gana sobre `CHECKOUT_PUBLIC_KEY_<PASARELA>`, y esa variable sobre el archivo. Si el cliente corre desde una copia sin `.env`, como un worktree, el archivo se indica con `--dotenv=<ruta>` o `KIT_PAGOS_DOTENV`; si falta el indicado, el servidor no arranca y lo dice. Al arrancar dice de dónde salió cada llave, nunca su valor. Si no encuentra ninguna, dice «Llaves públicas para tarjeta: ninguna; la tarjeta queda deshabilitada (pase el .env con --dotenv=<ruta>)», la consola del navegador lo repite y la tarjeta sale deshabilitada con todas las pasarelas (punto 105). Las llaves públicas del `.env` local tienen que ser del mismo par que usa la API, con `npm start` el de Render: el navegador crea el token de la tarjeta con la llave local y la API lo cobra con sus credenciales, y en Mercado Pago además lee el token con su access token y busca la marca con su propia llave pública. Cobrar con las credenciales de una aplicación un token creado con la llave de otra no está medido. El PSE no usa nada de ese archivo con `npm start`. La opción no se llama `--env-file` porque Node interpreta esa opción por su cuenta aunque vaya después del script.

Para probar este cliente contra los sandboxes reales, con los resultados que se esperan en cada pasarela, ver la [guía de prueba](checkout-frontend-rest-guia-de-prueba.md).

### Lo que cada modo no puede hacer

- **Tarjeta con el simulador de Render.** El tokenizador de navegador del SDK tiene fijo `http://localhost:3000` como destino del ambiente `simulator`, a propósito: así una página no puede mandar un número de tarjeta a un host que ella elija. Con `npm start -- --environment=simulator`, la tarjeta no puede tokenizarse contra Render: la tienda la muestra deshabilitada y la consola dice por qué («Con el ambiente simulator, el SDK tokeniza la tarjeta contra localhost:3000, y esta API está en…»), en vez de fallar con «Failed to fetch». Con el simulador de Render se paga con PSE; con tarjeta, `npm start` (sandbox) o `start:local`.
- **Tarjeta en `sandbox`.** El número va del navegador a la ruta de tokenización real de la pasarela, con la llave pública de sandbox que sale del `.env`. El formulario trae el titular `APRO Ruiz`: Mercado Pago aprueba en su sandbox los titulares que empiezan por `APRO`, y Wompi exige al menos cinco caracteres (medido el 15 de octubre de 2026). La tarjeta de Mercado Pago necesita que la API use el SDK 0.6.0, que la cobra por la Orders API (punto 96).
- **PSE de Mercado Pago en `sandbox`.** Mercado Pago rechaza una `callback_url` que apunta a `localhost`, y el cliente manda la suya: hay que servirlo por un túnel público (ver la guía de prueba). Con las credenciales de prueba de la segunda aplicación del proyecto, el PSE llegó a «Banco Prueba PSE» y se aprobó el 16 de octubre de 2026 a las 15:44; a las 19:07 dejó de entregar la URL, como la primera aplicación. Con la tercera, el 17 de octubre a las 15:23, a las 15:46 y a las 16:35, y a las 16:55 por Render, el PSE desde la tienda terminó aprobado (puntos 103 a 105); es el par del proyecto, y con él no se cobran tarjetas de Mercado Pago mientras no se sepa si son las que cortan el PSE. Cuando la URL no llega, la orden nace en `processing` sin URL de banco y termina `failed / processing_error` (punto 100), y la página lo muestra como un pago pendiente que, al consultarlo, sale `DECLINED`.
- **PSE de Kushki en `sandbox`.** La página real del banco y la vuelta funcionan, pero en este comercio de UAT ninguna transferencia sale de `initializedTransaction`, ni con los documentos de prueba (`docs/testing-data/kushki.md`, 5.2.2). La confirmación dice «Tu pago está en proceso» y ofrece «Consultar de nuevo».
- **PSE de Rapyd en `sandbox`.** El sandbox de Rapyd solo cobra 9 de sus 50 bancos; con los otros 41 responde `400 ERROR_GET_GATEWAY`. Desde la 0.6.0-rc.3 el SDK los quita de la lista contra el sandbox, así que el selector muestra solo esos 9 (`docs/testing-data/rapyd.md`, 5.8; punto 102).
- **Producción.** No está entre los ambientes del cliente: exigiría llaves privadas del comercio, y un navegador no debe tenerlas.

### Con el simulador en su máquina

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

En otra, el cliente. Si el `.env` de la raíz tiene las llaves públicas, se usan esas, y el simulador las acepta; si no, se pasan las de prueba:

```bash
cd prototypes/checkout-frontend-rest
npm ci
npm run build
npm run start:local -- --public-key=wompi:pub_test_kp109_simulador --public-key=mercadopago:TEST-kp109-simulador
```

Y abrir `http://localhost:4100`. La API tiene que escuchar en el puerto 3000, porque es el destino fijo del tokenizador del SDK; con otro puerto la página bloquea la tarjeta, pero el PSE sigue funcionando.

| Opción | Variable | Por omisión | Qué es |
|---|---|---|---|
| `--api-url` | `KIT_PAGOS_API_URL` | La API de Render | Dónde está `/v1/api` |
| `--environment` | `KIT_PAGOS_ENVIRONMENT` | `simulator` | `simulator` o `sandbox`. Se manda como `x-kit-pagos-environment` en cada llamada y se le pasa al SDK al tokenizar la tarjeta, para que los dos pasos usen el mismo |
| `--public-key=<pasarela>:<llave>` | `CHECKOUT_PUBLIC_KEY_<PASARELA>` | La del `.env` | La llave pública de cada pasarela que tokeniza en el navegador. Sin ella, el SDK rechaza la tokenización. Se repite una vez por pasarela |
| `--dotenv=<ruta>` | `KIT_PAGOS_DOTENV` | El `.env` de la raíz | El archivo del que se leen las llaves públicas |
| `--port` | `PORT` | `4100` | El puerto del servidor estático |

Las variables `KIT_PAGOS_API_URL` y `TOKENIZATION_ENVIRONMENT` existían antes del punto 94; la segunda desapareció, porque el ambiente de la tokenización y el de las llamadas a la API tienen que ser el mismo, y tenerlos separados permitía armar combinaciones que no funcionan.

## El flujo

1. La página pide las pasarelas y, para la elegida, sus bancos de PSE.
2. `POST /v1/api/payments` con un solo cuerpo para las cuatro: monto, divisa, referencia, el pagador completo (con documento, teléfono y dirección, que Mercado Pago exige para PSE), el método y `returnUrlConfig.returnUrl`. No lleva `ipAddress`: el navegador no conoce su IP pública, y la API toma la de la petición (ver «La IP del pagador»).
3. Si la respuesta es `REDIRECT_REQUIRED`, la página guarda en `sessionStorage` el pago pendiente (pasarela, identificador, referencia y método) y el carrito, y lleva al comprador a `redirectUrl` con `location.assign`, sin mostrar el enlace. Al volver a la URL de retorno (`/?retorno=1`), lee el pago pendiente, muestra «Confirmando tu pago…» y consulta. El enlace «Volver al comercio» de la página de banco del simulador lleva ahí. Si el comprador vuelve a la tienda sin pasar por la URL de retorno, porque cerró la pestaña del banco o regresó con «Atrás», un aviso «Tienes un pago en proceso» ofrece «Consultar el estado», que hace lo mismo. La tienda recuerda la pasarela y el método del último intento para el siguiente.
4. Si es `TRANSACTION` y el estado no es final, consulta. En los dos casos, `GET /v1/api/payments/:id?gateway=` se repite hasta `isFinal`, con un tope de diez consultas.
5. El pago queda guardado hasta que una consulta da un estado final. Si después del tope sigue pendiente, como pasa con el PSE de Kushki en su sandbox, la confirmación dice «Tu pago está en proceso» y ofrece «Consultar de nuevo». Con el estado final, la página lo olvida. Con un pago aprobado, además, vacía el carrito; con uno rechazado lo conserva para intentar con otro medio.

Si `fetch` falla, el comprador lee «No pudimos conectar con el servicio de pagos» y la consola registra `API_UNREACHABLE` con el origen de la API, el error del navegador y las dos causas posibles: que la API no haya respondido, o que haya respondido y el navegador no pueda leer la respuesta por CORS. Desde la página no se distinguen, porque el navegador rechaza los dos casos con el mismo error. El segundo se midió el 15 de octubre de 2026: un túnel de Cloudflare reemplazó un `502` de la API por su propia página, sin `access-control-allow-origin`.

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

## En Render y en el sandbox, medido en el navegador

El 14 de octubre de 2026 Joshua probó el cliente y encontró que mandaba siempre a `localhost`, que no había forma de ir al sandbox oficial y que no funcionaba contra la API de Render sin encender el simulador. Era cierto en tres cosas. El cliente apuntaba por omisión a `localhost:3000`. Nunca mandaba `x-kit-pagos-environment`, así que no podía pedir el sandbox, y el ambiente de la tokenización (`TOKENIZATION_ENVIRONMENT`) era una variable aparte de las llamadas a la API. Y cuando la API no respondía, la página mostraba «Failed to fetch». El punto 94 lo arregla: la API de Render y el ambiente se eligen al arrancar (sección «Cómo correrlo»), la página dice a qué está hablando y los errores dicen qué hacer.

Corrida entre las 22:47 y las 22:55 (UTC−5), con el navegador de Cursor, sobre la API desplegada en Render y con la rama del issue. Entonces `npm start` era el simulador de Render y `start:sandbox` el sandbox; desde el punto 104, el sandbox es `npm start`. Las horas de la traza de la página están en UTC. Las capturas están en `.cursor/evidencia/109/ambiente-y-render/`, fuera del repositorio.

| Modo | Pasarela y método | Hora | Lo que respondió | Resultado |
|---|---|---|---|---|
| `--api-url` a un puerto sin nada | — | 22:47 | `API_UNREACHABLE`: «No se pudo conectar con la API en http://localhost:3999. Verifique que esté encendida; si es la desplegada en Render, puede estar despertando.» | El mensaje dice qué pasó |
| `npm start` (Render, `simulator`) | Kushki, PSE | 22:47 | `201 REDIRECT_REQUIRED` con enlace a `sandbox-pse.kushkipagos.com` | **El PSE de Kushki, Mercado Pago y Rapyd no funciona contra Render todavía.** Render corre código anterior al punto 93 y entrega las URL de banco inexistentes de antes. Se arregla al integrar el #109 y volver a desplegar |
| `npm start` (Render, `simulator`) | Wompi, tarjeta | 22:48 | La página no envía nada y explica que el SDK tokeniza contra `localhost:3000` | La tarjeta contra un simulador remoto no puede funcionar (ver «Lo que cada modo no puede hacer») |
| `npm run start:sandbox` | — | 22:48 | La página muestra «API: …onrender.com/v1/api · ambiente: sandbox» y el aviso «Se usaron las credenciales de sandbox del servidor…» | La cabecera `x-kit-pagos-warning` cruza CORS y llega a la página |
| `start:sandbox` | Wompi, PSE, banco `1` | 22:48 | `201 TRANSACTION`, `APPROVED` en la primera respuesta, sin redirección | El sandbox de Wompi aprueba ese banco de inmediato |
| `start:sandbox` | Kushki, PSE, banco `0001` | 22:49 | `201 REDIRECT_REQUIRED` a `https://api-uat.kushkipagos.com/transfer/v1/agent?token=…&mid=…` | La URL es del dominio real y la página abre |
| La misma, abierta | Kushki | 22:50 | La página real «Kushki Bank»: «Transacción pendiente» y el botón «Volver al comercio». El botón llevó a `http://localhost:4102/?retorno=1&token=…` | La vuelta funciona. En diez consultas durante 14 segundos el estado siguió `PENDING` (`initializedTransaction`) y la página dijo que el pago sigue pendiente; no se esperó más |
| `start:sandbox` | Rapyd, PSE, `co_pse_banco_davivienda_bank` | 22:51 | `201 REDIRECT_REQUIRED` a `https://sandboxcheckout.rapyd.net/complete-bank-payment?token=payment_…&complete_payment_url=…`. En la página real, «Success» y «Pay» devolvieron al pagador | Una consulta: `APPROVED` (`CLO`) |
| `start:sandbox` | Mercado Pago, PSE, banco `1001` | 22:52 | `400 INVALID_REQUEST`: falta `ipAddress` | **No pasa.** Render corre código anterior al punto 92, que toma la IP de la petición. Y aun con eso, Mercado Pago rechaza una `callback_url` de `localhost` (ver abajo) |
| `start:sandbox` | Wompi, tarjeta `4242…`, titular `APRO`, con la llave pública de sandbox | 22:52 | Wompi, la real, rechazó la tokenización: «card_holder: no debe contener menos de 5 caracteres» | La tarjeta sí llegó a Wompi desde el navegador |
| `start:sandbox` | Wompi, tarjeta, titular `Felipe Ruiz` | 22:53 | `201`, y tres consultas | `APPROVED` (`APPROVED`) |
| `npm run start:local` | Kushki, PSE | 22:53 | `201 REDIRECT_REQUIRED` a `http://localhost:3000/v1/sim/kushki/transfer/v1/agent?token=…`; «Volver al comercio» y una consulta | `APPROVED` (`approvedTransaction`) |
| `start:local` | Wompi, tarjeta, con la llave de prueba | 22:55 | `201`, una consulta. Sin la llave, la API respondió `INVALID_CREDENTIALS: La clave pública de Wompi es requerida` | `APPROVED` (`APPROVED`) |

Dos cosas que esta corrida midió del lado de las pasarelas:

- **La URL de banco de Kushki.** El punto 93 dejó la de Kushki sin medición propia. Contra el sandbox real, la URL es `https://api-uat.kushkipagos.com/transfer/v1/agent?token=…&mid=…` y redirige a `https://uat-sandbox.kushkipagos.com/checkout/transfer?status=pending&…`. La ruta `/transfer/v1/agent?token=` coincide con la que sirve el simulador; el dominio que el simulador usaba antes, `sandbox-pse.kushkipagos.com`, no era el real. Al volver, Kushki agrega `&token=<token>` a la URL de retorno del comercio; desde el punto 97 la página del simulador también lo agrega.
- **Kushki en sandbox no cierra el PSE por sí solo.** El simulador responde `APPROVED` en la primera consulta; el sandbox real de Kushki seguía `initializedTransaction` después de volver del banco. Lo que un comercio ve con el simulador no es lo que verá en el sandbox, y el cliente maneja los dos casos porque trata «pendiente» como un estado válido.

Sin probar en esa corrida: Windows y PowerShell (no había dónde); la tarjeta de Mercado Pago en `sandbox`; el PSE de Mercado Pago en `sandbox` desde un host público; y el PSE de las cuatro pasarelas contra Render con el código del #109 desplegado.

La corrida del 15 de octubre de 2026, entre las 21:47 y las 22:12, cubrió lo que se pudo de eso con la API de la rama detrás de un túnel de Cloudflare. Wompi (PSE con los bancos `1`, `2` y `3`, y tarjeta), Rapyd (PSE con «Success» y con «Error») y la tarjeta de Mercado Pago (`APRO Ruiz` aprobada, `OTHE Ruiz` rechazada) funcionaron de punta a punta. El PSE de Kushki quedó pendiente y el de Mercado Pago no entregó URL de banco, por lo que dicen los dos puntos de arriba. La corrida encontró además cuatro defectos de este cliente y de la API, ya corregidos (punto 101). Los resultados por pasarela están en la [guía de prueba](checkout-frontend-rest-guia-de-prueba.md). Windows y Render con el código del #109 siguen sin probar: los prueba Joshua al revisar el PR.

## Por qué el número de tarjeta no pasa por la API

`/v1/api` no tiene dónde recibir un número de tarjeta, y es a propósito. Si lo recibiera, la API y quien la despliega procesarían datos del titular de la tarjeta, y quedarían dentro del alcance de PCI DSS. El SDK lo rechaza por diseño: con Kushki y sin token, `POST /v1/api/payments` responde `400 INVALID_REQUEST` con el mensaje «El SDK no acepta el número de tarjeta: recibirlo metería al comercio dentro del alcance de PCI DSS» (medido el 13 de octubre de 2026).

Por eso la página tokeniza en el navegador con `KitPagosBrowser.tokenizeCard()`: el número va de la página a la ruta de tokenización de la pasarela, cuyo host sale de un catálogo cerrado del SDK (puntos 77 y 78), y a `/v1/api` solo llega el token. El módulo se carga desde jsDelivr con la versión fija, `kit-pagos-colombia@0.5.0`, y solo al pagar con tarjeta: el cobro con PSE no descarga código del SDK. Dos pruebas lo sostienen, y las dos fallan con su mutación: una revisa que ninguna petición a la API lleve el número, y otra que el código no nombre pasarelas.

La página protege ese módulo con integridad de subrecurso (punto 99): un import map en `index.html` fija el hash sha384 del archivo de esa URL exacta, y el navegador rechaza un archivo distinto antes de ejecutarlo. Si el módulo no se puede cargar o no pasa esa verificación, el comprador lee «No se pudo cargar el formulario seguro de la tarjeta. La tarjeta no se envió.», y la consola guarda el mensaje completo («No se pudo cargar el módulo de tarjeta o no pasó la verificación de integridad») con el error del navegador. Medido el 15 de octubre de 2026 con un hash alterado: el navegador bloqueó el módulo y no hubo tokenización ni cobro. Lo soportan Chrome y Edge desde la versión 127, Firefox desde la 138 y Safari desde la 18, según MDN. Al cambiar la versión del SDK, `npm run check:sri` compara el hash con el archivo que sirve jsDelivr.

La traza de la consola registra solo el método, la ruta y el código de cada llamada a `/v1/api`, nunca el cuerpo.

## Lo que el simulador no puede mostrar

- **La página real del banco.** Las cuatro páginas de banco del simulador dicen que son del simulador y ofrecen un enlace «Volver al comercio» a la URL de retorno que mandó el comercio. Es una convención (nivel 3, punto 93): no imitan la página del banco ni la de la pasarela, y contra un sandbox real quien devuelve al pagador es el banco. En Mercado Pago real la URL de banco lleva al portal de PSE de ACH Colombia, el pagador vuelve por un comprobante de Mercado Pago y la `callback_url` recibe `?payment_id=<id>`; la página del simulador solo repite ese último paso (medido el 14 de octubre de 2026, `docs/testing-data/mercado-pago.md`).
- **Mercado Pago real no acepta este cliente desde `localhost`.** El cliente manda `returnUrl` con su propio origen, `http://localhost:4100/…`, y Mercado Pago responde `402 processing_error` a una `callback_url` que apunta a la máquina local (medido el 14 de octubre de 2026, con las credenciales que resultaron ser de producción, punto 95). Contra el simulador funciona; contra el sandbox real hace falta servir el cliente desde un host público, por ejemplo un túnel (guía de prueba).
- **El desenlace por la visita.** En las cuatro, el estado del PSE avanza con la consulta y no con la visita a la página del banco (sección 4.1 de [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md)).

## Insumo para la Prioridad 3: Kushki y Rapyd no tokenizan en el navegador

`KitPagosBrowser` tokeniza solo con Wompi y Mercado Pago. Con Kushki y con Rapyd la tienda no ofrece tarjeta: la opción aparece deshabilitada, con el motivo «Con esta pasarela no ofrecemos tarjeta: la tarjeta se tokeniza en tu navegador con la llave pública de la pasarela, y esta tienda no la tiene, porque el SDK de Kit Pagos todavía no tokeniza con ella o porque la tienda arrancó sin esa llave. Paga con PSE o elige otra pasarela.» (punto 105). El motivo nombra las dos causas porque la tienda no puede distinguirlas sin nombrar pasarelas; cuando no hay ninguna llave, el arranque y la consola dicen que falta el `.env`. La señal es que `/config.json` no trae llave pública de esas pasarelas, porque el `.env` solo define `WOMPI_PUBLIC_KEY` y `MERCADOPAGO_PUBLIC_KEY`: el cliente sigue sin nombrar pasarelas. Si alguien agregara una llave para otra, `KitPagosBrowser` lanzaría `UNSUPPORTED_OPERATION` antes de enviar nada y el comprador leería que esa pasarela no recibe ese medio de pago desde el navegador: quien decide qué pasarela tokeniza sigue siendo el SDK.

- **Kushki** exige un token emitido por su propia ruta de tokenización (`POST /card/v1/tokens`, según el mensaje del SDK). Cobrar con tarjeta desde este cliente obligaría a agregar un tokenizador de Kushki al módulo de navegador o a cargar el script de Kushki en la página. No se comprobó qué ofrece Kushki para el navegador.
- **Rapyd** cobra la tarjeta en su página alojada. Medido el mismo día: `POST /v1/api/payments` con tarjeta y sin token responde `REDIRECT_REQUIRED` hacia `/v1/sim/rapyd/checkout/:id/pay`, y después de la visita la consulta da `APPROVED` (`CLO`). Este cliente no usa ese camino, por decisión de Joan del 13 de octubre de 2026: el criterio de tarjeta del issue aplica a las pasarelas que tokenizan en el navegador, y la de Rapyd queda fuera del prototipo C.

Ese es el problema que motiva la Prioridad 3: un frontend que quiera cobrar con tarjeta por las cuatro tiene que cargar el SDK de navegador de cada pasarela o una página alojada, y la API REST no lo resuelve.

## Lo que este ejemplo no cubre

- **Los webhooks.** El estado final se lee por consulta. Recibir la notificación necesita un servidor del comercio, que es lo que tienen los prototipos A y B.
- **Las pasarelas reales, todas de punta a punta.** Con `--environment=sandbox` el cliente manda `x-kit-pagos-environment: sandbox` y la API usa las credenciales del servidor con una advertencia (punto 69). Wompi, Rapyd y la tarjeta de Mercado Pago funcionan de punta a punta; el PSE de Kushki y el de Mercado Pago dependen de sus sandboxes (ver «Lo que cada modo no puede hacer» y la guía de prueba).
- **El token de la API.** Si la API corre con `API_AUTH_TOKEN`, exige `Authorization: Bearer`. Este cliente no lo manda, porque sería una credencial en el navegador; contra una API con el token configurado no funciona tal cual.
