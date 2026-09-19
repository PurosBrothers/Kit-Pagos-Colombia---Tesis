/**
 * Contratos del mock de Kushki (API de Simulación).
 *
 * Representan la estructura nativa que expone la API de Kushki para
 * POST /card/v1/charges. Confirmados contra la documentación pública
 * (docs.kushki.com, api-docs.kushkipagos.com):
 *
 * 1. El monto no viaja como escalar: Kushki exige un objeto `amount`
 *    descompuesto en subtotalIva0, subtotalIva, iva, ice y currency. Es la
 *    única de las cuatro pasarelas del proyecto que lo hace así.
 * 2. El identificador de transacción es `ticketNumber`, no `id` como Wompi
 *    ni `id` numérico como Mercado Pago.
 * 3. El estado se expone en `transaction_status` (o `code` según el
 *    endpoint), con los valores textuales `APPROVAL` / `DECLINED` — una
 *    letra de diferencia con "APPROVED" que rompe un switch copiado de
 *    Wompi sin darse cuenta.
 * 4. INITIALIZED no está confirmado con fuente pública para pagos con
 *    tarjeta (sí para cash/wire transfers); se incluye en el mock porque
 *    el issue lo pide explícitamente como estado intermedio del ciclo de
 *    vida, análogo a PENDING del dominio.
 * 5. El mock responde HTTP 200 incluso cuando la transacción es rechazada;
 *    el mock replica esto a propósito, porque es el comportamiento que
 *    rompe implementaciones ingenuas que deciden éxito solo mirando el
 *    código HTTP.
 */

/** Desglose de impuestos tal como lo exige el objeto `amount` de Kushki. */
export interface KushkiAmount {
  subtotalIva0: number;
  subtotalIva: number;
  iva: number;
  ice: number;
  currency: string;
}

/** Cuerpo de la solicitud para crear un cargo (POST /card/v1/charges). */
export interface KushkiCreateChargeRequestBody {
  token: string;
  /** Referencia del comercio. Distinta del `transactionReference` que genera Kushki. */
  trackingCode?: string;
  amount: KushkiAmount;
  contactDetails?: {
    email?: string;
    firstName?: string;
    lastName?: string;
  };
}

/** Estados nativos de transacción de Kushki para pagos con tarjeta. */
export type KushkiTransactionStatus = "APPROVAL" | "DECLINED" | "INITIALIZED";

/**
 * Respuesta nativa de Kushki para POST /card/v1/charges y para la consulta
 * de estado. La creación y la consulta simulada responden HTTP 200,
 * incluso cuando transaction_status es
 * DECLINED: la decisión de éxito o fallo está en el cuerpo, nunca en el
 * código HTTP.
 */
export interface KushkiChargeResponse {
  ticketNumber: string;
  transaction_status: KushkiTransactionStatus;
  amount: KushkiAmount;
  /** Generado por Kushki, no es la referencia que envió el comercio. */
  transactionReference: string;
  /** Eco de la referencia del comercio, cuando la solicitud la trae. */
  trackingCode?: string;
  contactDetails?: {
    email?: string;
  };
}

/**
 * Cuerpo de `POST /transfer/v1/tokens`, el primer paso de Transfer In.
 *
 * **Forma verificada contra la API UAT** el 18 de septiembre de 2026: este cuerpo,
 * tal como el adaptador lo arma, responde `201` con el token. La ruta es en plural;
 * `/transfer/v1/token` responde como una ruta inexistente.
 */
export interface KushkiTransferTokenRequestBody {
  bankId?: string;
  callbackUrl?: string;
  userType?: string;
  documentType?: string;
  documentNumber?: string;
  email?: string;
  currency?: string;
  paymentDescription?: string;
  amount?: KushkiAmount;
}

/** Cuerpo de `POST /transfer/v1/init`, el segundo paso. */
/**
 * Estados nativos de una transferencia, que **no** son los de tarjeta.
 *
 * Medidos contra la API UAT real el 18 de septiembre de 2026: la transferencia
 * nace en `requestedToken` y pasa a `initializedTransaction` al iniciarla. Los
 * finales vienen de la documentacion de Kushki: llevar una transferencia hasta el
 * desenlace exige autorizar en el portal del banco.
 */
export type KushkiTransferStatus =
  | "requestedToken"
  | "initializedTransaction"
  | "approvedTransaction"
  | "declinedTransaction";

/** Respuesta de `POST /transfer/v1/init`, con la forma medida. No trae estado. */
export interface KushkiTransferInitResponse {
  bankId: string;
  bankName: string;
  redirectUrl: string;
  transactionReference: string;
  trazabilityCode: string;
}

/** Respuesta de `GET /transfer/v1/status/{token}`, con la forma medida. */
export interface KushkiTransferStatusResponse {
  status: KushkiTransferStatus;
  token: string;
  paymentDescription: string;
  email: string;
  amount: KushkiAmount;
  transactionReference: string;
  bankId: string;
  documentType: string;
  documentNumber: string;
  currency: string;
  country: string;
  created: number;
  merchantName: string;
  callbackUrl: string;
}

export interface KushkiTransferInitRequestBody {
  token?: string;
  /** Kushki lo exige aunque ya viajo al pedir el token. Medido: sin el, 400 T001. */
  amount?: KushkiAmount;
}

/** Una entidad financiera de `GET /transfer/v1/bankList`. */
export interface KushkiBank {
  code: string;
  name: string;
}

