# Prototipos del experimento de la Fase 5

Dos implementaciones del mismo checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo con tarjeta o PSE, informar el resultado, recibir la notificación asíncrona y consultar el estado. El diseño del experimento está en [`docs/project-management/prototypes-evaluation-plan.md`](../docs/project-management/prototypes-evaluation-plan.md), y cómo se mide, en [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../docs/04-metricas-y-pruebas/4-medir-los-prototipos.md).

| Carpeta | Prototipo | Cómo cobra |
|---|---|---|
| `checkout-directo/` | A, control | `fetch` contra la API nativa de la pasarela, siguiendo su documentación oficial. Se presenta como «La Candelaria Cómics», una tienda de cómics con catálogo y carrito |
| `checkout-con-sdk/` | B, tratamiento | `kit-pagos-colombia` en el servidor y `kit-pagos-colombia/browser` en la página |
| `checkout-frontend-rest/` | C, fuera del experimento A/B | Desde el navegador contra `/v1/api`, sin servidor de pagos propio. Se documenta en [`docs/05-ejemplos/checkout-frontend-rest.md`](../docs/05-ejemplos/checkout-frontend-rest.md) |

C no comparte el esqueleto de A y B, y `check-skeleton-parity.sh` no lo compara: es una página estática con Vite, servida por `server.mjs`, que demuestra el patrón de integración 2 (punto 91 del `architecture-log.md`).

## La regla: solo cambia el módulo de pagos

Todo lo que no es integración de pagos es idéntico en los dos prototipos, y queda fuera del conteo de líneas. El módulo de pagos es lo único que cada prototipo escribe:

- `src/payments/index.ts`: `createPayments()`, que devuelve la implementación de `PaymentsPort`.
- `src/payments/browser/client.js`: `tokenizeCard()`, que corre en el navegador. El número de la tarjeta va del navegador a la pasarela y nunca pasa por el servidor del comercio.
- `test/payments/`: sus pruebas, con el mismo esfuerzo en los dos (variable 6).

Lo demás es el esqueleto común: el servidor Fastify, las páginas, las órdenes en memoria, las rutas y el contrato `src/checkout/PaymentsPort.ts`. No se modifica desde ningún prototipo. `check-skeleton-parity.sh` lo comprueba en la CI: compara las dos carpetas sin `payments/` y falla si el módulo de pagos de A usa el SDK.

**Excepción: la vitrina de A** (punto 110 del `architecture-log.md`). Desde el 19 de octubre de 2026, A se presenta como «La Candelaria Cómics», con tres cómics, un carrito y una página de resultado para el comprador, y B conserva la página de un producto. Difieren y quedan fuera de la comparación:

- `src/views/`, `src/public/` y `src/orders/`;
- `src/catalog.ts`, `src/routes/api.ts` y `src/routes/pages.ts`;
- las pruebas `checkout.test.ts`, `orders-and-config.test.ts` y `catalog.test.ts`.

El servidor, el contrato, los webhooks, la configuración y las dependencias se siguen comparando. La vitrina no está en `src/payments/`, así que no entra en el conteo de líneas.

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
| `npm start` | El sandbox oficial de la pasarela | Probar contra lo real. Las llaves salen del `.env` de la raíz; sin ellas, A se detiene al arrancar y dice cuáles faltan |
| `npm start -- --environment=simulator` | La API de Simulación de Render | Los escenarios del simulador sin encender nada. La primera consulta puede tardar mientras Render despierta |
| `npm run start:local` | Una API de Simulación en `localhost:3000` (`simulator-api`, `npm run dev`) | Trabajar con el simulador de la máquina |
| `npm run dev` | Lo mismo que `start:local`, recompilando al guardar | Desarrollo |

El esqueleto lee el `.env` de la raíz, el mismo de la API de Simulación (una variable del entorno gana sobre el archivo), y el ambiente: `--environment=sandbox|simulator`, `--simulator-url=…` y `--port=…`, o sus variables. No nombra ninguna pasarela: cada módulo de pagos traduce el ambiente a sus URLs (punto 111 del `architecture-log.md`). En A, el sandbox es `https://sandbox.wompi.co/v1` y el simulador, sus rutas `/v1/sim/wompi`; `WOMPI_BASE_URL` gana sobre los dos. El módulo de B que construye el #151 tiene que leer el mismo ambiente (`src/checkout/environment.ts`).

| Variable | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4000` | El puerto del checkout |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | El origen público, para la URL de retorno del banco |
| `CHECKOUT_ENVIRONMENT` | `sandbox` | `sandbox` o `simulator` |
| `CHECKOUT_SIMULATOR_URL` | `https://kit-pagos-colombia.onrender.com` | El origen de la API de Simulación, con `simulator` |

**Los webhooks (función 4).** En el sandbox, Wompi manda los eventos a la URL configurada en su panel, que no puede ser `localhost`, y lo mismo pasa con el simulador de Render: la orden se resuelve con la consulta. Con el simulador local el webhook sí llega. Basta con arrancar `simulator-api` con `SIMULATOR_WEBHOOK_TARGET_URL=http://localhost:4000/webhooks` y `SIMULATOR_WEBHOOK_AUTO=true` (sección 4.2 de [`3-api-de-simulacion.md`](../docs/02-arquitectura/3-api-de-simulacion.md)), porque el simulador y A leen del mismo `.env` el secreto de eventos (`WOMPI_EVENTS_SECRET`). Si corren los dos prototipos a la vez, el segundo necesita otro `PORT`, y el destino de los webhooks es uno solo.

**Los datos de prueba de A**, medidos el 19 de octubre de 2026 en el sandbox de Wompi y en el simulador local (en el de Render, la tarjeta aprobada):

- la tarjeta 4242 4242 4242 4242 se aprueba y la 4111 1111 1111 1111 se rechaza;
- en PSE, el banco 1 aprueba, el 2 rechaza y el 3 da `ERROR`, que A traduce a rechazo;
- en el sandbox, el PSE se resuelve en la primera consulta, sin página de banco.

Los precios del catálogo esquivan los montos que el simulador reserva para escenarios de fallo.

## Pruebas

```bash
npm run typecheck
npm test -- --coverage
../check-skeleton-parity.sh
```

El umbral de cobertura es 80 %, como en el SDK y el simulador. Las pruebas del esqueleto usan un módulo de pagos falso (`test/helpers/fakePayments.ts`).
