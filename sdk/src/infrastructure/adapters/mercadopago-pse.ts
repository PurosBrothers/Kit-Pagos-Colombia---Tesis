/**
 * Mecánica de PSE en Mercado Pago, que no se parece a la de Wompi.
 *
 * ## Qué se midió contra la API real, y qué salió
 *
 * Todo lo que sigue está medido contra `https://api.mercadopago.com` el 18 de
 * septiembre de 2026, no leído de la documentación. Seis resultados, y cuatro de
 * ellos cambiaron el diseño:
 *
 * 1. **PSE exige la Orders API; la Payments API no sirve.** Se intentó primero
 *    por `POST /v1/payments`, que es la que el adaptador ya usaba para tarjeta,
 *    porque habría evitado un segundo endpoint. Con el banco en
 *    `transaction_details.financial_institution` la petición pasa la validación
 *    de campos y muere igual en `424 / 9032 BankTransfers Api fail`, con
 *    cualquier banco, cualquier monto y los dos `entity_type`. Las mismas
 *    credenciales sí procesan tarjeta (fallan en `3003 Invalid card_token_id`,
 *    o sea solo por el token falso), así que no era un problema de permisos.
 *    Por eso este flujo va a `POST /v1/orders` y no al endpoint de tarjeta.
 *
 * 2. **Las credenciales de prueba no pueden crear órdenes.** Un token `TEST-`
 *    devuelve `401 invalid_credentials` en la Orders API, con el mensaje "Test
 *    credentials are not supported, use test users with production credentials
 *    to sandbox environment". Hace falta el token `APP_USR-`.
 *
 * 3. **Y un usuario de prueba como pagador rompe el pago**, que es lo contrario
 *    de lo que ese mismo mensaje aconseja. Con un email
 *    `test_user_...@testuser.com` la orden se crea pero el pago interno queda en
 *    `failed / processing_error` (HTTP 402), medido con dos bancos distintos.
 *    Con un email corriente responde 201 y entrega la redirección. Es una
 *    contradicción de la propia pasarela y conviene tenerla escrita, porque el
 *    síntoma no dice nada sobre la causa.
 *
 * 4. **La URL de redirección viene en la respuesta de creación**, en
 *    `transactions.payments[0].payment_method.redirect_url`. A diferencia de
 *    Wompi (punto 43), acá no hace falta sondear: Mercado Pago sí es un flujo de
 *    una sola llamada antes de redirigir.
 *
 * 5. **`total_amount` no admite decimales.** `"2000"` responde 201 y `"2000.00"`
 *    responde `400 Invalid value for property`. Importa porque `Amount.getValue()`
 *    conserva la escala con la que el comercio escribió el monto, así que un
 *    `"2000.00"` perfectamente válido en el dominio es inválido acá. De ahí
 *    `toWholePesos()`.
 *
 * 6. **Un banco inexistente no se detecta al crear.** El código `"9999"` pasa la
 *    validación y muere después en `processing_error`, igual que en Wompi. Y por
 *    debajo del mínimo de la cuenta (1600 COP) responde 422.
 *
 * ## Qué es obligatorio, medido por omisión
 *
 * Cada uno de estos campos, quitado por separado, devuelve `400` con
 * `'$.payer' - missing properties`: `email`, `entity_type`, `first_name`,
 * `last_name`, `identification`, `phone` y `address`. Fuera de `payer` son
 * obligatorios `additional_info` (la IP del pagador), `external_reference` y
 * `config` (la URL de retorno). `expiration_time` y `processing_mode` son
 * opcionales: sin ellos responde 201 igual.
 *
 * La consecuencia para el contrato es que **`ReturnUrlConfig` deja de ser
 * opcional en esta pasarela**, al revés de lo que se midió en Wompi, donde
 * `redirect_url` aceptaba 201 sin ella (punto 43). Es la asimetría más concreta
 * que apareció entre dos pasarelas para el mismo método de pago.
 *
 * ## Por qué es un módulo de funciones y no métodos del adaptador
 *
 * Por lo mismo que `wompi-pse.ts` y `payment-method-support.ts`: el
 * `MercadoPagoAdapter` ya estaba en CBO 5 de 5, y el script de métricas cuenta
 * los tipos que aparecen en firmas de métodos. Un método privado que devolviera
 * el payload o la redirección le sumaría acoplamiento sin agregar lógica. Acá no
 * le cuesta nada a nadie (`architecture-log.md`, punto 34).
 */
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import { Gateway } from "../../domain/value-objects/Gateway";
import { GatewayTransactionId } from "../../domain/value-objects/GatewayTransactionId";
import type { PendingRedirect } from "../../domain/value-objects/PaymentResult";
import type { PayerKind } from "../../domain/value-objects/PaymentMethod";
import type { Amount } from "../../domain/value-objects/Amount";
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * Naturaleza jurídica tal como la nombra Mercado Pago.
 *
 * `association` para persona jurídica está medido: con `entity_type:
 * "association"` y un NIT la orden se crea y entrega redirección.
 */
