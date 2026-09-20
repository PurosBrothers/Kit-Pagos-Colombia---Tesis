# Las pruebas de contrato contra los sandboxes reales

Dieciséis pruebas que llaman a las APIs reales de las cuatro pasarelas. Son la suite más pequeña del proyecto y la que encontró los defectos más graves.

```bash
cd sdk && npm run test:sandbox
```

---

## 1. Qué son y para qué sirven

Las pruebas unitarias verifican que el SDK hace lo que el autor **creyó** que la pasarela esperaba. Cuando esa creencia está equivocada, ninguna prueba unitaria lo detecta, porque el mock está construido sobre la misma creencia.

Estas pruebas son la única defensa contra eso: **llaman a la pasarela de verdad y ven qué contesta.**

No reemplazan a las unitarias ni compiten con ellas. Las unitarias prueban la lógica; estas prueban **la suposición**.

---

## 2. Las 16 pruebas

| Pasarela | Qué afirma cada prueba |
|---|---|
| **Wompi** (3) | Que la lista de bancos de PSE responde con código y nombre; que un cobro con tarjeta queda consultable; y que **sigue rechazando** una transacción sin firma de integridad |
| **Mercado Pago** (4) | Bancos de PSE; que un cobro con tarjeta devuelve una transacción legible; que **sigue rechazando** un cobro con token y sin cuotas; y que **sigue pidiendo** el token nombrando `payment_method_id` |
| **Kushki** (5) | Bancos de PSE; cobro con tarjeta legible; que la ruta vieja de consulta **sigue respondiendo 403** igual que una ruta inventada; que el SDK **explica** que no hay consulta de tarjeta en vez de culpar a las credenciales; y que la respuesta **sigue viniendo** sin monto ni estado cuando no se pide `fullResponse` |
| **Rapyd** (4) | Bancos de PSE; que se crea una página de pago para la tarjeta y devuelve su URL; que se puede consultar esa página antes de que el pagador pague; y que **sigue rechazando** un cobro de tarjeta con token en `/payments` |

**La mitad de las pruebas afirma que un defecto ajeno sigue presente.** Eso es deliberado y es lo más valioso de esta suite: cada una de esas afirmaciones corresponde a una limitación medida que obligó a que el SDK haga algo raro. Si la pasarela algún día la corrige, **esa prueba falla**, y eso es exactamente lo que se quiere: es la notificación de que el SDK puede simplificarse.

Es una forma poco común de usar una prueba —afirmar el estado del mundo en lugar del propio comportamiento— y para este proyecto encaja, porque casi todas las rarezas del código son consecuencia de una rareza ajena.

---

## 3. Por qué no afirman `APPROVED`

Ninguna prueba afirma que un cobro salga aprobado. Afirman que **la petición fue aceptada y la respuesta tiene la forma esperada**.

La razón es simple y decisiva: **un sandbox declina cuando quiere.** Las pasarelas de prueba tienen sus propias reglas de antifraude, sus tarjetas cambian de comportamiento, y algunas rechazan cobros concurrentes de la misma cuenta como sospechosos. Una prueba que afirmara `APPROVED` sería intermitente, y **una suite intermitente enseña a ignorar el rojo**, que es peor que no tener suite.

Lo que sí se puede afirmar con determinismo:

- Que la petición se aceptó, o que se rechazó **con el error específico** que se midió.
- Que la respuesta trae los campos que el normalizador necesita.
- Que la lista de bancos tiene código y nombre.
- Que un identificador recién creado es consultable.

Para afirmar desenlaces está la API de Simulación, que sí es determinista. Las dos cosas hacen falta, y cada una para lo que sirve.

Por la misma razón la suite corre **en serie** (`maxWorkers: 1`) y con un tiempo de espera de 60 segundos por prueba: varias pasarelas rechazan cobros concurrentes de la misma cuenta de prueba, y un rechazo por antifraude no es un defecto del SDK.

---

## 4. Cómo se activan

Las credenciales salen del `.env` de la raíz del repositorio:

| Pasarela | Variables |
|---|---|
| Wompi | `WOMPI_PUBLIC_KEY`, `WOMPI_PRIVATE_KEY`, y `WOMPI_INTEGRITY_SECRET` |
| Mercado Pago | `MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_ACCESS_TOKEN` |
| Kushki | `KUSHKI_PUBLIC_MERCHANT_ID`, `KUSHKI_PRIVATE_MERCHANT_ID` |
| Rapyd | `RAPYD_API_ACCESS_KEY`, `RAPYD_API_SECRET_KEY` |

`WOMPI_INTEGRITY_SECRET` es imprescindible para las pruebas de cobro de Wompi: sin él, la prueba mediría un `422` y no el contrato.

