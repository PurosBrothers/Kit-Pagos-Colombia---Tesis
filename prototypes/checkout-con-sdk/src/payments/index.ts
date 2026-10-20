import {
  Amount,
  Currency,
  Environment,
  Gateway,
  KitPagos,
  KitPagosError,
  KitPagosErrorCode,
  OrderReference,
  Payer,
  PaymentMethod,
  ReturnUrlConfig,
} from "kit-pagos-colombia";
import type { Credentials, TransactionStatus, WebhookEvent } from "kit-pagos-colombia";
import {
  CreatePaymentRequest,
  IncomingWebhook,
  MerchantPaymentStatus,
  PaymentSnapshot,
  PaymentsPort,
  PaymentTechnicalError,
  PseBankOption,
  WebhookNotification,
} from "../checkout/PaymentsPort";
import type { Payer as PortPayer, PaymentMethodRequest } from "../checkout/PaymentsPort";
import { paymentsEnvironment } from "../checkout/environment";
import type { IncomingHttpHeaders } from "node:http";

/**
 * El módulo de pagos del prototipo B: las seis funciones del puerto (plan de evaluación,
 * §2) delegadas en `kit-pagos-colombia`. Es lo único que cambia frente al prototipo A.
 *
 * La pasarela es Wompi, en el ambiente que diga el esqueleto: el sandbox oficial por omisión
 * o la API de Simulación (punto 111). El módulo no conoce ninguna URL de Wompi, ningún nombre
 * de campo ni ningún estado propio: el SDK resuelve el endpoint desde `environment` y traduce
 * los nativos a `TransactionStatus`. Lo que sí lee del entorno son las credenciales, porque el
 * simulador firma los webhooks con las suyas (`simulator-api/src/auth/merchantSecrets.ts`): si
 * aquí no coincidieran, la firma no verificaría.
 */

/** La pasarela de este prototipo. El prototipo es de Wompi por la asignación A/B de #151. */
const GATEWAY = Gateway.WOMPI;

/**
 * Credenciales de prueba para cuando el entorno no trae las de Wompi. No son secretos ni
 * apuntan a producción; siguen la convención de `examples/` y no llevan las marcas
 * (`invalid`, `inexistente`, `not_found`) con las que el simulador fuerza la respuesta de
 * credencial inválida.
 */
const DEFAULT_PUBLIC_KEY = "pub_test_ejemplo_no_real";
const DEFAULT_PRIVATE_KEY = "prv_test_ejemplo_no_real";

/** El secreto de integridad de Wompi cuando el simulador no configura uno propio. */
const DEFAULT_INTEGRITY_SECRET = "test_integrity_kit_pagos_simulator";

/** Las llaves sin las que el sandbox oficial no cobra; el simulador tiene valores por omisión. */
const SANDBOX_KEYS = ["WOMPI_PUBLIC_KEY", "WOMPI_PRIVATE_KEY", "WOMPI_INTEGRITY_SECRET"] as const;

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

/**
 * Construye el puerto de pagos. `env` es inyectable para las pruebas, igual que en
 * `loadCheckoutConfig`; en producción se usa `process.env`.
 */
