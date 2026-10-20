# Prototipos del experimento de la Fase 5

Dos implementaciones del mismo checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo con tarjeta o PSE, informar el resultado, recibir la notificación asíncrona y consultar el estado. El diseño del experimento está en [`docs/project-management/prototypes-evaluation-plan.md`](../docs/project-management/prototypes-evaluation-plan.md), y cómo se mide, en [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../docs/04-metricas-y-pruebas/4-medir-los-prototipos.md).

| Carpeta | Prototipo | Cómo cobra |
|---|---|---|
| `checkout-directo/` | A, control | `fetch` contra la API nativa de la pasarela, siguiendo su documentación oficial. Se presenta como «La Candelaria Cómics», una tienda de cómics con catálogo y carrito |
| `checkout-con-sdk/` | B, tratamiento | `kit-pagos-colombia` en el servidor y `kit-pagos-colombia/browser` en la página. Se presenta como «La Bodega de Chapinero», una tienda de vinos con catálogo y carrito |
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

- `src/payments/index.ts`: `createPayments()`, que devuelve la implementación de `PaymentsPort`.
- `src/payments/browser/client.js`: `tokenizeCard()`, que corre en el navegador. El número de la tarjeta va del navegador a la pasarela y nunca pasa por el servidor del comercio.
- `test/payments/`: sus pruebas, con el mismo esfuerzo en los dos (variable 6).

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

El monto llega en pesos enteros: convertirlo a la unidad de la pasarela es trabajo del módulo. `verifyWebhook()` recibe el cuerpo tal como llegó por la red, las cabeceras y la query, porque Mercado Pago firma con el `data.id` de la URL. El contrato tiene que servir sin cambios para la migración a Mercado Pago (issue #133).

## Cómo correrlos

Por omisión, `npm start` cobra en el sandbox oficial de la pasarela, como el prototipo C (punto 104), sin encender nada en la máquina:

```bash
cd prototypes/checkout-directo   # o checkout-con-sdk
npm ci
npm start                        # http://localhost:4000
```

| Comando | Dónde cobra | Para qué sirve |
|---|---|---|
| `npm start` | El sandbox oficial de la pasarela | Probar contra lo real. Las llaves salen del `.env` de la raíz; sin ellas, A y B se detienen al arrancar y dicen cuáles faltan |
| `npm start -- --environment=simulator` | La API de Simulación de Render | Los escenarios del simulador sin encender nada. La primera consulta puede tardar mientras Render despierta. En B, solo PSE: la tarjeta no tokeniza (ver abajo) |
| `npm run start:local` | Una API de Simulación en `localhost:3000` (`simulator-api`, `npm run dev`) | Trabajar con el simulador de la máquina |
| `npm run dev` | Lo mismo que `start:local`, recompilando al guardar | Desarrollo |

El esqueleto lee el `.env` de la raíz, el mismo de la API de Simulación (una variable del entorno gana sobre el archivo), y el ambiente: `--environment=sandbox|simulator`, `--simulator-url=…` y `--port=…`, o sus variables. No nombra ninguna pasarela: cada módulo de pagos traduce el ambiente a sus URLs (punto 111 del `architecture-log.md`). En A, el sandbox es `https://sandbox.wompi.co/v1` y el simulador, sus rutas `/v1/sim/wompi`; `WOMPI_BASE_URL` gana sobre los dos. En B, el módulo le pasa el ambiente al SDK (punto 116):

- con `sandbox`, el SDK toma la URL de su catálogo;
- con `simulator`, el módulo usa la URL del esqueleto con `/v1/sim/wompi`;
- `WOMPI_BASE_URL` gana sobre los dos, y cuenta como simulador.

**La tarjeta de B contra el simulador de Render no tokeniza.** El SDK de navegador tokeniza en `simulator` siempre contra `localhost:3000`, porque su catálogo de hosts es cerrado para que la tarjeta no pueda ir a otro lado (punto 77). Con Render, la página responde «Error de conexión al tokenizar tarjeta», y el PSE sí funciona. La tarjeta en el simulador se prueba con `npm run start:local`. En A no pasa, porque el módulo de David arma la URL de la tokenización a mano.

| Variable | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4000` | El puerto del checkout |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | El origen público, para la URL de retorno del banco |
| `CHECKOUT_ENVIRONMENT` | `sandbox` | `sandbox` o `simulator` |
| `CHECKOUT_SIMULATOR_URL` | `https://kit-pagos-colombia.onrender.com` | El origen de la API de Simulación, con `simulator` |

**Los webhooks (función 4).** En el sandbox, Wompi manda los eventos a la URL configurada en su panel, que no puede ser `localhost`, y lo mismo pasa con el simulador de Render: la orden se resuelve con la consulta. Con el simulador local el webhook sí llega. Basta con arrancar `simulator-api` con `SIMULATOR_WEBHOOK_TARGET_URL=http://localhost:4000/webhooks` y `SIMULATOR_WEBHOOK_AUTO=true` (sección 4.2 de [`3-api-de-simulacion.md`](../docs/02-arquitectura/3-api-de-simulacion.md)), porque el simulador, A y B leen del mismo `.env` el secreto de eventos (`WOMPI_EVENTS_SECRET`). Si corren los dos prototipos a la vez, el segundo necesita otro `PORT`, y el destino de los webhooks es uno solo.

**Los datos de prueba**, medidos el 19 de octubre de 2026:

- **A**, en el sandbox de Wompi y en el simulador local (en el de Render, la tarjeta aprobada):
  - la tarjeta 4242 4242 4242 4242 se aprueba y la 4111 1111 1111 1111 se rechaza;
  - en PSE, el banco 1 aprueba, el 2 rechaza y el 3 da `ERROR`, que A traduce a rechazo;
  - en el sandbox, el PSE se resuelve en la primera consulta, sin página de banco.
- **B**, en el sandbox de Wompi:
  - la 4242 se aprueba y la 4111 se rechaza;
  - el PSE con el banco 1 sale aprobado desde la creación.

  En el simulador de Render, el PSE con el banco 1 pasa por la página de banco del simulador y la consulta lo aprueba.

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
| A | En el esqueleto (`server.ts` o `app.ts`), igual en A y B por la paridad | Pasar a un archivo el `<style>` en línea de `src/views/pages.ts`, o permitirlo con su hash. El host de Wompi sale de `publicConfig().baseUrl` del módulo de David, sin nombrarlo |
| B | La misma cabecera del esqueleto | Su propio `<style>` en línea. El host de tokenización lo decide el SDK y no está en `publicConfig()`: habría que exponerlo desde el módulo de Andrés, y eso cuenta en las variables del experimento |
| C | En `server.mjs`, al servir el HTML | El hash del import map, calculado al arrancar desde `dist/index.html`. Los hosts de tokenización no se pueden escribir en `server.mjs`, porque `no-gateway-names.test.ts` lo prohíbe: tendría que darlos la API o un argumento |

## Pruebas

```bash
npm run typecheck
npm test -- --coverage
../check-skeleton-parity.sh
```

El umbral de cobertura es 80 %, como en el SDK y el simulador. Las pruebas del esqueleto usan un módulo de pagos falso (`test/helpers/fakePayments.ts`).
