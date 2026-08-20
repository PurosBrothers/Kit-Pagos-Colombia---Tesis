/**
 * Estado transaccional normalizado por el SDK.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Los enums TransactionStatus,
 * RejectionCategory, SdkErrorCode y Gateway no requieren metodos propios".
 */
export type TransactionStatus =
  | "APPROVED"
  | "DECLINED"
  | "PENDING"
  | "EXPIRED"
  | "VOIDED"
  | "ERROR";
