import { randomUUID } from "node:crypto";
import {
  WompiCreateTransactionRequestBody,
  WompiMerchantResponse,
  WompiTokenizeCardRequestBody,
  WompiTokenizeCardResponse,
  WompiTransaction,
  WompiTransactionResponse,
} from "./types";

/**
 * Gateway Mock Factory — Wompi (issue #55).
 *
 * Single responsibility: build the response payload that replicates the
 * native Wompi structure for a given scenario.
 *
 * Does not know about headers, does not decide which scenario to execute
 * (that is the ScenarioEngine's responsibility), does not validate the
 * request body, **does not persist** —that is the router's responsibility— and
 * above all does not move a transaction between states, which is what
 * `state/wompiStateMachine.ts` is for.
 *
 * That last part is the change of issue #124. The factory used to receive the
 * `TransactionStore` in its constructor and to write every record it built, and
 * it also carried `advanceCardTransaction` and `advancePseTransaction`, which
 * decided how a payment moved when it was queried. Three places then knew the
 * rules of the Wompi flow, and the two that mattered —the ones that ran on a
 * query— were a método duplicating the table and a function in the router
 * reading the bank code. Now every builder is a pure function of the request
 * body and the scenario, and the router owns persistence and movement.
 */
export class GatewayMockFactory {
  /**
   * Crea un cobro con tarjeta como lo crea Wompi: **`PENDING`, no `APPROVED`**.
   *
   * Que nazca pendiente no es una complicación del mock, es lo que se midió contra
   * `sandbox.wompi.co` el 19 de septiembre de 2026: `POST /transactions` con
   * `payment_method: {type: "CARD", token, installments}` responde `201` con
   * `status: "PENDING"` y `finalized_at: null`, y la transacción pasa a `APPROVED`
   * unos 600 ms después. El cobro con tarjeta de Wompi **es asíncrono**, igual que su
   * PSE, y el mock que devolvía `APPROVED` de una le escondía ese paso al comercio.
   *
   * La transacción se guarda en el store para que la consulta posterior la resuelva,
   * que es justo el paso que el comercio tiene que saber que existe.
   */
  buildApprovedResponse(
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    const transaction: WompiTransaction = {
      id: randomUUID(),
      status: "PENDING",
      amount_in_cents: requestBody.amount_in_cents,
      currency: requestBody.currency,
      reference: requestBody.reference,
      customer_email: requestBody.customer_email,
      payment_method: requestBody.payment_method,
    };

    return { data: transaction };
  }

  /**
   * Construye una respuesta de transacción rechazada (DECLINED / fondos insuficientes).
   */
  buildDeclinedResponse(
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    const transaction: WompiTransaction = {
      id: randomUUID(),
      status: "DECLINED",
      amount_in_cents: requestBody.amount_in_cents,
      currency: requestBody.currency,
      reference: requestBody.reference,
      customer_email: requestBody.customer_email,
      payment_method: requestBody.payment_method,
      redirect_url: requestBody.redirect_url,
    };

    return { data: transaction };
  }

  /**
   * Construye una respuesta de transacción expirada (VOIDED).
   */
  buildExpiredResponse(
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    const transaction: WompiTransaction = {
      id: randomUUID(),
      status: "VOIDED",
      amount_in_cents: requestBody.amount_in_cents,
      currency: requestBody.currency,
      reference: requestBody.reference,
      customer_email: requestBody.customer_email,
      payment_method: requestBody.payment_method,
      redirect_url: requestBody.redirect_url,
    };

    return { data: transaction };
  }

  /**
   * Respuesta nativa de timeout para Wompi (HTTP 504).
   */
  buildTimeoutResponse() {
    return {
      error: {
        type: "GATEWAY_TIMEOUT",
        reason: "Tiempo de espera agotado en la pasarela Wompi",
      },
    };
  }

  /**
   * Respuesta nativa de saturación / límite de tasa (HTTP 429).
   */
  buildRateLimitResponse() {
    return {
      error: {
        type: "RATE_LIMIT",
        reason: "Demasiadas peticiones a Wompi (Rate limit exceeded)",
      },
    };
  }

  /**
   * Respuesta nativa de error interno de pasarela (HTTP 5xx).
   */
  buildServerErrorResponse(code = 500) {
    return {
      error: {
        type: "SERVER_ERROR",
        reason: `Error interno de pasarela Wompi (${code})`,
      },
    };
  }

  /**
   * Crea un PSE tal como lo crea Wompi: PENDING y **sin** URL de redirección.
   *
   * Que la URL no esté es lo correcto, no una simplificación del mock. Se midió
   * contra `sandbox.wompi.co` el 18 de septiembre de 2026: la respuesta de
   * creación trae `payment_method.extra` con solo `{is_three_ds,
   * three_ds_auth_type}`, y `async_payment_url` aparece únicamente en una
   * consulta posterior. Ver el encabezado de `sdk/src/infrastructure/adapters/wompi-pse.ts`.
   */
  buildPendingPseResponse(
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    const transaction: WompiTransaction = {
      id: randomUUID(),
      status: "PENDING",
      amount_in_cents: requestBody.amount_in_cents,
      currency: requestBody.currency,
      reference: requestBody.reference,
      customer_email: requestBody.customer_email,
      payment_method: {
        ...requestBody.payment_method,
        type: "PSE",
        extra: { is_three_ds: false, three_ds_auth_type: null },
      },
      redirect_url: requestBody.redirect_url,
    };

    return { data: transaction };
  }

  /**
   * Token de aceptación de términos.
   *
   * Wompi lo entrega firmado y de un solo uso; el mock no lo valida, pero sí
   * devuelve uno distinto en cada llamada para que un SDK que lo reutilizara no
   * pase las pruebas por accidente.
   *
   * `origin` es el `protocolo://host` de la petición (`requestOrigin()`), para que el
   * `permalink` no apunte a `localhost:3000` cuando el simulador está desplegado.
   */
  buildMerchantResponse(origin: string): WompiMerchantResponse {
    return {
      data: {
        presigned_acceptance: {
          acceptance_token: `sim_acceptance_${randomUUID()}`,
          permalink: `${origin}/v1/sim/wompi/terms`,
        },
      },
    };
  }

  /**
   * Construye una respuesta de tokenización de tarjeta (issue #126).
   * Reproduce la estructura exacta devuelta por Wompi en POST /v1/tokens/cards.
   */
  buildTokenCardResponse(
    requestBody: WompiTokenizeCardRequestBody,
  ): WompiTokenizeCardResponse {
    const cleanNumber = requestBody.number.replace(/\s+/g, "");
    const lastFour = cleanNumber.slice(-4);
    const bin = cleanNumber.slice(0, 6);
    const tokenId = `tok_sim_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

    let brand = "VISA";
    if (cleanNumber.startsWith("5")) {
      brand = "MASTERCARD";
    } else if (cleanNumber.startsWith("3")) {
      brand = "AMEX";
    }

    return {
      status: "CREATED",
      data: {
        id: tokenId,
        created_at: new Date().toISOString(),
        brand,
        name: requestBody.card_holder,
        last_four: lastFour,
        bin,
        exp_year: requestBody.exp_year,
        exp_month: requestBody.exp_month,
        card_holder: requestBody.card_holder,
        created_with_cvc: Boolean(requestBody.cvc),
        expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
        validity_ends_at: null,
      },
    };
  }
}
