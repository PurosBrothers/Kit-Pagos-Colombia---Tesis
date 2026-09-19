# Credenciales

El primer paso para probar la API es disponer de las credenciales de prueba y configurar la key de entorno en el archivo `.env`:

* **`MERCADO_PAGO_ACCESS_TOKEN`**: Clave privada de prueba generada en Mercado Pago para peticiones del backend (comienza obligatoriamente con el prefijo **`APP_USR-`**).



Para realizar compras de prueba exitosas con **Mercado Pago**, debes utilizar en el checkout el **e-mail del comprador obligatorio**: **`test@testuser.com`**.

A continuación se detallan los datos de prueba específicos para cada método de pago y el paso a paso de implementación cuando aplique.

---

# Datos de Prueba en Sandbox — Mercado Pago

## 1. Tarjetas (Crédito / Débito)

Mercado Pago proporciona **tarjetas de prueba** genéricas que puedes combinar con **datos específicos en el nombre del titular** para simular distintos escenarios de respuesta.

### Datos de la Tarjeta

| Tipo de Tarjeta | Bandera / Marca | Número de Tarjeta | Código de Seguridad (CVV) | Fecha de Caducidad |
| --- | --- | --- | --- | --- |
| **Tarjeta de Crédito** | Mastercard | `5254 1336 7440 3564` | `123` | `11/30` |
| **Tarjeta de Crédito** | Visa | `4013 5406 8274 6260` | `123` | `11/30` |
| **Tarjeta de Débito** | Visa | `4915 1120 5524 6507` | `123` | `11/30` |

### Escenarios de Prueba (Datos del Titular)

Ingresa los siguientes valores en el campo **Nombre y Apellido del Titular** para forzar el estado deseado del pago:

| Estado / Resultado del Pago | Nombre del Titular (`name`) | Documento de Identidad |
| --- | --- | --- |
| **Pago Aprobado** | `APRO` | `123456789` |
| **Rechazado por Error General** | `OTHE` | `123456789` |
| **Pendiente de Pago** | `CONT` | `-` |
| **Rechazado con Validación para Autorizar** | `CALL` | `-` |
| **Rechazado por Importe Insuficiente** | `FUND` | `-` |
| **Rechazado por Código de Seguridad Inválido** | `SECU` | `-` |
| **Rechazado por Fecha de Vencimiento** | `EXPI` | `-` |
| **Rechazado por Error de Formulario** | `FORM` | `-` |
| **Rechazado por Falta de `card_number**` | `CARD` | `-` |
| **Rechazado por Cuotas Inválidas** | `INST` | `-` |
| **Rechazado por Pago Duplicado** | `DUPL` | `-` |
| **Rechazado por Tarjeta Deshabilitada** | `LOCK` | `-` |
| **Rechazado por Tipo de Tarjeta No Permitida** | `CTNA` | `-` |
| **Rechazado por Intentos Excedidos de PIN** | `ATTE` | `-` |
| **Rechazado por Estar en Lista Negra** | `BLAC` | `-` |
| **No Soportado** | `UNSU` | `-` |
| **Usado para Aplicar Regla de Montos** | `TEST` | `-` |

---

## 2. PSE (Pagos Seguros en Línea)

