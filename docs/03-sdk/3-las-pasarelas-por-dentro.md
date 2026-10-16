# Las pasarelas por dentro: el HTTP de cada adaptador

Qué peticiones manda cada adaptador, en qué orden, con qué headers y con qué cuerpo. Y sobre todo: **qué defecto medido justifica cada rareza**, porque casi ninguna de las decisiones de este documento se tomó en abstracto.

El resumen de cuántos viajes de red cuesta cada flujo:

| Flujo | Wompi | Mercado Pago | Kushki | Rapyd |
|---|---|---|---|---|
| Cobrar con tarjeta | 2 | 1 | 1 | 1 (devuelve redirección) |
| Cobrar con PSE | 1 + sondeo | 1 | 2 | 2 |
| Consultar estado | 1 | 1 (de dos rutas posibles) | 1 a 3 tanteos | 1 (de dos rutas posibles) |
| Listar bancos PSE | 1 | 1 + filtrado | 1 | 1 + filtrado |

---

## Wompi

**Autenticación:** `Authorization: Bearer <llave>`. El SDK usa la **pública** tanto para crear como para consultar: `WompiAdapter` envía `Bearer {credentials.publicKey}` en todas sus llamadas, y la llave privada jamás viaja por la red (medido en `architecture-log.md`, punto 50; ver `layers-and-components.md` §2.5).

### Cobrar con tarjeta — 2 peticiones

```http
GET {baseUrl}/merchants/{publicKey}
Authorization: Bearer pub_test_...
```

Devuelve el **token de aceptación** de términos. Es de un solo uso: hay que pedir uno por transacción, y reutilizarlo devuelve "El token de aceptación ya fue usado".

```http
POST {baseUrl}/transactions
Authorization: Bearer pub_test_...
Content-Type: application/json

{
  "amount_in_cents": 5000000,
  "currency": "COP",
  "reference": "ORDEN-001",
  "customer_email": "cliente@example.com",
  "acceptance_token": "eyJhbGci...",
  "payment_method": { "type": "CARD", "token": "tok_test_...", "installments": 1 },
  "signature": "a7f3c9..."
}
```

**El orden de las dos validaciones previas no es casual.** El adaptador exige primero el secreto de integridad y después pide el token de aceptación:

```113:123:sdk/src/infrastructure/adapters/WompiAdapter.ts
    const hasCredentials = Boolean(this.credentials);
    assertIntegritySecret(hasCredentials, this.credentials?.integritySecret);

    const acceptanceToken = await this.fetchAcceptanceToken();
    assertAcceptanceToken(hasCredentials, acceptanceToken);
```

El secreto es configuración y se puede revisar sin salir a la red; el token cuesta una llamada. Un comercio al que le falte el secreto **no paga esa llamada**.

**La firma de integridad:**

```text
signature = SHA256_hex( reference + amount_in_cents + currency + secreto_de_integridad )
```

Sin ella, Wompi real responde `422 "Firma de integridad requerida no enviada"`. El SDK no la mandaba, y las pruebas unitarias no lo veían porque el simulador no la exigía. Lo encontró medir contra el sandbox real (punto 44).

**Y una conversión que merece un párrafo.** El monto se convierte a `number` justo acá, en la frontera con el formato de cable, porque JSON solo tiene `number`:

```109:109:sdk/src/infrastructure/adapters/WompiAdapter.ts
    const amountInCents = Number(request.amount.toMinorUnits(request.currency));
```

Es seguro porque el valor ya es un entero de centavos muy por debajo del máximo entero seguro. Lo que el dominio garantiza es que **ese entero se calculó sin aritmética de punto flotante**: corriendo el punto decimal sobre el texto, no multiplicando por cien.

### PSE — 1 petición y un sondeo

Mismo `POST /transactions` con `payment_method.type: "PSE"`. Devuelve una transacción `PENDING` **sin URL**. La URL aparece después, en `transaction.extra.async_payment_url`, así que el adaptador consulta hasta que aparezca.

**Y acá está el hallazgo que motivó al simulador:** contra el sandbox de Wompi, esa URL aparece **en el mismo instante en que el pago se resuelve**. No hay ventana en la que redirigir tenga sentido. El flujo de PSE de Wompi **no se puede ejercitar de punta a punta** contra su sandbox (punto 43).

