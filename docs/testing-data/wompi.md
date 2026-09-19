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

### 1.1. El cobro medido contra la API real (19 de septiembre de 2026)

Tres cosas que solo aparecieron al llamar, y que están en el punto 50 del `architecture-log.md`:

1. **El cobro nace `PENDING`, no `APPROVED`.** `POST /transactions` responde `201` con
   `status: "PENDING"` y `finalized_at: null`, y la transacción pasa a `APPROVED` sola unos
   cientos de milisegundos después. El resultado **no está en la respuesta de creación**.
2. **Sin `payment_method` no hay cobro:** `422 UNPROCESSABLE` con
   `"No se especificó método de pago o fuente de pago"`.
3. **Sin firma de integridad tampoco**, ni con tarjeta ni con PSE: `422` con
   `"Firma de integridad requerida no enviada"`. La firma es
   `SHA256(referencia + monto en centavos + divisa + secreto de integridad)`.

Las cuotas son opcionales: el cobro sin `installments` responde `201` igual, y la consulta
posterior devuelve la transacción sin ese campo.

```json
{
  "amount_in_cents": 15000000,
  "currency": "COP",
  "customer_email": "comprador@example.com",
  "reference": "ORDER-1042",
  "acceptance_token": "...",
  "signature": "...",
  "payment_method": { "type": "CARD", "token": "tok_test_...", "installments": 1 }
}
```

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

### La lista de bancos se pide por API (`GET /pse/financial_institutions`)

> **Medido contra el sandbox real (`https://sandbox.wompi.co/v1`) el 18 de septiembre de 2026, issue
> #64.** Se autentica con la **llave pública**, no con la privada.

Wompi es la única de las cuatro con un endpoint dedicado a esto. Devuelve
`financial_institution_code` y `financial_institution_name`, y en sandbox **lo que devuelve no son
bancos**: son tres entidades de prueba cuyo código fuerza el desenlace.

| `financial_institution_code` | `financial_institution_name` (literal, de la API) |
| --- | --- |
| `"1"` | Banco que aprueba |
| `"2"` | Banco que declina |
| `"3"` | Banco que simula un error |

El tercero no estaba documentado en este archivo y sí existe. Lo medido es la lista, no el desenlace:
el nombre dice qué simula cada uno, pero solo los códigos `1` y `2` tienen su estado final
confirmado en la tabla de abajo, que venía de antes. Vale la pena no maquillar estos
nombres al mostrarlos: un comercio que ve "Banco que declina" en su selector sabe al instante contra
qué entorno está apuntando.

### Integración API Directa (`POST /transactions`)

Se debe pasar el código de institución financiera (`financial_institution_code`), tomado de la lista
de arriba:

| Estado Final | `financial_institution_code` |
| --- | --- |
| **Aprobada (`APPROVED`)** | `"1"` |
| **Declinada (`DECLINED`)** | `"2"` |
| Error simulado (sin confirmar cuál es el estado resultante) | `"3"` |

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