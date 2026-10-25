# Prototipos del experimento de la Fase 5

Dos implementaciones del mismo checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo con tarjeta o PSE, informar el resultado, recibir la notificación asíncrona y consultar el estado. El diseño del experimento está en [`docs/project-management/prototypes-evaluation-plan.md`](../docs/project-management/prototypes-evaluation-plan.md), y cómo se mide, en [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../docs/04-metricas-y-pruebas/4-medir-los-prototipos.md).

| Carpeta | Prototipo | Cómo cobra |
|---|---|---|
| `checkout-sin-solucion/` | A, control | `fetch` contra la API nativa de cada una de las cuatro pasarelas (Wompi, Mercado Pago, Kushki y Rapyd), siguiendo su documentación oficial. Se presenta como «La Candelaria Cómics», una tienda de cómics con catálogo y carrito |
| `checkout-con-sdk-front-back/` | B, tratamiento | Las mismas cuatro con `kit-pagos-colombia` (0.7.0-rc.2) en el servidor y `kit-pagos-colombia/browser` en la página. Se presenta como «La Bodega de Chapinero», una tienda de vinos con catálogo y carrito |
| `checkout-frontend-rest/` | C, fuera del experimento A/B | Desde el navegador contra `/v1/api`, sin servidor de pagos propio. Se documenta en [`docs/05-ejemplos/checkout-frontend-rest.md`](../docs/05-ejemplos/checkout-frontend-rest.md) |
| `checkout-con-sdk-solo-back/` | D, fuera del experimento A/B | Las mismas cuatro con `kit-pagos-colombia` (0.7.0-rc.2) solo en el servidor. La página tokeniza la tarjeta con `fetch` contra la API de cada pasarela, sin `kit-pagos-colombia/browser`. Se presenta como «Austral Mate», una tienda de yerba mate con catálogo y carrito. Se documenta en su [`README.md`](checkout-con-sdk-solo-back/README.md) |

C no comparte el esqueleto de A y B, y `check-skeleton-parity.sh` no lo compara: es una página estática con Vite, servida por `server.mjs`, que demuestra el patrón de integración 2 (punto 91 del `architecture-log.md`).

