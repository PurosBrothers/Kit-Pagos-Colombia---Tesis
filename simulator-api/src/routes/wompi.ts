import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_SCENARIO,
  getSimulatorScenario,
  ScenarioEngine,
  UnsupportedScenarioError,
} from "../scenarios/ScenarioEngine";
import { GatewayMockFactory } from "../gateways/wompi/GatewayMockFactory";
import {
  WompiCreateTransactionRequestBody,
  WompiTokenizeCardRequestBody,
} from "../gateways/wompi/types";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { wompiStateMachine } from "../state/wompiStateMachine";
import { wompiTransactions } from "../store/GatewayStores";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
} from "../store/ScenarioMarks";

/**
 * Wompi HTTP router (issue #55).
 * Wompi HTTP router (issue #55 & #65).
 *
 * Exposes two endpoints that replicate the real Wompi API contract:
 * Exposes endpoints that replicate the real Wompi API contract:
 *
 *   POST /v1/sim/wompi/transactions
 *     Creates a transaction under the scenario indicated by the
 *     `x-simulate-scenario` header (defaults to APPROVED) and saves it
 *     in the shared TransactionStore.
 *     `x-simulator-scenario` or `x-simulate-scenario` header (defaults to APPROVED).
 *     Saves the resulting transaction in TransactionStore.
 *
 *   GET /v1/sim/wompi/transactions/:id
 *     Retrieves a saved transaction by its native identifier.
 *     Returns 404 in Wompi's native error shape if the id does not exist,
 *     because that case must also be testable from the SDK.
 *
 * Contains no payload construction logic: it extracts the control header and
 * body, delegates the scenario to the ScenarioEngine, saves what was built and
 * answers. The GET reads the record it saved and lets `wompiStateMachine` decide
 * whether it moves — a query has no business scenario, because the creation
 * already fixed the outcome.
 */
