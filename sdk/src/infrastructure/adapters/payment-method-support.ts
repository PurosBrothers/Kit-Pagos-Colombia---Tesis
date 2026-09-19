/**
 * Verificación de que la pasarela activa sepa cobrar con el método pedido.
 *
 * ## El defecto que esto corrige
 *
 * `CreatePaymentRequest.paymentMethod` se introdujo opcional en el issue #85, y
 * durante un tiempo ningún adaptador lo leía. Mientras PSE no funcionaba en
 * ninguna pasarela eso era inofensivo. Al implementarlo en Wompi (issue #64)
 * dejó de serlo, porque cambiar de pasarela pasó a ser un escenario plausible y
 * el resultado medido contra el simulador era este:
 *
 *     MERCADOPAGO: pedí PSE y obtuve -> TRANSACTION (APPROVED)
 *     RAPYD:       pedí PSE y obtuve -> TRANSACTION (APPROVED)
 *
 * Es decir que el comercio pedía PSE, el adaptador descartaba el método en
 * silencio y le cobraba **como tarjeta**, aprobado y sin ninguna señal. Es la
 * misma clase de fallo silencioso que el punto 39 describe para la redirección
 * descartada de Rapyd, solo que alcanzable desde la API pública: un cobro con un
 * medio de pago distinto del que el pagador eligió.
 *
 * ## Por qué la verificación vive en el adaptador y no en la fachada
 *
 * Porque qué métodos soporta cada pasarela es conocimiento de infraestructura.
 * Si la fachada tuviera la tabla de capacidades, el dominio y la aplicación
 * tendrían que saber qué sabe hacer cada proveedor, que es exactamente lo que la
 * Arquitectura Hexagonal separa. Acá cada adaptador **declara** lo que soporta y
 * la verificación en sí vive en un solo lugar.
 *
 * Es una función de módulo por lo mismo que `payload-utils.ts` y
 * `rapyd-signature.ts`: no hay estado, y así no le cuesta CBO a ninguna clase
 * (ver `architecture-log.md`, punto 34).
 */
import { KitPagosError } from "../../domain/errors/KitPagosError";
import { KitPagosErrorCode } from "../../domain/value-objects/KitPagosErrorCode";
import type { Gateway } from "../../domain/value-objects/Gateway";
import type {
  PaymentMethod,
  PaymentMethodType,
} from "../../domain/value-objects/PaymentMethod";

/**
 * Falla si la pasarela no sabe cobrar con el método pedido.
 *
 * Omitir el método es válido y no se verifica: el contrato dice que cuando no se
 * informa, cada pasarela aplica su método por defecto, que en las cuatro es
 * tarjeta. Lo que no puede pasar es pedir algo concreto y recibir otra cosa.
 *
 * Se lanza `UNSUPPORTED_OPERATION` y no `INVALID_REQUEST` porque la solicitud del
 * comercio no tiene nada de inválida: es correcta y la pasarela activa no la
 * puede atender. La distinción importa para el comercio, porque la salida de un
 * `UNSUPPORTED_OPERATION` es cambiar de pasarela, y la de un `INVALID_REQUEST` es
 * corregir los datos.
 */
export function assertSupportedPaymentMethod(
  paymentMethod: PaymentMethod | undefined,
  gateway: Gateway,
  supported: readonly PaymentMethodType[],
): void {
  if (!paymentMethod || supported.includes(paymentMethod.type)) {
    return;
  }

  throw new KitPagosError(
    KitPagosErrorCode.UNSUPPORTED_OPERATION,
    gateway,
    null,
    `${gateway} no soporta pagos con ${paymentMethod.type} en esta versión del SDK. ` +
      `Métodos soportados: ${supported.join(", ")}.`,
  );
}

/**
 * Devuelve el token de tarjeta, o falla si no vino.
 *
 * ## El defecto que esto corrige
 *
 * `PaymentMethod.card(cardToken)` existía desde el PR #85, estaba exportado y
 * probado, y **ningún adaptador leía `cardToken`**: es el mismo defecto que el issue
 * #64 ya registra para `ReturnUrlConfig`, en el otro método del alcance. Medido
 * contra los sandboxes reales, un cobro con tarjeta sin token respondía:
 *
 *     Wompi:        422 "No se especificó método de pago o fuente de pago"
 *     Mercado Pago: 400 "payment_method_id attribute can't be null"
 *     Kushki:       400 K001, porque mandaba el literal "simulated-token"
 *     Rapyd:        400 MISSING_FIELDS - [PAYMENT_METHOD]
 *
 * O sea que cobrar con tarjeta funcionaba **solo contra el simulador**, en las cuatro.
 *
 * Se valida antes de armar el payload, y no se deja que la pasarela conteste, por lo
 * mismo que en PSE: un HTTP 400 de la pasarela no dice qué falta ni de dónde sacarlo,
 * y acá sí se puede decir. `INVALID_REQUEST` y no `UNSUPPORTED_OPERATION` porque la
 * pasarela sí sabe cobrar con tarjeta: lo que falta es un dato del comercio.
 */
export function requireCardToken(
  paymentMethod: PaymentMethod | undefined,
  gateway: Gateway,
  tokenizationEndpoint: string,
): string {
  const cardToken = paymentMethod?.cardToken;
  if (cardToken) {
    return cardToken;
  }

  throw new KitPagosError(
    KitPagosErrorCode.INVALID_REQUEST,
    gateway,
    null,
    `${gateway} necesita un token de tarjeta para cobrar y no se informó ninguno. ` +
      `Pedilo desde el frontend con ${tokenizationEndpoint} y pasalo en ` +
      `PaymentMethod.card(cardToken). El SDK no acepta el número de tarjeta: recibirlo ` +
      `metería al comercio dentro del alcance de PCI DSS.`,
  );
}

/** Cuotas pedidas, o 1 si el método no las informó. */
export function resolveInstallments(
  paymentMethod: PaymentMethod | undefined,
): number {
  return paymentMethod?.installments ?? 1;
}