export function createPayments(env: NodeJS.ProcessEnv = process.env): PaymentsPort {
  const { environment, simulatorUrl } = paymentsEnvironment(env);
  // WOMPI_BASE_URL apunta el módulo a otro simulador a propósito; si no, manda el ambiente del esqueleto.
  const baseUrlOverride = readEnv(env, "WOMPI_BASE_URL");
  const sdkEnvironment =
    baseUrlOverride !== undefined || environment === "simulator" ? Environment.SIMULATOR : Environment.SANDBOX;
  if (sdkEnvironment === Environment.SANDBOX) {
    const missing = SANDBOX_KEYS.filter((name) => readEnv(env, name) === undefined);
    if (missing.length > 0) {
      throw new Error(
        `Para cobrar en el sandbox de Wompi faltan ${missing.join(", ")} en el .env de la raíz. ` +
          "Sin ellas, usa el simulador: npm run start:local.",
      );
    }
  }
  const baseUrl =
    baseUrlOverride ?? (sdkEnvironment === Environment.SIMULATOR ? `${simulatorUrl}/v1/sim/wompi` : undefined);

  const credentials: Credentials = {
    publicKey: readEnv(env, "WOMPI_PUBLIC_KEY") ?? DEFAULT_PUBLIC_KEY,
    privateKey: readEnv(env, "WOMPI_PRIVATE_KEY") ?? DEFAULT_PRIVATE_KEY,
    // El cobro con Wompi exige firma de integridad aunque sea el simulador: sin el secreto,
    // el adaptador lanza INVALID_CREDENTIALS antes de la llamada.
    integritySecret: readEnv(env, "WOMPI_INTEGRITY_SECRET") ?? DEFAULT_INTEGRITY_SECRET,
  };
  const webhookSecret = readEnv(env, "WOMPI_EVENTS_SECRET");
  if (webhookSecret) {
    credentials.webhookSecret = webhookSecret;
  }

  const kit = new KitPagos({
    gateway: GATEWAY,
    credentials: { [GATEWAY]: credentials },
    environment: sdkEnvironment,
    ...(baseUrl ? { baseUrl } : {}),
  });

  /**
   * Ejecuta una operación del SDK y convierte su fallo en el del puerto.
   *
   * Cualquier `KitPagosError` que sale de aquí es un fallo técnico, no un rechazo: los
   * rechazos de negocio vuelven como `Transaction` con estado `DECLINED` (o `ERROR`), no como
   * excepción. Los reintentos de las consultas ya los hizo el SDK (`RetryHandler`); un
   * `MAX_RETRIES_EXCEEDED` significa que se agotaron y el fallo persiste. `createPayment` es
   * la excepción deliberada: el SDK no la reintenta para no cobrar dos veces (punto 35 del
   * `architecture-log.md`), así que el módulo tampoco.
   */
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof KitPagosError) {
        throw new PaymentTechnicalError(
          `La pasarela no pudo completar la operación (${error.code}): ${error.message}`,
          error,
        );
      }
      throw error;
    }
  }

  return {
    publicConfig() {
      return {
        gateway: GATEWAY,
        publicKey: credentials.publicKey,
        environment: sdkEnvironment,
      };
    },

    async listPseBanks(): Promise<PseBankOption[]> {
      const banks = await call(() => kit.getPseBanks());
      return banks.map((bank) => ({ code: bank.code, name: bank.name }));
    },

    async createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
      const result = await call(() =>
        kit.createPayment({
          amount: new Amount(String(request.amountInPesos)),
          currency: new Currency("COP"),
          orderReference: new OrderReference(request.orderReference),
          payer: toSdkPayer(request.payer),
          paymentMethod: toSdkMethod(request.method),
          returnUrlConfig: new ReturnUrlConfig(request.returnUrl),
        }),
      );

      if (result.outcome === "REDIRECT_REQUIRED") {
        // La redirección al banco solo aparece en un pago que aún no se resolvió: nace PENDING.
        return {
          transactionId: result.redirect.gatewayTransactionId.value,
          status: "PENDING",
          nativeStatus: result.redirect.rawStatus,
          redirectUrl: result.redirect.redirectUrl,
        };
      }
      return toSnapshot(result.transaction);
    },

    async getPaymentStatus(transactionId: string): Promise<PaymentSnapshot> {
      const transaction = await call(() => kit.getPaymentStatus(transactionId));
      return toSnapshot(transaction);
    },

    async verifyWebhook(webhook: IncomingWebhook): Promise<WebhookNotification | null> {
      let event: WebhookEvent;
      try {
        event = kit.validateWebhook(webhook.rawBody, toStringHeaders(webhook.headers), {
          gateway: GATEWAY,
          query: definedQuery(webhook.query),
        });
      } catch (error) {
        // Una firma que no verifica es un webhook ajeno, no un fallo del pago: el puerto
        // pide `null` para que el checkout responda 401 y no reintente.
        if (error instanceof KitPagosError && error.code === KitPagosErrorCode.WEBHOOK_SIGNATURE_INVALID) {
          return null;
        }
        if (error instanceof KitPagosError) {
          throw new PaymentTechnicalError(
            `No se pudo verificar el webhook (${error.code}): ${error.message}`,
            error,
          );
        }
        throw error;
      }
      return {
        transactionId: event.gatewayTransactionId,
        status: toMerchantStatus(event.newStatus),
        // El evento del SDK ya viene normalizado y no expone el valor crudo; en Wompi los
        // nativos coinciden con los normalizados (`PENDING`, `APPROVED`, `DECLINED`), así que
        // el auditor ve lo mismo que mandó la pasarela.
        nativeStatus: event.newStatus,
      };
    },
  };
}

/** Traduce el estado del SDK al del comercio, conservando el nativo aparte (función 2). */
function toMerchantStatus(status: TransactionStatus): MerchantPaymentStatus {
  if (status === "APPROVED") return "APPROVED";
  if (status === "PENDING") return "PENDING";
  // DECLINED, EXPIRED, VOIDED y ERROR comparten el desenlace para el comercio: el pago no
  // se completó. El valor exacto queda en `nativeStatus`, que es lo que se guarda para auditoría.
  return "DECLINED";
}

function toSnapshot(transaction: {
  gatewayTransactionId: { value: string };
  getStatus(): TransactionStatus;
  rawStatus: string;
}): PaymentSnapshot {
  return {
    transactionId: transaction.gatewayTransactionId.value,
    status: toMerchantStatus(transaction.getStatus()),
    nativeStatus: transaction.rawStatus,
  };
}

function toSdkPayer(payer: PortPayer): Payer {
  return new Payer({
    email: payer.email,
    fullName: payer.fullName,
    documentType: payer.documentType,
    documentNumber: payer.documentNumber,
    phone: payer.phone,
  });
}

function toSdkMethod(method: PaymentMethodRequest): PaymentMethod {
  if (method.type === "CARD") {
    return PaymentMethod.card(method.cardToken, { installments: method.installments });
  }
  return PaymentMethod.pse({ bankCode: method.bankCode, payerKind: method.personType });
}

/** Las cabeceras de Node admiten arreglos; el SDK de webhooks espera una sola cadena. */
function toStringHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      result[name] = value;
    } else if (Array.isArray(value) && value.length > 0) {
      result[name] = value[0];
    }
  }
  return result;
}

function definedQuery(query: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) result[name] = value;
  }
  return result;
}