export async function wompiRoutes(app: FastifyInstance): Promise<void> {
  const scenarioEngine = new ScenarioEngine();
  const mockFactory = new GatewayMockFactory();

  // ── POST /v1/sim/wompi/transactions ──────────────────────────────────────
  app.post(
    "/v1/sim/wompi/transactions",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Fastify types headers as string | string[] | undefined, hence the
      // array check. In practice that branch is never reached over HTTP: the
      // Node parser collapses a repeated header into a single comma-separated
      // string and only returns an array for set-cookie. Kept to satisfy the
      // type, not because it describes a real case.
      let scenario = getSimulatorScenario(request);
      const requestBody = request.body as WompiCreateTransactionRequestBody;

      /*
       * Wompi no cobra sin método de pago, y el mock tampoco.
       *
       * Medido contra `sandbox.wompi.co`: un `POST /transactions` sin `payment_method`
       * responde `422 UNPROCESSABLE "No se especificó método de pago o fuente de pago"`.
       * El mock lo aceptaba, y por eso el SDK pudo pasar meses sin mandar el token de
       * tarjeta con todas las pruebas en verde. Un mock que acepta más que la API real no
       * es permisivo: es el lugar donde se esconden los defectos (puntos 48 y 50).
       */
      if (!requestBody?.payment_method) {
        return reply.code(422).send({
          error: {
            type: "UNPROCESSABLE",
            reason: "No se especificó método de pago o fuente de pago",
          },
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
        const key = requestBody.reference ?? "default_wompi_flapping";
        const isFailing = nextFlappingAttempt(key);
        if (isFailing) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
        }
        scenario = DEFAULT_SCENARIO;
      }

      if (scenario === "DUPLICATE_PAYMENT") {
        const dupKey = `dup_wompi_${requestBody.reference}`;
        if (hasDuplicateMark(dupKey)) {
          return reply.code(409).send({
            error: {
              type: "DUPLICATE_TRANSACTION",
              reason: `Transacción ya creada previamente con la referencia '${requestBody.reference}'`,
            },
          });
        }
        markDuplicate(dupKey);
        scenario = DEFAULT_SCENARIO;
      }

      try {
        const response = scenarioEngine.execute(scenario, requestBody);

        /*
         * La fábrica solo construye; guardar es de la ruta.
         *
         * Antes lo escribía `GatewayMockFactory`, que recibía el store por el constructor
         * y guardaba cada transacción que armaba. Con eso, el estado de un cobro vivía
         * repartido entre tres lugares: la tabla de transiciones para las consultas, un
         * método de la fábrica para la tarjeta y otro para el PSE, y este `if` para el
         * 404. Además la ruta no guardaba nada, así que un cobro creado con un escenario
         * que no pasara por la factoría no se podía consultar después.
         *
         * Aquí queda explícito: se guarda exactamente lo que se va a responder, con el
         * estado que la creación decidió. Que nazca `PENDING` y se resuelva al consultar
         * es correcto —así se midió— y por eso la tabla tiene una transición de tarjeta.
         */
        wompiTransactions.save(response.data.id, response.data);

        // `PENDING` nace igual que el aprobado; lo que lo distingue es que la consulta no lo
        // resuelve. Es una decisión del simulador (nivel 3), ver `wompiStateMachine.ts`.
        if (scenario === "PENDING") {
          rememberScenarioTarget("wompi", "transaction", response.data.id, "PENDING");
        }

        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof UnsupportedScenarioError) {
          return reply.code(501).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  // ── GET /v1/sim/wompi/transactions/:id ───────────────────────────────────
  app.get(
    "/v1/sim/wompi/transactions/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const transaction = wompiTransactions.findById(id);

      if (!transaction) {
        // Nivel 1 — medido contra `sandbox.wompi.co` el 5 de octubre de 2026: un id
        // inexistente (uuid o con la forma del id nativo, con o sin `Authorization`)
        // responde este 404, sin el id en el mensaje. El SDK lo traduce a
        // RESOURCE_NOT_FOUND con `ErrorHandler`.
        return reply.code(404).send({
          error: {
            type: "NOT_FOUND_ERROR",
            reason: "La entidad solicitada no existe",
          },
        });
      }

      /*
       * La tabla mueve la transacción y la ruta guarda lo que se movió.
       *
       * Un PSE pendiente avanza un paso en cada consulta: primero publica la URL de
       * redirección sin salir de PENDING, y después resuelve. Un cobro con tarjeta
       * pendiente resuelve en la primera consulta, porque así se midió Wompi: nace PENDING
       * y pasa a APPROVED solo, en unos 600 ms.
       *
       * Esa diferencia entre métodos está en la tabla y no en el router, que es donde
       * estaba antes. La razón concreta: la regla del PSE necesita saber si la URL del
       * banco ya se publicó, y para decirlo tiene que mirar el registro. En el router eso
       * era un `if` sobre `payment_method.type` con una segunda condición sobre
       * `extra.async_payment_url` que nadie encontraba al leerlo.
       *
       * Guardar solo si cambió es lo que hace que consultar dos veces no escriba nada: la
       * segunda consulta devuelve el mismo objeto y la ruta no lo vuelve a guardar.
       */
      const resolved = wompiStateMachine.transition(transaction, "query");

      if (resolved !== transaction) {
        wompiTransactions.save(id, resolved);
      }

      // Wompi wraps the transaction in { data: ... } for both creation and
      // status queries. The same shape is preserved here so ResponseNormalizer
      // does not need a separate branch for status query responses.
      return reply.code(200).send({ data: resolved });
    },
  );

  // ── GET /v1/sim/wompi/merchants/:publicKey ───────────────────────────────
  //
  // El SDK la llama antes de crear cualquier transacción, porque Wompi exige un
  // `acceptance_token` firmado y de un solo uso. Existe acá para que el SDK
  // tenga un solo camino de código y no una rama "modo simulador".
  app.get(
    "/v1/sim/wompi/merchants/:publicKey",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send(mockFactory.buildMerchantResponse());
    },
  );

  /**
   * Lista de entidades financieras de PSE.
   *
   * Reproduce lo medido contra el sandbox real el 18 de septiembre de 2026, con los
   * tres bancos de prueba y sus nombres textuales. Son los codigos que fuerzan cada
   * desenlace: 1 aprueba, 2 declina y 3 simula un error.
   *
   * Los nombres van tal cual, sin cambiarlos por nombres de bancos reales, por dos
   * razones: es lo que devuelve el sandbox, y un comercio que ve "Banco que
   * declina" en su selector sabe de inmediato contra que entorno esta apuntando.
   */
  app.get(
    "/v1/sim/wompi/pse/financial_institutions",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send({
        data: [
          { financial_institution_code: "1", financial_institution_name: "Banco que aprueba" },
          { financial_institution_code: "2", financial_institution_name: "Banco que declina" },
          { financial_institution_code: "3", financial_institution_name: "Banco que simula un error" },
        ],
        meta: {},
      });
    },
  );

  // ── POST /v1/sim/wompi/tokens/cards (issue #126) ─────────────────────────
  app.post(
    "/v1/sim/wompi/tokens/cards",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({
          error: {
            type: "UNAUTHORIZED",
            code: "ACCESS_TOKEN_HEADER_NOT_PRESENT",
            reason: "Header de autorización 'Authorization' no enviado.",
          },
        });
      }

      const publicKey = authHeader.slice(7).trim();
      if (!publicKey) {
        return reply.code(401).send({
          error: {
            type: "UNAUTHORIZED",
            code: "ACCESS_TOKEN_HEADER_NOT_PRESENT",
            reason: "Header de autorización 'Authorization' no enviado.",
          },
        });
      }

      /*
       * Nivel de evidencia 1 para la forma medida contra sandbox.wompi.co el 3 y 4 de octubre de 2026:
       * Ante una llave pública inexistente, Wompi responde 404 con code: "MERCHANT_NOT_FOUND".
       */
      if (
        publicKey.includes("inexistente") ||
        publicKey.includes("invalid") ||
        publicKey.includes("not_found")
      ) {
        return reply.code(404).send({
          error: {
            type: "NOT_FOUND",
            reason: `Comercio con llave ${publicKey} no encontrado`,
            code: "MERCHANT_NOT_FOUND",
          },
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

      const body = request.body as WompiTokenizeCardRequestBody;
      /*
       * Nivel de evidencia 1 para la forma (medido contra sandbox.wompi.co el 3 y 4 de octubre de 2026):
       * Los errores de validación de campos responden 422 con un mapa messages: { [campo]: string[] }
       * y sin propiedad reason.
       */
      if (
        !body ||
        body.number === undefined ||
        body.cvc === undefined ||
        body.exp_month === undefined ||
        body.exp_year === undefined ||
        body.card_holder === undefined
      ) {
        const missingFields: Record<string, string[]> = {};
        if (body?.number === undefined) missingFields.number = ["debe tener la propiedad requerida number."];
        if (body?.cvc === undefined) missingFields.cvc = ["debe tener la propiedad requerida cvc."];
        if (body?.exp_month === undefined) missingFields.exp_month = ["debe tener la propiedad requerida exp_month."];
        if (body?.exp_year === undefined) missingFields.exp_year = ["debe tener la propiedad requerida exp_year."];
        if (body?.card_holder === undefined) missingFields.card_holder = ["debe tener la propiedad requerida card_holder."];

        return reply.code(422).send({
          error: {
            type: "INPUT_VALIDATION_ERROR",
            messages: missingFields,
          },
        });
      }

      if (body.cvc === "" || !/^\d{3,4}$/.test(String(body.cvc))) {
        return reply.code(422).send({
          error: {
            type: "INPUT_VALIDATION_ERROR",
            messages: {
              cvc: ['debe coincidir con el patron "^\\d{3,4}$"'],
            },
          },
        });
      }

      const cleanNumber = String(body.number).replace(/\s+/g, "");
      if (cleanNumber.length < 13 || !/^\d+$/.test(cleanNumber)) {
        return reply.code(422).send({
          error: {
            type: "INPUT_VALIDATION_ERROR",
            messages: {
              number: ["debe coincidir con el patron …"],
            },
          },
        });
      }

      const response = mockFactory.buildTokenCardResponse(body);
      return reply.code(201).send(response);
    },
  );
}


