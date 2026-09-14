import { randomUUID } from "node:crypto";
import {
  WompiCreateTransactionRequestBody,
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
}