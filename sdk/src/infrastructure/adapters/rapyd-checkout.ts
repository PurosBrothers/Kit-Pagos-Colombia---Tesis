/**
 * La tarjeta en Rapyd, que es el único caso de los cuatro que no se cobra con un token.
 *
 * ## Lo que se midió (19 de septiembre de 2026, sandboxapi.rapyd.net)
 *
 * El adaptador cobraba con `POST /v1/payments` sin ningún `payment_method`, y contra la
 * API real eso responde `400 MISSING_FIELDS - [PAYMENT_METHOD]`. Al buscar con qué
 * llenarlo aparecieron tres caminos y solo uno sirve:
 *
 * | Camino | Respuesta medida |
 * |---|---|
 * | `payment_method: "card_..."` (token guardado) | `400 ERROR_CARD_NOT_AUTHENTICATED` |
 * | el mismo token más `customer` y `3d_required: true` | `400 ERROR_CARD_NOT_AUTHENTICATED` |
 * | `payment_method: { type: "co_visa_card", fields: { number, cvv, ... } }` más `customer` | `200`, `ACT`, `next_action: "3d_verification"` y URL de 3DS |
 *
 * O sea que el único camino servidor-a-servidor que funciona **exige el número de la
 * tarjeta en la petición**. Eso es justo lo que el SDK no acepta: recibirlo metería al
 * SDK y a todo comercio que lo integre dentro del alcance de PCI DSS, que es la razón
 * por la que `PaymentMethod.card()` trabaja con un token y no con una tarjeta.
 *
 * ## La salida, y por qué no rompe el puerto
 *
 * Rapyd tiene una página de pago propia: `POST /v1/checkout` responde `200` con un
 * `redirect_url` a `sandboxcheckout.rapyd.net`, donde el pagador escribe la tarjeta.
 * El número nunca pasa por el SDK ni por el comercio.
 *
 * Lo notable es que el contrato **no necesitó cambiar** para expresarlo: el resultado es
 * un `REDIRECT_REQUIRED`, la misma rama que ya usaban PSE en las cuatro y 3DS en Rapyd.
 * El comercio escribe el mismo código para cobrar con tarjeta en las cuatro pasarelas y
 * lo único que cambia es que en Rapyd tiene que redirigir, que es una diferencia que la
 * unión del puerto obliga a atender y no deja ignorar (punto 39). Si el puerto hubiera
 * devuelto `Transaction`, este caso no habría entrado sin un campo nuevo.
 *
 * El costo, dicho: en Rapyd el `cardToken` que el comercio haya conseguido **no se usa**,
 * porque su página pide la tarjeta de nuevo. No se rechaza para no obligar al comercio a
 * escribir código distinto por pasarela, que es lo que el SDK existe para evitar; queda
 * documentado acá, en `PaymentMethod.card()` y en el punto 50 del `architecture-log.md`.
 */
import type { CreatePaymentRequest } from "../../application/ports/PaymentGatewayPort";

/**
 * Prefijo de los identificadores de checkout.
 *
 * Rapyd prefija sus identificadores por tipo de recurso (`payment_`, `customer_`,
 * `checkout_`), y eso permite elegir la ruta de consulta sin adivinar: se midió que un
 * id de checkout en `GET /v1/payments/{id}` responde `400 ERROR_GET_PAYMENT`. Es la misma
 * regla que el adaptador de Mercado Pago aplica con el prefijo `ORD` de sus órdenes, y
 * a diferencia del caso de Kushki acá el prefijo sí está en la respuesta que se midió.
 */
const CHECKOUT_ID_PREFIX = "checkout_";

/** Si este identificador es de un checkout y no de un pago. */
export function isRapydCheckoutId(gatewayTransactionId: string): boolean {
  return gatewayTransactionId.startsWith(CHECKOUT_ID_PREFIX);
}

/**
 * Arma el cuerpo de `POST /v1/checkout`.
 *
 * `payment_method_type_categories: ["card"]` limita la página a tarjeta, porque el
 * comercio pidió tarjeta: dejarla abierta a todo el catálogo colombiano le permitiría al
 * pagador elegir otro medio y devolvería un cobro que no es el que se pidió, que es el
 * mismo fallo silencioso que `payment-method-support.ts` documenta.
 *
 * `country` es obligatorio y va fijo en `CO` porque el SDK es de pasarelas colombianas;
 * si algún día deja de serlo, sale de la divisa y no de una constante.
 */
export function buildCheckoutPayload(
  request: CreatePaymentRequest,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    amount: request.amount.toFixedScale(request.currency.getMinorUnitExponent()),
    currency: request.currency.getCode(),
    country: "CO",
    merchant_reference_id: request.orderReference.getValue(),
    payment_method_type_categories: ["card"],
    // Se midió que el checkout lo acepta y lo devuelve en `payment.receipt_email`. Sin
    // él el pagador desaparece del cobro y la `Transaction` que recibe el comercio
    // vuelve con el correo de relleno del normalizador, que no es el de nadie.
    receipt_email: request.payer.email,
  };

  // Las dos URL de retorno tienen nombres distintos en Rapyd y significados distintos
  // para el comercio: a una se vuelve con el cobro hecho y a la otra con el cobro
  // fallido. Es la misma pareja que usa el pago con PSE.
  const completeUrl = request.returnUrlConfig?.resolveFor("APPROVED");
  if (completeUrl) {
    payload.complete_payment_url = completeUrl;
  }
  const errorUrl = request.returnUrlConfig?.resolveFor("DECLINED");
  if (errorUrl) {
    payload.error_payment_url = errorUrl;
  }

  return payload;
}

/**
 * Traduce la consulta de un checkout a la forma de un pago, que es lo que el
 * normalizador sabe leer.
 *
 * Mientras nadie pague, `data.payment.id` viene en `null` y el checkout solo conoce el
 * monto, la divisa y la referencia del comercio: eso es exactamente una transacción
 * pendiente, y se reporta así, con el id del checkout, que es el único que el comercio
 * tiene en la mano. Cuando el pagador termina, `data.payment` pasa a ser un pago de
 * verdad y se normaliza tal cual, sin traducción ninguna.
 */
export function checkoutToPaymentResponse(rawResponse: unknown): unknown {
  const payload = rawResponse as { data?: Record<string, unknown> } | null;
  const data = payload?.data;
  if (!data) {
    return rawResponse;
  }

  const payment = data.payment as Record<string, unknown> | undefined;
  if (payment && typeof payment.id === "string" && payment.id.length > 0) {
    return { data: payment };
  }

  return {
    data: {
      id: data.id,
      status: data.status,
      amount: payment?.amount ?? 0,
      currency_code: payment?.currency_code ?? data.currency,
      merchant_reference_id:
        payment?.merchant_reference_id ?? data.merchant_reference_id,
      receipt_email: payment?.receipt_email,
    },
  };
}
