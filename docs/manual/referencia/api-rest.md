# La API REST

La capa HTTP de Kit Pagos: los cinco endpoints de `/v1/api`, que exponen el SDK para cobrar, consultar, listar bancos PSE y verificar webhooks sin instalar el paquete ni escribir TypeScript.

Es el segundo componente del producto y vive en el mismo proceso que la API de Simulación, pero son superficies distintas: `/v1/api` es el producto, `/v1/sim` son pasarelas falsas para probar. Esta página documenta solo `/v1/api`.

**Dónde corre.** En local, `http://localhost:3000` (`npm run dev` dentro de `simulator-api/`). Desplegada, en [`https://kit-pagos-colombia.onrender.com`](https://kit-pagos-colombia.onrender.com).

**Especificación formal.** El servidor genera OpenAPI 3.0.3 al arrancar: Swagger UI en [`/docs`](https://kit-pagos-colombia.onrender.com/docs) y el JSON en `/docs/json`. Esa es la fuente para generar clientes; esta página explica lo que la especificación no dice.

---

## 1. Autenticación

| | |
|---|---|
| Cabecera | `Authorization: Bearer <token>` |
| De dónde sale el token | Variable de entorno `API_AUTH_TOKEN` del servidor (también acepta `SIMULATOR_API_AUTH_TOKEN`) |
| Comparación | En tiempo constante (`crypto.timingSafeEqual`) |

**Si el servidor no tiene `API_AUTH_TOKEN`, la capa REST opera abierta**, sin pedir cabecera, y avisa por el log al arrancar. Es el modo por omisión en desarrollo local y el que usa quien levanta el repositorio para probar. En un despliegue público, sin token, cualquiera con la URL puede intentar cobrar con las credenciales del servidor.

**Rutas exentas de token:** `/health` y todo `/v1/sim`. La excepción es `/v1/sim/webhooks/trigger`, que sí lo exige: dispara webhooks firmados con los secretos del servidor y abierto sería un oráculo de firma.

Un token ausente o incorrecto responde `401` con un cuerpo distinto al de los demás errores:

```json
{
  "error": "Unauthorized",
  "message": "Missing or malformed Authorization header. Expected 'Bearer <token>'."
}
```

---

## 2. A qué ambiente va la petición

El cliente declara el destino en la cabecera `x-kit-pagos-environment`.

| Valor | A dónde va |
|---|---|
| ausente o vacío | `simulator`: el `/v1/sim` del propio servidor. **Es el valor por omisión** |
| `sandbox` | El sandbox oficial de cada pasarela |
| `production` | El endpoint productivo oficial de cada pasarela |

Un valor distinto de esos tres responde `400 INVALID_REQUEST`. La cabecera no se nota en las respuestas, y olvidarla es la causa más común de «no me está cobrando contra el sandbox»: por omisión todo se queda en el simulador.

---

## 3. Credenciales de la pasarela

La API puede cobrar con las credenciales configuradas en el servidor o con las de quien la llama, que las manda por cabecera.

| Cabecera | Qué es | Cuándo |
|---|---|---|
| `x-gateway-public-key` | Llave pública o id de comercio | Junto con la siguiente, para usar credenciales propias |
| `x-gateway-private-key` | Llave privada, secret key o access token | Ídem |
| `x-gateway-integrity-secret` | Secreto de integridad | Solo Wompi, que no crea transacciones sin firma |

**Las reglas, en orden:**

1. **Si llegan la pública y la privada, mandan esas.** Se crea un cliente del SDK al vuelo con ellas.
2. **Si no llegan, se usan las del servidor** (`.env` o variables de entorno).
3. **Contra `production`, las del servidor no se prestan.** Si la petición no trae credenciales propias, responde `401` sin tocar la red: con las del servidor estaría cobrando en la cuenta de quien desplegó la API.
4. **Contra `sandbox`, las del servidor sí se prestan, pero con advertencia.** La respuesta trae la cabecera `x-kit-pagos-warning` y un arreglo `warnings` en el cuerpo, con el código `SERVER_SANDBOX_CREDENTIALS_USED` y la lista de lo que faltó.

**El secreto de webhook no se acepta por cabecera.** No existe `x-gateway-webhook-secret` en esta API, aunque el README del simulador la mencione: la verificación usa siempre el perfil del servidor. La razón es de seguridad: si el secreto viniera de quien envía la notificación, el emisor elegiría con qué se verifica su propia firma.

---

## 4. Los cinco endpoints

### 4.1 `GET /v1/api/gateways`

Prueba de vida y catálogo. No llama a ninguna pasarela ni necesita credenciales.

```bash
curl -s http://localhost:3000/v1/api/gateways
```

```json
{
  "gateways": ["wompi", "rapyd", "mercadopago", "kushki"],
  "cardCapture": {
    "wompi": "BROWSER_TOKEN",
    "mercadopago": "BROWSER_TOKEN",
    "kushki": "BROWSER_TOKEN",
    "rapyd": "HOSTED_PAGE"
  }
}
```

`cardCapture` dice cómo recibe la tarjeta cada pasarela: `BROWSER_TOKEN` es que hay que tokenizarla antes de cobrar, `HOSTED_PAGE` es que el pagador la escribe en la página de la pasarela. Es lo primero que conviene consultar cuando una integración falla en el paso de la tarjeta.

### 4.2 `POST /v1/api/payments`

Crea un cobro. Devuelve `201` en los dos desenlaces exitosos.

**Cuerpo.** `amount`, `currency`, `orderReference` y `payer` son obligatorios; `gateway` también lo es en la práctica, porque sin él la petición no se puede dirigir a ninguna pasarela.

| Campo | Tipo | Notas |
|---|---|---|
| `gateway` | `wompi`, `mercadopago`, `kushki`, `rapyd` | Sin él: `400` |
| `amount` | cadena decimal | `"50000.00"`. Nunca un número: el SDK usa decimales exactos |
| `currency` | cadena | `"COP"` |
| `orderReference` | cadena, máx. 100 | La referencia del pedido en el sistema del comercio |
| `payer` | objeto | `email` obligatorio; PSE exige además documento. Mercado Pago exige nombre y apellido separados, teléfono con indicativo, dirección e IP |
| `paymentMethod` | objeto | `{ "type": "CARD", "token": "..." }` o `{ "type": "PSE", "bankCode": "...", "payerKind": "NATURAL" }` |
| `returnUrlConfig` | objeto | A dónde vuelve el pagador |
| `taxBreakdown` | objeto | Desglose tributario; sin él, Kushki cobra el monto completo como exento de IVA |
| `ipAddress` | cadena | Si no llega, la API usa la de la petición |

```bash
curl -s -X POST http://localhost:3000/v1/api/payments \
  -H 'Content-Type: application/json' \
  -H 'x-kit-pagos-environment: simulator' \
  -d '{
    "gateway": "wompi",
    "amount": "75000.00",
    "currency": "COP",
    "orderReference": "ORD-2026-0901",
    "payer": { "email": "cliente@ejemplo.com", "fullName": "Jaime Pavlich" },
    "paymentMethod": { "type": "CARD", "token": "tok_test_card_12345" }
  }'
```

**Cobro resuelto en línea:**

```json
{
  "outcome": "TRANSACTION",
  "transaction": {
    "gatewayTransactionId": "1234-5678",
    "orderReference": "ORD-2026-0901",
    "amount": "75000.00",
    "currency": "COP",
    "payer": { "email": "cliente@ejemplo.com", "fullName": "Jaime Pavlich" },
    "status": "APPROVED",
    "rawStatus": "APPROVED",
    "isApproved": true,
    "isPending": false,
    "isFinal": true
  },
  "rawStatus": "APPROVED"
}
```

**Redirección requerida** —PSE, 3DS de Wompi o Kushki, o el checkout alojado de Rapyd:

```json
{
  "outcome": "REDIRECT_REQUIRED",
  "redirect": {
    "redirectUrl": "https://sandbox.wompi.co/...",
    "gatewayTransactionId": "1234-5678",
    "rawStatus": "PENDING"
  }
}
```

Guarde el `gatewayTransactionId`: es con lo que se consulta el pago si el pagador no vuelve. **Un PSE también puede llegar como `TRANSACTION`** cuando el pago ya tiene desenlace al crearlo, así que hay que tratar las dos ramas siempre.

`rejectionReason` solo aparece cuando el estado es `DECLINED`, y trae el código nativo de la pasarela (`rejectionCode`) más una categoría normalizada cuando existe correspondencia.

### 4.3 `GET /v1/api/payments/:id?gateway=<pasarela>`

Consulta el estado de un cobro.

```bash
curl -s 'http://localhost:3000/v1/api/payments/1234-5678?gateway=wompi'
```

```json
{
  "gateway": "wompi",
  "transaction": { "status": "APPROVED", "rawStatus": "APPROVED", "...": "..." }
}
```

**`gateway` es obligatorio y va en la query, no en la ruta.** El id de una transacción solo se puede consultar contra la pasarela que la creó. Sin el parámetro: `400`.

La operación se reintenta sola ante fallos transitorios, hasta `maxRetries` veces con retroceso exponencial. Si el fallo persiste, responde `502 MAX_RETRIES_EXCEEDED` con el último error en `cause`.

### 4.4 `GET /v1/api/pse-banks?gateway=<pasarela>`

Lista los bancos habilitados para PSE.

```bash
curl -s 'http://localhost:3000/v1/api/pse-banks?gateway=wompi'
```

```json
{
  "pseBanks": [
    {
      "gateway": "wompi",
      "banks": [
        { "code": "1022", "name": "Banco Union", "achCode": "1002" }
      ]
    }
  ]
}
```

- **Sin `?gateway`** se listan las cuatro pasarelas, en un viaje por pasarela.
- **Con credenciales propias**, `?gateway` es obligatorio: las cabeceras `x-gateway-*` no dicen a qué pasarela pertenecen, y usarlas contra las otras tres sería mandar la llave privada de un comercio a tres proveedores. Sin el parámetro: `400`.
- **Los `code` solo valen en la pasarela que los dio.** `achCode` es el código de compensación de ACH Colombia, que sí sirve en las cuatro; aparece solo cuando el banco está en ese catálogo, y los bancos ficticios de los sandboxes de Wompi y Kushki no lo traen.
- **No hay caché.** Cada petición vuelve a consultar las pasarelas. Si una falla, la respuesta es el error, no una lista parcial que el comercio podría tomar por completa.

### 4.5 `POST /v1/api/webhooks/:gateway`

Verifica la firma de una notificación y devuelve el evento normalizado. El comercio recibe el webhook de la pasarela y lo reenvía **byte a byte**: cuerpo exacto, cabeceras originales y query string incluido. Reserializar el JSON rompe las firmas de Kushki y Rapyd.

```bash
curl -s -X POST http://localhost:3000/v1/api/webhooks/wompi \
  -H 'Content-Type: application/json' \
  -H 'x-event-checksum: <la firma que mandó Wompi>' \
  --data-binary @payload-crudo.json
```

```json
{
  "gateway": "wompi",
  "eventType": "transaction.updated",
  "gatewayTransactionId": "1234-5678",
  "newStatus": "APPROVED"
}
```

**Todo rechazo responde igual.** Firma falsificada, cuerpo malformado, marca de tiempo vencida y secreto sin configurar devuelven el mismo `401` con el mismo cuerpo, sin decir cuál fue la causa:

```json
{ "code": "WEBHOOK_SIGNATURE_INVALID", "message": "Invalid webhook signature" }
```

Eso es deliberado: distinguir los motivos le diría a quien ataca qué le faltó. El motivo real queda en el log del servidor.

**El secreto debe estar configurado en el servidor.** Si la pasarela no tiene `webhookSecret` en el perfil del servidor, la ruta rechaza todo sin intentar verificar. En Rapyd el secreto es la misma `secret_key` de la API; en Wompi y Kushki es un valor aparte que se saca de otro lugar del panel.

---

## 5. Errores

Todos los fallos del SDK se traducen a un código HTTP fijo. El cuerpo es `{ "code": "...", "message": "..." }`, y **el `message` nunca trae credenciales**: el SDK las borra antes de lanzar el error.

| Código del SDK | HTTP | Cuándo |
|---|---|---|
| `INVALID_REQUEST` | 400 | Campo faltante o malformado, pasarela no soportada, ambiente inválido |
| `UNSUPPORTED_OPERATION` | 400 | La pasarela no soporta esa operación |
| `INVALID_CREDENTIALS` | 401 | Credenciales rechazadas por la pasarela |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | Verificación de webhook fallida |
| `RESOURCE_NOT_FOUND` | 404 | La transacción no existe en esa pasarela |
| `RESOURCE_LOCKED` | 423 | La pasarela está procesando otra petición con la misma llave |
| `RATE_LIMIT_EXCEEDED` | 429 | Límite de peticiones de la pasarela |
| `CONNECTION_FAILED` | 502 | No se pudo conectar con la pasarela |
| `GATEWAY_SERVER_ERROR` | 502 | Error interno de la pasarela |
| `MALFORMED_RESPONSE` | 502 | La pasarela respondió algo que no se puede interpretar |
| `MAX_RETRIES_EXCEEDED` | 502 | Un fallo transitorio persistió en todos los intentos |
| `GATEWAY_TIMEOUT` | 504 | La pasarela no respondió a tiempo |
| `UNKNOWN_ERROR` | 500 | Error no tipificado |

Son los mismos trece códigos del SDK, sin agregar ni quitar. El cuerpo de un error no incluye el `originalPayload` que la pasarela devolvió: exponerlo filtraría datos del proveedor.

**Dos excepciones al formato:** el `401` de autenticación (`{ "error": "Unauthorized", "message": "..." }`) y el `401` de webhook (`WEBHOOK_SIGNATURE_INVALID` con mensaje fijo).

---

## 6. Lo que esta capa no hace

- **No tokeniza tarjetas.** No hay endpoint para cambiar un número de tarjeta por un token. Para cobrar con tarjeta por REST hay que obtener el token antes: con el módulo de navegador del SDK, con la librería oficial de la pasarela o con su página alojada (Rapyd). Sin token, `POST /v1/api/payments` con `type: "CARD"` no tiene con qué cobrar.
- **No guarda estado de sesión.** Cada petición resuelve sus credenciales y su ambiente por sí sola; no hay nada que «iniciar sesión» ni que mantener.
- **No concilia.** `POST /v1/api/webhooks/:gateway` verifica y normaliza el evento; comparar contra la orden, marcar el pedido como pagado y decidir qué hacer es del comercio.
- **No reintenta un cobro.** `POST /v1/api/payments` no se reintenta nunca, ni ante timeout: que la respuesta no llegue no prueba que la pasarela no haya creado el cobro, y repetirlo podría cobrar dos veces. Antes de reintentar, consulte el estado.
- **No acepta el secreto de webhook por cabecera**, por la razón de la sección 3.
