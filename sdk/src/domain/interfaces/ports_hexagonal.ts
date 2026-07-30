/**
 * ============================================================================
 * PUERTOS DEL HEXAGONO - SDK de Pagos Colombia (KitPagos)
 * ============================================================================
 * Este archivo define las "aduanas" de la arquitectura hexagonal:
 *
 *  - Puerto de Entrada (Inbound / Driving Port): KitPagosPort
 *    Define como el comercio (cliente) invoca al SDK.
 *
 *  - Puerto de Salida (Outbound / Driven Port): PaymentGatewayPort
 *    Define como el nucleo del SDK invoca a cada pasarela. Cada adaptador
 *    concreto (WompiAdapter, PayUAdapter, MercadoPagoAdapter, KushkiAdapter)
 *    implementa este contrato.
 *
 * Todos los tipos reutilizan el Lenguaje Ubicuo de los 4 flujos ya
 * documentados: Creacion de Pago, Notificacion Asincrona (Webhooks),
 * Consulta de Estado (Polling) y Manejo de Errores Tecnicos.
 *
 * NOTA DE RECONCILIACION: el Flujo de Webhooks definio el motivo de rechazo
 * con DOS campos (rejectionCode + rejectionCategory), pero la interfaz
 * TransactionStatusResponse del Flujo de Polling solo incluia rejectionCode.
 * Aqui se incluyen ambos campos para que el contrato sea consistente con
 * las dos decisiones de arquitectura.
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. TIPOS COMPARTIDOS DEL DOMINIO
// ----------------------------------------------------------------------------

/** Identifica la pasarela concreta. Union de literales (no enum de TS) para
 *  que el compilador reduzca el tipo exacto en cada rama de un switch. */
export type GatewayName = "wompi" | "payu" | "mercadopago" | "kushki";

/** Estado transaccional normalizado.
 *  Fuente: "Estado Transaccional Nativo", Flujo de Notificacion Asincrona. */
export type TransactionStatus =
  | "APPROVED"
  | "DECLINED"
  | "PENDING"
  | "EXPIRED"
  | "VOIDED"
  | "ERROR";

/** Categoria semantica del motivo de rechazo.
 *  Fuente: "Codigo de Motivo de Rechazo", Flujo de Notificacion Asincrona. */
export type RejectionCategory =
  | "INSUFFICIENT_FUNDS"
  | "INVALID_CARD_DATA"
  | "CARD_RESTRICTED"
  | "FRAUD_SUSPICION"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_FAILED"
  | "DUPLICATED_PAYMENT"
  | "UNKNOWN";

/** Codigos de error tecnico normalizados por el SDK.
 *  Fuente: Flujo de Manejo y Normalizacion de Errores Tecnicos. */
export type SdkErrorCode =
  | "INVALID_CREDENTIALS"
  | "GATEWAY_TIMEOUT"
  | "CONNECTION_FAILED"
  | "RATE_LIMIT_EXCEEDED"
  | "INVALID_REQUEST"
  | "RESOURCE_NOT_FOUND"
  | "GATEWAY_SERVER_ERROR"
  | "MALFORMED_RESPONSE"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "UNSUPPORTED_OPERATION"
  | "UNKNOWN_ERROR";

/** Datos del pagador. Fuente: "Datos del Pagador", Flujo de Creacion de Pago.
 *  Unico campo obligatorio: email (minimo comun entre las 4 pasarelas). */
export interface PayerInput {
  email: string;
  fullName?: string;
  documentType?: string;
  documentNumber?: string;
  phone?: string;
}

/** Configuracion de redireccion post-pago.
 *  Fuente: "Redireccion de Retorno", Flujo de Creacion de Pago. returnUrl es
 *  el fallback uniforme; returnUrls se usa cuando se requiere granularidad
 *  por resultado (unicamente MercadoPago la soporta hoy). */
export interface ReturnUrlInput {
  returnUrl?: string | null;
  returnUrls?: {
    success?: string;
    failure?: string;
    pending?: string;
  };
}

/**
 * Objeto de respuesta normalizado. Fuente: "Objeto de Respuesta Normalizado
 * del Polling" + "Codigo de Motivo de Rechazo". Es el unico contrato que el
 * codigo del comercio necesita conocer, sin importar la pasarela. Se
 * reutiliza en la creacion, en el webhook y en el polling.
 */
export interface TransactionStatusResponse {
  gatewayTransactionId: string;
  orderReference: string;
  transactionStatus: TransactionStatus;
  amount: number;
  currency: string;
  rawStatus: string;
  rejectionCode: string | null;
  rejectionCategory: RejectionCategory | null;
  authorizationCode: string | null;
  updatedAt: string | null;
  rawGatewayResponse: Record<string, unknown>;
}

/**
 * Error normalizado del SDK. Fuente: "Estructura del Error Nativo", Flujo de
 * Manejo de Errores Tecnicos. originalError es `unknown` (no `any`) para
 * forzar un type-guard explicito en quien consuma el SDK.
 */