const ENTITY_TYPES: Readonly<Record<PayerKind, string>> = {
  NATURAL: "individual",
  LEGAL: "association",
};

/** Prefijo de los identificadores de orden, para distinguirlos de los de pago. */
const ORDER_ID_PREFIX = "ORD";

/**
 * Monto en pesos enteros, como string.
 *
 * Lanza en vez de redondear cuando hay centavos, por la misma razón que
 * `Amount.toMinorUnits()` lanza en vez de truncar: cobrar un monto distinto del
 * que el comercio pidió es peor que fallar. Mercado Pago rechaza los decimales
 * en `total_amount` (medido: `"2000.00"` da 400), así que no hay forma de
 * mandarlos y hay que decidir explícitamente.
 */
export function toWholePesos(amount: Amount): string {
  const [pesos, cents] = amount.getValue().split(".");

  if (cents && /[1-9]/.test(cents)) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      `Mercado Pago no acepta centavos en PSE: el monto ${amount.getValue()} ` +
        `tiene decimales distintos de cero y total_amount solo admite pesos enteros.`,
    );
  }

  return pesos;
}

/**
 * Campos que Mercado Pago exige para PSE y que el dominio deja opcionales.
 *
 * Se valida acá y no en `Payer` porque son requisitos de una sola pasarela:
 * meterlos en el objeto de valor obligaría a un comercio que cobra con tarjeta
 * por Wompi a informar la dirección del pagador. Es el mismo criterio con el que
 * los tipos de documento de Wompi viven en `wompi-pse.ts`.
 *
 * Se acumulan todos los que faltan en un solo error en vez de fallar en el
 * primero, porque el comercio puede corregirlos de una sola vez en lugar de
 * descubrirlos uno por uno.
 */
export function assertPseRequirements(request: CreatePaymentRequest): void {
  const { payer } = request;
  const missing: string[] = [];

  if (!payer.documentType || !payer.documentNumber) {
    missing.push("payer.documentType y payer.documentNumber");
  }
  if (!payer.firstName) missing.push("payer.firstName");
  if (!payer.lastName) missing.push("payer.lastName");
  if (!payer.phone || !payer.phoneAreaCode) {
    missing.push("payer.phone y payer.phoneAreaCode");
  }
  if (!payer.address) missing.push("payer.address");
  if (!request.ipAddress) missing.push("ipAddress");
  // Mercado Pago rechaza la orden sin `config.online.callback_url`, de modo que
  // acá ReturnUrlConfig no es opcional como sí lo es en Wompi.
  if (!request.returnUrlConfig?.resolveFor("PENDING")) {
    missing.push("returnUrlConfig con una URL aplicable a PENDING");
  }

  if (missing.length > 0) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.MERCADOPAGO,
      null,
      `PSE en Mercado Pago requiere estos datos y no llegaron: ${missing.join(", ")}.`,
    );
  }
}

/**
 * Arma el cuerpo de `POST /v1/orders`.
 *
 * Asume que `assertPseRequirements()` ya corrió: los `?? ""` que quedan son para
 * satisfacer al compilador, no una tolerancia real a datos faltantes.
 */
