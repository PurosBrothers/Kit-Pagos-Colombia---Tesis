import {
  MercadoPagoCardTokenResponse,
  MercadoPagoCreateOrderRequestBody,
  MercadoPagoCreatePaymentRequestBody,
  MercadoPagoOrderResponse,
  MercadoPagoOrderStatus,
  MercadoPagoPaymentMethodResult,
  MercadoPagoPaymentMethodSearchResponse,
  MercadoPagoPaymentResponse,
  MercadoPagoTokenizeCardRequestBody,
} from "./types";

/**
 * Los medios de pago de las tarjetas de prueba, por BIN.
 *
 * Nivel 1 — medido con `GET /v1/payment_methods/search` el 15 de octubre de 2026: `401354`
 * (Visa crédito), `525413` (Mastercard crédito) y `491511` (Visa débito) son los BIN de las
 * tres tarjetas de `docs/testing-data/mercado-pago.md`. Los demás BIN que empiezan con 4 o con
 * 5 caen en Visa o Mastercard crédito, que es una convención del simulador sin medir.
 */
const PAYMENT_METHODS_BY_BIN: ReadonlyMap<string, MercadoPagoPaymentMethodResult> = new Map([
  ["401354", { id: "visa", name: "Visa", payment_type_id: "credit_card", status: "active" }],
  ["525413", { id: "master", name: "Mastercard", payment_type_id: "credit_card", status: "active" }],
  ["491511", { id: "debvisa", name: "Visa Débito", payment_type_id: "debit_card", status: "active" }],
]);

const PAYMENT_METHODS_BY_FIRST_DIGIT: ReadonlyMap<string, MercadoPagoPaymentMethodResult> = new Map([
  ["4", PAYMENT_METHODS_BY_BIN.get("401354")!],
  ["5", PAYMENT_METHODS_BY_BIN.get("525413")!],
]);

/** Algoritmo de Luhn (ISO/IEC 7812-1) sobre una cadena de solo dígitos. */
function passesLuhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/**
 * El titular del token: la identificación vuelve solo si llegaron el tipo y el número.
 *
 * Nivel 1 (medido contra api.mercadopago.com el 4 de octubre de 2026): si falta
 * `cardholder.identification`, la API responde `identification: {}`.
 */
function tokenCardholder(
  requestBody: MercadoPagoTokenizeCardRequestBody,
): MercadoPagoCardTokenResponse["cardholder"] {
  const hasId = Boolean(
    requestBody.cardholder?.identification?.type &&
    requestBody.cardholder?.identification?.number,
  );

  const idObj = hasId
    ? {
        type: requestBody.cardholder!.identification!.type,
        number: requestBody.cardholder!.identification!.number,
      }
    : {};

  return {
    name: requestBody.cardholder?.name ?? "APRO",
    identification: idObj,
  };
}

/**
 * Gateway Mock Factory — Mercado Pago (API de Simulación).
 *
 * Responsabilidad única: construir el payload de respuesta que replica la
 * estructura nativa de Mercado Pago para los escenarios soportados.
 *
 * Particularidades nativas de Mercado Pago:
 * - Estados en minúsculas (`approved`, `rejected`, etc.).
 * - Monto en pesos decimales (`transaction_amount`), no en centavos.
 * - Objeto plano sin envoltorio `data`.
 * - `status_detail` con el código nativo de acreditación o rechazo.
 *
 * Desde el issue #153 son cuatro clases, una por recurso de la API: los pagos de
 * `/v1/payments`, las órdenes de `/v1/orders` (PSE y tarjeta), la tarjeta antes del cobro
 * (`/v1/card_tokens` y `/v1/payment_methods/search`) y los cuerpos de error nativos. Ver el
 * punto 107 del `architecture-log.md`.
 */
export class MercadoPagoPaymentMockFactory {
  /**
   * Genera un identificador numérico aleatorio al estilo de Mercado Pago (ej. 1234567890).
   */
  private generateId(): number {
    return Math.floor(1000000000 + Math.random() * 9000000000);
  }

