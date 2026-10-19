/**
 * Cliente HTTP de `/v1/api`. Es todo lo que este prototipo sabe de Kit Pagos: rutas, formas
 * JSON y códigos de error, sin instalar `kit-pagos-colombia`.
 *
 * No manda cabeceras de credenciales ni `Authorization`: contra el perfil del servidor, en el
 * ambiente `simulator` y en `sandbox`, la API no las pide (`KitPagosProvider.resolveClient`).
 * Lo único que agrega a cada llamada es `x-kit-pagos-environment`, que dice a qué ambiente va el
 * cobro: el simulador de la propia API o el sandbox oficial de la pasarela.
 */

import type { KitPagosEnvironment } from "./config";

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

/**
 * Cómo recibe la tarjeta una pasarela, según `GET /v1/api/gateways`: tokenizada en el navegador
 * (`BROWSER_TOKEN`) o en la página de la pasarela, con un pago creado sin token
 * (`HOSTED_PAGE`). Con este dato la tienda no tiene que saber cuál es cuál.
 */
export type CardCapture = "BROWSER_TOKEN" | "HOSTED_PAGE";

export interface GatewayCatalog {
  gateways: string[];
  /** Vacío si la API no lo dice, como la que corre un código anterior a este campo. */
  cardCapture: Record<string, CardCapture>;
}

export type PaymentMethodBody =
  | { type: "PSE"; bankCode: string; payerKind: "NATURAL" | "LEGAL" }
  | { type: "CARD"; token?: string; installments: number };

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
  /** El `RejectionReason` del SDK, con sus mismos campos. Solo en un rechazo con código. */
  rejectionReason?: { rejectionCode: string; rejectionCategory: string };
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
  listGateways(): Promise<GatewayCatalog>;
  listPseBanks(gateway: string): Promise<PseBank[]>;
  createPayment(body: CreatePaymentBody): Promise<CreatePaymentResponse>;
  getPaymentStatus(gateway: string, gatewayTransactionId: string): Promise<TransactionView>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface KitPagosApiOptions {
  /** A qué ambiente va cada llamada. Por omisión, `simulator`, que también es el de la API. */
  environment?: KitPagosEnvironment;
  /**
   * Recibe el aviso de la cabecera `x-kit-pagos-warning`. En `sandbox` la API cobra con las
   * credenciales del servidor y lo advierte en cada respuesta; el navegador solo puede leerla
   * porque la API la expone en `Access-Control-Expose-Headers`.
   */
  onWarning?: (message: string) => void;
}

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

export function createKitPagosApi(
  baseUrl: string,
  fetchFn: FetchLike = fetch,
  { environment = "simulator", onWarning }: KitPagosApiOptions = {},
): KitPagosApi {
  const root = baseUrl.replace(/\/+$/, "");

  async function call<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
    const headers: Record<string, string> = { "x-kit-pagos-environment": environment };
    if (init.body !== undefined) {
      headers["content-type"] = "application/json";
    }

    let response: Response;
    try {
      response = await fetchFn(`${root}${path}`, { ...init, headers });
    } catch (error) {
      // `fetch` rechaza con el mismo `TypeError` cuando no hubo respuesta y cuando la hubo pero
      // el navegador no la deja leer por CORS: el estándar Fetch trata los dos como error de red,
      // y la página no puede distinguirlos. Medido el 15 de octubre de 2026: un túnel de
      // Cloudflare cambió un 502 de la API por su propia página, sin CORS.
      throw new KitPagosApiError(
        0,
        "API_UNREACHABLE",
        `No se pudo leer la respuesta de la API en ${new URL(root).origin}. Hay dos causas posibles: ` +
          `la API no respondió (verifique que esté encendida; si es la desplegada en Render, puede estar despertando), ` +
          `o respondió y el navegador no pudo leer la respuesta, como pasa cuando un proxy (un túnel de Cloudflare, ` +
          `por ejemplo) reemplaza un error de la API por una página propia sin CORS. ` +
          `El registro de la API dice si la petición llegó. (${String(error)})`,
      );
    }

    const warning = response.headers.get("x-kit-pagos-warning");
    if (warning) {
      onWarning?.(warning);
    }
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
      const body = await call<{ gateways: string[]; cardCapture?: Record<string, CardCapture> }>("/gateways");
      return { gateways: body.gateways, cardCapture: { ...body.cardCapture } };
    },
    async listPseBanks(gateway) {
      const body = await call<{ pseBanks: Array<{ banks: PseBank[] }> }>(
        `/pse-banks?gateway=${encodeURIComponent(gateway)}`,
      );
      return body.pseBanks.flatMap((entry) => entry.banks);
    },
    createPayment(body) {
      return call<CreatePaymentResponse>("/payments", { method: "POST", body: JSON.stringify(body) });
    },
    async getPaymentStatus(gateway, gatewayTransactionId) {
      const body = await call<{ transaction: TransactionView }>(
        `/payments/${encodeURIComponent(gatewayTransactionId)}?gateway=${encodeURIComponent(gateway)}`,
      );
      return body.transaction;
    },
  };
}
