import {
  Amount,
  Currency,
  Environment,
  KitPagos,
  KitPagosError,
  KitPagosErrorCode,
  OrderReference,
  Payer,
  PaymentMethod,
  ReturnUrlConfig,
} from "kit-pagos-colombia";
import type { TransactionStatus, WebhookEvent } from "kit-pagos-colombia";
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
import { GATEWAYS, GatewaySetup, readEnv } from "./gateways";
import type { IncomingHttpHeaders } from "node:http";

/**
 * El módulo de pagos del prototipo B: las seis funciones del puerto (plan de evaluación,
 * §2) delegadas en `kit-pagos-colombia`. Es lo único que cambia frente al prototipo A.
 *
 * Las pasarelas son las de `gateways.ts`, en el ambiente que diga el esqueleto: el sandbox
 * oficial por omisión o la API de Simulación (puntos 111 y 117). El módulo no conoce ninguna
 * URL de las pasarelas, ningún nombre de campo ni ningún estado propio: el SDK resuelve el
 * endpoint desde `environment` y traduce los nativos a `TransactionStatus`. El SDK cobra con
 * una pasarela activa por instancia, así que hay un `KitPagos` por pasarela. Lo que sí lee del
 * entorno son las credenciales, porque el simulador firma los webhooks con las suyas
 * (`simulator-api/src/auth/merchantSecrets.ts`): si aquí no coincidieran, la firma no
 * verificaría.
 */

/** El código de país de un celular colombiano, que hay pasarelas que piden aparte. */
const COLOMBIA_PHONE_CODE = "57";

interface ActiveGateway {
  setup: GatewaySetup;
  kit: KitPagos;
  sdkEnvironment: Environment;
  publicKey: string;
}

/**
 * Construye el puerto de pagos. `env` es inyectable para las pruebas, igual que en
 * `loadCheckoutConfig`; en producción se usa `process.env`.
 *
 * En el sandbox, una pasarela queda activa solo si están sus llaves; si no queda ninguna, el
 * checkout no arranca y dice qué falta.
 */