> ### Verificado contra la API real el 18 de septiembre de 2026 (issue #64)
>
> Lo que sigue en esta sección es correcto en cuanto a la forma del payload y a la
> ubicación de la URL de redirección. Pero al implementarlo aparecieron cuatro
> cosas que no están dichas acá y que hacen fallar la integración si uno sigue el
> paso a paso literalmente. El razonamiento completo está en el punto 45 del
> `architecture-log.md` y en `sdk/src/infrastructure/adapters/mercadopago-pse.ts`.
>
> 1. **El token `TEST-` no sirve para esta API.** `POST /v1/orders` responde
>    `401 invalid_credentials`: "Test credentials are not supported, use test users
>    with production credentials to sandbox environment". Hace falta el token
>    `APP_USR-`, que es lo que ya decía el paso 1 pero sin explicar que un `TEST-`
>    falla de entrada.
>
> 2. **El email del ejemplo no funciona, y un usuario de prueba tampoco.** Con
>    `test_user_co@testuser.com` la respuesta es `400 / 2034 Invalid users
>    involved`. Y con un usuario creado por `POST /users/test_user` la orden se
>    crea pero el pago muere en `failed / processing_error` (402), o sea lo
>    contrario de lo que aconseja el mensaje de error del punto anterior. **Hay que
>    usar un email corriente** (por ejemplo `comprador@example.com`).
>
> 3. **`total_amount` no admite decimales.** `"5000"` funciona y `"5000.00"`
>    responde `400 Invalid value for property`.
>
> 4. **PSE no se puede cobrar por la Payments API.** Se intentó por
>    `POST /v1/payments` con el banco en `transaction_details.financial_institution`
>    y devuelve `424 / 9032 BankTransfers Api fail` con cualquier banco y cualquier
>    monto, aunque las mismas credenciales sí procesen tarjeta. La Orders API no es
>    una alternativa: es el único camino.
>
> **Campos obligatorios, medidos quitándolos de a uno.** En `payer`: `email`,
> `entity_type`, `first_name`, `last_name`, `identification`, `phone` y `address`,
> todos con `400 '$.payer' - missing properties`. Fuera de `payer`:
> `additional_info` (la IP), `external_reference` y `config` (la URL de retorno).
> Son opcionales `expiration_time` y `processing_mode`.
>
> **Lista real de bancos.** No hace falta adivinarla: `GET /v1/payment_methods`
> devuelve el método `pse` con su arreglo `financial_institutions`. Ahí están
> `1001` Banco de Bogotá, `1007` Bancolombia, `1013` BBVA, `1051` Davivienda y el
> resto, junto con `min_allowed_amount: 1600` y `max_allowed_amount: 340000000`.
> Un código inexistente **no** se rechaza al crear: pasa la validación y el pago
> muere después en `processing_error`.
>
> Son **47 entidades**, contadas contra la API real el 18 de septiembre de 2026 — el
> mismo número que devuelve Rapyd, porque las dos leen el registro de ACH Colombia.
> El SDK las expone con `kitPagos.getPseBanks()`, que filtra esa entrada del
> catálogo; el comercio no tiene que conocer que la lista viene anidada dentro de
> todos los métodos de pago del país.

### Paso a paso de implementación en Sandbox (Orders API)

1. **Crear la Orden:** Envía la solicitud a `POST /v1/orders` utilizando tu `Access Token` de prueba:



```json
{
  "type": "online",
  "total_amount": "5000",
  "external_reference": "ext_ref_1234",
  "processing_mode": "automatic",
  "expiration_time": "PT20M",
  "payer": {
    "email": "test_user_co@testuser.com",
    "entity_type": "individual",
    "identification": {
      "type": "CC",
      "number": "76262349"
    },
    "first_name": "John",
    "last_name": "Doe",
    "phone": {
      "area_code": "57",
      "number": "3001234567"
    },
    "address": {
      "street_name": "Calle 10",
      "street_number": "100",
      "city": "Bogota",
      "zip_code": "110111",
      "neighborhood": "Centro"
    }
  },
  "transactions": {
    "payments": [
      {
        "amount": "5000",
        "payment_method": {
          "id": "pse",
          "type": "bank_transfer",
          "financial_institution": "1051"
        }
      }
    ]
  },
  "additional_info": {
    "payer.ip_address": "200.100.50.25"
  },
  "config": {
    "online": {
      "callback_url": "https://merchant.com/pse/return"
    }
  }
}

```

2. **Obtener la URL de Redirección:** La respuesta devolverá `status: "action_required"` y `status_detail: "waiting_transfer"`. Ubica y extrae la URL del campo:
`transactions.payments[0].payment_method.redirect_url`


3. **Simular el Pago en el Sandbox:**
* Abre la `redirect_url` en el navegador para ingresar al simulador bancario.


* Ingresa **cualquier usuario y contraseña** en la pantalla inicial de inicio de sesión del banco.


* En el menú desplegable de escenarios, selecciona el estado de prueba deseado (**Aprobación**, **Abandono**, **Fondos Insuficientes**, **Cuenta Inactiva**, etc.) y haz clic en **Enviar**.


* Haz clic en **Volver al comercio** para ser redirigido automáticamente a la `callback_url`.





---

## 3. Verificación y Operaciones de Prueba

### Verificar el Estado de una Compra

Para consultar el resultado final de cualquier transacción (tarjeta o PSE), realiza una petición `GET` al endpoint de la API:

```http
GET https://api.mercadopago.com/v1/orders/{id}

```

Reemplaza `{id}` por el identificador de la orden devuelto en la creación. El campo `status` contendrá el resultado de la prueba.

### Reembolsos de Prueba

Si necesitas realizar un reembolso de prueba (`POST /v1/orders/{id}/refund`), ejecuta el llamado a la API utilizando únicamente tu **`Access Token` de prueba** (`APP_USR-`).