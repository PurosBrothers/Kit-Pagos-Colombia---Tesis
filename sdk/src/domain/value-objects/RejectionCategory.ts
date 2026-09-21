/**
 * Categoria semantica normalizada del motivo de rechazo de un pago.
 * Usada por RejectionReason. Fuente: lenguaje ubicuo del proyecto y SAD,
 * seccion 15.1 (Nucleo del dominio).
 */
export type RejectionCategory =
  | "INSUFFICIENT_FUNDS"
  | "INVALID_CARD_DATA"
  | "CARD_RESTRICTED"
  | "FRAUD_SUSPICION"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_FAILED"
  | "DUPLICATED_PAYMENT"
  | "UNKNOWN";