La misma función de sondeo cubre el desafío 3DS con tarjeta, porque la forma de la respuesta es la misma: un `PENDING` con una URL que llega después.

### Consultar estado y listar bancos

```http
GET {baseUrl}/transactions/{id}
GET {baseUrl}/pse/financial_institutions
```

Wompi es la única de las cuatro con un endpoint dedicado a los bancos. **En sandbox no devuelve bancos**: devuelve "Banco que aprueba", "Banco que declina" y "Banco que simula un error", con códigos `1`, `2` y `3`. El SDK los pasa tal cual, porque disfrazarlos con nombres que parezcan de producción le esconderia al comercio contra qué entorno está apuntando.

---

## Mercado Pago

**Autenticación:** `Authorization: Bearer <access_token>`, **más un header obligatorio por operación**.

### Cobrar con tarjeta — 3 peticiones, por la Orders API (desde la versión 0.6.0)

Hasta la versión 0.5.0 el SDK cobraba la tarjeta con una sola petición a la Payments API (`POST {baseUrl}/payments`). Desde la 0.6.0 va por la **Orders API**, la misma de PSE, porque con las credenciales `APP_USR-` del vendedor de prueba de una aplicación «Checkout API via Orders» la Payments API responde `401 "Unauthorized use of live credentials"` y la Orders API sí cobra (medido el 15 de octubre de 2026). Así, una sola pareja de credenciales cobra tarjeta y PSE.

La Orders API exige la marca y el tipo de la tarjeta (`payment_method.id` y `payment_method.type`): sin ellos responde `400 required_properties`. La Payments API los deducía del token; esta no. Como `PaymentMethod.card(token)` solo trae el token, el adaptador los deduce con dos lecturas antes de cobrar:

```http
GET  {baseUrl}/card_tokens/{token}                                   # first_six_digits, con el access token
GET  {baseUrl}/payment_methods/search?public_key={llave}&bins=401354 # id: visa, payment_type_id: credit_card
POST {baseUrl}/orders
Authorization: Bearer APP_USR-...
Content-Type: application/json
X-Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000

{
  "type": "online",
  "processing_mode": "automatic",
  "total_amount": "50000",
  "external_reference": "ORDEN-001",
  "payer": { "email": "cliente@example.com" },
  "transactions": {
    "payments": [{
      "amount": "50000",
      "payment_method": { "id": "visa", "type": "credit_card", "token": "ff8080814c11e237014c1ff593b57b4d", "installments": 1 }
    }]
  }
}
```

Leer el token no lo consume, y la búsqueda exige la llave pública aunque llegue el Bearer (`400 "public_key is required"`), por eso el SDK necesita `publicKey` en las credenciales para cobrar con tarjeta. `total_amount` no admite decimales, igual que en PSE. El documento del pagador viaja en `payer.identification` solo si el comercio lo informó: la orden se aprobó con y sin él.

El desenlace llega como en PSE: aprobado, `201` con la orden en `processed / accredited`; rechazado, `402` con la orden en `failed / failed` dentro de `data` y el motivo en el pago (`insufficient_amount`, `bad_filled_card_data`, `rejected_by_issuer`…), que el SDK entrega como una transacción `DECLINED` con `rejectionReason` y no como un error; pendiente, `201` en `processing / in_process`. La respuesta no trae el email del pagador, así que la `Transaction` lleva el de relleno del normalizador. La orden llega con `transaction_security.validation: "never"` y el SDK no pide 3DS, así que el cobro con tarjeta no devuelve redirección. El detalle de lo medido está en `sdk/src/infrastructure/adapters/mercadopago-card.ts`.

**`X-Idempotency-Key` no es opcional.** Sin él, Mercado Pago no crea nada: la Payments API respondía `400 "Header X-Idempotency-Key can't be null"` y la Orders API responde `400 "Missing HTTP header: X-Idempotency-Key."`. El SDK genera un UUID por petición. Otro defecto que vivió en el SDK porque el simulador no lo pedía, y que encontró medir contra la API real (punto 48).

