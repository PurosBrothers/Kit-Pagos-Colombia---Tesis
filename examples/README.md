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

### 3. Simulación de pago con Rapyd

```bash
npm run simulate:rapyd
```

* **Archivo:** `simulate-rapyd-payment.ts`
* **Por qué existe uno por pasarela:** cada archivo puede detenerse en las particularidades de su pasarela sin distraer del flujo, y la comparación entre archivos es directa, porque los pasos 2, 3 y 4 son idénticos en el código del comercio y lo único que cambia es la configuración inicial. El ejemplo parametrizable que recorre las cuatro en un solo archivo existe aparte, es el número 5.
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

### 5. Intercambiabilidad de las cuatro pasarelas

```bash
npm run simulate:interchangeability
```

* **Archivo:** `gateway-interchangeability.ts`
* **Qué demuestra:** el mismo pago, descrito **una sola vez**, cobrado por las cuatro pasarelas sin que cambie una línea del código del comercio. Es el cierre de la Iteración 2 y el argumento central de la tesis convertido en código ejecutable. Los cuatro ejemplos anteriores muestran una pasarela cada uno; este muestra lo que ninguno puede mostrar solo, porque la intercambiabilidad es una propiedad de la relación entre las cuatro.
* **Qué esperar:** una tabla comparativa con el estado normalizado, el estado nativo, el monto y el identificador de cada pasarela. La columna que cambia es la del estado nativo — `APPROVED`, `CLO`, `approved` y `APPROVAL` son la misma cosa dicha de cuatro formas —; la del estado normalizado es una sola.
* **La verificación no es visual.** El ejemplo compara por código que las cuatro coincidan en estado normalizado, monto y referencia de la orden, y **sale con código distinto de cero** si alguna no coincide. Romper a mano el mapeo de estados de cualquier adaptador lo pone rojo, así que funciona como prueba de regresión ejecutable.
* **Detalle a tener en cuenta:** el monto se compara con `Amount.equals()` y no con `===` sobre la cadena, porque Wompi y Rapyd devuelven `150000.00` y Mercado Pago y Kushki `150000`. Es el mismo monto con distinta escala, y comparar cadenas daría un fallo que no es un fallo.

Explicación completa, con los límites de la demostración, en [`docs/examples/gateway-interchangeability.md`](../docs/examples/gateway-interchangeability.md).

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
