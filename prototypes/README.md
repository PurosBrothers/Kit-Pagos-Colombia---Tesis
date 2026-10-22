# Prototipos del experimento de la Fase 5

Dos implementaciones del mismo checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo con tarjeta o PSE, informar el resultado, recibir la notificación asíncrona y consultar el estado. El diseño del experimento está en [`docs/project-management/prototypes-evaluation-plan.md`](../docs/project-management/prototypes-evaluation-plan.md), y cómo se mide, en [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../docs/04-metricas-y-pruebas/4-medir-los-prototipos.md).

| Carpeta | Prototipo | Cómo cobra |
|---|---|---|
| `checkout-sin-solucion/` | A, control | `fetch` contra la API nativa de cada una de las cuatro pasarelas (Wompi, Mercado Pago, Kushki y Rapyd), siguiendo su documentación oficial. Se presenta como «La Candelaria Cómics», una tienda de cómics con catálogo y carrito |
| `checkout-con-sdk-front-back/` | B, tratamiento | Las mismas cuatro con `kit-pagos-colombia` (0.7.0-rc.1) en el servidor y `kit-pagos-colombia/browser` en la página. Se presenta como «La Bodega de Chapinero», una tienda de vinos con catálogo y carrito |
| `checkout-frontend-rest/` | C, fuera del experimento A/B | Desde el navegador contra `/v1/api`, sin servidor de pagos propio. Se documenta en [`docs/05-ejemplos/checkout-frontend-rest.md`](../docs/05-ejemplos/checkout-frontend-rest.md) |

C no comparte el esqueleto de A y B, y `check-skeleton-parity.sh` no lo compara: es una página estática con Vite, servida por `server.mjs`, que demuestra el patrón de integración 2 (punto 91 del `architecture-log.md`).

> **Límite declarado: los prototipos no son plantillas para producción.**
>
> - **Ninguno de los tres manda Content-Security-Policy** en la página donde se escribe la tarjeta. Un script malicioso en esa página podría leer el número y mandarlo a otro dominio.
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
| 3. Distinguir un rechazo de un fallo técnico, y reintentar solo el segundo | Un rechazo vuelve como `DECLINED`. Un fallo técnico se reintenta dentro del módulo y, si persiste, sale como `PaymentTechnicalError` |
| 4. Verificar la firma de un webhook y actualizar la orden | `verifyWebhook()` verifica; el esqueleto actualiza la orden |
| 5. Consultar el estado por el identificador | `getPaymentStatus()` |
| 6. Registrar el estado nativo para auditoría | El `nativeStatus` de cada respuesta; el esqueleto lo guarda en el historial de la orden |

El contrato sirve a las cuatro pasarelas a la vez (punto 117 del `architecture-log.md`):

- **La pasarela es un parámetro** de cada operación.
- **`listGateways()`** dice cuáles están disponibles, con su nombre para el comprador y cómo recibe la tarjeta: `BROWSER_TOKEN` (Wompi, Mercado Pago y Kushki) o `HOSTED_PAGE` (Rapyd).
- **El esqueleto** guarda la pasarela en la orden, sirve `GET /api/gateways` y recibe los webhooks en `/webhooks/<pasarela>`.

El monto llega en pesos enteros: convertirlo a la unidad de la pasarela es trabajo del módulo. `verifyWebhook()` recibe el cuerpo tal como llegó por la red, las cabeceras y la query, porque Mercado Pago firma con el `data.id` de la URL.

La notificación puede traer la referencia de la orden. El esqueleto la busca así cuando no la encuentra por el id de la transacción, porque la tarjeta de Rapyd se crea como checkout y su webhook trae el id del pago (punto 118). Un `PENDING` que llega cuando la orden ya está aprobada o rechazada queda en el historial sin cambiar el estado, porque las pasarelas no garantizan el orden de sus avisos.

## Cómo correrlos

Por omisión, `npm start` cobra en el sandbox oficial de cada pasarela, como el prototipo C (punto 104), sin encender nada en la máquina:

