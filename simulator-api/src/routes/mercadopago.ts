import { randomUUID } from "node:crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/mercadopago/GatewayMockFactory";
import {
  MercadoPagoCreateOrderRequestBody,
  MercadoPagoCreatePaymentRequestBody,
  MercadoPagoOrderStatus,
  MercadoPagoTokenizeCardRequestBody,
} from "../gateways/mercadopago/types";
import { getSimulatorScenario } from "../scenarios/ScenarioEngine";
import { invalidCredentialRequested } from "../scenarios/invalidCredential";
import { resolveScenario, wholePesosFromDecimal } from "../scenarios/scenarioFromRequest";
import { bankListFailure, queryFailure, technicalFailure } from "../scenarios/technicalFailure";
import { mpOrderMachine, mpPaymentMachine } from "../state/mercadopagoStateMachine";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import {
  CardTokenOutcome,
  cardTokenOutcomeFor,
  rememberCardTokenOutcome,
} from "../store/CardTokenOutcomes";
import { mercadopagoOrders, mercadopagoPayments } from "../store/GatewayStores";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
  rememberQueryFailure,
} from "../store/ScenarioMarks";

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
 * Lo medido no coincide con esta tabla. El 6 de octubre de 2026, la cuenta de prueba real
 * respondió `rejected / cc_rejected_high_risk` para `APRO`, `OTHE` y `CONT`
 * (`docs/testing-data/mercado-pago.md`, sección 1.2), igual que `APRO` el 19 de septiembre.
 * Mercado Pago no informa la causa. El simulador sigue la tabla oficial por decisión de
 * Joan: es el comportamiento documentado que un comercio espera, y esta cuenta no permite
 * observarlo.
 */
