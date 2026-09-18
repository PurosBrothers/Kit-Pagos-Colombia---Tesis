import { randomUUID } from "node:crypto";
import {
  WompiCreateTransactionRequestBody,
  WompiMerchantResponse,
  WompiTransaction,
  WompiTransactionResponse,
} from "./types";
import { TransactionStore, transactionStore } from "../../store/TransactionStore";

/**
 * Gateway Mock Factory — Wompi (issue #55).
 *
 * Single responsibility: build the response payload that replicates the
 * native Wompi structure for a given scenario, and persist it in the
 * TransactionStore so the status query endpoint can retrieve it later.
 *
 * Does not know about headers, does not decide which scenario to execute
 * (that is the ScenarioEngine's responsibility), and does not validate the
 * request body (that is the router's responsibility).
 *
 * The TransactionStore is received in the constructor to allow substitution
 * in tests without altering the shared singleton, defaulting to the shared
 * singleton instance.
 *
 * Iteration 3 will extend this file with the remaining scenarios
 * (DECLINED, INSUFFICIENT_FUNDS) and with factories for the other
 * gateways, as described in layers-and-components.md.
 */
export class GatewayMockFactory {
  constructor(private readonly store: TransactionStore = transactionStore) {}

  /**
   * Builds an approved transaction response with the same shape that the
   * real Wompi API would return: the `transaction` object wrapped in `data`,
   * with a generated `id` and reflecting the amount, reference and payer
   * email received in the original request.
   *
   * The transaction is saved in the store before returning, indexed by its
   * `id`, so that GET /v1/sim/wompi/transactions/:id can retrieve it without
   * having to rebuild it.
   */
  buildApprovedResponse(
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    const transaction: WompiTransaction = {
      id: randomUUID(),
      status: "APPROVED",
      amount_in_cents: requestBody.amount_in_cents,
      currency: requestBody.currency,
      reference: requestBody.reference,
      customer_email: requestBody.customer_email,
    };

    // Persist in the shared store before responding, so that
    // getPaymentStatus() in the SDK can query the state afterwards.
    this.store.save(transaction.id, transaction);

    return { data: transaction };
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

    this.store.save(transaction.id, transaction);

    return { data: transaction };
  }

  /**
   * Avanza un PSE un paso cada vez que se lo consulta.
   *
   * ## Por qué el simulador tiene que hacer esto
   *
   * El sandbox de Wompi publica la URL de redirección **en el mismo instante**
   * en que resuelve el pago: con el banco que aprueba, a los 1075 ms junto con
   * `APPROVED`; con el que declina, a los 1650 ms junto con `DECLINED`. Es decir
   * que resuelve el pago solo, sin que nadie visite el banco, y cuando la URL
   * existe ya no sirve para nada. Contra ese sandbox **es imposible verificar el
   * orden del flujo de redirección**.
   *
   * Acá el orden se reproduce en dos pasos, y esa es la razón de fondo por la
   * que la API de Simulación existe:
   *
   *   1ª consulta → sigue PENDING, pero ya con `async_payment_url`. Es la
   *      ventana que el sandbox real nunca expone y en la que un pagador de
   *      verdad sería redirigido.
   *   2ª consulta → estado final, como si el pagador ya hubiera pagado.
   *
   * No hace falta un contador: la presencia de la URL **es** el estado.
   *
   * El estado final lo decide el banco, con los mismos códigos del sandbox
   * (`1` aprueba, `2` declina, `3` da error), para que una prueba pueda elegir
   * el desenlace sin depender del azar.
   */
  advancePseTransaction(transaction: WompiTransaction): WompiTransaction {
    const extra = transaction.payment_method?.extra ?? {};

    if (!extra.async_payment_url) {
      const advanced: WompiTransaction = {
        ...transaction,
        payment_method: {
          ...transaction.payment_method,
          type: "PSE",
          extra: {
            ...extra,
            async_payment_url: `http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=${transaction.id}`,
          },
        },
      };
      this.store.save(advanced.id, advanced);
      return advanced;
    }

    const advanced: WompiTransaction = {
      ...transaction,
      status: resolvePseOutcome(transaction.payment_method?.financial_institution_code),
    };
    this.store.save(advanced.id, advanced);
    return advanced;
  }

  /**
   * Token de aceptación de términos.
   *
   * Wompi lo entrega firmado y de un solo uso; el mock no lo valida, pero sí
   * devuelve uno distinto en cada llamada para que un SDK que lo reutilizara no
   * pase las pruebas por accidente.
   */
  buildMerchantResponse(): WompiMerchantResponse {
    return {
      data: {
        presigned_acceptance: {
          acceptance_token: `sim_acceptance_${randomUUID()}`,
          permalink: "http://localhost:3000/v1/sim/wompi/terms",
        },
      },
    };
  }
}

/** Mismos códigos de banco de prueba que expone el sandbox de Wompi. */
function resolvePseOutcome(
  financialInstitutionCode: string | undefined,
): WompiTransaction["status"] {
  if (financialInstitutionCode === "2") return "DECLINED";
  if (financialInstitutionCode === "3") return "ERROR";
  return "APPROVED";
}