export function createPayments(env: NodeJS.ProcessEnv = process.env): PaymentsPort {
  const { environment, simulatorUrl } = paymentsEnvironment(env);
  const missing: string[] = [];
  const active = new Map<string, ActiveGateway>();
  for (const setup of GATEWAYS) {
    // La variable de URL apunta la pasarela a otro simulador a propósito; si no, manda el ambiente del esqueleto.
    const baseUrlOverride = readEnv(env, setup.baseUrlVariable);
    const sdkEnvironment =
      baseUrlOverride !== undefined || environment === "simulator" ? Environment.SIMULATOR : Environment.SANDBOX;
    if (sdkEnvironment === Environment.SANDBOX) {
      const absent = setup.sandboxKeys.filter((name) => readEnv(env, name) === undefined);
      if (absent.length > 0) {
        missing.push(`${setup.option.name}: ${absent.join(", ")}`);
        continue;
      }
    }
    const baseUrl =
      baseUrlOverride ??
      (sdkEnvironment === Environment.SIMULATOR ? `${simulatorUrl}/v1/sim/${setup.option.id}` : undefined);
    const credentials = setup.credentials(env);
    const kit = new KitPagos({
      gateway: setup.gateway,
      credentials: { [setup.gateway]: credentials },
      environment: sdkEnvironment,
      ...(baseUrl ? { baseUrl } : {}),
    });
    active.set(setup.option.id, { setup, kit, sdkEnvironment, publicKey: credentials.publicKey });
  }
  if (active.size === 0) {
    throw new Error(
      `Para cobrar en el sandbox faltan las llaves de todas las pasarelas en el .env de la raíz (${missing.join("; ")}). ` +
        "Sin ellas, usa el simulador: npm run start:local.",
    );
  }

  function gateway(id: string): ActiveGateway {
    const found = active.get(id);
    if (!found) throw new Error(`El checkout no cobra con la pasarela «${id}»`);
    return found;
  }

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
    listGateways() {
      return [...active.values()].map(({ setup }) => setup.option);
    },

    publicConfig(id: string): Record<string, string> {
      const { setup, publicKey, sdkEnvironment } = gateway(id);
      const config: Record<string, string> = { gateway: setup.gateway, environment: sdkEnvironment };
      // Una pasarela con página propia no tokeniza en el navegador: no hay llave que darle.
      if (setup.option.cardCapture === "BROWSER_TOKEN") config.publicKey = publicKey;
      return config;
    },

    async listPseBanks(id: string): Promise<PseBankOption[]> {
      const { kit } = gateway(id);
      const banks = await call(() => kit.getPseBanks());
      return banks.map((bank) => ({ code: bank.code, name: bank.name }));
    },

    async createPayment(request: CreatePaymentRequest): Promise<PaymentSnapshot> {
      const { kit } = gateway(request.gateway);
      const result = await call(() =>
        kit.createPayment({
          amount: new Amount(String(request.amountInPesos)),
          currency: new Currency("COP"),
          orderReference: new OrderReference(request.orderReference),
          payer: toSdkPayer(request.payer),
          paymentMethod: toSdkMethod(request.method),
          returnUrlConfig: new ReturnUrlConfig(request.returnUrl),
          ipAddress: request.payerIp,
        }),
      );

      if (result.outcome === "REDIRECT_REQUIRED") {
        // La redirección (el banco, o la página de la pasarela) solo aparece en un pago que aún
        // no se resolvió: nace PENDING.
        return {
          transactionId: result.redirect.gatewayTransactionId.value,
          status: "PENDING",
          nativeStatus: result.redirect.rawStatus ?? "PENDING",
          redirectUrl: result.redirect.redirectUrl,
        };
      }
      return toSnapshot(result.transaction);
    },

    async getPaymentStatus(id: string, transactionId: string): Promise<PaymentSnapshot> {
      const { kit } = gateway(id);
      const transaction = await call(() => kit.getPaymentStatus(transactionId));
      return toSnapshot(transaction);
    },

    async verifyWebhook(id: string, webhook: IncomingWebhook): Promise<WebhookNotification | null> {
      const { setup, kit } = gateway(id);
      let event: WebhookEvent;
      try {
        event = kit.validateWebhook(webhook.rawBody, toStringHeaders(webhook.headers), {
          gateway: setup.gateway,
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
      if (event.newStatus === "PENDING") {
        // Hay pasarelas cuyo webhook firmado no trae el estado (el SDK reporta PENDING): se
        // confirma consultando, como pide la guía del SDK.
        const transaction = await call(() => kit.getPaymentStatus(event.gatewayTransactionId));
        return { ...toSnapshot(transaction), orderReference: event.orderReference };
      }
      return {
        transactionId: event.gatewayTransactionId,
        status: toMerchantStatus(event.newStatus),
        // Sin un estado firmado en el cuerpo, el SDK solo da el normalizado.
        nativeStatus: event.rawStatus ?? event.newStatus,
        orderReference: event.orderReference,
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

/** El pagador del puerto en el `Payer` del SDK, con lo que algunas pasarelas piden por separado. */
function toSdkPayer(payer: PortPayer): Payer {
  const [firstName, ...rest] = payer.fullName.trim().split(/\s+/);
  return new Payer({
    email: payer.email,
    fullName: payer.fullName,
    firstName,
    lastName: rest.join(" ") || firstName,
    documentType: payer.documentType,
    documentNumber: payer.documentNumber,
    phone: payer.phone,
    phoneAreaCode: COLOMBIA_PHONE_CODE,
    address: payer.address,
  });
}

function toSdkMethod(method: PaymentMethodRequest): PaymentMethod {
  if (method.type === "CARD") {
    // Sin token, la pasarela recibe la tarjeta en su página (HOSTED_PAGE).
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
