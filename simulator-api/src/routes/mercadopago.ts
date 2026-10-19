import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  MercadoPagoCardMockFactory,
  MercadoPagoErrorMockFactory,
  MercadoPagoOrderMockFactory,
  MercadoPagoPaymentMockFactory,
} from "../gateways/mercadopago/GatewayMockFactory";
import {
  allowAnyOrigin,
  MERCADOPAGO_TOKENIZATION_PREFLIGHT_HEADERS,
  registerTokenizationPreflight,
} from "../gateways/tokenizationCors";
import {
  MercadoPagoCreateOrderRequestBody,
  MercadoPagoCreatePaymentRequestBody,
  MercadoPagoOrderResponse,
  MercadoPagoOrderStatus,
  MercadoPagoTokenizeCardRequestBody,
} from "../gateways/mercadopago/types";
import { sendBankPage } from "../gateways/bankPage";
import { getSimulatorScenario } from "../scenarios/ScenarioEngine";
import { invalidCredentialIn, invalidCredentialRequested } from "../scenarios/invalidCredential";
import {
  ResolvedScenario,
  resolveScenario,
  wholePesosFromDecimal,
} from "../scenarios/scenarioFromRequest";
import { bankListFailure, queryFailure, technicalFailure } from "../scenarios/technicalFailure";
import { mpOrderMachine, mpPaymentMachine } from "../state/mercadopagoStateMachine";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { requestOrigin } from "../store/BankRedirectOrigins";
import { bankReturnUrlFor, rememberBankReturnUrl, withQueryParam } from "../store/BankReturnUrls";
import {
  CardTokenOutcome,
  cardTokenOutcomeFor,
  rememberCardTokenOutcome,
} from "../store/CardTokenOutcomes";
import {
  mercadopagoCardTokens,
  mercadopagoOrders,
  mercadopagoPayments,
} from "../store/GatewayStores";
import {
  bodyFingerprint,
  claimIdempotencyKey,
  idempotencyEntryKey,
  releaseIdempotencyKey,
  rememberIdempotentResponse,
} from "../store/IdempotencyKeys";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
  rememberQueryFailure,
} from "../store/ScenarioMarks";
import {
  getMpOrderSchema,
  getMpPaymentMethodsSchema,
  getMpPaymentSchema,
  postMpOrdersSchema,
  postMpPaymentsSchema,
  postMpTokenCardSchema,
} from "./schemas/mercadopago.schemas";

export const DEFAULT_SCENARIO = "APPROVED";

/*
 * Token inválido. Nivel 1 — medido contra la API real el 6 de octubre de 2026
 * (`docs/testing-data/mercado-pago.md`, sección 1.2), con un access token inexistente de
 * forma `APP_USR-`:
 *
 * - `POST /v1/payments`: `401` «user not found».
 * - `GET /v1/payments/{id}`, `POST /v1/orders` y `GET /v1/orders/{id}`: `401` «invalid
 *   access token».
 * - `GET /v1/payment_methods`: `401` con el sobre `message`/`error`/`status`/`cause`.
 *
 * No se midió si el token se revisa antes o después del cuerpo; la ruta lo revisa antes,
 * después de la llave de idempotencia que el SDK siempre manda.
 */
const INVALID_TOKEN_ON_PAYMENT = { code: "unauthorized", message: "user not found" } as const;
const INVALID_ACCESS_TOKEN = { code: "unauthorized", message: "invalid access token" } as const;
const INVALID_TOKEN_ON_PAYMENT_METHODS = {
  message: "invalid_token",
  error: "not_found",
  status: 401,
  cause: [],
} as const;

/**
 * El desenlace que fuerza el nombre del titular en el sandbox de Mercado Pago (issue #122).
 *
 * Nivel 3 para la correspondencia entre nombre y desenlace: `docs/testing-data/mercado-pago.md`,
 * líneas 31 a 51, que la toma de la página de tarjetas de prueba de Mercado Pago. Esa página
 * no se pudo leer el 6 de octubre de 2026 (se arma con JavaScript), así que no se cita. Los
 * pares `status` / `status_detail` sí están en la tabla oficial de resultados de pago
 * (https://www.mercadopago.com.co/developers/en/docs/checkout-api-payments/response-handling/collection-results,
 * consultada el 6 de octubre de 2026).
 *
 * Lo medido en la Payments API no coincide con esta tabla. El 6 de octubre de 2026, la cuenta
 * de prueba real respondió `rejected / cc_rejected_high_risk` para `APRO`, `OTHE` y `CONT`
 * (`docs/testing-data/mercado-pago.md`, sección 1.2), igual que `APRO` el 19 de septiembre.
 * Mercado Pago no informa la causa. El simulador sigue la tabla oficial por decisión de
 * Joan: es el comportamiento documentado que un comercio espera, y esta cuenta no permite
 * observarlo.
 *
 * En la Orders API sí coincide. Nivel 1 — medido el 15 de octubre de 2026 con las credenciales
 * del vendedor de prueba: cada titular dio el desenlace de la tabla, con el `status_detail` de
 * `orderStatusDetail`, y la regla es de **prefijo**: `APRO Ruiz` aprobó igual que `APRO`. Por
 * eso la búsqueda es por prefijo en los dos caminos, distinguiendo mayúsculas como en lo
 * medido. Un nombre fuera de la tabla, como `Felipe Ruiz`, dio `rejected_by_issuer` en la API
 * real; el simulador no lo imita y lo deja en el escenario del monto o de la cabecera, para
 * que esas dos convenciones sigan sirviendo con cualquier titular.
 */
