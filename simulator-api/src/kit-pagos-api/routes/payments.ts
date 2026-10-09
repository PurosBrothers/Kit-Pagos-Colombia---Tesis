import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  Amount,
  Currency,
  CreatePaymentRequest,
  Gateway,
  KitPagosError,
  KitPagosErrorCode,
  OrderReference,
  Payer,
  PaymentMethod,
  ReturnUrlConfig,
  TaxBreakdown,
  Transaction,
} from "kit-pagos-colombia";
import { gatewayClientFor } from "../gateway-client";
import { parseGateway, unsupportedGatewayBody } from "../gateway-param";
import { GetPaymentStatusSchema, PostPaymentsSchema } from "../openapi/schemas";

export interface CreatePaymentBodyDTO {
  gateway: string;
  amount: string;
  currency: string;
  orderReference: string;
  payer: {
    email: string;
    fullName?: string;
    firstName?: string;
    lastName?: string;
    documentType?: string;
    documentNumber?: string;
    phone?: string;
    phoneAreaCode?: string;
    address?: {
      streetName: string;
      streetNumber: string;
      city: string;
      zipCode: string;
      neighborhood: string;
    };
  };
  paymentMethod?: {
    type: string;
    token?: string;
    cardToken?: string;
    bankCode?: string;
    payerKind?: "NATURAL" | "LEGAL";
    installments?: number;
  };
  returnUrlConfig?: {
    returnUrl?: string;
    returnUrls?: {
      success?: string;
      failure?: string;
      pending?: string;
    };
  };
  taxBreakdown?: {
    subtotalIva0?: string;
    subtotalIva?: string;
    iva?: string;
    ice?: string;
    rate?: string;
  };
  ipAddress?: string;
}

