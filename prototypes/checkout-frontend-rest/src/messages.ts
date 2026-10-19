import type { CheckoutStep } from "./checkout";

/**
 * Lo que la tienda le dice al comprador. El detalle técnico —estado nativo, códigos, la traza de
 * `/v1/api`— va a la consola del navegador (`describeOutcome()` en `checkout.ts`); aquí queda lo
 * que una tienda de verdad mostraría.
 */
export type Tone = "approved" | "declined" | "pending" | "error";

export interface ShopperMessage {
  tone: Tone;
  title: string;
  detail: string;
}

const CATEGORY_HINT: Record<string, string> = {
  INSUFFICIENT_FUNDS: "El banco indicó fondos insuficientes.",
  INVALID_CARD_DATA: "Revisa los datos de la tarjeta.",
  CARD_RESTRICTED: "El banco no autorizó esta tarjeta.",
  FRAUD_SUSPICION: "El banco detuvo el pago por seguridad.",
  AUTHENTICATION_FAILED: "No se completó la autenticación con tu banco.",
  DUPLICATED_PAYMENT: "Ya existe un pago igual para este pedido.",
};

type ResolvedStep = Exclude<CheckoutStep, { kind: "redirect" }>;

export function shopperMessage(step: ResolvedStep): ShopperMessage {
  if (step.kind === "pending") {
    return {
      tone: "pending",
      title: "Tu pago está en proceso",
      detail: "Tu banco todavía no confirma el pago. Si ya lo hiciste, consulta de nuevo en unos minutos.",
    };
  }
  const { status, rejectionReason } = step.transaction;
  if (status === "APPROVED") {
    return {
      tone: "approved",
      title: "¡Gracias! Tu pago fue aprobado",
      detail: "Recibimos tu pedido y te avisaremos cuando salga para tu casa.",
    };
  }
  if (status === "EXPIRED" || status === "VOIDED") {
    return {
      tone: "declined",
      title: "El pago no se completó",
      detail: "El tiempo para pagar venció o el pago se anuló. Puedes intentarlo de nuevo.",
    };
  }
  if (status === "DECLINED") {
    const hint = rejectionReason ? CATEGORY_HINT[rejectionReason.rejectionCategory] : undefined;
    return {
      tone: "declined",
      title: "Tu pago fue rechazado",
      detail: `${hint ?? "El banco o la pasarela no aprobaron el pago."} No se hizo ningún cobro; puedes intentarlo con otro medio.`,
    };
  }
  return {
    tone: "error",
    title: "No pudimos procesar el pago",
    detail: "Hubo un problema con la pasarela. No se hizo ningún cobro; intenta de nuevo en un momento.",
  };
}

const ERROR_TEXT: Record<string, string> = {
  UNSUPPORTED_OPERATION: "Esta pasarela no recibe ese medio de pago desde el navegador. Elige PSE u otra pasarela.",
  API_UNREACHABLE: "No pudimos conectar con el servicio de pagos. Revisa tu conexión e intenta de nuevo.",
  CARD_MODULE_UNAVAILABLE: "No se pudo cargar el formulario seguro de la tarjeta. La tarjeta no se envió.",
  INVALID_CREDENTIALS: "La tienda no tiene configurada esta pasarela en este ambiente.",
};

/** El error de un intento, para el comprador. El mensaje de la API va a la consola. */
export function shopperError(error: unknown): ShopperMessage {
  const { code, message } = error as { code?: string; message?: string };
  if (code === "INVALID_REQUEST") {
    return { tone: "error", title: "Revisa tus datos", detail: message ?? "Falta un dato del pedido." };
  }
  return {
    tone: "error",
    title: "No pudimos procesar el pago",
    detail: (code && ERROR_TEXT[code]) || "Intenta de nuevo en un momento. No se hizo ningún cobro.",
  };
}

/** El nombre de la pasarela tal como lo da `/v1/api/gateways`, con mayúscula inicial. */
export function gatewayLabel(gateway: string): string {
  return gateway ? gateway[0].toUpperCase() + gateway.slice(1) : gateway;
}