export class SdkError extends Error {
  constructor(
    public readonly code: SdkErrorCode,
    public readonly friendlyMessage: string,
    public readonly gateway: GatewayName,
    public readonly httpStatus: number | null,
    public readonly originalError: unknown,
    public readonly requestId?: string,
  ) {
    super(friendlyMessage);
    this.name = "SdkError";
  }
}

// ----------------------------------------------------------------------------
// 2. PUERTO DE ENTRADA (INBOUND / DRIVING PORT)
//    Define como el comercio invoca al SDK. Es la interfaz publica.
// ----------------------------------------------------------------------------

/** Opciones exclusivas de cada pasarela para el desglose tributario.
 *  PayU y Kushki calculan el IVA distinto (ver "Monto de la Transaccion");
 *  si el comercio no las provee, el adaptador aplica su estrategia por
 *  defecto documentada. */
export interface GatewayOptionsByName {
  wompi: Record<string, never>;
  payu: {
    taxBreakdown?: { tax: number; taxReturnBase: number };
  };
  mercadopago: Record<string, never>;
  kushki: {
    taxBreakdown?: {
      subtotalIva0: number;
      subtotalIva: number;
      iva: number;
      ice: number;
    };
  };
}

/** Payload para crear un pago.
 *  Fuente: todos los elementos de dominio del Flujo "Creacion de Pago". */
export interface CreatePaymentRequest {
  gateway: GatewayName;
  amount: number;
  currency?: string; // default "COP"
  orderReference: string;
  payer: PayerInput;
  returnUrl?: ReturnUrlInput;
  /** Bolsa de escape TIPADA por pasarela (ver GatewayOptionsByName). */
  gatewayOptions?: GatewayOptionsByName[GatewayName];
}

/** Resultado de crear un pago. */
export interface CreatePaymentResult {
  gatewayTransactionId: string | null;
  orderReference: string;
  transactionStatus: TransactionStatus;
  /** Solo presente si la integracion es hosted/redirect. null en
   *  integraciones transparentes (API pura). */
  redirectUrl: string | null;
  rawGatewayResponse: Record<string, unknown>;
}

/** Insumos para verificar la firma de un webhook.
 *  Fuente: "Firma Criptografica del Webhook", Flujo de Notificacion
 *  Asincrona. */
export interface VerifyWebhookRequest {
  gateway: GatewayName;
  rawBody: string;
  headers: Record<string, string>;
  secret: string;
}

/** Parametros para consultar el estado de una transaccion. Al menos uno de
 *  los dos identificadores debe proveerse.
 *  Fuente: "Identificador de Consulta", Flujo de Consulta de Estado. */
export interface TransactionStatusQuery {
  gateway: GatewayName;
  gatewayTransactionId?: string;
  orderReference?: string;
}

/**
 * Puerto de entrada del SDK. Unica superficie publica que el backend del
 * comercio necesita conocer.
 */
export interface KitPagosPort {
  /** Flujo: Creacion de Pago. Empaqueta la orden y la envia al adaptador
   *  correspondiente segun `request.gateway`. */
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;

  /**
   * Flujo: Notificacion Asincrona. Verifica la firma del evento entrante.
   * Debe llamarse SIEMPRE antes de confiar en el contenido del webhook.
   * Fuente: "el backend del comercio no debe actualizar ordenes sin pasar
   * primero por esta verificacion".
   */
  verifyWebhookSignature(request: VerifyWebhookRequest): boolean;

  /**
   * Verifica la firma y, si es valida, parsea el evento a la forma
   * normalizada. Lanza SdkError(WEBHOOK_SIGNATURE_INVALID) si la firma no
   * coincide: asi es imposible procesar un evento sin verificarlo primero.
   */
  processWebhookEvent(request: VerifyWebhookRequest): TransactionStatusResponse;

  /** Flujo: Consulta de Estado (Polling). Mecanismo de contingencia si el
   *  webhook no llega. */
  getTransactionStatus(
    query: TransactionStatusQuery,
  ): Promise<TransactionStatusResponse>;
}

// ----------------------------------------------------------------------------
// 3. PUERTO DE SALIDA (OUTBOUND / DRIVEN PORT)
//    Define como el SDK invoca a cada pasarela. Cada adaptador
//    (WompiAdapter, PayUAdapter, MercadoPagoAdapter, KushkiAdapter)
//    implementa este contrato.
// ----------------------------------------------------------------------------

/** Payload que el nucleo del SDK entrega al adaptador para crear la
 *  transaccion. Ya viene en el Lenguaje Ubicuo normalizado; la conversion a
 *  formato nativo (centavos, objeto amount descompuesto, etc.) es
 *  responsabilidad interna de cada adaptador, no de este contrato. Por eso
 *  `gatewayOptions` se relaja aqui a un bolsa generica: cada adaptador ya
 *  sabe, por su propio tipo concreto, que forma esperar y la valida antes
 *  de usarla. */
export interface GatewayCreateTransactionRequest {
  amount: number;
  currency: string;
  orderReference: string;
  payer: PayerInput;
  returnUrl?: ReturnUrlInput;
  gatewayOptions?: Record<string, unknown>;
}