Es también la única de las cuatro con soporte nativo de idempotencia, lo cual es coherente con lo explicado en [01-producto/2-conceptos-tecnicos.md](../01-producto/2-conceptos-tecnicos.md) §3: la pasarela reconoce el reintento y devuelve el resultado original en lugar de crear un segundo cobro.

### PSE — 1 petición, a la Orders API

PSE nunca vivió en la Payments API sino en la **Orders API**, `POST {baseUrl}/orders`, con un cuerpo bastante más exigente:

```json
{
  "type": "online",
  "external_reference": "ORDEN-001",
  "processing_mode": "automatic",
  "payer": {
    "email": "cliente@example.com",
    "entity_type": "individual",
    "identification": { "type": "CC", "number": "1099888777" },
    "first_name": "Juan", "last_name": "Perez",
    "phone": { "area_code": "301", "number": "2345678" },
    "address": { "street_name": "...", "city": "...", "zip_code": "..." }
  },
  "additional_info": { "payer.ip_address": "190.85.1.1" },
  "config": { "online": { "callback_url": "https://comercio.example.com/retorno" } }
}
```

El adaptador valida todo eso **antes** de salir a la red, y si falta algo lanza `INVALID_REQUEST` listando qué falta. Es mejor que mandar la petición y traducir un error remoto que no siempre dice cuál campo era.

Desde la versión 0.6.0 la IP del pagador se normaliza antes de enviarla, con la misma regla que aplica `/v1/api`: se quitan los espacios, `::ffff:a.b.c.d` pasa a `a.b.c.d` y `::1` a `127.0.0.1`. Son las formas en que Node entrega `req.ip` en un servidor que escucha en `::`, y Mercado Pago las rechaza con `400` (medido el 15 de octubre de 2026; ver «La IP del pagador» en [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md)). Las demás direcciones pasan sin validar, y una IP en blanco cuenta como faltante.

**Y tiene un bloqueo duro:** la Orders API **responde `401` con credenciales `TEST-`** y exige un token `APP_USR-`. El PSE de Mercado Pago no se pudo probar en sandbox con esas credenciales (punto 45). Con las credenciales `APP_USR-` del vendedor de prueba de una aplicación «Checkout API via Orders», la misma API sí cobra tarjeta (medido el 15 de octubre de 2026).

**`baseUrl` como mapa nació de acá.** Al necesitar dos rutas —`/payments` y `/orders`— la segunda no tenía dónde vivir con una `baseUrl` global única. Desde el punto 57, `baseUrl` admite un mapa por pasarela, y eso habilitó además que el SDK hable con los sandboxes reales sin pasar por el simulador.

### Consultar estado — dos rutas, se elige por el formato del id

```http
GET {baseUrl}/payments/{id}    # id numérico: tarjeta cobrada con la versión 0.5.0 o anterior
GET {baseUrl}/orders/{id}      # ULID con prefijo ORD: PSE, y tarjeta desde la 0.6.0
```

Mercado Pago no manda ningún discriminador, así que el adaptador lo deduce del identificador. El prefijo `ORD` está documentado y medido, y consultar el recurso equivocado da un 404 que parece "el pago no existe". Con las credenciales de un vendedor de prueba las órdenes empiezan con `ORDTST` (medido el 15 de octubre de 2026), que el mismo prefijo cubre.

### Bancos PSE

`GET {baseUrl}/payment_methods`, y el filtrado del método `pse` ocurre en el SDK. Salen 47 entidades. Bancolombia es `1007`, Davivienda `1051`, el banco de prueba del sandbox es `1013`.

---

## Kushki

**Autenticación:** headers propios, y **distintos según la llave**. `Public-Merchant-Id` o `Private-Merchant-Id`, y cada ruta acepta una sola de las dos. Equivocarse da `401`.

### Cobrar con tarjeta — 1 petición

```http
POST {baseUrl}/card/v1/charges
Private-Merchant-Id: <llave privada>
Content-Type: application/json

{
  "token": "...",
  "amount": { "subtotalIva": 0, "subtotalIva0": 50000, "iva": 0, "currency": "COP" },
  "fullResponse": true
}
```

El monto es un **objeto con desglose de IVA**, no un número. `fullResponse: true` hace que la respuesta traiga el estado resuelto, y eso importa porque contra Kushki real el estado final de un cobro llega por webhook: sin este flag habría que esperarlo.