  /**
   * Construye la respuesta de un pago aprobado (POST o GET).
   */
  buildApprovedResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "approved",
      status_detail: "accredited",
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: now,
    };
  }

  /**
   * Construye la respuesta de un pago rechazado.
   *
   * @param statusDetail El motivo del rechazo. Lo elige el nombre del titular de la tarjeta
   *   de prueba (issue #122); sin él, el rechazo genérico de siempre.
   */
  buildRejectedResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
    statusDetail = "cc_rejected_other_reason",
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "rejected",
      status_detail: statusDetail,
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: null,
    };
  }

  /**
   * Construye la respuesta de un pago que quedó en revisión: el pendiente con tarjeta.
   *
   * Nivel 1 para el `status_detail`: la cuenta de prueba respondió `pending_review_manual`
   * con HTTP `201` el 19 de septiembre de 2026 (`docs/testing-data/mercado-pago.md`,
   * línea 70). Nivel 3 para el `status`: la tabla oficial de resultados de pago lo empareja
   * con `in_process` (https://www.mercadopago.com.co/developers/en/docs/checkout-api-payments/response-handling/collection-results,
   * consultada el 5 de octubre de 2026), y la medición no registró el campo `status`.
   *
   * @param statusDetail `pending_contingency` cuando lo pide el titular `CONT` (issue #122,
   *   nivel 3: `docs/testing-data/mercado-pago.md` y la misma tabla oficial).
   */
  buildInProcessResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
    statusDetail = "pending_review_manual",
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "in_process",
      status_detail: statusDetail,
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: null,
    };
  }

  /**
   * Construye la respuesta de un pago expirado.
   */
  buildExpiredResponse(
    requestBody: MercadoPagoCreatePaymentRequestBody,
    customId?: number | string,
  ): MercadoPagoPaymentResponse {
    const now = new Date().toISOString();

    return {
      id: customId ?? this.generateId(),
      status: "cancelled",
      status_detail: "expired",
      transaction_amount: requestBody.transaction_amount,
      currency_id: "COP",
      description: requestBody.description,
      external_reference: requestBody.external_reference ?? requestBody.description,
      payer: requestBody.payer,
      date_created: now,
      date_approved: null,
    };
  }
}

/** Las órdenes de `/v1/orders`: la de PSE y la de tarjeta, que cobra la versión 0.6.0 del SDK. */
export class MercadoPagoOrderMockFactory {
  /**
   * Identificador de orden al estilo de la Orders API: un ULID con prefijo.
   *
   * El prefijo no es decorativo. El SDK distingue por él a qué endpoint
   * consultar, porque los pagos con tarjeta usan identificadores numéricos y las
   * órdenes de PSE no (ver `isOrderId()` en el SDK).
   */
  private generateOrderId(prefix: "ORD" | "PAY"): string {
    const suffix = Math.random().toString(36).slice(2, 12).toUpperCase();
    return `${prefix}01${suffix}`;
  }

  /**
   * El identificador que la URL del banco lleva en la ruta (`/payments/<id>/bank_transfer`).
   *
   * Nivel 1 — medido contra `api.mercadopago.com` el 14 de octubre de 2026: son doce dígitos y
   * **no** son el `PAY…` del pago (`docs/testing-data/mercado-pago.md`, «La URL de banco del
   * PSE y la vuelta al comercio»). La vuelta al comercio lo trae como `payment_id`. El valor
   * es aleatorio; solo la forma está medida.
   */
  generateBankPaymentId(): string {
    const first = 1 + Math.floor(Math.random() * 9);
    const rest = Math.floor(Math.random() * 1e11)
      .toString()
      .padStart(11, "0");
    return `${first}${rest}`;
  }

