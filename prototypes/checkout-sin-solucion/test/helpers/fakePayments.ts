import {
  CreatePaymentRequest,
  GatewayOption,
  IncomingWebhook,
  PaymentSnapshot,
  PaymentsPort,
  PseBankOption,
  WebhookNotification,
} from "../../src/checkout/PaymentsPort";

/** Dos pasarelas falsas: una que tokeniza en el navegador y otra que cobra en su página. */
export const FAKE_GATEWAYS: GatewayOption[] = [
  { id: "token-pay", name: "Token Pay", cardCapture: "BROWSER_TOKEN" },
  { id: "hosted-pay", name: "Hosted Pay", cardCapture: "HOSTED_PAGE" },
];

/**
 * Un módulo de pagos falso para probar el esqueleto sin pasarela. Cada operación es un
 * `jest.fn` que la prueba reemplaza cuando necesita otro desenlace.
 */
export function fakePayments(): jest.Mocked<PaymentsPort> {
  return {
    listGateways: jest.fn((): GatewayOption[] => FAKE_GATEWAYS),
    publicConfig: jest.fn((gateway: string): Record<string, string> => ({ gateway, publicKey: "pub_fake" })),
    listPseBanks: jest.fn(async (_gateway: string): Promise<PseBankOption[]> => [{ code: "1007", name: "Bancolombia" }]),
    createPayment: jest.fn(async (request: CreatePaymentRequest): Promise<PaymentSnapshot> => {
      if (request.method.type === "PSE") {
        return { transactionId: "tx-pse-1", status: "PENDING", nativeStatus: "PENDING", redirectUrl: "https://bank.example/pay" };
      }
      if (!request.method.cardToken) {
        return { transactionId: "tx-hosted-1", status: "PENDING", nativeStatus: "ACT", redirectUrl: "https://pay.example/checkout" };
      }
      return { transactionId: "tx-card-1", status: "APPROVED", nativeStatus: "APPROVED" };
    }),
    getPaymentStatus: jest.fn(
      async (_gateway: string, transactionId: string): Promise<PaymentSnapshot> => ({
        transactionId,
        status: "APPROVED",
        nativeStatus: "APPROVED",
      }),
    ),
    verifyWebhook: jest.fn(
      async (_gateway: string, _webhook: IncomingWebhook): Promise<WebhookNotification | null> => ({
        transactionId: "tx-card-1",
        status: "APPROVED",
        nativeStatus: "APPROVED",
      }),
    ),
  };
}