export function buildPseOrderPayload(
  request: CreatePaymentRequest,
): Record<string, unknown> {
  const { payer, paymentMethod } = request;
  const total = toWholePesos(request.amount);
  const address = payer.address;

  return {
    type: "online",
    total_amount: total,
    external_reference: request.orderReference.getValue(),
    processing_mode: "automatic",
    payer: {
      email: payer.email,
      entity_type: ENTITY_TYPES[paymentMethod?.payerKind ?? "NATURAL"],
      identification: {
        type: payer.documentType,
        number: payer.documentNumber,
      },
      first_name: payer.firstName,
      last_name: payer.lastName,
      phone: {
        area_code: payer.phoneAreaCode,
        number: payer.phone,
      },
      address: {
        street_name: address?.streetName ?? "",
        street_number: address?.streetNumber ?? "",
        city: address?.city ?? "",
        zip_code: address?.zipCode ?? "",
        neighborhood: address?.neighborhood ?? "",
      },
    },
    transactions: {
      payments: [
        {
          amount: total,
          payment_method: {
            id: "pse",
            type: "bank_transfer",
            financial_institution: paymentMethod?.bankCode ?? "",
          },
        },
      ],
    },
    // La clave lleva un punto en el nombre; no es un objeto anidado.
    additional_info: { "payer.ip_address": request.ipAddress },
    config: {
      online: {
        // Mercado Pago admite una sola URL de retorno mientras ReturnUrlConfig
        // admite una por resultado. Se resuelve con "PENDING" porque es el estado
        // en el que está el pago cuando se redirige al pagador, igual que en
        // Wompi. Si el comercio configuró URLs diferenciadas, las otras se
        // pierden: es una limitación de la pasarela, no del SDK.
        callback_url: request.returnUrlConfig?.resolveFor("PENDING"),
      },
    },
  };
}

/** Navegación defensiva sobre una respuesta de la que no se sabe nada todavía. */
function readObject(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== "object" || source === null) return undefined;
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "object" || value === null) return undefined;
  return value as Record<string, unknown>;
}

/**
 * El primer pago de la orden, que es donde viven el estado y la redirección.
 *
 * Mercado Pago modela `transactions.payments` como lista porque una orden puede
 * pagarse en varias partes. El SDK crea siempre un solo pago, así que el primero
 * es el único; si algún día se soportaran pagos divididos, este es el lugar que
 * habría que repensar.
 */
function firstPayment(rawResponse: unknown): Record<string, unknown> | undefined {
  const order = readObject(rawResponse, "data") ?? rawResponse;
  const transactions = readObject(order, "transactions");
  const payments = (transactions?.payments ?? []) as unknown[];
  const payment = payments[0];
  if (typeof payment !== "object" || payment === null) return undefined;
  return payment as Record<string, unknown>;
}

/**
 * Convierte la respuesta de creación en una redirección pendiente.
 *
 * Lanza si no hay URL, en vez de devolver una redirección vacía, por la misma
 * razón que el sondeo de Wompi lanza (punto 43): el comercio recibiría algo que
 * parece válido, no redirigiría a nadie, y el pago quedaría colgado hasta
 * expirar. El error lleva el identificador porque la orden **ya existe** en la
 * pasarela y perderlo volvería irrastreable un cobro real.
 */
export function extractOrderRedirect(rawResponse: unknown): PendingRedirect {
  const order = (readObject(rawResponse, "data") ?? rawResponse) as
    | Record<string, unknown>
    | undefined;
  const payment = firstPayment(rawResponse);
  const method = readObject(payment, "payment_method");

  const orderId = String(order?.id ?? "");
  const redirectUrl = method?.redirect_url;
  const rawStatus = String(order?.status ?? payment?.status ?? "");

  if (typeof redirectUrl !== "string" || redirectUrl.length === 0) {
    throw new KitPagosError(
      KitPagosErrorCode.MALFORMED_RESPONSE,
      Gateway.MERCADOPAGO,
      null,
      `Mercado Pago creó la orden ${orderId} en estado '${rawStatus}' pero no ` +
        `entregó la URL del banco: consultar su estado con getStatus().`,
    );
  }

  return {
    redirectUrl,
    gatewayTransactionId: new GatewayTransactionId(orderId, Gateway.MERCADOPAGO),
    rawStatus,
  };
}

/**
 * Si un identificador corresponde a una orden y no a un pago.
 *
 * Existe porque Mercado Pago tiene dos familias de recursos con endpoints
 * distintos, y `getStatus()` recibe un string plano: los pagos de tarjeta se
 * consultan en `/v1/payments/{id}` con un id numérico, y las órdenes de PSE en
 * `/v1/orders/{id}` con un ULID prefijado `ORD` (medido:
 * `ORD01M2V7ZQH9BAZ57V99VG1NY0K1`). Distinguir por el prefijo es frágil en
 * apariencia, pero la alternativa era cambiar la firma del puerto para las
 * cuatro pasarelas y así meterle a las otras tres una distinción que no tienen.
 */
export function isOrderId(gatewayTransactionId: string): boolean {
  return gatewayTransactionId.startsWith(ORDER_ID_PREFIX);
}
