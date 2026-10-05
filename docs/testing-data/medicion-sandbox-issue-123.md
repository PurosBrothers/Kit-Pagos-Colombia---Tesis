# Evidencia de Ejecución contra Sandbox Real (Issue #123)

- **Fecha y hora de ejecución:** `2026-10-05T18:48:23.170Z`
- **Operación ejecutada:** `POST /v1/api/payments`
- **Cabecera de ambiente:** `x-kit-pagos-environment: sandbox`
- **Fuente de credenciales:** Perfil de servidor (.env) sin credenciales de cliente enviadas.
- **Archivo de datos en crudo:** [`sandbox-payments-execution-issue-123.json`](./sandbox-payments-execution-issue-123.json)

---

## 1. Resumen por Pasarela

| Pasarela | URL de Sandbox Resuelta | HTTP Status | Outcome / Desenlace | ID Transacción / Redirección | Advertencia `SERVER_SANDBOX_CREDENTIALS_USED` |
|---|---|:---:|---|---|:---:|
| **Wompi** | `https://sandbox.wompi.co/v1` | **201** | `TRANSACTION` (`PENDING`) | `12066420-1791226107-72286` | Presente en Header y Body |
| **Kushki** | `https://api-uat.kushkipagos.com` | **201** | `TRANSACTION` (`APPROVED`) | `105752898821505149` | Presente en Header y Body |
| **Rapyd** | `https://sandboxapi.rapyd.net/v1` | **201** | `REDIRECT_REQUIRED` | `checkout_baa825af10b3c7ce282f2799d2149b51` | Presente en Header y Body |
| **Mercado Pago** | `https://api.mercadopago.com/v1` | **400** | `INVALID_REQUEST` (Rechazo API MP) | N/A (Error retornado por endpoint de MP) | Presente en Header y Body |

---

## 2. Detalle de Respuestas y Cabeceras

### Wompi
- **Cabecera `x-kit-pagos-warning`:**
  ```text
  Para pruebas futuras se recomienda utilizar las credenciales propias. Se usaron las credenciales de sandbox del servidor porque falta: x-gateway-public-key, x-gateway-private-key.
  ```
- **Respuesta JSON:**
  ```json
  {
    "outcome": "TRANSACTION",
    "transaction": {
      "gatewayTransactionId": "12066420-1791226107-72286",
      "orderReference": "SBX-WOMPI-1791226106067",
      "amount": "15000.00",
      "currency": "COP",
      "payer": {
        "email": "usuario@ejemplo.com"
      },
      "status": "PENDING",
      "rawStatus": "PENDING",
      "isApproved": false,
      "isPending": true,
      "isFinal": false
    },
    "rawStatus": "PENDING",
    "warnings": [
      {
        "code": "SERVER_SANDBOX_CREDENTIALS_USED",
        "message": "Para pruebas futuras se recomienda utilizar las credenciales propias. Se usaron las credenciales de sandbox del servidor porque falta: x-gateway-public-key, x-gateway-private-key."
      }
    ]
  }
  ```

### Kushki
- **Cabecera `x-kit-pagos-warning`:** Presente con advertencia de credenciales de servidor.
- **Respuesta JSON:**
  ```json
  {
    "outcome": "TRANSACTION",
    "transaction": {
      "gatewayTransactionId": "105752898821505149",
      "orderReference": "SBX-KUSHKI-1791226109513",
      "amount": "10000.00",
      "currency": "COP",
      "payer": {
        "email": "usuario@ejemplo.com"
      },
      "status": "APPROVED",
      "rawStatus": "APPROVAL",
      "isApproved": true,
      "isPending": false,
      "isFinal": true
    },
    "rawStatus": "APPROVAL",
    "warnings": [
      {
        "code": "SERVER_SANDBOX_CREDENTIALS_USED",
        "message": "Para pruebas futuras se recomienda utilizar las credenciales propias. Se usaron las credenciales de sandbox del servidor porque falta: x-gateway-public-key, x-gateway-private-key."
      }
    ]
  }
  ```

### Rapyd
- **Cabecera `x-kit-pagos-warning`:** Presente con advertencia de credenciales de servidor.
- **Respuesta JSON:**
  ```json
  {
    "outcome": "REDIRECT_REQUIRED",
    "redirect": {
      "redirectUrl": "https://sandboxcheckout.rapyd.net/?token=checkout_baa825af10b3c7ce282f2799d2149b51",
      "gatewayTransactionId": "checkout_baa825af10b3c7ce282f2799d2149b51",
      "rawStatus": "NEW"
    },
    "warnings": [
      {
        "code": "SERVER_SANDBOX_CREDENTIALS_USED",
        "message": "Para pruebas futuras se recomienda utilizar las credenciales propias. Se usaron las credenciales de sandbox del servidor porque falta: x-gateway-public-key, x-gateway-private-key."
      }
    ]
  }
  ```

### Mercado Pago
- **Cabecera `x-kit-pagos-warning`:** Presente con advertencia de credenciales de servidor.
- **Respuesta JSON:**
  ```json
  {
    "code": "INVALID_REQUEST",
    "message": "Mercado Pago gateway returned an HTTP error status 400",
    "warnings": [
      {
        "code": "SERVER_SANDBOX_CREDENTIALS_USED",
        "message": "Para pruebas futuras se recomienda utilizar las credenciales propias. Se usaron las credenciales de sandbox del servidor porque falta: x-gateway-public-key, x-gateway-private-key."
      }
    ]
  }
  ```
