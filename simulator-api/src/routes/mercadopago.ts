import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/mercadopago/GatewayMockFactory";
import {
  MercadoPagoCreateOrderRequestBody,
  MercadoPagoCreatePaymentRequestBody,
  MercadoPagoTokenizeCardRequestBody,
} from "../gateways/mercadopago/types";
import {
  getSimulatorScenario,
  ScenarioEngine,
} from "../scenarios/ScenarioEngine";
import { mpOrderMachine, mpPaymentMachine } from "../state/mercadopagoStateMachine";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { mercadopagoOrders, mercadopagoPayments } from "../store/GatewayStores";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
} from "../store/ScenarioMarks";

export const DEFAULT_SCENARIO = "APPROVED";

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

  // 1. Creación de pago (POST /v1/sim/mercadopago/payments)
  app.post(
    "/v1/sim/mercadopago/payments",
    async (request: FastifyRequest, reply: FastifyReply) => {
      let scenario = getSimulatorScenario(request);

      if (rejectsWithoutIdempotencyKey(request, reply, "payments")) {
        return reply;
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

      // ── Manejo de escenarios técnicos ──
      if (scenario === "TIMEOUT" || scenario === "GATEWAY_TIMEOUT") {
        return reply.code(504).send(mockFactory.buildTimeoutResponse());
      }

      if (scenario === "NETWORK_ERROR" || scenario === "CONNECTION_ERROR") {
        return ScenarioEngine.handleNetworkError(request, reply);
      }

      if (scenario === "RATE_LIMIT" || scenario === "TOO_MANY_REQUESTS" || scenario === "429") {
        return reply.code(429).send(mockFactory.buildRateLimitResponse());
      }

      if (scenario === "SERVER_ERROR" || scenario === "INTERNAL_ERROR" || scenario === "500") {
        return reply.code(500).send(mockFactory.buildServerErrorResponse(500));
      }

      if (scenario === "BAD_GATEWAY" || scenario === "502") {
        return reply.code(502).send(mockFactory.buildServerErrorResponse(502));
      }

      if (scenario === "SERVICE_UNAVAILABLE" || scenario === "503") {
        return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
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
       * Cada desenlace guarda el pago que construyó, con el estado que le corresponde.
       *
       * Guardar en las cuatro ramas y no en un punto común es lo que permite que cada
       * escenario nazca con su estado real: un pago declinado se crea `rejected` y se
       * consulta `rejected`, no aprobado por accidente. Con un guardado único al final
       * habría que decidir el estado aparte de construirlo, que es duplicar la decisión.
       */
      if (
        scenario === DEFAULT_SCENARIO ||
        scenario.toUpperCase() === "APPROVED" ||
        scenario === "APPROVAL"
      ) {
        const response = mockFactory.buildApprovedResponse(requestBody);
        mercadopagoPayments.save(String(response.id), response);

        return reply.code(201).send(response);
      }

      if (
        scenario.toUpperCase() === "REJECTED" ||
        scenario.toUpperCase() === "DECLINED"
      ) {
        const response = mockFactory.buildRejectedResponse(requestBody);
        mercadopagoPayments.save(String(response.id), response);

        return reply.code(201).send(response);
      }

      if (scenario === "EXPIRED") {
        const response = mockFactory.buildExpiredResponse(requestBody);
        mercadopagoPayments.save(String(response.id), response);

        return reply.code(201).send(response);
      }

      return reply
        .code(501)
        .send({ error: `Escenario aún no soportado: ${scenario}` });
    },
  );

  // 2. Consulta de pago (GET /v1/sim/mercadopago/payments/:id)
  app.get(
    "/v1/sim/mercadopago/payments/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const { id } = request.params;

      /*
       * La consulta responde el pago que se creó, no uno armado acá.
       *
       * Antes fabricaba la respuesta con `transaction_amount: 50000` y una descripción
       * inventada, y el estado salía de la cabecera de la petición: el mismo pago
       * consultado dos veces con cabeceras distintas devolvía `approved` y `rejected`. Un
       * estado que depende de la pregunta no es un estado, y el monto de mentira rompía la
       * conciliación del comercio.
       *
       * Un identificador que no existe responde 404, porque es lo que responde la API
       * real y porque un 200 con datos de otro cobro esconde el error.
       */
      const payment = mercadopagoPayments.findById(id);

      if (payment === undefined) {
        return reply.code(404).send({
          message: "Payment not found",
          error: "not_found",
          status: 404,
        });
      }

      const movido = mpPaymentMachine.transition(payment, "query");

      if (movido !== payment) {
        mercadopagoPayments.save(id, movido);
      }

      return reply.code(200).send(movido);
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

      const scenario = getSimulatorScenario(request);
      const requestBody = request.body as MercadoPagoCreateOrderRequestBody;

      if (
        scenario.toUpperCase() === "REJECTED" ||
        scenario.toUpperCase() === "DECLINED"
      ) {
        // La pasarela real no rechaza un PSE al crearlo: la orden se crea y el
        // pago muere después, con la orden entera en `failed`. Se reproduce con
        // 402 y no con 201 porque es el código que devolvió la API real.
        return reply.code(402).send({
          errors: [
            {
              code: "failed",
              message: "The following transactions failed",
            },
          ],
        });
      }

      const response = mockFactory.buildPendingOrderResponse(requestBody);
      mercadopagoOrders.save(String(response.id), response);

      /*
       * El escenario se registra acá y la consulta lo aplica.
       *
       * El rechazo no pasa por acá: contra la API real, un PSE que falla devuelve `402` con
       * la orden entera en `failed` en el momento de crearla, y eso es lo que responde la
       * rama de arriba. Lo que sí queda para después de la redirección es la expiración:
       * Mercado Pago no tiene un estado `expired` para órdenes, y el que le corresponde es
       * `canceled`. Sin registrarlo, `EXPIRED` se aceptaba con `201` y la consulta
       * respondía `processed` —un cobro caducado reportado como cobrado.
       *
       * Es la traducción al vocabulario de la pasarela, y por eso vive en el router: quien
       * sabe que `EXPIRED` es `canceled` y no `expired` es el que conoce la pasarela.
       */
      if (scenario.toUpperCase() === "EXPIRED") {
        rememberScenarioTarget("mercadopago", "order", String(response.id), "canceled");
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
       * `canceled` según quién preguntara.
       */
      const order = mercadopagoOrders.findById(id);

      if (order === undefined) {
        return reply.code(404).send({
          message: "Order not found",
          error: "not_found",
          status: 404,
        });
      }

      const movida = mpOrderMachine.transition(order, "query");

      if (movida !== order) {
        mercadopagoOrders.save(id, movida);
      }

      return reply.code(200).send(movida);
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
    async (_request: FastifyRequest, reply: FastifyReply) => {
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

      const scenario = getSimulatorScenario(request);
      if (scenario === "TIMEOUT" || scenario === "GATEWAY_TIMEOUT") {
        return reply.code(504).send(mockFactory.buildTimeoutResponse());
      }
      if (scenario === "NETWORK_ERROR" || scenario === "CONNECTION_ERROR") {
        return ScenarioEngine.handleNetworkError(request, reply);
      }
      if (scenario === "RATE_LIMIT" || scenario === "TOO_MANY_REQUESTS" || scenario === "429") {
        return reply.code(429).send(mockFactory.buildRateLimitResponse());
      }
      if (scenario === "SERVER_ERROR" || scenario === "INTERNAL_ERROR" || scenario === "500") {
        return reply.code(500).send(mockFactory.buildServerErrorResponse(500));
      }
      if (scenario === "BAD_GATEWAY" || scenario === "502") {
        return reply.code(502).send(mockFactory.buildServerErrorResponse(502));
      }
      if (scenario === "SERVICE_UNAVAILABLE" || scenario === "503") {
        return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
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
      return reply.code(201).send(response);
    },
  );
}
