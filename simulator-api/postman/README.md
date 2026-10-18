# Colección de Postman — API de Simulación

Colección y ambientes versionados de la API de Simulación de Kit Pagos Colombia (issue #131).

## Archivos

- `kit-pagos-simulator.postman_collection.json`: 42 peticiones en 7 carpetas.
  1. `00. Diagnóstico`: `GET /health`.
  2. `01. Capa REST Kit Pagos (/v1/api)`: `gateways`, `payments`, `payments/:id` y `pse-banks`.
  3. `02` a `05`: las rutas `/v1/sim` de Wompi, Mercado Pago, Rapyd y Kushki. La carpeta `03`
     recorre los dos caminos de tarjeta de Mercado Pago: `POST /payments`, que usa el SDK 0.5.0, y
     el del SDK 0.6.0, que lee el BIN del token (`GET /card_tokens/:id`), busca la marca
     (`GET /payment_methods/search`) y crea la orden por `POST /orders`, aprobada con el titular
     `APRO` y rechazada con `OTHE`.
  4. `06. Webhooks`: `POST /v1/sim/webhooks/trigger` y `POST /v1/api/webhooks/:gateway`.
- `local.postman_environment.json`: `http://localhost:3000`.
- `render.postman_environment.json`: `https://kit-pagos-colombia.onrender.com`.

## Cómo funciona

- **Orden.** Las carpetas se corren en orden. Cada creación guarda su id en el ambiente
  (`wompiTransactionId`, `mpPaymentId`, `mpCardToken`, `mpCardBin`, `mpCardBrand`, `mpCardType`, `mpOrderId`, `mpBankPaymentId`, `rapydCheckoutId`, `kushkiTransferToken`…) y la consulta
  siguiente lo usa. El trigger de webhooks firma la transacción de Wompi de la carpeta `02`, y
  `POST /v1/api/webhooks/wompi` verifica ese mismo webhook.
- **Firmas.** El simulador exige firma, como las pasarelas reales (punto 86 del `architecture-log.md`):
  - Wompi: `POST /transactions` calcula `signature` en su pre-request, con la fórmula de
    `sdk/src/infrastructure/adapters/wompi-pse.ts`.
  - Rapyd: la carpeta `04` calcula `salt`, `timestamp` y `signature` en su pre-request, con la
    fórmula de `sdk/src/infrastructure/adapters/rapyd-signature.ts`. Las páginas `/checkout/:id/pay` y
    `/complete-bank-payment` no llevan firma.
- **Pruebas.** Cada petición comprueba que responde 2xx, salvo la orden de tarjeta con el titular
  `OTHE`, que comprueba el `402` medido: la orden `failed` en `data` y el motivo
  `rejected_by_issuer` en el pago. Las del camino de la 0.6.0 comprueban además el BIN, la marca y
  el estado de la orden aprobada. El trigger tiene su propia prueba: sin
  `SIMULATOR_WEBHOOK_TARGET_URL` responde `409 WEBHOOK_TARGET_NOT_CONFIGURED` con el webhook firmado,
  y eso cuenta como éxito. `POST /v1/api/webhooks/wompi` exige `200`; si el trigger no devolvió un
  webhook firmado (el servidor no tiene el secreto de eventos), su prueba se omite. Si alguna prueba
  falla, Newman sale con un código distinto de 0.

## Credenciales

La colección no trae credenciales. Las variables sensibles son `apiAuthToken`,
`wompiIntegritySecret` y `rapydSecretKey`:

- En `local`, los dos secretos traen los valores por omisión del simulador
  (`test_integrity_kit_pagos_simulator` y `rapyd_secret_kit_pagos_simulator`). Son públicos y están
  en `simulator-api/src/auth/merchantSecrets.ts`.
- En `render`, las tres están vacías y son de tipo `secret`. Se pasan al correr la colección.

> [!IMPORTANT]
> Si el simulador local corre con un `.env` que trae `WOMPI_INTEGRITY_SECRET` o
> `RAPYD_API_SECRET_KEY`, firma con esos valores y no con los de omisión. Hay que poner esos mismos
> valores en `wompiIntegritySecret` y `rapydSecretKey`, igual que hace `examples/simulator-secrets.ts`.
> Si no, Wompi responde `422 La firma es inválida` y Rapyd `401 UNAUTHENTICATED_API_CALL`.

## Correr con Newman

Contra el servidor local:

```bash
npx newman run simulator-api/postman/kit-pagos-simulator.postman_collection.json \
  -e simulator-api/postman/local.postman_environment.json
```

Contra Render, con los secretos del servicio pasados al correr (nunca escritos en el repo):

```bash
npx newman run simulator-api/postman/kit-pagos-simulator.postman_collection.json \
  -e simulator-api/postman/render.postman_environment.json \
  --env-var "apiAuthToken=<token de Render>" \
  --env-var "wompiIntegritySecret=<secreto de Render>" \
  --env-var "rapydSecretKey=<secreto de Render>"
```

Si Render no tiene configurados esos secretos, deje fuera las dos últimas `--env-var`: el simulador
usa sus valores por omisión, y los scripts también.
