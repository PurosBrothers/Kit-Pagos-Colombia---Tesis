# Credenciales
El primer paso para probar la API es tener las credenciales y sus keys, estas se encontraran en el ``.env``. 


Para integrar los ambientes de prueba (Sandbox) de **Wompi Colombia**, es necesario utilizar la llave pública de pruebas con el prefijo **`pub_test_`**.

Para integrar los ambientes de prueba (Sandbox) de Wompi, las peticiones deben dirigirse a la URL base: ``https://sandbox.wompi.co/v1``

A continuación se detallan los datos de prueba específicos para cada método de pago y el paso a paso de implementación cuando aplique.

---

# Datos de Prueba en Sandbox — Wompi Colombia

## 1. Tarjetas (Crédito / Débito)

Para probar la tokenización vía API (`POST /tokens/cards`) o mediante el Widget de Checkout:

| Estado Final | Número de Tarjeta | Fecha de Expiración | CVC |
| --- | --- | --- | --- |
| **Aprobada (`APPROVED`)** | `4242 4242 4242 4242` | Cualquier fecha futura | 3 dígitos cualquiera (ej: `123`) |
| **Declinada (`DECLINED`)** | `4111 1111 1111 1111` | Cualquier fecha futura | 3 dígitos cualquiera (ej: `123`) |

> **Nota:** Usar cualquier otro número de tarjeta generará un estado final **`ERROR`**.

---

## 2. Nequi

### Datos de prueba

| Estado Final | Número de Teléfono (`phone_number`) |
| --- | --- |
| **Aprobada (`APPROVED`)** | `3991111111` |
| **Declinada (`DECLINED`)** | `3992222222` |

> Cualquier otro número de teléfono resultará en un estado **`ERROR`**.

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "NEQUI",
    "phone_number": "3991111111"
  }
}

```

---

## 3. PSE (Pagos Seguros en Línea)

### Integración API Directa (`POST /transactions`)

Se debe pasar el código de institución financiera (`financial_institution_code`):

| Estado Final | `financial_institution_code` |
| --- | --- |
| **Aprobada (`APPROVED`)** | `"1"` |
| **Declinada (`DECLINED`)** | `"2"` |

### Integración con Widget

En la interfaz visual desplegada, selecciona una de las siguientes opciones del listado de bancos:

* **Banco que aprueba**: Simula una transacción **`APPROVED`**.
* **Banco que rechaza**: Simula una transacción **`DECLINED`**.

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "PSE",
    "user_type": 0, // 0: Persona Natural, 1: Persona Jurídica
    "user_legal_id_type": "CC",
    "user_legal_id": "1999888777",
    "financial_institution_code": "1",
    "payment_description": "Pago a Tienda Wompi"
  }
}

```

---

## 4. Botón de Transferencia Bancolombia

### Paso a paso de implementación en Sandbox (API)

1. **Crear Transacción:** Envía la solicitud a `POST /transactions` especificando el tipo de método de pago:
```json
{
  "payment_method": {
    "type": "BANCOLOMBIA_TRANSFER",
    "payment_description": "Pago a Tienda Wompi"
  }
}

```


2. **Obtener la URL de autenticación:** Al recibir la respuesta o consultar la transacción (`GET /transactions/:id`), ubica el campo:
`data.payment_method.extra.async_payment_url`
3. **Simular el Estado:** Redirige o abre dicha URL. Te llevará a una vista de prueba (*Bandbox*) donde podrás seleccionar manualmente el estado deseado (**APPROVED**, **DECLINED**, etc.) para finalizar el flujo.

---

## 5. Bancolombia QR

### Integración API Directa (`POST /transactions`)

Define el estado deseado directamente en el payload usando la propiedad `sandbox_status`:

| Estado Final | Valor de `sandbox_status` |
| --- | --- |
| **Aprobada** | `"APPROVED"` |
| **Declinada** | `"DECLINED"` |
| **Error** | `"ERROR"` |

### Integración con Widget

En el Widget se mostrarán botones interactivos para seleccionar el estado deseado: **Transacción APROBADA**, **Transacción DECLINADA** o **Transacción con ERROR**.

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "BANCOLOMBIA_QR",
    "payment_description": "Pago a Tienda Wompi",
    "sandbox_status": "APPROVED"
  }
}

```

---

## 6. Puntos Colombia

### Integración API Directa (`POST /transactions`)

Utiliza la propiedad `sandbox_status` dentro del objeto `payment_method`:

| Caso / Estado Deseado | Valor de `sandbox_status` |
| --- | --- |
| **Pago 100% con puntos (Aprobado)** | `"APPROVED_ONLY_POINTS"` |
| **Pago 50% con puntos (Aprobado)** | `"APPROVED_HALF_POINTS"` |
| **Pago solo puntos declinado** | `"DECLINED"` |
| **Error al pagar con puntos** | `"ERROR"` |

### Ejemplo de Payload (API)

```json
{
  "payment_method": {
    "type": "PCOL",
    "sandbox_status": "APPROVED_ONLY_POINTS"
  }
}

```

---

## 7. BNPL Bancolombia (Compra Ahora, Paga Después)

### Paso a paso de implementación

1. **Iniciar Transacción:** Crea la transacción con el método de pago BNPL Bancolombia a través de la API o Widget.
2. **Redirección Sandbox:** Serás redirigido a la interfaz de pruebas de BNPL.
3. **Selección de Estado:** En la página de prueba visual se desplegará una pantalla de simulación donde podrás hacer clic en el botón correspondiente al estado con el que deseas que termine la transacción (**Aprobada**, **Rechazada**, etc.).

---

## 8. Daviplata

### A. Pago Simple (Transacción Directa)

#### Integración visual (Widget / Interfaz Wompi)

Al procesar la transacción se desplegará la interfaz con opciones de selección directa para definir si finalizará en **Aprobada**, **Declinada** o **Error**.

#### Integración vía API (Códigos OTP de prueba)

| Estado Final / Escenario | Código OTP a enviar |
| --- | --- |
| **Aprobada (`APPROVED`)** | `574829` |
| **Declinada (`DECLINED`)** | `932015` |
| **Declinada por Saldo Insuficiente** | `186743` |
| **Error (`ERROR`)** | `999999` |
| **OTP Inválido (permite reintento en estado `PENDING`)** | Cualquier otro número de 6 dígitos (ej: `123456`) |

---

### B. Pago Recurrente (Tokenización Daviplata)

#### Teléfonos de prueba para creación de Token

| Escenario | Número de Teléfono |
| --- | --- |
| **Token Aprobado** (Permite transacciones `APPROVED`) | `3991111111` |
| **Token Declinado** (Genera transacciones `DECLINED`) | `3992222222` |
| **Token Declinado (Monedero Inválido)** | `3993333333` |

#### Códigos OTP para confirmación de Token

| Escenario | Código OTP |
| --- | --- |
| **Confirmar Token Aprobado (`APPROVED`)** | `574829` |
| **Confirmar Token Declinado (Suscripción existente)** | `932016` |
| **Simular OTP Inválido** | Cualquier número de 6 dígitos diferente a los anteriores |

---

## 9. Su+ Pay

### Paso a paso de implementación

1. **Iniciar Pago:** Genera la transacción seleccionando **Su+ Pay** como método de pago.
2. **Redirección de Simulación:** El sistema redirigirá automáticamente a la página de pruebas de Sandbox de SU+ Pay.
3. **Finalización:** En la vista desplegada, elige el estado final con el cual deseas que concluya la prueba para verificar los webhooks y respuestas en tu sistema.