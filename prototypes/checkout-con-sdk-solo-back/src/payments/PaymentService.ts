import {
  Amount,
  Currency,
  Environment,
  Gateway,
  KitPagos,
  KitPagosError,
  OrderReference,
  Payer,
  PaymentMethod,
  PseBank,
  ReturnUrlConfig,
  WebhookEvent,
} from "kit-pagos-colombia";
import { AppConfig } from "../config";

export interface ProcessPaymentInput {
  gateway: string;
  orderReference: string;
  /** IP del pagador vista por el servidor del comercio (la exige Mercado Pago en PSE). */
  ipAddress?: string;
  amountInPesos: number;
  returnUrl: string;
  payer: {
    fullName: string;
    email: string;
    documentType: string;
    documentNumber: string;
    phone: string;
    /** La dirección la escribe el comprador; Mercado Pago la exige para PSE. */
    streetName?: string;
    streetNumber?: string;
    neighborhood?: string;
    city?: string;
    zipCode?: string;
  };
  method:
    | {
        type: "CARD";
        cardToken?: string;
        installments?: number;
      }
    | {
        type: "PSE";
        bankCode: string;
        personType?: "NATURAL" | "LEGAL";
      };
}

export interface ProcessPaymentResponse {
  outcome: "APPROVED" | "DECLINED" | "PENDING" | "REDIRECT_REQUIRED";
  transactionId: string;
  status: "APPROVED" | "DECLINED" | "PENDING" | "ERROR";
  nativeStatus: string;
  redirectUrl?: string;
  isApproved: boolean;
  isPending: boolean;
  rejectionReason?: {
    rejectionCode?: string;
    rejectionCategory?: string;
  };
}

export interface PaymentStatusResponse {
  transactionId: string;
  status: "APPROVED" | "DECLINED" | "PENDING" | "ERROR";
  nativeStatus: string;
  isApproved: boolean;
  isPending: boolean;
  isFinal: boolean;
  rejectionReason?: {
    rejectionCode: string;
    rejectionCategory: string;
  };
}

/** El estado del comercio, como lo dice el SDK. */
export type MerchantStatus = "APPROVED" | "DECLINED" | "PENDING";

/**
 * Traduce el estado del SDK al del comercio. `DECLINED`, `EXPIRED`, `VOIDED` y `ERROR` comparten el
 * desenlace: el pago no se completó. Antes se mostraban como `PENDING`, y la página consultaba un
 * pago que ya no iba a cambiar. El valor exacto queda en `nativeStatus`.
 */
export function toMerchantStatus(status: string): MerchantStatus {
  if (status === "APPROVED") return "APPROVED";
  if (status === "PENDING") return "PENDING";
  return "DECLINED";
}

/** Los cinco campos de la dirección, o ninguno: el SDK no recibe una dirección a medias ni inventada. */
function payerAddress(payer: ProcessPaymentInput["payer"]) {
  const { streetName, streetNumber, neighborhood, city, zipCode } = payer;
  if (!streetName || !streetNumber || !neighborhood || !city || !zipCode) return undefined;
  return { streetName, streetNumber, neighborhood, city, zipCode };
}

export class PaymentService {
  constructor(private readonly config: AppConfig) {}

  /**
   * Resuelve la instancia de KitPagos para una pasarela dada.
   * Toda la interacción con la pasarela se delega a KitPagos exclusivamente en el backend.
   *
   * ============================================================================
   * GUÍA DE AMBIENTES (SIMULADOR DE TESIS vs SERVIDORES EXTERNOS):
   * ============================================================================
   * 1. SANDBOX (Por defecto):
   *    - Conecta directamente con las APIs de prueba oficiales de cada pasarela:
   *      * Wompi: https://sandbox.wompi.co
   *      * Mercado Pago: https://api.mercadopago.com
   *      * Kushki: https://api-uat.kushkipagos.com
   *      * Rapyd: https://sandbox-api.rapyd.net
   *    - baseUrl queda en 'undefined', permitiendo que el SDK use las URLs canónicas.
   *
   * 2. SIMULATOR (Solo cuando KIT_PAGOS_ENVIRONMENT='simulator'):
   *    - Desvía las llamadas a NUESTRO SIMULADOR LOCAL de la tesis (simulator-api, :3000)
   *      a través del mapa de rutas '/v1/sim/{gateway}'.
   *    - Permite pruebas herméticas automatizadas sin consumir cuotas de pasarelas
   *      ni requerir conexión a internet activa.
   * ============================================================================
   */
  public getSdk(gateway: Gateway): KitPagos {
    const creds = this.config.credentials;
    const isSim = this.config.environment === "simulator";
    const sim = this.config.simulatorBaseUrl;

    return new KitPagos({
      gateway,
      credentials: {
        [Gateway.WOMPI]: {
          publicKey: creds.wompi.publicKey,
          privateKey: creds.wompi.privateKey,
          integritySecret: creds.wompi.integritySecret,
          webhookSecret: creds.wompi.eventsSecret,
        },
        [Gateway.MERCADOPAGO]: {
          publicKey: creds.mercadopago.publicKey,
          privateKey: creds.mercadopago.accessToken,
          webhookSecret: creds.mercadopago.webhookSecret,
        },
        [Gateway.KUSHKI]: {
          publicKey: creds.kushki.publicMerchantId,
          privateKey: creds.kushki.privateMerchantId,
          webhookSecret: creds.kushki.webhookSecret,
        },
        [Gateway.RAPYD]: {
          publicKey: creds.rapyd.accessKey,
          privateKey: creds.rapyd.secretKey,
          webhookUrl: creds.rapyd.webhookUrl,
        },
      },
      // Ambiente: SANDBOX por defecto, o SIMULATOR si se especificó explícitamente
      environment: isSim ? Environment.SIMULATOR : Environment.SANDBOX,
      // URLs Base: Solo se sobreescriben si usamos NUESTRO simulador local de tesis
      baseUrl: isSim
        ? {
            [Gateway.WOMPI]: `${sim}/v1/sim/wompi`,
            [Gateway.MERCADOPAGO]: `${sim}/v1/sim/mercadopago`,
            [Gateway.KUSHKI]: `${sim}/v1/sim/kushki`,
            [Gateway.RAPYD]: `${sim}/v1/sim/rapyd`,
          }
        : undefined,
    });
  }