D tampoco lo comparte, y tampoco se compara. Responde si el SDK le sirve a un comercio que no quiere adoptar su módulo de navegador (issue #164).

- **Conserva su estructura:** `PaymentService.ts` y su HTML estático.
- **Toma de A y B:**
  - el aspecto;
  - `localtest.me`;
  - `/webhooks/<pasarela>`;
  - el monto que pone el servidor;
  - el estado nativo en el historial;
  - el texto de cada rechazo (punto 123).

> **Límite declarado: los prototipos no son plantillas para producción.**
>
> - **Ninguno de los cuatro manda Content-Security-Policy** en la página donde se escribe la tarjeta. Un script malicioso en esa página podría leer el número y mandarlo a otro dominio.
> - **En C, el monto lo decide el navegador.**
>
> Se dejaron así a propósito: Joan lo decidió el 19 de octubre de 2026 (punto 114). El experimento mide el código de pagos, y una cabecera no cambia esa medición. Antes de copiar una de estas páginas a un comercio, lea [«Lo que un comercio real agrega»](#lo-que-un-comercio-real-agrega).

## La regla: solo cambia el módulo de pagos

Todo lo que no es integración de pagos es idéntico en los dos prototipos, y queda fuera del conteo de líneas. El módulo de pagos es lo único que cada prototipo escribe:

- `src/payments/index.ts`: `createPayments()`, que devuelve la implementación de `PaymentsPort` con las pasarelas registradas.
  - En A, cada pasarela es un archivo (`wompi.ts`, `mercadopago.ts`, `kushki.ts`, `rapyd.ts`) con lo que comparten en `gateway.ts`.
  - En B, cada pasarela es una entrada de `gateways.ts` con sus credenciales, y el módulo crea un `KitPagos` por pasarela, porque el SDK cobra con una pasarela activa por instancia.
- `src/payments/browser/client.js`: `tokenizeCard()`, que corre en el navegador. El número de la tarjeta va del navegador a la pasarela y nunca pasa por el servidor del comercio. Rapyd no tokeniza: la tarjeta se escribe en su página.
- `test/payments/`: sus pruebas, con el mismo esfuerzo en los dos (variable 6).

La pasarela la elige el comprador con un selector de la tienda, como en C. Los nombres los da el módulo de pagos en tiempo de ejecución, así que la vitrina no nombra pasarelas en su código, y una prueba lo comprueba.

Lo demás es el esqueleto común: el servidor Fastify, las páginas, las órdenes en memoria, las rutas y el contrato `src/checkout/PaymentsPort.ts`. No se modifica desde ningún prototipo. `check-skeleton-parity.sh` lo comprueba en la CI: compara las dos carpetas sin `payments/` y falla si el módulo de pagos de A usa el SDK.

**Excepción: las vitrinas** (puntos 110 y 116 del `architecture-log.md`). Desde el 19 de octubre de 2026, A se presenta como «La Candelaria Cómics» y B como «La Bodega de Chapinero». Cada una tiene tres productos, un carrito y una página de resultado para el comprador.

La vitrina de B copia la estructura de la de A: los mismos archivos, las mismas rutas y el mismo flujo. Cambian el catálogo, la marca y los estilos, y dos cosas propias de una tienda de licores: la casilla «Confirmo que soy mayor de edad» y las leyendas de las leyes 30 de 1986 y 124 de 1994. Estos archivos difieren y quedan fuera de la comparación:

- `src/views/`, `src/public/` y `src/orders/`;
- `src/catalog.ts`, `src/routes/api.ts` y `src/routes/pages.ts`;
- las pruebas `checkout.test.ts`, `orders-and-config.test.ts` y `catalog.test.ts`.

El servidor, el contrato, los webhooks, la configuración y las dependencias se siguen comparando. Las vitrinas no están en `src/payments/`, así que no entran en el conteo de líneas.

Los dos `package.json` traen `kit-pagos-colombia`, para que el esqueleto sea idéntico incluso en las dependencias. Solo el módulo de pagos de B puede usarlo.

## El contrato

`src/checkout/PaymentsPort.ts` reparte las seis funciones del plan de evaluación (§2):

| Función | Dónde |
|---|---|
| 1. Crear el pago por un monto en pesos, con la referencia de la orden y los datos del pagador | `createPayment()` |
| 2. Traducir el resultado a un estado del comercio | El `status` de cada respuesta: `APPROVED`, `DECLINED` o `PENDING` |
| 3. Distinguir un rechazo de un fallo técnico, y reintentar solo el segundo | Un rechazo vuelve como `DECLINED`, con su `declineReason` si la pasarela da el código. Un fallo técnico se reintenta dentro del módulo y, si persiste, sale como `PaymentTechnicalError` |
| 4. Verificar la firma de un webhook y actualizar la orden | `verifyWebhook()` verifica; el esqueleto actualiza la orden |
| 5. Consultar el estado por el identificador | `getPaymentStatus()` |
| 6. Registrar el estado nativo para auditoría | El `nativeStatus` de cada respuesta; el esqueleto lo guarda en el historial de la orden |

El contrato sirve a las cuatro pasarelas a la vez (punto 117 del `architecture-log.md`):

- **La pasarela es un parámetro** de cada operación.
- **`listGateways()`** dice cuáles están disponibles, con su nombre para el comprador y cómo recibe la tarjeta: `BROWSER_TOKEN` (Wompi, Mercado Pago y Kushki) o `HOSTED_PAGE` (Rapyd).
- **El esqueleto** guarda la pasarela en la orden, sirve `GET /api/gateways` y recibe los webhooks en `/webhooks/<pasarela>`.

El monto llega en pesos enteros: convertirlo a la unidad de la pasarela es trabajo del módulo. `verifyWebhook()` recibe el cuerpo tal como llegó por la red, las cabeceras y la query, porque Mercado Pago firma con el `data.id` de la URL.

La notificación puede traer la referencia de la orden. El esqueleto la busca así cuando no la encuentra por el id de la transacción, porque la tarjeta de Rapyd se crea como checkout y su webhook trae el id del pago (punto 118). Un `PENDING` que llega cuando la orden ya está aprobada o rechazada queda en el historial sin cambiar el estado, porque las pasarelas no garantizan el orden de sus avisos.

**El motivo de un rechazo llega al comprador** (punto 122). El `declineReason` trae el código de la pasarela y una categoría, las mismas del `RejectionCategory` del SDK. La página muestra un texto por categoría sin nombrar la pasarela, como «La tarjeta no tiene fondos suficientes», y el detalle técnico muestra el código, como `Rechazo 021 (INSUFFICIENT_FUNDS)`. Un rechazo sin código, o con `UNKNOWN`, conserva el texto general.

- **B** pasa el `rejectionReason` del SDK.
- **A** mapea a mano los mismos códigos: el `400` de Kushki y el `00011` de su PSE, el `status_detail` de una orden `failed` de Mercado Pago, y el `failure_code` de procesador de un pago `ERR` de Rapyd. Wompi no manda un código.
- **Un webhook no trae el motivo**, porque el evento del SDK no lo tiene, y A tampoco lo lee. Un rechazo sin motivo no borra el que trajo la creación o la consulta.

## Cómo correrlos

Por omisión, `npm start` cobra en el sandbox oficial de cada pasarela, como el prototipo C (punto 104), sin encender nada en la máquina:

```bash
cd prototypes/checkout-sin-solucion   # o checkout-con-sdk-front-back
npm ci
npm start                             # http://localtest.me:4000
```

**La tienda se abre en `http://localtest.me:4000`, no en `localhost`.** `localtest.me` es un dominio público que resuelve a `127.0.0.1`. Mercado Pago no acepta volver a `localhost` al final de un PSE; con este origen, el banco devuelve al comprador a la máquina sin túnel (punto 120).

- **El carrito se guarda por origen**, así que la tienda se usa entera en `localtest.me`.
- **Si una red no lo resuelve**, basta una línea en `/etc/hosts`: `127.0.0.1 localtest.me`. Se comprueba con `dscacheutil -q host -a name localtest.me`, que tiene que responder `127.0.0.1`.

| Comando | Dónde cobra | Para qué sirve |
|---|---|---|
| `npm start` | El sandbox oficial de cada pasarela | Probar contra lo real. Las llaves salen del `.env` de la raíz. Una pasarela sin sus llaves queda fuera del selector; si no queda ninguna, A y B se detienen al arrancar y dicen cuáles faltan |
| `npm start -- --environment=simulator` | La API de Simulación de Render | Los escenarios del simulador sin encender nada. La primera consulta puede tardar mientras Render despierta. En B, solo PSE: la tarjeta no tokeniza (ver abajo) |
| `npm run start:local` | Una API de Simulación en `localhost:3000` (`simulator-api`, `npm run dev`) | Trabajar con el simulador de la máquina |
| `npm run dev` | Lo mismo que `start:local`, recompilando al guardar | Desarrollo |

El esqueleto lee el `.env` de la raíz, el mismo de la API de Simulación (una variable del entorno gana sobre el archivo), y el ambiente: `--environment=sandbox|simulator`, `--simulator-url=…` y `--port=…`, o sus variables. No nombra ninguna pasarela: cada módulo de pagos traduce el ambiente a sus URLs (punto 111 del `architecture-log.md`).

- **En A**, cada pasarela tiene su URL de sandbox y sus rutas del simulador (`/v1/sim/wompi`, `/v1/sim/mercadopago`, `/v1/sim/kushki` y `/v1/sim/rapyd`). `<PASARELA>_BASE_URL` gana sobre las dos.
- **En B**, el módulo le pasa el ambiente al SDK (punto 116). Con `sandbox`, el SDK toma la URL de su catálogo; con `simulator`, el módulo usa la URL del esqueleto con las mismas rutas. `<PASARELA>_BASE_URL` gana sobre los dos, y cuenta como simulador.

| Pasarela | Llaves para el sandbox | Para los webhooks |
|---|---|---|
| Wompi | `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, `WOMPI_INTEGRITY_SECRET` | `WOMPI_EVENTS_SECRET` |
| Mercado Pago | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY` | `MERCADOPAGO_WEBHOOK_SECRET`, la clave de la aplicación del vendedor de prueba, no la de la cuenta del proyecto (ver abajo) |
| Kushki | `KUSHKI_PUBLIC_MERCHANT_ID`, `KUSHKI_PRIVATE_MERCHANT_ID` | `KUSHKI_WEBHOOK_SECRET` |
| Rapyd | `RAPYD_API_ACCESS_KEY`, `RAPYD_API_SECRET_KEY` | `RAPYD_WEBHOOK_URL`, la URL exacta registrada en el panel, porque Rapyd la firma |

**La clave de los webhooks de Mercado Pago es la de la aplicación del vendedor de prueba** (punto 121). La Orders API solo acepta en sandbox las credenciales `APP_USR-` de un vendedor de prueba. Esas credenciales son de una aplicación que vive en la cuenta de ese vendedor, no en la del proyecto, y esa aplicación firma sus notificaciones con su propia clave.

- **Dónde está la clave.** El panel de la aplicación del proyecto muestra otra clave, que solo valida «Simular notificación». La buena se revela iniciando sesión con el vendedor de prueba: sus datos y su código de verificación de 6 dígitos están en «Pruebas > Cuentas de prueba». Allí se abre la aplicación cuyo id trae el token (`APP_USR-<id>-…`) y se va a Webhooks > Configurar notificaciones.
- **Dónde va la URL.** La URL de los webhooks se registra en esa misma aplicación.
- **Cómo comprobarla.** Cada notificación trae el `application_id` que la firmó, y tiene que coincidir con el id del token.

**La tarjeta de B contra el simulador de Render no tokeniza.** El SDK de navegador tokeniza en `simulator` siempre contra `localhost:3000`, porque su catálogo de hosts es cerrado para que la tarjeta no pueda ir a otro lado (punto 77). Con Render, la página responde «Error de conexión al tokenizar tarjeta». El PSE sí funciona, y la tarjeta de Rapyd también, porque no tokeniza. La tarjeta en el simulador se prueba con `npm run start:local`. En A no pasa, porque cada módulo arma a mano la URL de su tokenización.

| Variable | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4000` | El puerto del checkout |
| `PUBLIC_BASE_URL` | `http://localtest.me:<PORT>` | El origen público, para la URL de retorno del banco. `localtest.me` resuelve a esta máquina |
| `CHECKOUT_ENVIRONMENT` | `sandbox` | `sandbox` o `simulator` |
| `CHECKOUT_SIMULATOR_URL` | `https://kit-pagos-colombia.onrender.com` | El origen de la API de Simulación, con `simulator` |

**Los webhooks (función 4)** llegan a `/webhooks/<pasarela>`.

- **En el sandbox**, cada pasarela notifica a la URL registrada en su panel, que tiene que ser pública. `localtest.me` no sirve: en el servidor de la pasarela también resuelve a `127.0.0.1`. Hace falta un túnel, como en [«Los webhooks reales, en vivo»](#los-webhooks-reales-en-vivo). Sin él, la orden se resuelve con la consulta de su página.
- **Con el simulador local**, el webhook llega solo. Basta con arrancar `simulator-api` con `SIMULATOR_WEBHOOK_TARGET_URL=http://localhost:4000/webhooks/{gateway}` y `SIMULATOR_WEBHOOK_AUTO=true` (sección 4.2 de [`3-api-de-simulacion.md`](../docs/02-arquitectura/3-api-de-simulacion.md)). El simulador, A y B tienen que leer los mismos secretos de webhook y la misma `RAPYD_WEBHOOK_URL`. El simulador emite solo cuando un pago cambia de estado; uno que nace resuelto se notifica con `POST /v1/sim/webhooks/trigger`. La tarjeta de Rapyd pagada en su página llega con la misma secuencia del sandbox: dos avisos en `ACT` y después `PAYMENT_COMPLETED`.
- **Si corren los dos prototipos a la vez**, el segundo necesita otro `PORT`, y el destino de los webhooks del simulador es uno solo.

**Para probar en el día a día no hace falta túnel.**

- El simulador local firma cada aviso como la pasarela real, con lo que se midió en los sandboxes, incluida la secuencia de Rapyd.
- Las pruebas de los módulos verifican firmas con cuerpos de la documentación de cada pasarela y de lo medido, sin red ni llaves.
- Contra el sandbox, la orden se resuelve con la consulta aunque no llegue el webhook.

Un webhook real solo hace falta para mostrarlo en vivo o para volver a medir, si una pasarela cambia su forma de notificar o se agrega una.

### Los webhooks reales, en vivo

Para mostrar, por ejemplo en la sustentación, que cada pasarela notifica y que la tienda verifica la firma, hace falta una URL pública que llegue a la máquina. Se usa el dominio gratuito de ngrok, que es fijo para cada cuenta, así que los paneles se configuran una sola vez (punto 120).

**Una vez, días antes:**

1. **Preparar ngrok.** Crear la cuenta gratuita en ngrok, instalarlo (`brew install ngrok`) y conectarlo con `ngrok config add-authtoken <token>`; el token está en el panel de ngrok. El mismo panel muestra el dominio de la cuenta, de la forma `<nombre>.ngrok-free.app`.
2. **Registrar en el modo de pruebas de cada panel** la URL `https://<dominio>/webhooks/<pasarela>`:
   - **Wompi:** la URL de eventos del ambiente de pruebas.
   - **Mercado Pago:** los webhooks de la aplicación del vendedor de prueba, en su sesión, con los eventos de órdenes. La clave secreta que muestra se copia a `MERCADOPAGO_WEBHOOK_SECRET` del `.env` (ver arriba). Después de guardar hay que volver a revelarla, por si cambió.
   - **Rapyd:** la URL de webhooks. La misma URL, exacta, va en `RAPYD_WEBHOOK_URL` del `.env`, porque Rapyd la firma.
3. **Ensayar el día completo**, con los pasos de abajo.

**El día:**

1. **Arrancar.** Se levanta un prototipo en el puerto 4000 (`npm start` en su carpeta) y, en otra terminal, se corre `ngrok http 4000`.
2. **Pagar.** Se abre `http://localtest.me:4000` y se paga. Cada `webhook:` que llega aparece, con su estado nativo, en la traza de la terminal y en el «Detalle técnico de la orden».
   - **Wompi:** la tarjeta aprobada llega como `APPROVED`.
   - **Mercado Pago:** la tarjeta aprobada llega como `APPROVED (processed)`, con la clave del vendedor de prueba.
   - **Rapyd:** la tarjeta pagada en su página manda tres avisos. En A quedan como dos `PENDING (ACT)` y un `APPROVED (CLO)`. En B el segundo ya sale `APPROVED (CLO)`: ante un aviso pendiente, B consulta el pago, y para entonces Rapyd ya lo cerró. El PSE llega como `APPROVED (CLO)`.
   - **Kushki:** no hubo acceso a su consola de UAT, y eso queda como límite del experimento. Su webhook se muestra con el simulador local, firmado igual que la pasarela, como en «Con el simulador local».
3. **Cambiar de prototipo.** Se detiene el primero y se arranca el otro en el mismo puerto; el túnel y los paneles no cambian.

Lo medido contra los sandboxes está en los puntos 118 y 121.

- **Wompi, Mercado Pago y Rapyd:** sus webhooks reales verifican la firma y actualizan la orden en A y en B, medido el 22 de octubre de 2026 por un túnel. En Mercado Pago, con la clave de la aplicación del vendedor de prueba.
- **Kushki:** queda sin medir, porque no hubo acceso a su consola de UAT, y se declara como límite del experimento. Su firma se prueba con el simulador.

**Los datos de prueba**, medidos entre el 19 y el 21 de octubre de 2026 en los dos prototipos:

| Pasarela | Tarjeta | PSE |
|---|---|---|
| Wompi | 4242 4242 4242 4242 se aprueba y 4111 1111 1111 1111 se rechaza | El banco 1 aprueba, el 2 rechaza y el 3 da `ERROR`, que cuenta como rechazo. En el sandbox se resuelve en la primera consulta, sin página de banco |
| Mercado Pago | 4013 5406 8274 6260, 11/30, titular `APRO Ruiz` | «Banco Prueba PSE», con cualquier usuario y «APROBAR PAGO». Exige una `callback_url` que no sea `localhost`, y acepta la de `localtest.me` (punto 120). El sandbox tiene ventanas en que la orden nace sin URL del banco y termina en `processing_error` (punto 113) |
| Kushki | 4242 4242 4242 4242. El token queda atado al monto (`K220` si se cobra otro). Las tarjetas de rechazo de `docs/testing-data/kushki.md` §1 rechazan con su código, medido el 24 de octubre de 2026: 4349 0012 1084 6432 sin fondos (`021`), 4349 0013 8678 1322 bloqueada (`023`), y las demás de la tabla (punto 122) | Llega a la página real «Kushki Bank» y vuelve a la tienda, pero queda pendiente (`initializedTransaction`): UAT no cierra las transferencias |
| Rapyd | En su página: 4111 1111 1111 1111, 12/30, CVV 123, y el código `123456` en su simulador de 3DS | Solo cobra con 9 de sus bancos, que son los que lista la tienda; «Rapyd Bank Payment Simulation» con Success |

En el simulador, la tarjeta aprobada y el PSE con el banco 1 siguen los escenarios de `simulator-api`.

**Límites medidos**, que la tienda muestra tal cual:

- **La tarjeta de Kushki no tiene consulta de estado** en Colombia: «Consultar el estado» responde 502 y la orden conserva el estado con que nació. El SDK responde igual (`UNSUPPORTED_OPERATION`).
- **UAT de Kushki es lento:** la lista de bancos tardó 10,9 s y el inicio de la transferencia, entre 12 y 18 s.
- **El rechazo de Rapyd con tarjeta no llega a la tienda con su motivo.** Su página alojada muestra el error ahí mismo («Error processing card…»), deja reintentar y no devuelve al comprador; el checkout sigue en `NEW` (medido el 24 de octubre de 2026 con la tarjeta 4111 1111 1111 1151, punto 122).
- **El rechazo de Kushki al tokenizar** (la tarjeta «Declinada en Token») se queda en el formulario, porque todavía no hay orden.

Los precios del catálogo esquivan los montos que el simulador reserva para escenarios de fallo.

## La traza: lo que pasa por debajo

Para ver, o mostrar, qué hace la tienda por debajo (punto 112 del `architecture-log.md`):

- **En la terminal de `npm start`, A y B**, con `[checkout]`, muestran cada petición que llega del navegador o de la pasarela, y cada llamada que sale hacia la pasarela, con el método, la ruta, el código HTTP, el estado nativo y el tiempo. Lo hace `src/trace.ts`, del esqueleto, envolviendo `fetch`: ve las llamadas del módulo de pagos sin tocarlo.
- **Las vitrinas de A y B agregan**, en la misma terminal, la orden (qué se paga y con qué medio) y cada cambio de estado (creación, consulta o webhook). En la consola del navegador (F12), con `[tienda A]` o `[tienda B]`, muestran las llamadas de la página y la tokenización, que va del navegador directo a la pasarela.
- **Nunca se registran** cabeceras, cuerpos, la query, los datos del pagador o de la tarjeta, ni una llave completa (quedan los prefijos, como `pub_test_…`).

Un PSE de A contra el sandbox de Wompi se ve así (abreviado):

```
[checkout] navegador → tienda  POST /api/orders
[checkout]   orden ORD-4D67DA45: La Candelaria Cómics · 1 cómic por $68.000 COP, por PSE (banco 1) → módulo de pagos
[checkout]   tienda → pasarela  GET sandbox.wompi.co/v1/merchants/pub_test_… → 200 · 163 ms
[checkout]   tienda → pasarela  POST sandbox.wompi.co/v1/transactions → 201 · estado PENDING · 573 ms
[checkout]   tienda → pasarela  GET sandbox.wompi.co/v1/transactions/12066420-1792439469-43793 → 200 · estado APPROVED · 271 ms
[checkout]   orden ORD-4D67DA45 ← creación: APPROVED (nativo APPROVED), transacción 12066420-1792439469-43793
[checkout] navegador ← tienda  POST /api/orders → 201 · 2502 ms
```

## Lo que un comercio real agrega

Los cuatro prototipos cobran de verdad en los sandboxes, pero no son comercios completos. Hay dos cosas que un comercio necesita y que el SDK no puede hacer por él (punto 114). Están, con lo medido, en la [guía de implementación](../docs/03-sdk/4-guia-de-implementacion.md) §9.

- **El monto lo decide el servidor.**
  - En A, B y D, el servidor cobra con los precios de su catálogo. Una prueba de A y otra de D mandan un precio desde el navegador y comprueban que se ignora.
  - C no tiene servidor del comercio, así que el monto lo decide la página.
- **La página de la tarjeta lleva Content-Security-Policy.** Ninguno de los cuatro servidores la manda, por decisión de Joan del 19 de octubre de 2026.

Lo que costaría ponérsela a cada uno. El detalle está en el punto 114.

| Prototipo | Dónde iría | Qué hay que resolver |
|---|---|---|
| A | En el esqueleto (`server.ts` o `app.ts`), igual en A y B por la paridad | Pasar a un archivo el `<style>` en línea de `src/views/pages.ts`, o permitirlo con su hash. Los hosts de tokenización de Wompi, Mercado Pago y Kushki salen del `publicConfig().baseUrl` de cada módulo, sin nombrarlos |
| B | La misma cabecera del esqueleto | Su propio `<style>` en línea. El host de tokenización lo decide el SDK y no está en `publicConfig()`: habría que exponerlo desde el módulo de Andrés, y eso cuenta en las variables del experimento |
| C | En `server.mjs`, al servir el HTML | El hash del import map, calculado al arrancar desde `dist/index.html`. Los hosts de tokenización no se pueden escribir en `server.mjs`, porque `no-gateway-names.test.ts` lo prohíbe: tendría que darlos la API o un argumento |
| D | En `src/app.ts`, al servir `index.html` | Nada en línea: el script y los estilos son archivos. Los hosts de `connect-src` son los `tokenizationUrl` de `src/config.ts` |

## Pruebas

```bash
npm run typecheck
npm test -- --coverage
../check-skeleton-parity.sh
```

El umbral de cobertura es 80 %, como en el SDK y el simulador. Las pruebas del esqueleto usan un módulo de pagos falso (`test/helpers/fakePayments.ts`).
