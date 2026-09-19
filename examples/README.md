# Ejemplos de integración — Kit Pagos Colombia

Esta carpeta es un paquete npm independiente que **no forma parte del SDK**. Existe para demostrar la integración desde afuera: declara `kit-pagos-colombia` como dependencia y lo importa por su nombre público, exactamente como lo haría un comercio que lo instalara desde npm.

Esa separación es deliberada. Si el ejemplo viviera dentro de `sdk/src` e importara por rutas relativas, probaría el código interno pero no demostraría nada sobre lo que el paquete publicado realmente expone. Al consumirlo como dependencia, cualquier tipo o clase que falte en la superficie pública rompe la compilación del ejemplo de inmediato.

---

## Prerrequisitos

Necesitas dos terminales previas (o haber corrido los pasos una vez):

### 1. Compilar el SDK
El paquete de ejemplos apunta a `dist/index.js` y `dist/index.d.ts`, así que el SDK debe estar construido antes de consumirlo:

```bash
cd sdk
npm install
npm run build
```

### 2. Levantar la API de Simulación
Los ejemplos realizan peticiones HTTP reales contra los mocks locales en el puerto 3000. Déjala corriendo en una terminal:

```bash
cd simulator-api
npm install
npm run dev
```

---

## Comandos disponibles

Desde la carpeta `examples/`:

```bash
cd examples
npm install
```

Puedes ejecutar cualquiera de los siguientes scripts definidos en `package.json`:

### 1. Simulación de pago con Wompi

```bash
npm run simulate:wompi
# O también:
npm start
```

* **Archivo:** `simulate-wompi-payment.ts`
* **Descripción:** Construye una solicitud de pago unificada utilizando objetos de valor del dominio (`Amount`, `Currency`, `OrderReference`, `Payer`) y procesa el pago a través de Wompi.
* **Qué esperar:** 
  1. Imprime la solicitud de pago.
  2. Muestra la `Transaction` creada con estado `APPROVED`.
  3. Consulta exitosamente el estado por ID a través de `kitPagos.getPaymentStatus(...)` obteniendo la transacción con estado `APPROVED`.

---

### 1b. Simulación de pago con PSE (Wompi)

```bash
npm run simulate:wompi-pse
```

* **Archivo:** `simulate-wompi-pse.ts`
* **Descripción:** El mismo pago, pero con PSE en vez de tarjeta. Es el único ejemplo donde `createPayment()` **no** devuelve una transacción: devuelve una redirección pendiente, porque el pago no avanza hasta que el pagador entre al portal de su banco.
* **Qué esperar:**
  1. Imprime la solicitud, incluido el documento del pagador (PSE lo exige) y el código de banco elegido.
  2. Muestra una redirección pendiente con la URL del banco, el id en la pasarela y estado nativo `PENDING`.
  3. Consulta el estado después de la redirección y obtiene `APPROVED`.
* **Códigos de banco:** el ejemplo **ya no los trae escritos a mano**: los pide con `kitPagos.getPseBanks()` y usa el primero, que es lo que haría un comercio de verdad al armar su selector. En el sandbox de Wompi la lista son tres entidades de prueba —`1` "Banco que aprueba", `2` "Banco que declina" y `3` "Banco que simula un error"—, así que para probar otro desenlace basta con elegir otro índice de la lista.
* **Por qué corre contra el simulador y no contra el sandbox de Wompi:** no es comodidad. El sandbox real publica la URL de redirección en el mismo instante en que resuelve el pago, o sea que resuelve solo, sin que nadie visite el banco, y cuando la URL existe ya no sirve. Contra ese sandbox no hay ninguna ventana en la que redirigir tenga sentido. La API de Simulación reproduce el orden real, y por eso es el único lugar donde este flujo se puede ejercitar. El detalle medido está en el punto 43 del `architecture-log.md`.

---

### 2. Simulación de pago con Mercado Pago

```bash
npm run simulate:mercadopago
```

* **Archivo:** `simulate-mercadopago-payment.ts`
* **Descripción:** Demuestra el flujo completo end-to-end con Mercado Pago:
  * Creación de pago con montos en pesos decimales directos (a diferencia de Wompi, no requiere centavos).
  * Autenticación mediante token Bearer.
  * Normalización de respuestas manteniendo el estado nativo (`approved` en minúsculas en `rawStatus`) y el estado unificado (`TransactionStatus.APPROVED`).
  * Consulta del estado de la transacción (`kitPagos.getPaymentStatus(...)`) contra el endpoint HTTP `GET /v1/sim/mercadopago/payments/:id`.
* **Qué esperar:** Verás en consola tanto la creación de la transacción como la consulta posterior con estado acreditado/aprobado.

---

### 2b. Simulación de pago con PSE (Mercado Pago)

```bash
npm run simulate:mercadopago-pse
```