const CARDHOLDER_OUTCOMES: ReadonlyArray<readonly [string, CardTokenOutcome]> = [
  ["APRO", { scenario: "APPROVED" }],
  [
    "CONT",
    { scenario: "PENDING", statusDetail: "pending_contingency", orderStatusDetail: "in_process" },
  ],
  [
    "OTHE",
    {
      scenario: "DECLINED",
      statusDetail: "cc_rejected_other_reason",
      orderStatusDetail: "rejected_by_issuer",
    },
  ],
  [
    "CALL",
    {
      scenario: "DECLINED",
      statusDetail: "cc_rejected_call_for_authorize",
      orderStatusDetail: "required_call_for_authorize",
    },
  ],
  [
    "FUND",
    {
      scenario: "DECLINED",
      statusDetail: "cc_rejected_insufficient_amount",
      orderStatusDetail: "insufficient_amount",
    },
  ],
  [
    "SECU",
    {
      scenario: "DECLINED",
      statusDetail: "cc_rejected_bad_filled_security_code",
      orderStatusDetail: "bad_filled_card_data",
    },
  ],
  [
    "EXPI",
    {
      scenario: "DECLINED",
      statusDetail: "cc_rejected_bad_filled_date",
      orderStatusDetail: "bad_filled_card_data",
    },
  ],
  [
    "FORM",
    {
      scenario: "DECLINED",
      statusDetail: "cc_rejected_bad_filled_other",
      orderStatusDetail: "bad_filled_card_data",
    },
  ],
];

/** El desenlace del primer titular de la tabla con el que empieza el nombre, si hay uno. */
function cardholderOutcomeFor(name: string | undefined): CardTokenOutcome | undefined {
  const trimmed = name?.trim() ?? "";
  return CARDHOLDER_OUTCOMES.find(([prefix]) => trimmed.startsWith(prefix))?.[1];
}

/**
 * Los cuerpos de error de la Orders API con tarjeta. Nivel 1 — medidos el 15 de octubre de
 * 2026: una orden sin `payment_method.id`, sin `type` o sin `token` responde `400
 * required_properties` nombrando lo que falta, y una tarjeta de débito con más de una cuota
 * responde `400 property_value`.
 */
const CARD_METHOD_REQUIRED = ["id", "type", "token"] as const;

function missingCardPropertiesError(missing: readonly string[]) {
  return {
    errors: [
      {
        code: "required_properties",
        message: "Missing properties",
        details: [
          `'$.transactions.payments[0].payment_method' - missing properties: ${missing
            .map((property) => `'${property}'`)
            .join(", ")}`,
        ],
      },
    ],
  };
}

const DEBIT_INSTALLMENTS_ERROR = {
  errors: [
    {
      code: "property_value",
      message: "Invalid value for property",
      details: ["'$.transactions.payments[0].payment_method.installments' - value must be '1'"],
    },
  ],
} as const;

/** Las tarjetas de la Orders API; con cualquiera de los dos tipos, o con token, es tarjeta. */
const CARD_PAYMENT_TYPES: ReadonlySet<string> = new Set(["credit_card", "debit_card"]);

/** El medio de pago de una orden de tarjeta, o `undefined` si la orden es de PSE. */
function cardPaymentMethodOf(requestBody: MercadoPagoCreateOrderRequestBody | undefined) {
  const method = requestBody?.transactions?.payments?.[0]?.payment_method;
  if (method === undefined) return undefined;
  return method.token !== undefined || CARD_PAYMENT_TYPES.has(method.type) ? method : undefined;
}

/**
 * El `402` de una orden cuyo pago falló: el sobre `errors[]` —`details` en el formato
 * `"<id del pago>: <status_detail>"`— y la orden entera en `data`. Medido en PSE el 7 de
 * octubre de 2026 y en tarjeta el 15 de octubre de 2026, con la misma forma.
 */
function failedOrderEnvelope(order: MercadoPagoOrderResponse) {
  return {
    errors: [
      {
        code: "failed",
        message: "The following transactions failed",
        details: order.transactions.payments.map(
          (payment) => `${payment.id}: ${payment.status_detail}`,
        ),
      },
    ],
    data: order,
  };
}

/*
 * `GET /v1/card_tokens/{id}`. Nivel 1 — medido el 15 de octubre de 2026: sin `Authorization`
 * responde `401` con la causa `E212`, y con un access token inexistente `401` con la causa
 * vacía. Un token que no existe responde `404 "could not get a Cardtoken with the following
 * id: …"` en la API real; el simulador no lo imita (ver la ruta).
 */
const CARD_TOKEN_WITHOUT_ACCESS = {
  message: "access is unauthorized",
  status: 401,
  error: "unauthorized",
  code: "unauthorized_access",
  cause: [{ description: "access_parameters is required", code: "E212" }],
} as const;

const CARD_TOKEN_INVALID_ACCESS = {
  message: "access is unauthorized",
  status: 401,
  error: "unauthorized",
  code: "unauthorized_access",
  cause: [{ description: "", code: "" }],
} as const;

/**
 * La tarjeta de prueba Visa crédito de `docs/testing-data/mercado-pago.md`, para el token que
 * el simulador no emitió.
 */
const UNKNOWN_TOKEN_CARD = { firstSixDigits: "401354", lastFourDigits: "6260" } as const;

/**
 * Las respuestas de una llave de idempotencia ya usada. Nivel 1 — medidas en `POST /v1/orders`
 * el 15 de octubre de 2026 (`IdempotencyKeys.ts`).
 */
const IDEMPOTENCY_KEY_ALREADY_USED = {
  errors: [
    {
      code: "idempotency_key_already_used",
      message: "X-Idempotency-Key already used. Please retry with a different value.",
    },
  ],
} as const;

const IDEMPOTENCY_KEY_LOCKED = {
  errors: [
    {
      code: "resource_locked",
      message: "Idempotency key locked. Please retry after some time.",
    },
  ],
} as const;

const JSON_CONTENT_TYPE = "application/json; charset=utf-8";

/** Los escenarios de negocio que una orden de PSE sabe producir al crearse. */
const ORDER_SCENARIOS: ReadonlySet<string> = new Set([
  "APPROVED",
  "APPROVAL",
  "REJECTED",
  "DECLINED",
  "EXPIRED",
  "PENDING",
]);

