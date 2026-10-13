/**
 * Cliente HTTP de `/v1/api`. Es todo lo que este prototipo sabe de Kit Pagos: rutas, formas
 * JSON y códigos de error, sin instalar `kit-pagos-colombia`.
 *
 * No manda cabeceras de credenciales ni `Authorization`: contra el perfil del servidor en el
 * ambiente `simulator` la API no las pide (`KitPagosProvider.resolveClient`).
 */

export interface PseBank {
  code: string;
  name: string;
  achCode?: string;
}

export interface Payer {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  documentType: string;
  documentNumber: string;
  phone: string;
  phoneAreaCode: string;
  address: {
    streetName: string;
    streetNumber: string;
    city: string;
    zipCode: string;
    neighborhood: string;
  };
}

export type PaymentMethodBody =
  | { type: "PSE"; bankCode: string; payerKind: "NATURAL" | "LEGAL" }
  | { type: "CARD"; token: string; installments: number };

export interface CreatePaymentBody {
  gateway: string;
  amount: string;
  currency: string;
  orderReference: string;
  payer: Payer;
  paymentMethod: PaymentMethodBody;
  returnUrlConfig: { returnUrl: string };
  ipAddress?: string;
}

export interface TransactionView {
  gatewayTransactionId: string;
  orderReference: string;
  amount: string;
  currency: string;
  status: string;
  rawStatus: string;
  isApproved: boolean;
  isPending: boolean;
  isFinal: boolean;
  authorizationCode?: string;
  rejectionReason?: { code?: string; category?: string; message?: string };
}

export type CreatePaymentResponse =
  | { outcome: "TRANSACTION"; transaction: TransactionView; rawStatus: string }
  | {
      outcome: "REDIRECT_REQUIRED";
      redirect: { redirectUrl: string; gatewayTransactionId: string; rawStatus?: string };
    };

/** Una respuesta que no es 2xx, con el `code` del SDK cuando la API lo trae. */
export class KitPagosApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KitPagosApiError";
  }
}

export interface KitPagosApi {
  listGateways(): Promise<string[]>;
  listPseBanks(gateway: string): Promise<PseBank[]>;
  createPayment(body: CreatePaymentBody): Promise<CreatePaymentResponse>;
  getPaymentStatus(gateway: string, gatewayTransactionId: string): Promise<TransactionView>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}

export function createKitPagosApi(baseUrl: string, fetchFn: FetchLike = fetch): KitPagosApi {
  const root = baseUrl.replace(/\/+$/, "");

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchFn(`${root}${path}`, init);
    const body = await readJson(response);
    if (!response.ok) {
      const code = String(body.code ?? body.error ?? `HTTP_${response.status}`);
      const message = String(body.message ?? `La API respondió ${response.status}.`);
      throw new KitPagosApiError(response.status, code, message);
    }
    return body as T;
  }

  return {
    async listGateways() {
      const body = await call<{ gateways: string[] }>("/gateways");
      return body.gateways;
    },
    async listPseBanks(gateway) {
      const body = await call<{ pseBanks: Array<{ banks: PseBank[] }> }>(
        `/pse-banks?gateway=${encodeURIComponent(gateway)}`,
      );
      return body.pseBanks.flatMap((entry) => entry.banks);
    },
    createPayment(body) {
      return call<CreatePaymentResponse>("/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    async getPaymentStatus(gateway, gatewayTransactionId) {
      const body = await call<{ transaction: TransactionView }>(
        `/payments/${encodeURIComponent(gatewayTransactionId)}?gateway=${encodeURIComponent(gateway)}`,
      );
      return body.transaction;
    },
  };
}