function invalidRequest(gateway: Gateway, message: string): KitPagosError {
  return new KitPagosError(KitPagosErrorCode.INVALID_REQUEST, gateway, null, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Construye el objeto de valor PaymentMethod a partir del DTO.
 *
 * Un campo que viene pero no se puede interpretar responde 400 en vez de
 * descartarse: descartado, el cobro saldría con el valor por omisión (tarjeta,
 * una cuota, persona natural) y no con lo que pidió el comercio (punto 71).
 *
 * Si el tipo no es CARD ni PSE, retorna un objeto sintético para que la aserción
 * de soporte del adaptador sea quien lance UNSUPPORTED_OPERATION sin duplicar
 * condicionales aquí. Las cuatro pasarelas llaman a `assertSupportedPaymentMethod()`
 * antes de leer el método; si una dejara de hacerlo, este objeto llegaría a ella.
 */
function parsePaymentMethod(
  dto: unknown,
  gateway: Gateway,
): PaymentMethod | undefined {
  if (dto === undefined || dto === null) {
    return undefined;
  }
  if (!isPlainObject(dto)) {
    throw invalidRequest(gateway, "paymentMethod debe ser un objeto con un campo type");
  }
  if (typeof dto.type !== "string" || !dto.type.trim()) {
    throw invalidRequest(gateway, "paymentMethod.type es obligatorio");
  }

  const rawType = dto.type.toUpperCase();

  try {
    if (rawType === "CARD") {
      const cardToken =
        typeof dto.cardToken === "string"
          ? dto.cardToken
          : typeof dto.token === "string"
            ? dto.token
            : undefined;
      return PaymentMethod.card(cardToken, {
        installments: dto.installments as number | undefined,
      });
    }

    if (rawType === "PSE") {
      const bankCode = typeof dto.bankCode === "string" ? dto.bankCode : "";
      if (
        dto.payerKind !== undefined &&
        dto.payerKind !== "NATURAL" &&
        dto.payerKind !== "LEGAL"
      ) {
        throw new Error("paymentMethod.payerKind debe ser NATURAL o LEGAL");
      }
      return PaymentMethod.pse({
        bankCode,
        payerKind: dto.payerKind as "NATURAL" | "LEGAL" | undefined,
      });
    }
  } catch (err) {
    throw invalidRequest(gateway, (err as Error).message);
  }

  return { type: dto.type } as unknown as PaymentMethod;
}

/**
 * Mapea la configuración de URLs de retorno.
 */
function parseReturnUrlConfig(dto: unknown): ReturnUrlConfig | undefined {
  if (!dto || typeof dto !== "object") {
    return undefined;
  }
  const raw = dto as Record<string, unknown>;
  const returnUrl = typeof raw.returnUrl === "string" ? raw.returnUrl : null;
  const returnUrls =
    raw.returnUrls && typeof raw.returnUrls === "object"
      ? (raw.returnUrls as {
          success?: string;
          failure?: string;
          pending?: string;
        })
      : undefined;
  return new ReturnUrlConfig(returnUrl, returnUrls);
}

const TAX_BREAKDOWN_SHAPE =
  'taxBreakdown requiere rate (por ejemplo "0.19") o subtotalIva0, subtotalIva e iva, todos como string decimal';

/**
 * Mapea el desglose tributario si fue provisto en la petición.
 *
 * Un desglose que viene pero no se puede convertir responde 400. Descartarlo
 * no es neutro: sin desglose, Kushki cobra el monto completo como exento de IVA
 * (`resolveTaxBreakdown`), y el error solo aparece al conciliar (punto 71).
 */
function parseTaxBreakdown(
  dto: unknown,
  amount: Amount | undefined,
  currency: Currency | undefined,
  gateway: Gateway,
): TaxBreakdown | undefined {
  if (dto === undefined || dto === null) {
    return undefined;
  }
  if (!isPlainObject(dto)) {
    throw invalidRequest(gateway, TAX_BREAKDOWN_SHAPE);
  }
  // Sin monto o divisa el SDK rechaza la petición nombrando los campos que faltan.
  if (!amount || !currency) {
    return undefined;
  }

  const { rate, subtotalIva0, subtotalIva, iva, ice } = dto;
  try {
    if (typeof rate === "string") {
      return TaxBreakdown.fromTaxIncluded(amount, rate, currency);
    }
    if (
      rate === undefined &&
      typeof subtotalIva0 === "string" &&
      typeof subtotalIva === "string" &&
      typeof iva === "string" &&
      (ice === undefined || typeof ice === "string")
    ) {
      return TaxBreakdown.fromComponents({
        subtotalIva0: new Amount(subtotalIva0),
        subtotalIva: new Amount(subtotalIva),
        iva: new Amount(iva),
        ice: ice === undefined ? undefined : new Amount(ice),
        currency,
      });
    }
  } catch (err) {
    throw invalidRequest(gateway, (err as Error).message);
  }
  throw invalidRequest(gateway, TAX_BREAKDOWN_SHAPE);
}

/**
 * Serializa la entidad Transaction a JSON para la respuesta HTTP,
 * preservando el monto como cadena exacta y conservando el estado nativo rawStatus.
 */
function serializeTransaction(transaction: Transaction) {
  return {
    gatewayTransactionId: transaction.gatewayTransactionId.value,
    orderReference: transaction.orderReference.getValue(),
    amount: transaction.amount.getValue(),
    currency: transaction.currency.getCode(),
    payer: {
      email: transaction.payer.email,
      ...(transaction.payer.fullName
        ? { fullName: transaction.payer.fullName }
        : {}),
      ...(transaction.payer.firstName
        ? { firstName: transaction.payer.firstName }
        : {}),
      ...(transaction.payer.lastName
        ? { lastName: transaction.payer.lastName }
        : {}),
      ...(transaction.payer.documentType
        ? { documentType: transaction.payer.documentType }
        : {}),
      ...(transaction.payer.documentNumber
        ? { documentNumber: transaction.payer.documentNumber }
        : {}),
      ...(transaction.payer.phone ? { phone: transaction.payer.phone } : {}),
      ...(transaction.payer.phoneAreaCode
        ? { phoneAreaCode: transaction.payer.phoneAreaCode }
        : {}),
      ...(transaction.payer.address
        ? { address: transaction.payer.address }
        : {}),
    },
    status: transaction.getStatus(),
    rawStatus: transaction.rawStatus,
    isApproved: transaction.isApproved(),
    isPending: transaction.isPending(),
    isFinal: transaction.isFinal(),
    ...(transaction.authorizationCode
      ? { authorizationCode: transaction.authorizationCode }
      : {}),
    ...(transaction.rejectionReason
      ? { rejectionReason: transaction.rejectionReason }
      : {}),
  };
}

/**
 * POST /v1/api/payments: expone KitPagos.createPayment por REST.
 *
 * Convierte una petición HTTP en un cobro a través del SDK. La respuesta
 * discrimina explícitamente entre transacción completada y redirección requerida (PSE/3DS),
 * respondiendo HTTP 201 en ambos casos exitosos.
 */
export async function paymentsRoute(app: FastifyInstance): Promise<void> {
  app.post(
    "/payments",
    { schema: PostPaymentsSchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as CreatePaymentBodyDTO) ?? {};
      const gateway = parseGateway(body.gateway);
      if (!gateway) {
        return reply.status(400).send(unsupportedGatewayBody());
      }

      // Construcción segura de Value Objects del SDK
      let amount: Amount | undefined;
      if (body.amount !== undefined) {
        try {
          amount = new Amount(body.amount);
        } catch (err) {
          throw new KitPagosError(
            KitPagosErrorCode.INVALID_REQUEST,
            gateway,
            null,
            (err as Error).message,
          );
        }
      }

      let currency: Currency | undefined;
      if (body.currency !== undefined) {
        try {
          currency = new Currency(body.currency);
        } catch (err) {
          throw new KitPagosError(
            KitPagosErrorCode.INVALID_REQUEST,
            gateway,
            null,
            (err as Error).message,
          );
        }
      }

      let orderReference: OrderReference | undefined;
      if (body.orderReference !== undefined) {
        try {
          orderReference = new OrderReference(body.orderReference);
        } catch (err) {
          throw new KitPagosError(
            KitPagosErrorCode.INVALID_REQUEST,
            gateway,
            null,
            (err as Error).message,
          );
        }
      }

      let payer: Payer | undefined;
      if (body.payer !== undefined) {
        try {
          payer = new Payer(body.payer);
        } catch (err) {
          throw new KitPagosError(
            KitPagosErrorCode.INVALID_REQUEST,
            gateway,
            null,
            (err as Error).message,
          );
        }
      }

      const paymentMethod = parsePaymentMethod(body.paymentMethod, gateway);
      const returnUrlConfig = parseReturnUrlConfig(body.returnUrlConfig);
      const taxBreakdown = parseTaxBreakdown(
        body.taxBreakdown,
        amount,
        currency,
        gateway,
      );

      const paymentRequest: Partial<CreatePaymentRequest> = {
        amount,
        currency,
        orderReference,
        payer,
        paymentMethod,
        returnUrlConfig,
        taxBreakdown,
        ipAddress: body.ipAddress,
      };

      // Delegar la creación del pago al SDK. La validación de faltantes
      // corre en el SDK (assertValidCreatePaymentRequest) y no se duplica aquí.
      const kitPagos = gatewayClientFor(app, request, reply, gateway);
      const result = await kitPagos.createPayment(
        paymentRequest as CreatePaymentRequest,
      );

      if (result.outcome === "REDIRECT_REQUIRED") {
        return reply.status(201).send({
          outcome: "REDIRECT_REQUIRED",
          redirect: {
            redirectUrl: result.redirect.redirectUrl,
            gatewayTransactionId: result.redirect.gatewayTransactionId.value,
            rawStatus: result.redirect.rawStatus,
          },
        });
      }

      return reply.status(201).send({
        outcome: "TRANSACTION",
        transaction: serializeTransaction(result.transaction),
        rawStatus: result.transaction.rawStatus,
      });
    },
  );

  /**
   * GET /v1/api/payments/:id?gateway=: consulta el estado de una transaccion.
   *
   * El param `gateway` es obligatorio y viaja en el query, no en la ruta: el SDK
   * usa una pasarela por instancia, asi que el id de una transaccion solo se puede
   * consultar contra la pasarela que la creo. Deducirla del TransactionStore
   * acoplaria a la REST al simulador y no funcionaria contra pasarelas reales.
   *
   * La respuesta incluye el estado normalizado (`status`) y el nativo (`rawStatus`),
   * igual que la respuesta del POST. No se agregan reintentos aqui: `getPaymentStatus()`
   * ya va envuelto en `RetryHandler` dentro del SDK.
   */
  app.get<{ Params: { id: string }; Querystring: { gateway?: string } }>(
    "/payments/:id",
    { schema: GetPaymentStatusSchema },
    async (request: FastifyRequest<{ Params: { id: string }; Querystring: { gateway?: string } }>, reply: FastifyReply) => {
      const gateway = parseGateway(request.query.gateway);
      if (!gateway) {
        return reply.status(400).send(unsupportedGatewayBody());
      }

      // `getPaymentStatus(id)` del SDK: los errores (404 del recurso, 400 por
      // operacion no soportada) viajan solos al error handler global.
      const kitPagos = gatewayClientFor(app, request, reply, gateway);
      const transaction = await kitPagos.getPaymentStatus(request.params.id);

      return reply.status(200).send({
        gateway: gateway.toLowerCase(),
        transaction: serializeTransaction(transaction),
      });
    },
  );
}