/**
 * Router HTTP de Mercado Pago (API de Simulación).
 *
 * Expone:
 * 1. POST /v1/sim/mercadopago/payments: simula la creación de un pago (status 201).
 * 2. GET /v1/sim/mercadopago/payments/:id: simula la consulta del estado de un pago (status 200).
 * 3. POST /v1/sim/mercadopago/orders: simula la creación de una orden de PSE o de tarjeta.
 * 4. GET /v1/sim/mercadopago/orders/:id: simula la consulta de una orden (status 200).
 * 5. GET /v1/sim/mercadopago/card_tokens/:id y GET /v1/sim/mercadopago/payment_methods/search:
 *    las dos lecturas con las que la versión 0.6.0 del SDK deduce la marca de la tarjeta.
 *
 * Particularidades de Mercado Pago:
 * - El monto se procesa en pesos (`transaction_amount`).
 * - Los estados son en minúsculas (`approved`, `rejected`, `pending`).
 * - Respuesta JSON plana sin envoltorio `data`.
 * - **Dos APIs distintas, no dos payloads:** PSE va por `/orders`, con otro vocabulario de
 *   estados (`action_required`) y el monto como string sin decimales. Esto no es una
 *   simplificación del mock: es lo que se midió contra la API real (issue #64). La tarjeta va
 *   por `/payments` en la versión 0.5.0 del SDK y por `/orders` desde la 0.6.0, que es la que
 *   usa `/v1/api`, así que el simulador atiende los dos caminos.
 */
