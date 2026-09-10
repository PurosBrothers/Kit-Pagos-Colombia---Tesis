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
  3. Muestra un error tipado con código `UNSUPPORTED_OPERATION` al intentar consultar el estado por ID (diseñado intencionalmente para ilustrar cómo el comercio gestiona códigos de error tipados con `KitPagosError`).

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

### 3. Verificar tipos sin ejecutar

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