  public parseGateway(raw: string): Gateway {
    const normalized = raw.trim().toUpperCase();
    if (normalized === Gateway.WOMPI) return Gateway.WOMPI;
    if (normalized === Gateway.MERCADOPAGO) return Gateway.MERCADOPAGO;
    if (normalized === Gateway.KUSHKI) return Gateway.KUSHKI;
    if (normalized === Gateway.RAPYD) return Gateway.RAPYD;
    throw new Error(`Pasarela no soportada: '${raw}'. Opciones válidas: WOMPI, MERCADOPAGO, KUSHKI, RAPYD.`);
  }

  /**
   * Obtiene la lista oficial de bancos para PSE consultando el SDK.
   */
  async listPseBanks(gatewayStr: string): Promise<PseBank[]> {
    const gateway = this.parseGateway(gatewayStr);
    const sdk = this.getSdk(gateway);
    return sdk.getPseBanks();
  }

  /**
   * Crea un pago consumiendo KitPagos en el backend.
   */
  async createPayment(input: ProcessPaymentInput): Promise<ProcessPaymentResponse> {
    const gateway = this.parseGateway(input.gateway);
    const sdk = this.getSdk(gateway);

    const [firstName, ...rest] = input.payer.fullName.trim().split(/\s+/);
    const lastName = rest.join(" ") || firstName;
    const address = payerAddress(input.payer);

    const payer = new Payer({
      email: input.payer.email,
      fullName: input.payer.fullName,
      firstName,
      lastName,
      documentType: input.payer.documentType,
      documentNumber: input.payer.documentNumber,
      phone: input.payer.phone,
      phoneAreaCode: "57",
      ...(address ? { address } : {}),
    });

    let paymentMethod: PaymentMethod;
    if (input.method.type === "CARD") {
      paymentMethod = PaymentMethod.card(input.method.cardToken, {
        installments: input.method.installments || 1,
      });
    } else {
      paymentMethod = PaymentMethod.pse({
        bankCode: input.method.bankCode,
        payerKind: input.method.personType || "NATURAL",
      });
    }

    // La URL de retorno sale de PUBLIC_BASE_URL, que por omisión es `localtest.me`: Mercado Pago no
    // acepta volver de un PSE a `localhost` (punto 120).
    const returnUrlConfig = new ReturnUrlConfig(input.returnUrl);

    const result = await sdk.createPayment({
        amount: new Amount(input.amountInPesos.toFixed(2)),
        currency: new Currency("COP"),
        orderReference: new OrderReference(input.orderReference),
        payer,
        paymentMethod,
        returnUrlConfig,
      ipAddress: input.ipAddress,
      });

      if (result.outcome === "REDIRECT_REQUIRED") {
        return {
          outcome: "REDIRECT_REQUIRED",
          transactionId: result.redirect.gatewayTransactionId.value,
          status: "PENDING",
          nativeStatus: result.redirect.rawStatus || "PENDING",
          redirectUrl: result.redirect.redirectUrl,
          isApproved: false,
          isPending: true,
        };
      }

      const tx = result.transaction;
      const status = toMerchantStatus(tx.getStatus());

      const rejection = tx.rejectionReason;

      return {
        outcome: status,
        transactionId: tx.gatewayTransactionId.value,
        status,
        nativeStatus: tx.rawStatus,
        isApproved: tx.isApproved(),
        isPending: tx.isPending(),
        rejectionReason: rejection
          ? {
              rejectionCode: rejection.rejectionCode,
              rejectionCategory: rejection.rejectionCategory,
            }
          : undefined,
      };
  }

  /**
   * Consulta el estado de un pago mediante KitPagos.
   */
  async getPaymentStatus(gatewayStr: string, transactionId: string): Promise<PaymentStatusResponse> {
    const gateway = this.parseGateway(gatewayStr);
    const sdk = this.getSdk(gateway);

    const tx = await sdk.getPaymentStatus(transactionId);
    const rejection = tx.rejectionReason;

    return {
      transactionId: tx.gatewayTransactionId.value,
      status: toMerchantStatus(tx.getStatus()),
      nativeStatus: tx.rawStatus,
      isApproved: tx.isApproved(),
      isPending: tx.isPending(),
      isFinal: tx.isFinal(),
      ...(rejection
        ? { rejectionReason: { rejectionCode: rejection.rejectionCode, rejectionCategory: rejection.rejectionCategory } }
        : {}),
    };
  }

  /**
   * Valida la firma del webhook con KitPagos.
   */
  validateWebhook(
    gatewayStr: string,
    rawBody: string,
    headers: Record<string, string>,
    query?: Record<string, string>,
  ): WebhookEvent {
    const gateway = this.parseGateway(gatewayStr);
    const sdk = this.getSdk(gateway);
    return sdk.validateWebhook(rawBody, headers, { gateway, query });
  }
}