### PSE — 2 peticiones, con llaves distintas

```http
POST {baseUrl}/transfer/v1/tokens     Public-Merchant-Id    -> token
POST {baseUrl}/transfer/v1/init       Private-Merchant-Id   -> URL del banco
```

El monto va en **los dos pasos**, porque Kushki lo exige en ambos. Y el primer paso pide además `bankId`, `documentType`, `documentNumber`, `userType` y `callbackUrl`.

`callbackUrl` se resuelve para `PENDING` y no para `APPROVED`, con un criterio que vale la pena entender: **el pagador vuelve del banco antes de que la transferencia esté confirmada.** Es el mismo criterio que usa el camino de Wompi.

### Consultar estado — hasta 3 tanteos

Esta es la parte más rara del SDK, y tiene la mejor historia.

Kushki tiene una ruta de consulta por método y **no publica ningún discriminador** entre sus identificadores. Se consideró deducirlo de la forma, como hace Mercado Pago con el prefijo `ORD`, pero no es comparable: ese prefijo está documentado y medido, mientras que acá la regla candidata —"el ticket de tarjeta es solo dígitos"— no se pudo verificar, y basta que Kushki emita un token de solo dígitos para mandar la consulta a la ruta equivocada y reportar "no existe" sobre un pago que sí existe.

Así que en vez de adivinar, **el adaptador pregunta**: intenta una ruta y, solo si Kushki responde que no conoce ese identificador, prueba la siguiente.

```394:399:sdk/src/infrastructure/adapters/kushki-pse.ts
export function kushkiStatusPaths(gatewayTransactionId: string): readonly string[] {
  return [
    `/transfer/v1/status/${gatewayTransactionId}`,
    `/card-async/v1/status/${gatewayTransactionId}`,
    `/charges/${gatewayTransactionId}`,
  ];
```

**El orden va contra la intuición, y salió de medir.** La primera versión probaba tarjeta primero, con el argumento de que es el método mayoritario. Medir la API UAT el 18 de septiembre mostró que ese orden **no puede funcionar**: `GET /charges/{id}` responde `403` para cualquier identificador, igual que una ruta inventada, así que nunca emite un "no existe" del que se pueda encadenar, y el respaldo nunca se activaría. La de transferencia sí discrimina: `200` para un token que conoce, `400 T001` para uno que no.

**Y hay una segunda historia dentro de esta.** La primera medición concluyó que Kushki no expone **ninguna** consulta de tarjeta, y era una conclusión mal sacada: probó catorce formas de ruta y ninguna en el espacio `card-async`. Buscaba nombres de recurso —`charges`, `transaction`, `transactions`— y se le pasó la analogía directa con la ruta de PSE que sí existe. Medido de nuevo el 19 de septiembre:

| Ruta | Con llave privada | Con llave pública |
|---|---|---|
| `/card-async/v1/status/{id}` | `400 CAS004 "No existe la transacción"` | `401` |
| `/transfer/v1/status/{id}` | `400 T001` | `401` |
| `/card/v1/status/{id}` | `403`, igual que una ruta inventada | `403` |
| `/card-async/v1/status` (sin id) | `403 "Missing Authentication Token"` | — |

**La técnica que resolvió esto merece nombrarse**, porque sirve para cualquier API cerrada: los patrones de error de la puerta de entrada distinguen "la ruta no existe" de "no estás autorizado". Un `403 "Missing Authentication Token"` es la infraestructura diciendo que no hay ruta; un `400 CAS004` es la aplicación de Kushki contestando **después** del autorizador, lo cual prueba que la ruta está publicada.

`card-async` resultó ser el flujo asíncrono de tarjeta, que la documentación de Kushki declara disponible **solo en Chile**. Se intenta igual, por dos razones: la certeza sale de medir en el momento y no de citar documentación, y si Kushki registra los cobros síncronos ahí alguna vez, el SDK empieza a funcionar sin cambiarle una línea. Puntos 50, 53 y 54.

### Bancos PSE

`GET {baseUrl}/transfer/v1/bankList` con la llave pública. Trae una entrada de encabezado con código `0` y texto de instrucción, que el SDK descarta porque no es un banco.

---

## Rapyd

