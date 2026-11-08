# Primer pago contra el simulador

Un cobro completo, de la nada al resultado, en unos diez minutos. Al final va a tener un pago aprobado, uno rechazado y uno con redirección a un banco, todo sin credenciales de ninguna pasarela y sin salir de su máquina.

No hace falta entender por qué funciona. Para eso está la [referencia del SDK](../referencia/sdk.md) y la de la [API de Simulación](../referencia/api-simulacion.md).

---

## 1. Lo que necesita

- Node.js 20.19 o superior.
- El repositorio clonado.

```bash
node --version   # v20.19.0 o superior
```

---

## 2. Levantar el simulador

El simulador consume el SDK ya compilado, así que primero se compila el SDK:

```bash
cd sdk && npm install && npm run build
```

Después, en otra terminal:

```bash
cd simulator-api && npm install && npm run dev
```

Debe quedar escuchando en `http://localhost:3000`. Compruébelo:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

> **Deje esa terminal abierta.** Todo lo que sigue habla con ese servidor.

---

## 3. Crear su proyecto

En una carpeta aparte, fuera del repositorio:

```bash
mkdir mi-primer-pago && cd mi-primer-pago
npm init -y
npm install kit-pagos-colombia ts-node typescript
```

---

## 4. El primer cobro: uno aprobado

```typescript
import {
  Amount,
  Currency,
  Gateway,
  KitPagos,
  OrderReference,
  Payer,
  PaymentMethod,
} from "kit-pagos-colombia";

// `environment: "simulator"` es el valor por omisión: apunta al simulador local.
// Las credenciales son de mentira: el simulador no las valida contra nadie.
const sdk = new KitPagos({
  gateway: Gateway.WOMPI,
  credentials: {
    [Gateway.WOMPI]: {
      publicKey: "pub_test_demo",
      privateKey: "prv_test_demo",
      integritySecret: "test_integrity_kit_pagos_simulator",
    },
  },
});
```

Guarde eso en `pago.ts` y añada la función que cobra:

```typescript
async function primerPago() {
  const result = await sdk.createPayment({
    amount: new Amount("75000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORD-2026-0001"),
    payer: new Payer({ email: "cliente@ejemplo.com", fullName: "Jaime Pavlich" }),
    paymentMethod: PaymentMethod.card("tok_test_card_12345", { installments: 1 }),
  });

  if (result.outcome === "REDIRECT_REQUIRED") {
    console.log("Hay que redirigir al pagador:");
    if (result.redirect) {
      console.log(result.redirect.redirectUrl);
    }
    return;
  }

  console.log("Estado:", result.transaction.getStatus());
  console.log("Id en la pasarela:", result.transaction.gatewayTransactionId.value);
}

primerPago();
```

Ejecútelo:

```bash
npx ts-node pago.ts
# Estado: APPROVED
```

**Ya cobró.** El monto `75000` no es un monto reservado, así que el simulador aprueba.

---

## 5. Consultar el estado

El id que devolvió el cobro sirve para consultarlo después. Es lo que hace un comercio cuando el pagador no vuelve de la pasarela:

```typescript
async function consultar(id: string) {
  const transaction = await sdk.getPaymentStatus(id);
  console.log(transaction.getStatus(), transaction.isApproved());
}
```

---

## 6. Provocar un rechazo

Acá está lo útil del simulador: **el mismo código, cambiando el monto**, produce un desenlace distinto.

```typescript
async function pagoRechazado() {
  const result = await sdk.createPayment({
    amount: new Amount("10100"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORD-2026-0002"),
    payer: new Payer({ email: "cliente@ejemplo.com" }),
    paymentMethod: PaymentMethod.card("tok_test_card_12345", { installments: 1 }),
  });

  if (result.outcome === "TRANSACTION") {
    console.log("Estado:", result.transaction.getStatus());
    console.log("Motivo:", result.transaction.rejectionReason);
  }
}
```

`10100` es el monto reservado del simulador para `DECLINED`. Nada más cambió.

> Si integrara con una pasarela real, el rechazo llegaría con una tarjeta de prueba, no con un monto. Los montos reservados son una convención del simulador; las tarjetas de rechazo son datos de prueba reales y funcionan en los dos lados. Están en [la referencia de datos de prueba](../referencia/datos-de-prueba.md).

---

## 7. Un PSE, que redirige

PSE siempre redirige: el pagador tiene que autorizar en el portal de su banco.

```typescript
async function pagoPse() {
  const result = await sdk.createPayment({
    amount: new Amount("150000"),
    currency: new Currency("COP"),
    orderReference: new OrderReference("ORD-2026-0003"),
    payer: new Payer({
      email: "comprador@banco.com",
      fullName: "Jaime Pavlich",
      documentType: "CC",
      documentNumber: "1099888777",
    }),
    paymentMethod: PaymentMethod.pse({ bankCode: "1", payerKind: "NATURAL" }),
  });

  if (result.outcome === "REDIRECT_REQUIRED") {
    console.log("Abra esta URL en el navegador:");
    if (result.redirect) {
      console.log(result.redirect.redirectUrl);
    }
    console.log("Guarde este id:", result.redirect?.gatewayTransactionId.value);
  }
}
```

Abra la URL que imprime: es una página del propio simulador que avisa que la redirección es simulada y ofrece «Volver al comercio». No es la página de un banco real.

El banco `1` es el que aprueba en el sandbox de Wompi; `2` rechaza y `3` da error.

---

## 8. Lo que sigue

- **Verificar webhooks**: el simulador puede emitirlos firmados. Está en [la referencia de la API de Simulación](../referencia/api-simulacion.md) §5.
- **Consumir por HTTP**, sin instalar el paquete: [la referencia de la API REST](../referencia/api-rest.md).
- **Todos los datos de prueba**, pasarela por pasarela: [la referencia de datos de prueba](../referencia/datos-de-prueba.md).
- **Los límites del producto**, antes de llevar esto a producción: [`README.md`](../README.md#4-los-límites-del-producto).