**Si faltan las credenciales de una pasarela, sus pruebas se saltan en lugar de fallar.** Es a propósito, y la razón está escrita en el código: *"una prueba roja por una credencial que falta enseña a ignorar el rojo"*. Quien clone el repositorio sin credenciales tiene que ver las pruebas saltadas, no rotas.

**Y esa decisión tiene una trampa que hay que conocer:** una suite que se salta entera se ve casi igual de tranquila que una que pasa. Cuando importe, hay que leer la salida. Los nombres de los bloques están escritos para eso: incluyen la URL contra la que corren, así que la salida sirve como evidencia de **qué se midió** y no solo de que pasó.

Las URLs, que son las mismas que usan los adaptadores:

| Pasarela | Sandbox |
|---|---|
| Wompi | `https://sandbox.wompi.co/v1` |
| Mercado Pago | `https://api.mercadopago.com/v1` |
| Kushki | `https://api-uat.kushkipagos.com` |
| Rapyd | `https://sandboxapi.rapyd.net/v1` |

Vale notar que esto es posible porque `baseUrl` admite un mapa por pasarela (punto 57): **el SDK habla con los sandboxes reales sin pasar por el simulador**. Es un dato importante para la decisión abierta sobre el futuro del simulador, en [02-arquitectura/3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md).

---

## 5. Los defectos que encontraron

Esta es la justificación de la suite, y son defectos que las 586 pruebas unitarias no podían ver.

### Wompi rechazaba todos los cobros (punto 44)

El SDK no mandaba la firma de integridad. Wompi real responde `422 "Firma de integridad requerida no enviada"` y no crea nada. **Las pruebas unitarias pasaban** porque el simulador no la exigía. El SDK estaba completamente roto contra Wompi real y nadie lo sabía.

### Mercado Pago rechazaba todos los cobros (punto 48)

Faltaba el header `X-Idempotency-Key`. La API real responde `400 "Header X-Idempotency-Key can't be null"`. Mismo patrón exacto: el mock no lo pedía.

### Los estados de transferencia de Kushki se reportaban como error (punto 48)

`requestedToken` e `initializedTransaction` no estaban en la tabla de estados. Una transferencia **en curso** —o sea, el caso normal— se traducía a `ERROR`. Para un comercio eso significa marcar como fallido un pago que está avanzando bien.

### El mock decía que las cuatro cobraban con tarjeta igual, y ninguna lo hacía así (punto 50)

El hallazgo más grande. Al medir contra las APIs reales resultó que: Rapyd necesita checkout alojado porque su camino directo exige el número de la tarjeta; Kushki responde con una forma distinta a la que el mock devolvía; y Mercado Pago pide el token nombrando un campo que el mock no pedía.

**Lo que esto enseña sobre el simulador:** su fidelidad llega **hasta donde llegó la medición**, y punto. Un simulador construido sobre suposiciones las confirma en lugar de refutarlas.

### Kushki no expone la consulta de tarjeta que el simulador implementa (puntos 53 y 54)

`GET /charges/{id}` responde `403` para cualquier identificador, igual que una ruta inventada. La exploración que lo determinó tuvo dos rondas, y **la primera sacó una conclusión equivocada**: concluyó que Kushki no expone ninguna consulta de tarjeta, después de probar catorce formas de ruta, ninguna en el espacio `card-async`.

La técnica que finalmente lo resolvió merece nombrarse porque sirve para cualquier API cerrada: **los patrones de error de la puerta de entrada distinguen "la ruta no existe" de "no estás autorizado".** Un `403 "Missing Authentication Token"` es la infraestructura diciendo que no hay ruta; un `400 CAS004` es la aplicación de Kushki contestando **después** del autorizador, lo cual prueba que la ruta está publicada.

---

## 6. Por qué no corren en CI

Tres razones concretas:

1. **Necesitan credenciales reales**, y meter secretos de pasarela en CI es riesgo sin beneficio proporcional.
2. **No son deterministas**, porque un sandbox declina cuando quiere. Un CI intermitente se ignora.
3. **Son lentas**: llamadas HTTP encadenadas contra servicios que no prometen latencia, en serie.

La consecuencia es que **hay que acordarse de correrlas**, y por eso el flujo de trabajo del repositorio las pide explícitamente cuando un cambio toca un adaptador. Los puntos 43, 44, 48, 50, 52 y 53 del architecture-log son la evidencia de que ese paso no es ceremonia.

---

## 7. Qué sigue

- Las pruebas que sí corren en cada cambio: [2-pruebas-del-sdk.md](2-pruebas-del-sdk.md).
- Los límites de fidelidad del simulador, que estas pruebas vigilan: [02-arquitectura/3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md).
- Los datos de prueba que usan: [testing-data](../testing-data/).