  /**
   * Construye la respuesta de una orden de PSE esperando al pagador.
   *
   * Reproduce el caso que la API real devuelve con HTTP 201: `action_required` /
   * `waiting_transfer` y la URL del banco ya presente en la creación. A
   * diferencia de Wompi, aquí no hay nada que sondear (ver el punto 43 del
   * `architecture-log.md` para la comparación).
   *
   * `origin` es el `protocolo://host` de la petición que crea la orden (`requestOrigin()`):
   * la URL del banco apunta a la página de banco del propio simulador, con la forma de ruta
   * medida (`/payments/<id numérico>/bank_transfer`) bajo `/v1/sim/mercadopago`. Antes
   * apuntaba al dominio real con un id inventado y abrirla daba «Esta página no existe»
   * (issue #109). `bankPaymentId` es ese id numérico (`generateBankPaymentId()`); el llamador
   * lo necesita para registrar la URL de retorno.
   */
  buildPendingOrderResponse(
    requestBody: MercadoPagoCreateOrderRequestBody,
    origin: string,
    bankPaymentId: string,
    customId?: string,
  ): MercadoPagoOrderResponse {
    const paymentId = this.generateOrderId("PAY");
    const requested = requestBody.transactions?.payments?.[0];

    return this.buildOrder(requestBody, {
      orderId: customId ?? this.generateOrderId("ORD"),
      paymentId,
      status: "action_required",
      statusDetail: "waiting_transfer",
      redirectUrl: `${origin}/v1/sim/mercadopago/payments/${bankPaymentId}/bank_transfer`,
      financialInstitution: requested?.payment_method?.financial_institution,
    });
  }

  /**
   * Construye la orden de PSE cuyo pago falló, la que la API real devuelve en `data` del `402`.
   *
   * Nivel 1 — medido el 7 de octubre de 2026 (`docs/testing-data/mercado-pago.md`, «El `402`
   * de una orden de PSE que falla»): la orden queda en `failed / failed` con
   * `total_paid_amount: "0"`, y su pago en `failed / processing_error`, sin `redirect_url`.
   */
  buildFailedOrderResponse(
    requestBody: MercadoPagoCreateOrderRequestBody,
  ): MercadoPagoOrderResponse {
    return this.buildOrder(requestBody, {
      orderId: this.generateOrderId("ORD"),
      paymentId: this.generateOrderId("PAY"),
      status: "failed",
      statusDetail: "failed",
      paymentStatusDetail: "processing_error",
      totalPaidAmount: "0",
      financialInstitution:
        requestBody.transactions?.payments?.[0]?.payment_method?.financial_institution,
    });
  }

  /**
   * Construye una orden de tarjeta, la que cobra la versión 0.6.0 del SDK.
   *
   * Nivel 1 — medido contra `api.mercadopago.com` el 15 de octubre de 2026, con 20 000 COP
   * (`docs/testing-data/mercado-pago.md`). La forma es la misma en los tres desenlaces:
   * `processed / accredited` aprobada, `processing / in_process` pendiente y `failed /
   * failed` rechazada, con el motivo solo en el pago. A diferencia de la orden de PSE fallida,
   * la de tarjeta trae `total_paid_amount` y `paid_amount` iguales al total aunque falle, y
   * no trae `payer` ni al crear ni al consultar. `transaction_security.validation` llegó
   * siempre en `never`. El id real de un vendedor de prueba empieza con `ORDTST`; aquí se
   * usa `ORD`, que el SDK reconoce igual (`isOrderId()`).
   *
   * `installment_amount` es el total entre las cuotas, redondeado: con 20 000 en 3 cuotas
   * la API real respondió `"6667"`.
   */
  buildCardOrderResponse(
    requestBody: MercadoPagoCreateOrderRequestBody,
    status: MercadoPagoOrderStatus,
    statusDetail: string,
    paymentStatusDetail = statusDetail,
  ): MercadoPagoOrderResponse {
    const now = new Date().toISOString();
    const total = requestBody.total_amount;
    const requested = requestBody.transactions?.payments?.[0]?.payment_method;
    const installments = requested?.installments ?? 1;
    const transactionSecurity = { validation: "never" };

    return {
      id: this.generateOrderId("ORD"),
      type: requestBody.type ?? "online",
      processing_mode: requestBody.processing_mode ?? "automatic",
      external_reference: requestBody.external_reference,
      total_amount: total,
      total_paid_amount: total,
      country_code: "COL",
      status,
      status_detail: statusDetail,
      capture_mode: "automatic_async",
      currency: "COP",
      created_date: now,
      last_updated_date: now,
      config: { online: { transaction_security: transactionSecurity } },
      transactions: {
        payments: [
          {
            id: this.generateOrderId("PAY"),
            amount: total,
            paid_amount: total,
            reference_id: Math.random().toString(36).slice(2, 12),
            status,
            status_detail: paymentStatusDetail,
            payment_method: {
              id: requested?.id ?? "",
              type: requested?.type ?? "",
              token: requested?.token,
              installments,
              installment_amount: String(Math.round(Number(total) / installments)),
              transaction_security: transactionSecurity,
            },
          },
        ],
      },
    };
  }

