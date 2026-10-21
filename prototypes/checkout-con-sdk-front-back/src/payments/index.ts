import { PaymentsPort } from "../checkout/PaymentsPort";

/**
 * El módulo de pagos de este prototipo: lo único que cambia entre A y B, y lo único que se
 * cuenta en el experimento. Lo construye el issue de cada prototipo; en el esqueleto común
 * todas las operaciones fallan.
 */
export function createPayments(): PaymentsPort {
  const notImplemented = (): never => {
    throw new Error("El módulo de pagos de este prototipo todavía no está implementado (src/payments/).");
  };
  return {
    publicConfig: notImplemented,
    listPseBanks: async () => notImplemented(),
    createPayment: async () => notImplemented(),
    getPaymentStatus: async () => notImplemented(),
    verifyWebhook: async () => notImplemented(),
  };
}