export async function mercadopagoRoutes(app: FastifyInstance): Promise<void> {
  const paymentMocks = new MercadoPagoPaymentMockFactory();
  const orderMocks = new MercadoPagoOrderMockFactory();
  const cardMocks = new MercadoPagoCardMockFactory();
  const errorBodies = new MercadoPagoErrorMockFactory();

  /**
   * Mercado Pago no crea nada sin llave de idempotencia, y es la única de las cuatro que la
   * exige. Medido con las pruebas contra sandbox: `POST /v1/payments` responde
   * `400 "Header X-Idempotency-Key can\u2019t be null"` y `POST /v1/orders`
   * `400 "Missing HTTP header: X-Idempotency-Key."`, o sea que cada API se queja distinto del
   * mismo header. El mock las distingue porque el SDK no podía crear cobros en ninguna de las
   * dos y el mock los aceptaba en ambas: exactamente lo que este simulador no debe hacer.
   * Mercado Pago no crea nada sin llave de idempotencia.
   */
  function rejectsWithoutIdempotencyKey(
    request: FastifyRequest,
    reply: FastifyReply,
    api: "payments" | "orders",
  ): boolean {
    if (request.headers["x-idempotency-key"]) {
      return false;
    }

    if (api === "payments") {
      reply.code(400).send({
        message: "Header X-Idempotency-Key can\u2019t be null",
        error: "bad_request",
        status: 400,
        cause: [
          {
            code: 4292,
            description: "Header X-Idempotency-Key can\u2019t be null",
          },
        ],
      });
      return true;
    }

    reply.code(400).send({
      errors: [
        {
          code: "empty_required_header",
          message: "Missing HTTP header: X-Idempotency-Key.",
        },
      ],
    });
    return true;
  }

  /**
   * Traduce un escenario de negocio al estado en que debe terminar una orden.
   *
   * Traducir es del router, igual que en Kushki: quien sabe que `EXPIRED` es `expired`
   * en la Orders API es el que conoce la pasarela. Qué destinos existen lo decide la tabla
   * (`MP_ORDER_TARGETS`). Devuelve `undefined` cuando el escenario no fija un desenlace,
   * para que la tabla use su destino por defecto.
   */
  function orderTargetFor(scenario: string): MercadoPagoOrderStatus | undefined {
    if (scenario === "EXPIRED") {
      return "expired";
    }

    if (scenario === "PENDING") {
      return "action_required";
    }

    return undefined;
  }

  /**
   * La orden de tarjeta del escenario pedido, o `undefined` si el escenario no es de negocio.
   *
   * Nivel 1 — medido el 15 de octubre de 2026: aprobada en `processed / accredited` con `201`,
   * pendiente en `processing / in_process` con `201` (titular `CONT`) y rechazada en `failed /
   * failed` con `402`. El rechazo por monto o cabecera usa `rejected_by_issuer`, el detalle
   * medido para `OTHE`, el titular del «error general».
   *
   * Nivel 3 — `EXPIRED` crea la orden ya en `expired / expired` con `201`, para que el monto
   * 10 102 siga dando la expiración nativa con tarjeta. No se midió una orden de tarjeta
   * vencida: en modo automático resolvió en la misma respuesta. El par sale de la tabla
   * oficial de estados de la orden, y es `expired` y no `canceled` por el punto 80 del
   * `architecture-log.md`: el SDK traduce `canceled` a `VOIDED`. `DUPLICATE_PAYMENT` no llega
   * aquí: la ruta lo convierte en aprobado (ver `POST /orders`).
   */
  function cardOrderFor(
    scenario: string,
    requestBody: MercadoPagoCreateOrderRequestBody,
    statusDetail: string | undefined,
  ): { httpStatus: number; order: MercadoPagoOrderResponse } | undefined {
    switch (scenario) {
      case "APPROVED":
      case "APPROVAL":
        return {
          httpStatus: 201,
          order: orderMocks.buildCardOrderResponse(requestBody, "processed", "accredited"),
        };
      case "PENDING": {
        const detail = statusDetail ?? "in_process";
        return {
          httpStatus: 201,
          order: orderMocks.buildCardOrderResponse(requestBody, "processing", detail),
        };
      }
      case "EXPIRED":
        return {
          httpStatus: 201,
          order: orderMocks.buildCardOrderResponse(requestBody, "expired", "expired"),
        };
      case "REJECTED":
      case "DECLINED":
        return {
          httpStatus: 402,
          order: orderMocks.buildCardOrderResponse(
            requestBody,
            "failed",
            "failed",
            statusDetail ?? "rejected_by_issuer",
          ),
        };
      default:
        return undefined;
    }
  }

  /**
   * Crea la orden de tarjeta y la responde.
   *
   * Se guarda tal como se responde, porque la consulta medida devolvió la misma orden que la
   * creación, también la fallida. `processing` no tiene transición en `mpOrderMachine`: la
   * consulta 1,5 s después seguía en `processing / in_process`.
   */
  function sendCardOrder(
    reply: FastifyReply,
    requestBody: MercadoPagoCreateOrderRequestBody,
    scenario: string,
    resolved: ResolvedScenario,
    statusDetail: string | undefined,
    idempotencyEntry: string,
  ) {
    const built = cardOrderFor(scenario, requestBody, statusDetail);
    if (built === undefined) {
      return reply.code(501).send({ error: `Escenario aún no soportado: ${scenario}` });
    }

    const { order, httpStatus } = built;
    mercadopagoOrders.save(order.id, order);
    if (resolved.queryFailure !== undefined) {
      rememberQueryFailure("mercadopago", "order", order.id, resolved.queryFailure);
    }

    const body = httpStatus === 402 ? failedOrderEnvelope(order) : order;
    return sendRemembered(reply, idempotencyEntry, httpStatus, body);
  }

  /**
   * Responde una orden creada y la recuerda bajo su llave de idempotencia.
   *
   * Se serializa aquí, y no en Fastify, para que la repetición con la misma llave devuelva
   * los mismos bytes, que es lo medido (`IdempotencyKeys.ts`).
   */
  function sendRemembered(
    reply: FastifyReply,
    idempotencyEntry: string,
    statusCode: number,
    body: unknown,
  ) {
    const payload = JSON.stringify(body);
    rememberIdempotentResponse(idempotencyEntry, statusCode, payload);
    return reply.code(statusCode).type(JSON_CONTENT_TYPE).send(payload);
  }

  // 1. Creación de pago (POST /v1/sim/mercadopago/payments)
  app.post(
    "/v1/sim/mercadopago/payments",
    {
      schema: postMpPaymentsSchema,
      preValidation: async (request, reply) => {
        rejectsWithoutIdempotencyKey(request, reply, "payments");
        if (reply.sent) {
          return reply;
        }

        const body = request.body as MercadoPagoCreatePaymentRequestBody | undefined;
        if (!body?.token) {
          return reply.code(400).send({
            message: "payment_method_id attribute can't be null",
            error: "bad_request",
            status: 400,
            cause: [],
          });
        }
        if (body.installments === undefined) {
          return reply.code(400).send({
            message: "Invalid installments",
            error: "bad_request",
            status: 400,
            cause: [],
          });
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (rejectsWithoutIdempotencyKey(request, reply, "payments")) {
        return reply;
      }

      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_TOKEN_ON_PAYMENT);
      }

      const requestBody = request.body as MercadoPagoCreatePaymentRequestBody;

      /*
       * Mercado Pago no cobra sin token ni sin cuotas, y responde distinto a cada falta.
       * Las dos formas están medidas contra la API real:
       *
       * - sin `token`: `400 "payment_method_id attribute can't be null"`, porque el método
       *   de pago lo deduce del token y sin token no hay nada que deducir.
       * - sin `installments`: `400 "Invalid installments"`. Es la única de las cuatro
       *   pasarelas que exige las cuotas siempre, incluso cuando son una, y es la razón de
       *   que `installments` sea parte del dominio y no un extra de cada adaptador.
       * Validaciones de cuerpo de petición
       */
      if (!requestBody?.token) {
        return reply.code(400).send({
          message: "payment_method_id attribute can't be null",
          error: "bad_request",
          status: 400,
          cause: [],
        });
      }

      if (requestBody.installments === undefined) {
        return reply.code(400).send({
          message: "Invalid installments",
          error: "bad_request",
          status: 400,
          cause: [],
        });
      }

      // El nombre del titular, recordado al tokenizar, decide antes que el monto.
      const fromToken = cardTokenOutcomeFor("mercadopago", requestBody.token);
      const resolved = resolveScenario(request, {
        gatewayData: fromToken?.scenario,
        wholePesos: wholePesosFromDecimal(requestBody.transaction_amount),
      });
      let scenario = resolved.scenario;
      const statusDetail =
        resolved.source === "gateway_data" ? fromToken?.statusDetail : undefined;

      const failure = await technicalFailure(scenario, request, reply, errorBodies);

      if (failure !== undefined) {
        return failure;
      }

      if (scenario === "FLAPPING") {
        const key = requestBody.external_reference ?? requestBody.description ?? "mp_flapping";
        const isFailing = nextFlappingAttempt(key);
        if (isFailing) {
          return reply.code(503).send(errorBodies.buildServerErrorResponse(503));
        }
        scenario = DEFAULT_SCENARIO;
      }

      if (scenario === "DUPLICATE_PAYMENT") {
        const dupKey = `dup_mp_${requestBody.external_reference ?? requestBody.description}`;
        if (hasDuplicateMark(dupKey)) {
          return reply.code(409).send({
            message: "Payment with this external_reference already exists",
            error: "conflict",
            status: 409,
          });
        }
        markDuplicate(dupKey);
        scenario = DEFAULT_SCENARIO;
      }

      /*
       * Se guarda exactamente el pago que se construyó, con el estado que decidió el
       * escenario: un pago declinado se crea `rejected` y se consulta `rejected`. El guardado
       * quedó en un solo punto (issue #122) porque ahora también hay que registrar la falla
       * de consulta con el identificador del pago, y cuatro copias de las dos líneas eran
       * cuatro lugares para olvidar una.
       */
      const response = buildPayment(scenario, requestBody, statusDetail);

      if (response === undefined) {
        return reply
          .code(501)
          .send({ error: `Escenario aún no soportado: ${scenario}` });
      }

      mercadopagoPayments.save(String(response.id), response);

      if (resolved.queryFailure !== undefined) {
        rememberQueryFailure("mercadopago", "payment", String(response.id), resolved.queryFailure);
      }

      return reply.code(201).send(response);
    },
  );

  /**
   * Construye el pago del desenlace pedido, o `undefined` si el escenario no es de negocio.
   *
   * Cada desenlace nace con su estado real: un pago declinado se crea `rejected` y se
   * consulta `rejected`. `statusDetail` solo llega desde el nombre del titular; sin él, cada
   * fábrica usa el detalle que ya tenía.
   */
  function buildPayment(
    scenario: string,
    requestBody: MercadoPagoCreatePaymentRequestBody,
    statusDetail: string | undefined,
  ) {
    switch (scenario) {
      case "APPROVED":
      case "APPROVAL":
        return paymentMocks.buildApprovedResponse(requestBody);
      case "REJECTED":
      case "DECLINED":
        return paymentMocks.buildRejectedResponse(requestBody, undefined, statusDetail);
      case "EXPIRED":
        return paymentMocks.buildExpiredResponse(requestBody);
      // El pendiente con tarjeta nace en revisión y la consulta lo devuelve igual: la tabla
      // de pagos no tiene salida para `in_process` (ver `mercadopagoStateMachine.ts`).
      case "PENDING":
        return paymentMocks.buildInProcessResponse(requestBody, undefined, statusDetail);
      default:
        return undefined;
    }
  }

  // 2. Consulta de pago (GET /v1/sim/mercadopago/payments/:id)
  app.get(
    "/v1/sim/mercadopago/payments/:id",
    { schema: getMpPaymentSchema },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_ACCESS_TOKEN);
      }

      /*
       * La consulta responde el pago que se creó, no uno armado aquí.
       *
       * Antes fabricaba la respuesta con `transaction_amount: 50000` y una descripción
       * inventada, y el estado salía de la cabecera de la petición: el mismo pago
       * consultado dos veces con cabeceras distintas devolvía `approved` y `rejected`. Un
       * estado que depende de la pregunta no es un estado, y el monto de mentira rompía la
       * conciliación del comercio.
       *
       * Un identificador que no existe responde un error, porque un 200 con datos de otro
       * cobro esconde el error.
       */
      const payment = mercadopagoPayments.findById(id);

      /*
       * Nivel 1 — medido contra `api.mercadopago.com` el 5 de octubre de 2026:
       * `GET /v1/payments/1` y `/99999999999` responden este 404 con `cause`. El `data`
       * de la causa es `<fecha>;<uuid>`; la medición no registró el formato de la fecha,
       * así que el ISO 8601 de aquí es sintético.
       *
       * Limitación: un id no numérico (`/v1/payments/abc`) responde en Mercado Pago un
       * 404 de su enrutador con otro cuerpo (`"error": "resource not found"`), y el
       * simulador no lo imita: responde este mismo cuerpo.
       */
      if (payment === undefined) {
        return reply.code(404).send({
          message: "Payment not found",
          error: "not_found",
          status: 404,
          cause: [
            {
              code: 2000,
              description: "Payment not found",
              data: `${new Date().toISOString()};${randomUUID()}`,
            },
          ],
        });
      }

      const failure = await queryFailure(
        { gateway: "mercadopago", resource: "payment", id },
        reply,
        errorBodies,
      );
      if (failure !== undefined) {
        return failure;
      }

      const moved = mpPaymentMachine.transition(payment, "query");

      if (moved !== payment) {
        mercadopagoPayments.save(id, moved);
      }

      return reply.code(200).send(moved);
    },
  );

  // 3. Creación de orden para PSE (POST /v1/sim/mercadopago/orders)
  //
  // PSE no se cobra por la Payments API sino por esta: contra la API real, el
  // mismo pago con el banco en `transaction_details.financial_institution`
  // devuelve 424 pase lo que pase. Ver `mercadopago-pse.ts` en el SDK.
  app.post(
    "/v1/sim/mercadopago/orders",
    {
      schema: postMpOrdersSchema,
      preValidation: async (request, reply) => {
        rejectsWithoutIdempotencyKey(request, reply, "orders");
        if (reply.sent) {
          return reply;
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (rejectsWithoutIdempotencyKey(request, reply, "orders")) {
        return reply;
      }

      // Nivel 1, medido el 6 de octubre de 2026: no es el «user not found» de `/v1/payments`.
      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_ACCESS_TOKEN);
      }

      // La llave se revisa después de la credencial y antes del cuerpo (`IdempotencyKeys.ts`).
      const idempotencyEntry = idempotencyEntryKey(
        request.headers.authorization,
        String(request.headers["x-idempotency-key"]),
      );
      const claim = claimIdempotencyKey(idempotencyEntry, bodyFingerprint(request.body));
      if (claim.outcome === "locked") {
        return reply.code(423).send(IDEMPOTENCY_KEY_LOCKED);
      }
      if (claim.outcome === "conflict") {
        return reply.code(409).send(IDEMPOTENCY_KEY_ALREADY_USED);
      }
      if (claim.outcome === "replay") {
        return reply.code(claim.statusCode).type(JSON_CONTENT_TYPE).send(claim.payload);
      }

      try {
        return await createOrder(request, reply, idempotencyEntry);
      } finally {
        releaseIdempotencyKey(idempotencyEntry);
      }
    },
  );

  /** Crea la orden de PSE o de tarjeta que pidió `POST /orders`, ya con la llave reservada. */
  async function createOrder(
    request: FastifyRequest,
    reply: FastifyReply,
    idempotencyEntry: string,
  ) {
    const requestBody = request.body as MercadoPagoCreateOrderRequestBody;
    const cardMethod = cardPaymentMethodOf(requestBody);

    if (cardMethod !== undefined) {
      const missing = CARD_METHOD_REQUIRED.filter((property) => !cardMethod[property]);
      if (missing.length > 0) {
        return reply.code(400).send(missingCardPropertiesError(missing));
      }
      if (cardMethod.type === "debit_card" && (cardMethod.installments ?? 1) !== 1) {
        return reply.code(400).send(DEBIT_INSTALLMENTS_ERROR);
      }
    }

    // En PSE no hay dato de prueba que llegue aquí: el desenlace real lo decide el banco. En
    // tarjeta lo decide el titular, recordado al tokenizar.
    const fromToken = cardTokenOutcomeFor("mercadopago", cardMethod?.token);
    const resolved = resolveScenario(request, {
      gatewayData: fromToken?.scenario,
      wholePesos: wholePesosFromDecimal(requestBody?.total_amount),
    });
    let scenario = resolved.scenario;

    const failure = await technicalFailure(scenario, request, reply, errorBodies);

    if (failure !== undefined) {
      return failure;
    }

    // Igual que en `POST /payments`: falla la primera petición y la siguiente con la misma
    // referencia crea la orden. Es una falla de transporte, así que tampoco guarda nada.
    if (scenario === "FLAPPING") {
      const key = `mp_order_${requestBody?.external_reference ?? "flapping"}`;
      if (nextFlappingAttempt(key)) {
        return reply.code(503).send(errorBodies.buildServerErrorResponse(503));
      }
      scenario = DEFAULT_SCENARIO;
    }

    /*
     * Nivel 1 — medido el 15 de octubre de 2026 (`docs/testing-data/mercado-pago.md`,
     * «Duplicados e idempotencia en la Orders API»): la misma `external_reference` con otra
     * llave crea otra orden y la cobra, en tarjeta y en PSE. Mercado Pago no rechaza el
     * duplicado, así que el monto 10 409 crea la orden aprobada cada vez.
     */
    if (scenario === "DUPLICATE_PAYMENT") {
      scenario = DEFAULT_SCENARIO;
    }

    if (cardMethod !== undefined) {
      const statusDetail =
        resolved.source === "gateway_data" ? fromToken?.orderStatusDetail : undefined;
      return sendCardOrder(reply, requestBody, scenario, resolved, statusDetail, idempotencyEntry);
    }

    /*
     * Un escenario que la orden no sabe producir responde `501` antes de crear nada,
     * como en las demás rutas de creación. Antes `FLAPPING`, `DUPLICATE_PAYMENT` o un
     * nombre inventado se aceptaban con `201` y la consulta respondía `processed`: un
     * escenario aceptado e ignorado.
     */
    if (!ORDER_SCENARIOS.has(scenario)) {
      return reply
        .code(501)
        .send({ error: `Escenario aún no soportado: ${scenario}` });
    }

    if (scenario === "REJECTED" || scenario === "DECLINED") {
      /*
       * Nivel 1 — medido el 7 de octubre de 2026 (`docs/testing-data/mercado-pago.md`,
       * «El `402` de una orden de PSE que falla»). La orden se crea y su pago falla en la
       * misma petición: la respuesta es `402` con el sobre `errors[]` —`details` en el
       * formato `"<id del pago>: <status_detail>"`— y la orden entera en `data`.
       *
       * La orden existe: la consulta responde `200` con ella en `failed / failed`, suelta y
       * sin la llave `payer`. Por eso se guarda sin `payer`, y no se registra desenlace:
       * `failed` no tiene transición de salida en `mpOrderMachine`.
       */
      const failed = orderMocks.buildFailedOrderResponse(requestBody);
      const { payer: _payer, ...queried } = failed;
      mercadopagoOrders.save(String(failed.id), queried);

      return sendRemembered(reply, idempotencyEntry, 402, failedOrderEnvelope(failed));
    }

    const bankPaymentId = orderMocks.generateBankPaymentId();
    const response = orderMocks.buildPendingOrderResponse(
      requestBody,
      requestOrigin(request),
      bankPaymentId,
    );
    mercadopagoOrders.save(String(response.id), response);

    // La página de banco devuelve al pagador a la `callback_url` de la orden, que viaja en
    // la creación y no en ninguna consulta, con `payment_id` agregado como lo hace Mercado
    // Pago al volver (nivel 1, medido el 14 de octubre de 2026).
    rememberBankReturnUrl(
      "mercadopago",
      bankPaymentId,
      withQueryParam(requestBody.config?.online?.callback_url, "payment_id", bankPaymentId),
    );

    /*
     * El escenario se registra aquí y la consulta lo aplica.
     *
     * El rechazo no pasa por aquí: contra la API real, un PSE que falla devuelve `402` con
     * la orden entera en `failed` dentro de `data` en el momento de crearla, y eso es lo que
     * responde la rama de arriba. Lo que sí queda para después de la redirección es la expiración
     * —`expired`, que la Orders API distingue de `canceled`— y el pagador que nunca
     * vuelve del banco, que deja la orden en `action_required`. Sin registrarlos,
     * `EXPIRED` y `PENDING` se aceptaban con `201` y la consulta respondía `processed`.
     */
    const target = orderTargetFor(scenario);

    if (target !== undefined) {
      rememberScenarioTarget("mercadopago", "order", String(response.id), target);
    }

    if (resolved.queryFailure !== undefined) {
      rememberQueryFailure("mercadopago", "order", String(response.id), resolved.queryFailure);
    }

    return sendRemembered(reply, idempotencyEntry, 201, response);
  }

  // 4. Consulta de orden (GET /v1/sim/mercadopago/orders/:id)
  //
  // Devuelve la orden ya pagada, que es el estado que el comercio ve cuando el
  // pagador vuelve del banco. Es lo que permite ejercitar el flujo completo de
  // PSE de punta a punta, que contra la pasarela real exigiría que una persona
  // entre al banco.
  app.get(
    "/v1/sim/mercadopago/orders/:id",
    { schema: getMpOrderSchema },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      // Nivel 1, medido el 6 de octubre de 2026 con una orden existente.
      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_ACCESS_TOKEN);
      }

      /*
       * La orden se guardó al crearla, así que la consulta responde la que existe, con el
       * monto y la referencia que mandó el comercio.
       *
       * Antes no había nada guardado: esta ruta armaba una orden de cero con
       * `total_amount: "150000"` y un correo de ejemplo, y sin `external_reference` a
       * propósito porque "el simulador no guarda estado entre el POST y el GET". Inventar
       * una referencia era peor que omitirla, porque el normalizador caía entonces en el
       * identificador de la orden. Con el registro guardado, la referencia del comercio
       * vuelve intacta y la conciliación tiene contra qué compararse.
       *
       * El escenario no interviene: el desenlace ya lo decidió la creación, y una
       * consulta que cambiara el estado haría que la misma orden fuera `processed` o
       * `expired` según quién preguntara.
       */
      const order = mercadopagoOrders.findById(id);

      /*
       * Nivel 1 — medido contra `api.mercadopago.com` el 5 de octubre de 2026, con el
       * token `APP_USR-`: una orden inexistente con la forma del id real
       * (`ORD01JZZZZZZZZZZZZZZZZZZZZZZZ`) responde este 404. La Orders API usa `errors`,
       * no el sobre `message`/`error`/`status` de la Payments API.
       *
       * Limitación: un id con formato inválido (`ORDabc`) responde en Mercado Pago
       * `400 invalid_path_param`, y el simulador no lo imita: responde este 404.
       */
      if (order === undefined) {
        return reply.code(404).send({
          errors: [{ code: "order_not_found", message: "Order not found." }],
        });
      }

      const failure = await queryFailure(
        { gateway: "mercadopago", resource: "order", id },
        reply,
        errorBodies,
      );
      if (failure !== undefined) {
        return failure;
      }

      const moved = mpOrderMachine.transition(order, "query");

      if (moved !== order) {
        mercadopagoOrders.save(id, moved);
      }

      return reply.code(200).send(moved);
    },
  );

  /**
   * El destino de `redirect_url`: la página del banco de un PSE (issue #109).
   *
   * La forma de la ruta, `/payments/<id numérico>/bank_transfer`, está medida contra
   * `api.mercadopago.com` (nivel 1, 14 de octubre de 2026; `docs/testing-data/mercado-pago.md`).
   * El contenido no se imita: la URL real responde `302` al portal de PSE de ACH Colombia, y
   * al volver pasa por un comprobante de Mercado Pago antes de la `callback_url`. Esta página
   * devuelve al pagador a la `callback_url` de la orden con `payment_id`, que es lo último que
   * hace la real, y no mueve la orden: el desenlace del PSE lo decide el escenario al crearla
   * y se ve al consultarla (`mpOrderMachine`). `:paymentId` es el id numérico de la URL, no el
   * `PAY…` del pago.
   */
  app.get(
    "/v1/sim/mercadopago/payments/:paymentId/bank_transfer",
    async (request: FastifyRequest<{ Params: { paymentId: string } }>, reply: FastifyReply) => {
      const { paymentId } = request.params;
      return sendBankPage(reply, "mercadopago", bankReturnUrlFor("mercadopago", paymentId));
    },
  );

  /**
   * Catalogo de metodos de pago, donde viven los bancos de PSE.
   *
   * Mercado Pago no tiene endpoint de bancos: los anida en la entrada `pse`, bajo
   * `financial_institutions`, como `{ id, description }`. El mock devuelve cinco de
   * las 47 entidades medidas mas **un metodo que no es PSE**, a proposito: sin algo
   * que haya que descartar, una prueba del filtro pasaria aunque el filtro no
   * filtrara.
   *
   * `min_allowed_amount` y `max_allowed_amount` son los valores reales medidos. El
   * SDK todavia no los lee, y estan igual porque son la clase de dato que un
   * comercio descubre que necesitaba recien cuando un cobro de 1.500 pesos falla.
   */
  app.get(
    "/v1/sim/mercadopago/payment_methods",
    { schema: getMpPaymentMethodsSchema },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_TOKEN_ON_PAYMENT_METHODS);
      }

      const failure = bankListFailure(request, reply, errorBodies, "mercadopago");
      if (failure !== undefined) {
        return failure;
      }
      return reply.code(200).send([
        {
          id: "master",
          name: "Mastercard",
          payment_type_id: "credit_card",
          status: "active",
        },
        {
          id: "pse",
          name: "PSE",
          payment_type_id: "bank_transfer",
          status: "active",
          min_allowed_amount: 1600,
          max_allowed_amount: 340000000,
          financial_institutions: [
            { id: "1001", description: "Banco de Bogot\u00e1" },
            { id: "1007", description: "Bancolombia" },
            { id: "1013", description: "BBVA" },
            { id: "1051", description: "Davivienda" },
            { id: "1019", description: "DAVIbank S.A." },
          ],
        },
      ]);
    },
  );

  // ── POST /v1/sim/mercadopago/card_tokens (issue #127) ────────────────────
  registerTokenizationPreflight(app, "/v1/sim/mercadopago/card_tokens", MERCADOPAGO_TOKENIZATION_PREFLIGHT_HEADERS);
  app.post(
    "/v1/sim/mercadopago/card_tokens",
    {
      schema: postMpTokenCardSchema,
      onSend: allowAnyOrigin,
      preValidation: async (request, reply) => {
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          return reply.code(400).send({
            message: "unexpected_processing",
            error: "bad_request",
            status: 400,
            cause: [{ code: "G001", description: "unexpected_processing" }],
          });
        }

        const query = request.query as { public_key?: string } | undefined;
        if (!query?.public_key || !query.public_key.trim()) {
          return reply.code(401).send({
            message: "access is unauthorized",
            error: "unauthorized",
            code: "unauthorized_access",
            cause: [{ code: "E212", description: "access_parameters is required" }],
          });
        }
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { public_key?: string } | undefined;
      const publicKey = query?.public_key;
      const authHeader = request.headers.authorization;

      /*
       * Nivel de evidencia 1 (medido contra api.mercadopago.com el 4 de octubre de 2026):
       * Si se envía Authorization: Bearer en vez del parámetro en query, Mercado Pago rechaza
       * con 400 unexpected_processing (causa G001).
       */
      if (authHeader && authHeader.startsWith("Bearer ")) {
        return reply.code(400).send({
          message: "unexpected_processing",
          error: "bad_request",
          status: 400,
          cause: [
            {
              code: "G001",
              description: "unexpected_processing",
            },
          ],
        });
      }

      /*
       * Nivel de evidencia 1 (medido contra api.mercadopago.com el 4 de octubre de 2026):
       * Sin public_key en la query, Mercado Pago responde 401 con error: "unauthorized"
       * y causa "access_parameters is required" (E212).
       */
      if (!publicKey || !publicKey.trim()) {
        return reply.code(401).send({
          message: "access is unauthorized",
          error: "unauthorized",
          code: "unauthorized_access",
          cause: [
            {
              code: "E212",
              description: "access_parameters is required",
            },
          ],
        });
      }

      /*
       * Nivel de evidencia 1 (medido contra api.mercadopago.com el 4 de octubre de 2026):
       * Con una clave pública inexistente, Mercado Pago responde 500 internal_error
       * con causa E731 "POST tokenization unexpected status".
       */
      if (
        publicKey.includes("inexistente") ||
        publicKey.includes("invalid") ||
        publicKey.includes("not_found")
      ) {
        return reply.code(500).send({
          message: "internal_error",
          error: "internal_server_error",
          status: 500,
          cause: [
            {
              code: "E731",
              description: "POST tokenization unexpected status",
            },
          ],
        });
      }

      const failure = await technicalFailure(getSimulatorScenario(request), request, reply, errorBodies);
      if (failure !== undefined) {
        return failure;
      }

      const body = request.body as MercadoPagoTokenizeCardRequestBody;
      if (!body) {
        return reply.code(400).send({
          message: "Invalid parameter: body is required",
          status: 400,
          error: "bad_request",
        });
      }

      /*
       * Nivel de evidencia 1 (medido contra api.mercadopago.com el 4 de octubre de 2026):
       * Mercado Pago emite el token (201) incluso sin cardholder.identification (devolviendo
       * identification: {}), con número corto ("1234", con luhn_validation: false) o sin
       * security_code. El fallo por luhn ocurre recién al cobrar con el token (error 400, causa 2062).
       */
      const response = cardMocks.buildTokenCardResponse(body, publicKey);

      // Se recuerda el desenlace que fuerza el nombre, no el nombre (`CardTokenOutcomes.ts`).
      const outcome = cardholderOutcomeFor(body.cardholder?.name);
      if (outcome !== undefined) {
        rememberCardTokenOutcome("mercadopago", response.id, outcome);
      }
      const { cardholder: _cardholder, ...stored } = response;
      mercadopagoCardTokens.save(response.id, stored);

      return reply.code(201).send(response);
    },
  );

  /**
   * El token emitido, leído con el access token: de aquí saca el SDK 0.6.0 el BIN.
   *
   * Nivel 1 — medido el 15 de octubre de 2026: con el Bearer del mismo comercio responde `200`
   * con `first_six_digits`, y leerlo no consume el token. Un token que el simulador no emitió
   * no responde el `404` de la API real sino la tarjeta de prueba Visa crédito, a propósito:
   * `POST /payments` ya aceptaba cualquier token, y los ejemplos de `examples/` cobran con
   * tokens inventados.
   */
  app.get(
    "/v1/sim/mercadopago/card_tokens/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!request.headers.authorization) {
        return reply.code(401).send(CARD_TOKEN_WITHOUT_ACCESS);
      }
      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(CARD_TOKEN_INVALID_ACCESS);
      }

      const { id } = request.params;
      const stored = mercadopagoCardTokens.findById(id);
      if (stored !== undefined) {
        return reply.code(200).send(stored);
      }

      const { cardholder: _cardholder, ...unknown } = cardMocks.buildTokenCardResponse(
        {
          card_number: `${UNKNOWN_TOKEN_CARD.firstSixDigits}000000${UNKNOWN_TOKEN_CARD.lastFourDigits}`,
        },
        "",
      );
      return reply.code(200).send({ ...unknown, id });
    },
  );

  /**
   * Los medios de pago de un BIN, la segunda lectura del SDK 0.6.0 antes de cobrar.
   *
   * Nivel 1 — medido el 15 de octubre de 2026: sin `public_key` responde `400 "public_key is
   * required"` aunque llegue el Bearer, y con una llave pública inexistente `404 "public key
   * not found"`. La llave inválida se pide con las marcas de `invalidCredential.ts`.
   */
  app.get(
    "/v1/sim/mercadopago/payment_methods/search",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as { public_key?: string; bins?: string } | undefined;
      const publicKey = query?.public_key?.trim();

      if (!publicKey) {
        return reply.code(400).send({ code: 400, message: "public_key is required" });
      }
      if (invalidCredentialIn(request, [publicKey])) {
        return reply.code(404).send({ code: 404, message: "public key not found" });
      }

      return reply
        .code(200)
        .send(cardMocks.buildPaymentMethodSearchResponse(query?.bins?.trim() ?? ""));
    },
  );
}