  /**
   * Parte común de las respuestas de orden.
   *
   * Existe para que los campos que la API real devuelve igual en los dos casos
   * (montos, divisa, país, fechas, eco de la URL de retorno) se escriban una sola
   * vez y no se desincronicen entre escenarios.
   */
  private buildOrder(
    requestBody: MercadoPagoCreateOrderRequestBody,
    attributes: {
      orderId: string;
      paymentId: string;
      status: MercadoPagoOrderStatus;
      statusDetail: string;
      /** El del pago, cuando no coincide con el de la orden (`failed` frente a `processing_error`). */
      paymentStatusDetail?: string;
      totalPaidAmount?: string;
      redirectUrl?: string;
      financialInstitution?: string;
    },
  ): MercadoPagoOrderResponse {
    const now = new Date().toISOString();
    const total = requestBody.total_amount;

    return {
      id: attributes.orderId,
      type: requestBody.type ?? "online",
      processing_mode: requestBody.processing_mode ?? "automatic",
      external_reference: requestBody.external_reference,
      total_amount: total,
      total_paid_amount: attributes.totalPaidAmount ?? total,
      country_code: "COL",
      status: attributes.status,
      status_detail: attributes.statusDetail,
      currency: "COP",
      created_date: now,
      last_updated_date: now,
      payer: { entity_type: requestBody.payer?.entity_type },
      config: requestBody.config,
      transactions: {
        payments: [
          {
            id: attributes.paymentId,
            amount: total,
            reference_id: Math.random().toString(36).slice(2, 12),
            status: attributes.status,
            status_detail: attributes.paymentStatusDetail ?? attributes.statusDetail,
            payment_method: {
              id: "pse",
              type: "bank_transfer",
              redirect_url: attributes.redirectUrl,
              financial_institution: attributes.financialInstitution,
            },
          },
        ],
      },
    };
  }
}

/** La tarjeta antes del cobro: el token de `/v1/card_tokens` y el medio de pago de su BIN. */
export class MercadoPagoCardMockFactory {
  /**
   * Construye la respuesta de `GET /v1/payment_methods/search` para un BIN.
   *
   * Nivel 1 para la forma (`paging` y `results`) y para el BIN sin medio de pago: `999999`
   * respondió `results: []` con `total: 0` el 15 de octubre de 2026. La API real devuelve dos
   * entradas iguales para cada BIN medido y decenas de campos por entrada; aquí va una, con
   * los campos que lee el SDK.
   */
  buildPaymentMethodSearchResponse(bin: string): MercadoPagoPaymentMethodSearchResponse {
    const match = PAYMENT_METHODS_BY_BIN.get(bin) ?? PAYMENT_METHODS_BY_FIRST_DIGIT.get(bin.charAt(0));
    const results = match ? [match] : [];
    return { paging: { total: results.length, limit: 30, offset: 0 }, results };
  }