* **Archivo:** `simulate-mercadopago-pse.ts`
* **Descripción:** El mismo método de pago que `simulate-wompi-pse.ts`, en otra pasarela. Está pensado para leerse **al lado** de aquel, porque la comparación es el punto: el código de comercio es el mismo —objetos de valor, `createPayment()`, `PaymentResult`— y sin embargo Mercado Pago exige bastante más dato para cobrar exactamente lo mismo.
* **Qué esperar:**
  1. Imprime la solicitud, que además del documento lleva nombre y apellido separados, teléfono con indicativo, dirección completa e IP del pagador.
  2. Muestra una redirección pendiente con la URL del banco y estado nativo `action_required`, en **una sola** petición HTTP.
  3. Consulta el estado y obtiene `processed` → `APPROVED`.
* **Lo que este ejemplo enseña y el de Wompi no:** que la abstracción unifica **la forma de pedir el pago y la de leer el resultado**, no la cantidad de datos que hay que reunir antes. Un comercio que migra de Wompi a Mercado Pago no reescribe su integración, pero sí tiene que empezar a recolectar la dirección del pagador. Medido campo por campo contra la API real:

  | Dato | Wompi | Mercado Pago |
  |---|---|---|
  | documento del pagador | obligatorio | obligatorio |
  | nombre y apellido separados | no lo pide | obligatorios |
  | teléfono con indicativo | no lo pide | obligatorio |
  | dirección completa | no la pide | obligatoria |
  | IP del pagador | no la pide | obligatoria |
  | URL de retorno | **opcional** | **obligatoria** |
  | sondeo para obtener la URL | **necesario** | no hace falta |

* **Códigos de banco:** son los reales que publica la cuenta, y el ejemplo los pide con `kitPagos.getPseBanks()` en vez de fijarlos: son 47 entidades, entre ellas `1051` Davivienda, `1007` Bancolombia y `1013` BBVA. No tienen nada que ver con los de Wompi (`1`, `2`, `3`): el código de banco es el único dato del contrato que no se puede reutilizar al cambiar de pasarela.
* **Por qué corre contra el simulador:** porque la Orders API real **no se puede ejercitar con credenciales de prueba** (responde `401` y exige un token de producción), y completar el pago requiere que una persona entre al simulador bancario y transfiera. El detalle de lo medido está en el punto 45 del `architecture-log.md`.

---

### 3. Simulación de pago con Rapyd

```bash
npm run simulate:rapyd
```

* **Archivo:** `simulate-rapyd-payment.ts`
* **Por qué existe uno por pasarela:** Cada pasarela necesita su propio `baseUrl` y su propio juego de credenciales, así que un único ejemplo parametrizable tendría que resolver configuración antes de poder mostrar el pago. Con un archivo por pasarela, la comparación es directa: los pasos 2, 3 y 4 son idénticos en el código del comercio, y lo único que cambia es la configuración inicial.
* **Qué demuestra:** Rapyd recalcula una firma HMAC en cada petición (no un Bearer fijo), recibe el monto en pesos con decimales (no en centavos), y usa un catálogo de estados propio de tres letras (`CLO`, `ACT`, `ERR`, `EXP`, `REV`).
* **Qué esperar:** La transacción se crea con estado normalizado `APPROVED` y estado nativo `CLO`, el monto vuelve como `150000.00 COP` con la escala intacta, y la consulta posterior por identificador también funciona.

Dos detalles que se ven en la salida y vale la pena entender:
1. El estado nativo `CLO` significa "cerrado", no "pagado": el SDK solo lo traduce a `APPROVED` porque la respuesta además trae `paid: true`.
2. El monto imprime `150000.00`, con el cero final: confirma la representación de `Amount` como string exacto para cumplir con el hash firmado requerido por Rapyd.

---

### 4. Simulación de pago con Kushki

```bash
npm run simulate:kushki
```

* **Archivo:** `simulate-kushki-payment.ts`
* **Qué demuestra:** Kushki requiere un monto desglosado en base gravable, IVA, parte exenta e impuesto al consumo. El comercio conserva el mismo `CreatePaymentRequest` unificado y usa `TaxBreakdown.fromTaxIncluded(...)` para generar un desglose que suma exactamente el total. El adaptador lo convierte al formato nativo y traduce `APPROVAL` a `APPROVED`.
* **Qué esperar:** La creación y la consulta posterior imprimen el mismo identificador nativo (`ticketNumber`) y un estado unificado `APPROVED`; el estado nativo se conserva como `APPROVAL` para auditoría.

### 3b. Simulación de pago con PSE (Rapyd)

```bash
npm run simulate:rapyd-pse
```

* **Archivo:** `simulate-rapyd-pse.ts`
* **Descripción:** El mismo cobro por PSE, en la pasarela donde **no es una sola llamada**. Rapyd exige crear un `customer` con `POST /v1/customers` antes del pago: un pago sin cliente previo responde `MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]`, medido contra el sandbox real.
* **Qué esperar:**
  1. Pide la lista de bancos y usa el primero, cuyo código es `co_pse_{banco}_bank` y no un número: en Rapyd PSE son 47 métodos de pago distintos, uno por entidad.
  2. Crea el pago con **una sola** llamada del comercio, aunque por debajo sean dos, y devuelve una redirección pendiente con estado nativo `ACT`.
  3. Consulta el estado después de la redirección y obtiene `APPROVED`.