export interface GatewayCreateTransactionResult {
  gatewayTransactionId: string | null;
  transactionStatus: TransactionStatus;
  rawStatus: string;
  redirectUrl: string | null;
  rawGatewayResponse: Record<string, unknown>;
}

/**
 * Describe que operaciones soporta realmente cada pasarela. Convierte en
 * tipos las "alertas criticas" documentadas por adaptador, en vez de
 * dejarlas solo como advertencias en prosa.
 */
export interface GatewayCapabilities {
  /** true si el flujo es hosted/redirect y por lo tanto usa returnUrl(s). */
  supportsHostedRedirect: boolean;
  /** true si existe un endpoint de consulta por orderReference propio del
   *  comercio (PayU: ORDER_DETAIL_BY_REFERENCE_CODE; MercadoPago:
   *  /v1/payments/search?external_reference=). Wompi y Kushki: false. */
  supportsQueryByReference: boolean;
  /** false para Kushki en pagos con tarjeta: el resultado es sincrono en el
   *  POST de creacion; getTransactionStatus debe lanzar
   *  SdkError(UNSUPPORTED_OPERATION) para ese caso. */
  supportsStatusPolling: boolean;
  /** Algoritmo de firma de webhook. "PENDING_INVESTIGATION" es el estado
   *  actual documentado para Kushki. */
  webhookSignatureAlgorithm:
    | "SHA256"
    | "MD5_OR_HMAC_SHA256"
    | "HMAC_SHA256"
    | "PENDING_INVESTIGATION";
}

/**
 * Puerto de salida. Contrato que debe implementar cada adaptador concreto
 * de pasarela. El nucleo del SDK solo conoce esta interfaz, nunca los
 * detalles nativos de Wompi, PayU, MercadoPago o Kushki.
 */
export interface PaymentGatewayPort {
  readonly gatewayName: GatewayName;
  readonly capabilities: GatewayCapabilities;

  /** Crea la transaccion en la pasarela nativa. */
  createTransaction(
    request: GatewayCreateTransactionRequest,
  ): Promise<GatewayCreateTransactionResult>;

  /** Verifica la firma nativa del webhook segun el algoritmo propio de la
   *  pasarela (ver capabilities.webhookSignatureAlgorithm). */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string>,
    secret: string,
  ): boolean;

  /** Traduce el payload nativo del webhook (ya verificado) a la forma
   *  normalizada TransactionStatusResponse. */
  parseWebhookEvent(
    rawBody: string,
    headers: Record<string, string>,
  ): TransactionStatusResponse;

  /** Consulta el estado por el id nativo de la pasarela. Debe lanzar
   *  SdkError(UNSUPPORTED_OPERATION) cuando
   *  capabilities.supportsStatusPolling sea false. */
  getTransactionStatus(
    gatewayTransactionId: string,
  ): Promise<TransactionStatusResponse>;

  /** Consulta el estado por la referencia del comercio. Metodo OPCIONAL:
   *  solo las pasarelas con capabilities.supportsQueryByReference === true
   *  lo implementan de forma funcional; las demas deben lanzar
   *  SdkError(UNSUPPORTED_OPERATION) si se invoca. */
  getTransactionStatusByReference?(
    orderReference: string,
  ): Promise<TransactionStatusResponse>;
}

// ----------------------------------------------------------------------------
// 4. CAPACIDADES DOCUMENTADAS POR PASARELA (referencia)
//    Ilustra como cada adaptador concreto declararia su `capabilities`
//    segun lo investigado en el Lenguaje Ubicuo. No es parte del contrato
//    en si, sino la evidencia de que cada adaptador debe declarar esto
//    explicitamente.
// ----------------------------------------------------------------------------

export const WOMPI_CAPABILITIES: GatewayCapabilities = {
  supportsHostedRedirect: false, // pendiente de investigacion en la fuente consultada
  supportsQueryByReference: false, // "No se admite busqueda por reference en este endpoint"
  supportsStatusPolling: true,
  webhookSignatureAlgorithm: "SHA256",
};

export const PAYU_CAPABILITIES: GatewayCapabilities = {
  supportsHostedRedirect: true, // responseUrl en WebCheckout
  supportsQueryByReference: true, // ORDER_DETAIL_BY_REFERENCE_CODE
  supportsStatusPolling: true,
  webhookSignatureAlgorithm: "MD5_OR_HMAC_SHA256",
};

export const MERCADOPAGO_CAPABILITIES: GatewayCapabilities = {
  supportsHostedRedirect: true, // back_urls en Checkout Pro
  supportsQueryByReference: true, // /v1/payments/search?external_reference=
  supportsStatusPolling: true,
  webhookSignatureAlgorithm: "HMAC_SHA256",
};

export const KUSHKI_CAPABILITIES: GatewayCapabilities = {
  supportsHostedRedirect: false, // pendiente de investigacion en la fuente consultada
  supportsQueryByReference: false, // sin endpoint documentado
  supportsStatusPolling: false, // tarjeta: resultado sincrono en POST /card/v1/charges
  webhookSignatureAlgorithm: "PENDING_INVESTIGATION",
};