  /**
   * Construye la respuesta nativa de tokenización de tarjeta (POST /v1/card_tokens).
   *
   * Nivel de evidencia 1 (medido contra api.mercadopago.com el 4 de octubre de 2026):
   * Si falta cardholder.identification, responde con identification: {} (`tokenCardholder()`).
   * Si el número no pasa Luhn, emite el token igual con luhn_validation: false: medido con
   * "1234" y con 4013540682746261, que tiene 16 dígitos pero falla el dígito verificador.
   *
   * Nivel de evidencia 1 (medido contra api.mercadopago.com el 4 de octubre de 2026 a las
   * 17:49 −05:00, con 4013540682746260 y la llave pública de prueba del proyecto):
   * El 201 trae exactamente las claves de MercadoPagoCardTokenResponse. Se replica el
   * conjunto completo porque un consumidor que lea un campo ausente pasaría contra el
   * simulador leyendo undefined y fallaría contra la API real.
   * date_due cae 8 días después de date_created. Una segunda medición independiente, hacia
   * las 17:40, dio también 8 días y trunc_card_number "525413XXXXXX3564" para
   * 5254133674403564.
   * live_mode llegó en true con la llave de prueba. Se replica lo observado sin suponer por
   * qué; con otra llave podría cambiar.
   * Dos diferencias deliberadas: el id real son 32 caracteres hexadecimales, y el prefijo
   * tok_sim_mp_ se conserva para que un token simulado no se confunda con uno real; las
   * fechas reales llevan desfase −04:00 y aquí van en UTC, que es el mismo instante.
   * Sin medir: card_number_length y trunc_card_number con números que no tienen 16 dígitos.
   * Con menos de 10 se solapan los primeros seis y los últimos cuatro, y el valor que
   * devolvería la API real no se conoce.
   */
  buildTokenCardResponse(
    requestBody: MercadoPagoTokenizeCardRequestBody,
    publicKey: string,
  ): MercadoPagoCardTokenResponse {
    const cleanNumber = String(requestBody.card_number || "").replace(/\s+/g, "");
    const now = new Date();
    const dueDate = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const firstSixDigits = cleanNumber.slice(0, 6) || "401354";
    const lastFourDigits = cleanNumber.slice(-4) || "6260";
    const hiddenDigits = Math.max(cleanNumber.length - 10, 0);

    return {
      id: `tok_sim_mp_${Math.random().toString(36).substring(2, 12)}`,
      public_key: publicKey,
      live_mode: true,
      require_esc: false,
      status: "active",
      first_six_digits: firstSixDigits,
      last_four_digits: lastFourDigits,
      card_number_length: cleanNumber.length,
      trunc_card_number: `${firstSixDigits}${"X".repeat(hiddenDigits)}${lastFourDigits}`,
      luhn_validation: passesLuhn(cleanNumber),
      expiration_month: Number(requestBody.expiration_month) || 12,
      expiration_year: Number(requestBody.expiration_year) || 2030,
      security_code_length: String(requestBody.security_code || "").length || 3,
      date_created: now.toISOString(),
      date_last_updated: now.toISOString(),
      date_due: dueDate.toISOString(),
      cardholder: tokenCardholder(requestBody),
    };
  }
}

/** Los cuerpos de error nativos de Mercado Pago, los que usa `technicalFailure()` en todas sus rutas. */
export class MercadoPagoErrorMockFactory {
  /**
   * Respuesta nativa de timeout para Mercado Pago (HTTP 504).
   */
  buildTimeoutResponse() {
    return {
      message: "Gateway Timeout",
      error: "gateway_timeout",
      status: 504,
    };
  }

  /**
   * Respuesta nativa de rate limit para Mercado Pago (HTTP 429).
   */
  buildRateLimitResponse() {
    return {
      message: "Too many requests",
      error: "rate_limit_exceeded",
      status: 429,
    };
  }

  /**
   * Respuesta nativa de error de servidor para Mercado Pago (HTTP 5xx).
   */
  buildServerErrorResponse(status = 500) {
    return {
      message: "Internal Server Error",
      error: "server_error",
      status,
    };
  }
}