**Autenticación:** la más laboriosa. **Cada petición se firma**, con cuatro headers: `access_key`, `salt`, `timestamp` y `signature`.

```23:41:sdk/src/infrastructure/adapters/rapyd-signature.ts
export function computeRapydSignature(
  credentials: Credentials,
  httpMethod: string,
  urlPath: string,
  salt: string,
  timestamp: number,
  bodyString: string,
): string {
  const { publicKey: accessKey, privateKey: secretKey } = credentials;
  const toSign =
    httpMethod.toLowerCase() + urlPath + salt + timestamp + accessKey + secretKey + bodyString;
  const hmac = createHmac("sha256", secretKey);
  hmac.update(toSign);
  return Buffer.from(hmac.digest("hex")).toString("base64");
}
```

Tres detalles que arruinan la firma si se pasan por alto, y los tres están encapsulados en esta función:

1. **El digest se serializa a hexadecimal y ese texto es lo que se codifica en base64.** Pedir `digest("base64")` directo produce otra firma. Es el error más fácil de cometer "simplificando".
2. **El secreto entra dos veces:** como llave del HMAC y dentro del texto firmado.
3. **El método va en minúsculas.**

Y un cuarto que vive en el adaptador: **el cuerpo que se firma tiene que ser exactamente la cadena que se envía**, así que se serializa una sola vez y esa cadena se reutiliza para firmar y para el cuerpo. Reserializar es suficiente para invalidar la firma.

### Cobrar con tarjeta — 1 petición, y devuelve redirección

```http
POST {baseUrl}/checkout
```

**Por qué checkout alojado y no servidor a servidor.** Se midió que el único camino directo que funciona exige el **número de la tarjeta** en la petición, lo cual metería el servidor del comercio en el alcance de PCI DSS. El checkout alojado lo evita, al costo de que cobrar con tarjeta en Rapyd siempre implica redirigir. Es una diferencia visible para el comercio, y está declarada en lugar de disimulada (punto 50).

### PSE — 2 peticiones

```http
POST {baseUrl}/customers    -> customerId
POST {baseUrl}/payments     -> URL del banco, sin sondeo
```

La URL viene en la respuesta de creación: se midió `status: "ACT"` y `next_action: "pending_confirmation"` con la URL ya presente. Por eso Rapyd no necesita sondeo y Wompi sí.

### Consultar estado — dos recursos

Un id de checkout **no** se consulta en `/payments/{id}`: son recursos distintos, y se midió. El adaptador elige según el prefijo del identificador.

### Bancos PSE

`GET {baseUrl}/payment_methods/country?country=CO`, filtrando los métodos PSE. Los códigos son cadenas descriptivas como `co_pse_bancolombia_bank`; son 47.

### El estado más engañoso de las cuatro

`CLO` significa **"cerrado", no "pagado"**. Un checkout cerrado sin pagar también queda en `CLO`. El normalizador lo traduce a `APPROVED` **solo** si la respuesta además trae `paid: true`. Un comercio que asumiera que `CLO` es éxito estaría despachando producto sin haber cobrado.

---

## Lo que se aprende comparándolas

**Ningún flujo cuesta lo mismo en dos pasarelas.** Cobrar con tarjeta: una petición en dos de ellas, dos en Wompi, y en Rapyd termina en redirección. PSE: entre una y dos peticiones, con sondeo o sin él, y con la lista de bancos en un endpoint dedicado o filtrada de otro.

**Cada rareza del SDK corresponde a una medición.** El sondeo de Wompi, el orden de tanteos de Kushki, el checkout alojado de Rapyd, el header de idempotencia de Mercado Pago: ninguna se diseñó en abstracto. Todas salieron de ejecutar código contra un sandbox y descubrir que la documentación no alcanzaba.

**Y ese es el argumento más fuerte a favor del SDK**, más que el ahorro de líneas: un comercio que integre a mano va a tener que redescubrir cada una de estas trampas por su cuenta, y algunas solo se manifiestan en producción.

---

## Qué sigue

- Cómo se integra: [4-guia-de-implementacion.md](4-guia-de-implementacion.md).
- La matriz campo por campo: [ubiquitous-language.md](../02-arquitectura/ubiquitous-language.md).
- Los datos de prueba de cada pasarela: [testing-data](../testing-data/).
