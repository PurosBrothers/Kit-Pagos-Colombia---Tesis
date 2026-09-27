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

/**
 * Normaliza y valida la pasarela recibida en la petición.
 * Acepta nombres insensibles a mayúsculas/minúsculas.
 */
function parseGateway(rawGateway: unknown): Gateway {
  if (typeof rawGateway !== "string" || !rawGateway.trim()) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.WOMPI,
      null,
      "El campo 'gateway' es obligatorio",
    );
  }

  const upper = rawGateway.trim().toUpperCase();
  const validGateways = Object.values(Gateway);
  const match = validGateways.find((g) => g.toUpperCase() === upper);

  if (!match) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      Gateway.WOMPI,
      null,
      `Pasarela '${rawGateway}' no soportada. Pasarelas soportadas: ${validGateways.map((g) => g.toLowerCase()).join(", ")}`,
    );
  }

  return match;
}

/**
 * Construye el objeto de valor PaymentMethod a partir del DTO.
 * Si el tipo solicitado no es soportado por el dominio (ej. CASH, NEQUI),
 * retorna un objeto sintético para que la aserción de soporte del adaptador
 * sea quien lance UNSUPPORTED_OPERATION sin duplicar condicionales aquí.
 */
function parsePaymentMethod(
  dto: unknown,
  gateway: Gateway,
): PaymentMethod | undefined {
  if (!dto || typeof dto !== "object") {
    return undefined;
  }

  const raw = dto as Record<string, unknown>;
  const rawType = typeof raw.type === "string" ? raw.type.toUpperCase() : "";

  try {
    if (rawType === "CARD") {
      const cardToken =
        typeof raw.cardToken === "string"
          ? raw.cardToken
          : typeof raw.token === "string"
            ? raw.token
            : undefined;
      const installments =
        typeof raw.installments === "number" ? raw.installments : undefined;
      return PaymentMethod.card(cardToken, { installments });
    }

    if (rawType === "PSE") {
      const bankCode = typeof raw.bankCode === "string" ? raw.bankCode : "";
      const payerKind = raw.payerKind === "LEGAL" ? "LEGAL" : "NATURAL";
      return PaymentMethod.pse({ bankCode, payerKind });
    }
  } catch (err) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      gateway,
      null,
      (err as Error).message,
    );
  }

  return { type: (raw.type as unknown) ?? "" } as unknown as PaymentMethod;
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

/**
 * Mapea el desglose tributario si fue provisto en la petición.
 */
function parseTaxBreakdown(
  dto: unknown,
  amount: Amount | undefined,
  currency: Currency | undefined,
  gateway: Gateway,
): TaxBreakdown | undefined {
  if (!dto || typeof dto !== "object") {
    return undefined;
  }
  const raw = dto as Record<string, unknown>;
  try {
    if (typeof raw.rate === "string" && amount && currency) {
      return TaxBreakdown.fromTaxIncluded(amount, raw.rate, currency);
    }
    if (
      typeof raw.subtotalIva0 === "string" &&
      typeof raw.subtotalIva === "string" &&
      typeof raw.iva === "string" &&
      currency
    ) {
      return TaxBreakdown.fromComponents({
        subtotalIva0: new Amount(raw.subtotalIva0),
        subtotalIva: new Amount(raw.subtotalIva),
        iva: new Amount(raw.iva),
        ice: typeof raw.ice === "string" ? new Amount(raw.ice) : undefined,
        currency,
      });
    }
  } catch (err) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      gateway,
      null,
      (err as Error).message,
    );
  }
  return undefined;
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as CreatePaymentBodyDTO) ?? {};
      const gateway = parseGateway(body.gateway);

      // Obtener o instanciar KitPagos para la pasarela activa
      const kitPagos = request.server.kitPagosProvider.getKitPagos(
        gateway,
        request.headers,
      );

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
}