```bash
cd prototypes/checkout-sin-solucion   # o checkout-con-sdk-front-back
npm ci
npm start                             # http://localhost:4000
```

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
| Mercado Pago | `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY` | `MERCADOPAGO_WEBHOOK_SECRET` |
| Kushki | `KUSHKI_PUBLIC_MERCHANT_ID`, `KUSHKI_PRIVATE_MERCHANT_ID` | `KUSHKI_WEBHOOK_SECRET` |
| Rapyd | `RAPYD_API_ACCESS_KEY`, `RAPYD_API_SECRET_KEY` | `RAPYD_WEBHOOK_URL`, la URL exacta registrada en el panel, porque Rapyd la firma |

**La tarjeta de B contra el simulador de Render no tokeniza.** El SDK de navegador tokeniza en `simulator` siempre contra `localhost:3000`, porque su catálogo de hosts es cerrado para que la tarjeta no pueda ir a otro lado (punto 77). Con Render, la página responde «Error de conexión al tokenizar tarjeta». El PSE sí funciona, y la tarjeta de Rapyd también, porque no tokeniza. La tarjeta en el simulador se prueba con `npm run start:local`. En A no pasa, porque cada módulo arma a mano la URL de su tokenización.

| Variable | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4000` | El puerto del checkout |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | El origen público, para la URL de retorno del banco |
| `CHECKOUT_ENVIRONMENT` | `sandbox` | `sandbox` o `simulator` |
| `CHECKOUT_SIMULATOR_URL` | `https://kit-pagos-colombia.onrender.com` | El origen de la API de Simulación, con `simulator` |

**Los webhooks (función 4)** llegan a `/webhooks/<pasarela>`.

- **En el sandbox**, cada pasarela notifica a la URL registrada en su panel, que no puede ser `localhost`: hace falta un túnel. Sin él, la orden se resuelve con la consulta de su página.
- **Con el simulador local**, el webhook llega solo. Basta con arrancar `simulator-api` con `SIMULATOR_WEBHOOK_TARGET_URL=http://localhost:4000/webhooks/{gateway}` y `SIMULATOR_WEBHOOK_AUTO=true` (sección 4.2 de [`3-api-de-simulacion.md`](../docs/02-arquitectura/3-api-de-simulacion.md)). El simulador, A y B tienen que leer los mismos secretos de webhook. El simulador emite solo cuando un pago cambia de estado; uno que nace resuelto se notifica con `POST /v1/sim/webhooks/trigger`. La tarjeta de Rapyd pagada en su página llega con la misma secuencia del sandbox: dos avisos en `ACT` y después `PAYMENT_COMPLETED`.
- **Si corren los dos prototipos a la vez**, el segundo necesita otro `PORT`, y el destino de los webhooks del simulador es uno solo.

**Para probar en el día a día no hace falta túnel.**

- El simulador local firma cada aviso como la pasarela real, con lo que se midió en los sandboxes, incluida la secuencia de Rapyd.
- Las pruebas de los módulos verifican firmas con cuerpos de la documentación de cada pasarela y de lo medido, sin red ni llaves.
- Contra el sandbox, la orden se resuelve con la consulta aunque no llegue el webhook.

Un webhook real solo hace falta para volver a medir, si una pasarela cambia su forma de notificar o se agrega una. Ese día se registra en su panel la URL de un túnel, que en Rapyd tiene que ser también `RAPYD_WEBHOOK_URL`, porque Rapyd la firma.

Lo medido contra los sandboxes el 21 de octubre de 2026 está en el punto 118. Rapyd y Wompi verifican y actualizan la orden. Las notificaciones reales del modo de pruebas de Mercado Pago no verifican con la clave del panel, y la simulada desde el panel sí. Kushki quedó sin medir, porque no hubo acceso a su consola de UAT, y se declara como límite del experimento; su firma se prueba con el simulador.

