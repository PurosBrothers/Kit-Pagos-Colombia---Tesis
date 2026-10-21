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
    streetName?: string;
    streetNumber?: string;
    city?: string;
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
        },
        [Gateway.RAPYD]: {
          publicKey: creds.rapyd.accessKey,
          privateKey: creds.rapyd.secretKey,
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

    const nameParts = input.payer.fullName.trim().split(" ");
    const firstName = nameParts[0] || "Cliente";
    const lastName = nameParts.slice(1).join(" ") || "Mate";

    const payer = new Payer({
      email: input.payer.email,
      fullName: input.payer.fullName,
      firstName,
      lastName,
      documentType: input.payer.documentType,
      documentNumber: input.payer.documentNumber,
      phone: input.payer.phone,
      phoneAreaCode: "57",
      address: {
        streetName: input.payer.streetName || "Carrera 7",
        streetNumber: input.payer.streetNumber || "32-16",
        city: input.payer.city || "Bogotá",
        zipCode: "110111",
        neighborhood: "Chapinero",
      },
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

    // NOTA TÉCNICA (Mercado Pago PSE):
    // La API de Orders de Mercado Pago rechaza con HTTP 402 ("processing_error") si callback_url
    // contiene "localhost" o "127.0.0.1". Sustituimos el host por "localtest.me" (que en cualquier
    // sistema operativo resuelve por DNS público a 127.0.0.1) permitiendo la redirección local.
    let effectiveReturnUrl = input.returnUrl;
    if (
      gateway === Gateway.MERCADOPAGO &&
      (effectiveReturnUrl.includes("localhost") || effectiveReturnUrl.includes("127.0.0.1"))
    ) {
      effectiveReturnUrl = effectiveReturnUrl.replace("localhost", "localtest.me").replace("127.0.0.1", "localtest.me");
    }

    const returnUrlConfig = new ReturnUrlConfig(effectiveReturnUrl);

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
      const txStatus = tx.getStatus();
      const status: "APPROVED" | "DECLINED" | "PENDING" =
        txStatus === "APPROVED" ? "APPROVED" : txStatus === "DECLINED" ? "DECLINED" : "PENDING";

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
    const txStatus = tx.getStatus();
    const status: "APPROVED" | "DECLINED" | "PENDING" =
      txStatus === "APPROVED" ? "APPROVED" : txStatus === "DECLINED" ? "DECLINED" : "PENDING";

    return {
      transactionId: tx.gatewayTransactionId.value,
      status,
      nativeStatus: tx.rawStatus,
      isApproved: tx.isApproved(),
      isPending: tx.isPending(),
      isFinal: tx.isFinal(),
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