const CARDHOLDER_OUTCOMES: ReadonlyMap<string, CardTokenOutcome> = new Map([
  ["APRO", { scenario: "APPROVED" }],
  ["CONT", { scenario: "PENDING", statusDetail: "pending_contingency" }],
  ["OTHE", { scenario: "DECLINED", statusDetail: "cc_rejected_other_reason" }],
  ["CALL", { scenario: "DECLINED", statusDetail: "cc_rejected_call_for_authorize" }],
  ["FUND", { scenario: "DECLINED", statusDetail: "cc_rejected_insufficient_amount" }],
  ["SECU", { scenario: "DECLINED", statusDetail: "cc_rejected_bad_filled_security_code" }],
  ["EXPI", { scenario: "DECLINED", statusDetail: "cc_rejected_bad_filled_date" }],
  ["FORM", { scenario: "DECLINED", statusDetail: "cc_rejected_bad_filled_other" }],
]);

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
 * 3. POST /v1/sim/mercadopago/orders: simula la creación de una orden de PSE (status 201).
 * 4. GET /v1/sim/mercadopago/orders/:id: simula la consulta de una orden (status 200).
 *
 * Particularidades de Mercado Pago:
 * - El monto se procesa en pesos (`transaction_amount`).
 * - Los estados son en minúsculas (`approved`, `rejected`, `pending`).
 * - Respuesta JSON plana sin envoltorio `data`.
 * - **Dos APIs distintas, no dos payloads:** la tarjeta va por `/payments` y PSE
 *   por `/orders`, con otro vocabulario de estados (`action_required`) y el monto
 *   como string sin decimales. Esto no es una simplificación del mock: es lo que
 *   se midió contra la API real (issue #64).
 */
export async function mercadopagoRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

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

  // 1. Creación de pago (POST /v1/sim/mercadopago/payments)
  app.post(
    "/v1/sim/mercadopago/payments",
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

      const failure = await technicalFailure(scenario, request, reply, mockFactory);

      if (failure !== undefined) {
        return failure;
      }

      if (scenario === "FLAPPING") {
        const key = requestBody.external_reference ?? requestBody.description ?? "mp_flapping";
        const isFailing = nextFlappingAttempt(key);
        if (isFailing) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
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
        return mockFactory.buildApprovedResponse(requestBody);
      case "REJECTED":
      case "DECLINED":
        return mockFactory.buildRejectedResponse(requestBody, undefined, statusDetail);
      case "EXPIRED":
        return mockFactory.buildExpiredResponse(requestBody);
      // El pendiente con tarjeta nace en revisión y la consulta lo devuelve igual: la tabla
      // de pagos no tiene salida para `in_process` (ver `mercadopagoStateMachine.ts`).
      case "PENDING":
        return mockFactory.buildInProcessResponse(requestBody, undefined, statusDetail);
      default:
        return undefined;
    }
  }

  // 2. Consulta de pago (GET /v1/sim/mercadopago/payments/:id)
  app.get(
    "/v1/sim/mercadopago/payments/:id",
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
        mockFactory,
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (rejectsWithoutIdempotencyKey(request, reply, "orders")) {
        return reply;
      }

      // Nivel 1, medido el 6 de octubre de 2026: no es el «user not found» de `/v1/payments`.
      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_ACCESS_TOKEN);
      }

      const requestBody = request.body as MercadoPagoCreateOrderRequestBody;
      // PSE no tiene dato de prueba que llegue aquí: el desenlace real lo decide el banco.
      const resolved = resolveScenario(request, {
        wholePesos: wholePesosFromDecimal(requestBody?.total_amount),
      });
      let scenario = resolved.scenario;

      const failure = await technicalFailure(scenario, request, reply, mockFactory);

      if (failure !== undefined) {
        return failure;
      }

      // Igual que en `POST /payments`: falla la primera petición y la siguiente con la misma
      // referencia crea la orden. Es una falla de transporte, así que tampoco guarda nada.
      if (scenario === "FLAPPING") {
        const key = `mp_order_${requestBody?.external_reference ?? "flapping"}`;
        if (nextFlappingAttempt(key)) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
        }
        scenario = DEFAULT_SCENARIO;
      }

      /*
       * Un escenario que la orden no sabe producir responde `501` antes de crear nada,
       * como en las demás rutas de creación. Antes `FLAPPING`, `DUPLICATE_PAYMENT` o un
       * nombre inventado se aceptaban con `201` y la consulta respondía `processed`: un
       * escenario aceptado e ignorado. `DUPLICATE_PAYMENT` no se imita en órdenes porque el
       * `409` de pagos no está medido para la Orders API.
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
        const failed = mockFactory.buildFailedOrderResponse(requestBody);
        const { payer: _payer, ...queried } = failed;
        mercadopagoOrders.save(String(failed.id), queried);

        return reply.code(402).send({
          errors: [
            {
              code: "failed",
              message: "The following transactions failed",
              details: failed.transactions.payments.map(
                (payment) => `${payment.id}: ${payment.status_detail}`,
              ),
            },
          ],
          data: failed,
        });
      }

      const response = mockFactory.buildPendingOrderResponse(requestBody);
      mercadopagoOrders.save(String(response.id), response);

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

      return reply.code(201).send(response);
    },
  );

  // 4. Consulta de orden (GET /v1/sim/mercadopago/orders/:id)
  //
  // Devuelve la orden ya pagada, que es el estado que el comercio ve cuando el
  // pagador vuelve del banco. Es lo que permite ejercitar el flujo completo de
  // PSE de punta a punta, que contra la pasarela real exigiría que una persona
  // entre al banco.
  app.get(
    "/v1/sim/mercadopago/orders/:id",
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
        mockFactory,
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_TOKEN_ON_PAYMENT_METHODS);
      }

      const failure = bankListFailure(request, reply, mockFactory, "mercadopago");
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
  app.post(
    "/v1/sim/mercadopago/card_tokens",
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

      const failure = await technicalFailure(getSimulatorScenario(request), request, reply, mockFactory);
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
      const response = mockFactory.buildTokenCardResponse(body, publicKey);

      // Se recuerda el desenlace que fuerza el nombre, no el nombre (`CardTokenOutcomes.ts`).
      const outcome = CARDHOLDER_OUTCOMES.get(body.cardholder?.name?.trim() ?? "");
      if (outcome !== undefined) {
        rememberCardTokenOutcome("mercadopago", response.id, outcome);
      }

      return reply.code(201).send(response);
    },
  );
}