**Los datos de prueba**, medidos entre el 19 y el 21 de octubre de 2026 en los dos prototipos:

| Pasarela | Tarjeta | PSE |
|---|---|---|
| Wompi | 4242 4242 4242 4242 se aprueba y 4111 1111 1111 1111 se rechaza | El banco 1 aprueba, el 2 rechaza y el 3 da `ERROR`, que cuenta como rechazo. En el sandbox se resuelve en la primera consulta, sin página de banco |
| Mercado Pago | 4013 5406 8274 6260, 11/30, titular `APRO Ruiz` | «Banco Prueba PSE», con cualquier usuario y «APROBAR PAGO». Exige una `callback_url` que no sea `localhost` (`PUBLIC_BASE_URL` de un túnel), y el sandbox tiene ventanas en que la orden nace sin URL del banco y termina en `processing_error` (punto 113) |
| Kushki | 4242 4242 4242 4242. El token queda atado al monto (`K220` si se cobra otro) | Llega a la página real «Kushki Bank» y vuelve a la tienda, pero queda pendiente (`initializedTransaction`): UAT no cierra las transferencias |
| Rapyd | En su página: 4111 1111 1111 1111, 12/30, CVV 123, y el código `123456` en su simulador de 3DS | Solo cobra con 9 de sus bancos, que son los que lista la tienda; «Rapyd Bank Payment Simulation» con Success |

En el simulador, la tarjeta aprobada y el PSE con el banco 1 siguen los escenarios de `simulator-api`.

**Límites medidos**, que la tienda muestra tal cual:

- **La tarjeta de Kushki no tiene consulta de estado** en Colombia: «Consultar el estado» responde 502 y la orden conserva el estado con que nació. El SDK responde igual (`UNSUPPORTED_OPERATION`).
- **UAT de Kushki es lento:** la lista de bancos tardó 10,9 s y el inicio de la transferencia, entre 12 y 18 s.

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

Los tres prototipos cobran de verdad en los sandboxes, pero no son comercios completos. Hay dos cosas que un comercio necesita y que el SDK no puede hacer por él (punto 114). Están, con lo medido, en la [guía de implementación](../docs/03-sdk/4-guia-de-implementacion.md) §9.

- **El monto lo decide el servidor.**
  - En A y en B, el servidor cobra con los precios de su catálogo. Una prueba de A manda un precio desde el navegador y comprueba que se ignora.
  - C no tiene servidor del comercio, así que el monto lo decide la página.
- **La página de la tarjeta lleva Content-Security-Policy.** Ninguno de los tres servidores la manda, por decisión de Joan del 19 de octubre de 2026.

Lo que costaría ponérsela a cada uno. El detalle está en el punto 114.

| Prototipo | Dónde iría | Qué hay que resolver |
|---|---|---|
| A | En el esqueleto (`server.ts` o `app.ts`), igual en A y B por la paridad | Pasar a un archivo el `<style>` en línea de `src/views/pages.ts`, o permitirlo con su hash. Los hosts de tokenización de Wompi, Mercado Pago y Kushki salen del `publicConfig().baseUrl` de cada módulo, sin nombrarlos |
| B | La misma cabecera del esqueleto | Su propio `<style>` en línea. El host de tokenización lo decide el SDK y no está en `publicConfig()`: habría que exponerlo desde el módulo de Andrés, y eso cuenta en las variables del experimento |
| C | En `server.mjs`, al servir el HTML | El hash del import map, calculado al arrancar desde `dist/index.html`. Los hosts de tokenización no se pueden escribir en `server.mjs`, porque `no-gateway-names.test.ts` lo prohíbe: tendría que darlos la API o un argumento |

## Pruebas

```bash
npm run typecheck
npm test -- --coverage
../check-skeleton-parity.sh
```

El umbral de cobertura es 80 %, como en el SDK y el simulador. Las pruebas del esqueleto usan un módulo de pagos falso (`test/helpers/fakePayments.ts`).
