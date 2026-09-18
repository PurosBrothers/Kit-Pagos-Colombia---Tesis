import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_SCENARIO,
  ScenarioEngine,
  UnsupportedScenarioError,
} from "../scenarios/ScenarioEngine";
import { GatewayMockFactory } from "../gateways/wompi/GatewayMockFactory";
import { WompiCreateTransactionRequestBody, WompiTransaction } from "../gateways/wompi/types";
import { transactionStore } from "../store/TransactionStore";

const SCENARIO_HEADER = "x-simulate-scenario";

/**
 * Wompi HTTP router (issue #55).
 *
 * Exposes two endpoints that replicate the real Wompi API contract:
 *
 *   POST /v1/sim/wompi/transactions
 *     Creates a transaction under the scenario indicated by the
 *     `x-simulate-scenario` header (defaults to APPROVED) and saves it
 *     in the shared TransactionStore.
 *
 *   GET /v1/sim/wompi/transactions/:id
 *     Retrieves a saved transaction by its native identifier.
 *     Returns 404 in Wompi's native error shape if the id does not exist,
 *     because that case must also be testable from the SDK.
 *
 * Contains no scenario decision logic or payload construction logic:
 * it extracts the control header and body, and delegates all work to the
 * ScenarioEngine for POST. The GET reads directly from the TransactionStore
 * because there is no business logic involved — it is a pure read.
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
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = Array.isArray(scenarioHeader)
        ? scenarioHeader[0]
        : (scenarioHeader ?? DEFAULT_SCENARIO);

      const requestBody = request.body as WompiCreateTransactionRequestBody;

      try {
        const response = scenarioEngine.execute(scenario, requestBody);
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
      const transaction = transactionStore.findById(id) as WompiTransaction | undefined;

      if (!transaction) {
        // Respond with Wompi's native error shape so the SDK can map it to
        // KitPagosError(RESOURCE_NOT_FOUND) through ErrorHandler, exactly as
        // the real API would for an unknown id.
        return reply.code(404).send({
          error: {
            type: "NOT_FOUND",
            reason: `Transaction with id '${id}' does not exist`,
          },
        });
      }

      // Un PSE pendiente avanza un paso en cada consulta: primero publica la URL
      // de redirección sin salir de PENDING, y después resuelve. La decisión de
      // cómo avanza es de la fábrica, no del router.
      const resolved =
        transaction.status === "PENDING" && transaction.payment_method?.type === "PSE"
          ? mockFactory.advancePseTransaction(transaction)
          : transaction;

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
}