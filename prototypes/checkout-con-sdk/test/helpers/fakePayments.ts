import {
  CreatePaymentRequest,
  IncomingWebhook,
  PaymentSnapshot,
  PaymentsPort,
  PseBankOption,
  WebhookNotification,
} from "../../src/checkout/PaymentsPort";

/**
 * Un módulo de pagos falso para probar el esqueleto sin pasarela. Cada operación es un
 * `jest.fn` que la prueba reemplaza cuando necesita otro desenlace.
 */
export function fakePayments(): jest.Mocked<PaymentsPort> {
  return {
    publicConfig: jest.fn((): Record<string, string> => ({ publicKey: "pub_fake" })),
    listPseBanks: jest.fn(async (): Promise<PseBankOption[]> => [{ code: "1007", name: "Bancolombia" }]),
    createPayment: jest.fn(
      async (request: CreatePaymentRequest): Promise<PaymentSnapshot> =>
        request.method.type === "PSE"
          ? { transactionId: "tx-pse-1", status: "PENDING", nativeStatus: "PENDING", redirectUrl: "https://bank.example/pay" }
          : { transactionId: "tx-card-1", status: "APPROVED", nativeStatus: "APPROVED" },
    ),
    getPaymentStatus: jest.fn(
      async (transactionId: string): Promise<PaymentSnapshot> => ({
        transactionId,
        status: "APPROVED",
        nativeStatus: "APPROVED",
      }),
    ),
    verifyWebhook: jest.fn(
      async (_webhook: IncomingWebhook): Promise<WebhookNotification | null> => ({
        transactionId: "tx-card-1",
        status: "APPROVED",
        nativeStatus: "APPROVED",
      }),
    ),
  };
}
