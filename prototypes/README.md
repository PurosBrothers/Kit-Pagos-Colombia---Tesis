# Prototipos del experimento de la Fase 5

Dos implementaciones del mismo checkout mínimo de comercio electrónico: mostrar un producto, cobrarlo con tarjeta o PSE, informar el resultado, recibir la notificación asíncrona y consultar el estado. El diseño del experimento está en [`docs/project-management/prototypes-evaluation-plan.md`](../docs/project-management/prototypes-evaluation-plan.md), y cómo se mide, en [`docs/04-metricas-y-pruebas/4-medir-los-prototipos.md`](../docs/04-metricas-y-pruebas/4-medir-los-prototipos.md).

| Carpeta | Prototipo | Cómo cobra |
|---|---|---|
| `checkout-directo/` | A, control | `fetch` contra la API nativa de la pasarela, siguiendo su documentación oficial |
| `checkout-con-sdk/` | B, tratamiento | `kit-pagos-colombia` en el servidor y `kit-pagos-colombia/browser` en la página |
| `checkout-frontend-rest/` | C, fuera del experimento A/B | Desde el navegador contra `/v1/api`, sin servidor de pagos propio. Se documenta en [`docs/05-ejemplos/checkout-frontend-rest.md`](../docs/05-ejemplos/checkout-frontend-rest.md) |
| `checkout-con-sdk-solo-back/` | Prototipo de Backend | `kit-pagos-colombia` exclusivamente en el servidor (Fastify) y tokenización nativa en frontend sin SDK de navegador (tienda de Hierbas de Mate con las 4 pasarelas) |

C no comparte el esqueleto de A y B, y `check-skeleton-parity.sh` no lo compara: es una página estática con Vite, servida por `server.mjs`, que demuestra el patrón de integración 2 (punto 91 del `architecture-log.md`).

## La regla: solo cambia el módulo de pagos

Todo lo que no es integración de pagos es idéntico en los dos prototipos, y queda fuera del conteo de líneas. El módulo de pagos es lo único que cada prototipo escribe:

- `src/payments/index.ts`: `createPayments()`, que devuelve la implementación de `PaymentsPort`.
- `src/payments/browser/client.js`: `tokenizeCard()`, que corre en el navegador. El número de la tarjeta va del navegador a la pasarela y nunca pasa por el servidor del comercio.
- `test/payments/`: sus pruebas, con el mismo esfuerzo en los dos (variable 6).

Lo demás es el esqueleto común: el servidor Fastify, las páginas, las órdenes en memoria, las rutas y el contrato `src/checkout/PaymentsPort.ts`. No se modifica desde ningún prototipo. `check-skeleton-parity.sh` lo comprueba en la CI: compara las dos carpetas sin `payments/` y falla si el módulo de pagos de A usa el SDK.

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

## Correrlo contra el simulador

Con la API de Simulación corriendo en `localhost:3000` (`simulator-api`, `npm run dev`):

```bash
cd prototypes/checkout-directo   # o checkout-con-sdk
npm ci
npm run dev                      # http://localhost:4000
```

Para que el simulador mande los webhooks al checkout, arranque `simulator-api` con `SIMULATOR_WEBHOOK_TARGET_URL=http://localhost:4000/webhooks` y `SIMULATOR_WEBHOOK_AUTO=true` (sección 4.2 de [`3-api-de-simulacion.md`](../docs/02-arquitectura/3-api-de-simulacion.md)). Si corren los dos prototipos a la vez, el segundo necesita otro `PORT`, y el destino de los webhooks es uno solo.

| Variable | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4000` | El puerto del checkout |
| `PUBLIC_BASE_URL` | `http://localhost:<PORT>` | El origen público, para la URL de retorno del banco |

La configuración de la pasarela, como las llaves y la URL base, la lee el módulo de pagos de cada prototipo.

## Pruebas

```bash
npm run typecheck
npm test -- --coverage
../check-skeleton-parity.sh
```

El umbral de cobertura es 80 %, como en el SDK y el simulador. Las pruebas del esqueleto usan un módulo de pagos falso (`test/helpers/fakePayments.ts`).