* **Lo que este ejemplo enseña y los otros no:** que la cantidad de llamadas HTTP antes de redirigir **no es la misma en todas las pasarelas y el comercio no se entera**. Esconderlo es una decisión, no un descuido, y tiene un costo medido: si la segunda llamada falla, el cliente ya quedó creado en Rapyd. Por eso el adaptador valida todos los datos obligatorios antes de la primera. El razonamiento está en el punto 47 del `architecture-log.md`.
* **Datos que Rapyd exige y Wompi no:** nombre completo con solo letras y espacios, y teléfono celular colombiano. Van en el `customer`, no en los campos del pago: mandar el teléfono en `payment_method.fields` devuelve `UNKNOWN_PAYMENT_METHOD_FIELD - [PHONE_NUMBER]`.

---

### 4b. Simulación de pago con PSE (Kushki)

```bash
npm run simulate:kushki-pse
```

* **Archivo:** `simulate-kushki-pse.ts`
* **Descripción:** PSE en la pasarela que no lo llama PSE. En Kushki el mecanismo es **Transfer In**, la lista de bancos en Colombia **no es opcional** —el `bankId` tiene que salir de ahí— y la URL de retorno del comercio viaja **al pedir el token**, un paso previo al cobro.
* **Qué esperar:**
  1. Pide la lista de bancos y usa el primero.
  2. Crea el pago, que por debajo son dos llamadas (token e inicio), y devuelve una redirección pendiente cuyo identificador **es el token**, no un id nuevo.
  3. Consulta el estado y obtiene `APPROVED`.
* **Nivel de evidencia:** el ejemplo corre contra el simulador, pero el flujo que ejecuta está medido contra la API UAT real de Kushki, igual que los otros tres. Se escribió primero contra la documentación y **medirlo después encontró cuatro defectos** que el simulador no podía mostrar: `init` no acepta solo el token, la lista de bancos encabeza con un elemento que no es un banco, la consulta de estado devuelve una forma que el normalizador de tarjeta no puede leer, y los estados de transferencia son otro vocabulario. Están en el punto 48 del `architecture-log.md`. Lo único sin medir es el desenlace: llevar una transferencia hasta aprobada o declinada exige que una persona autorice en el portal del banco.
* **Un detalle del que se ve la consecuencia:** Kushki consulta tarjeta y transferencia en rutas distintas y no publica cómo distinguir sus identificadores, así que `getPaymentStatus()` prueba una y pasa a la otra si le responden que no conocen el identificador. La de transferencia va primero, y eso salió de medir: `GET /charges/{id}` responde `403` para cualquier identificador, incluso para uno inventado, así que por esa ruta no se puede encadenar nada.

---

### 5. La lista de bancos de PSE en las cuatro pasarelas

```bash
npm run simulate:pse-bancos
```

* **Archivo:** `simulate-pse-bancos.ts`
* **Descripción:** El único ejemplo que no cobra nada. Pide la lista de bancos a las cuatro pasarelas con **la misma llamada**, `kitPagos.getPseBanks()`, y las imprime juntas.
* **Qué esperar:**
  1. Las cuatro listas, una debajo de otra, con el código y el nombre tal como los devuelve cada pasarela.
  2. Una demostración de que los códigos **no son intercambiables**: mandarle a Rapyd el `"1"` de Wompi falla con un `INVALID_REQUEST` del SDK que dice qué patrón espera y de dónde sacarlo, en vez del error genérico de Rapyd.
* **Por qué existe:** porque es el paso inmediatamente anterior al cobro y, hasta que este método existió, era el único del flujo de PSE que el comercio tenía que resolver hablándole directo a la pasarela. Verlas al lado es también lo que hace evidente por qué el código de banco es opaco: en Wompi es `1`, en Mercado Pago `1007`, en Rapyd `co_pse_bancolombia_bank`. Un catálogo propio tendría que traducir en los dos sentidos y mantenerse al día con cuatro pasarelas, para resolver un problema que nadie tiene.

---

### 6. Verificar tipos sin ejecutar

```bash
npm run typecheck
```

* **Descripción:** Ejecuta `tsc --noEmit` para verificar que el código de los ejemplos compila perfectamente contra las definiciones de tipos (`.d.ts`) generadas por el SDK.
* **Utilidad:** Detecta al instante si algún cambio en el SDK rompió la superficie pública expuesta a los comercios, sin necesidad de levantar la API de simulación.

---

## Manejo de errores de conexión

Si ejecutas cualquiera de los ejemplos sin haber levantado previamente la `simulator-api`, el SDK capturará el fallo de red y arrojará un `KitPagosError` con código `KitPagosErrorCode.CONNECTION_FAILED`, imprimiendo una advertencia amigable en consola que te recordará iniciar el simulador:

```text
❌ No se pudo conectar con la API de Simulación.
Asegúrate de haberla iniciado en otra terminal:

  cd simulator-api && npm run dev
```

---

## Nota sobre el pipeline (CI)

El CI del repositorio ejecuta pruebas y verificaciones en `sdk` y `simulator-api`. Por lo tanto, si realizas cambios que afecten la API pública del SDK, ejecuta `npm run typecheck` en esta carpeta localmente antes de crear un pull request.
