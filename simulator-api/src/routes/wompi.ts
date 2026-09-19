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
      // de redirección sin salir de PENDING, y después resuelve. Un cobro con tarjeta
      // pendiente resuelve en la primera consulta, porque así se midió Wompi: nace
      // PENDING y pasa a APPROVED solo, en unos 600 ms. La decisión de cómo avanza cada
      // método es de la fábrica, no del router.
      const resolved = resolvePendingTransaction(transaction, mockFactory);

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
}

/**
 * Avanza una transacción pendiente según su método de pago.
 *
 * Los dos métodos de Wompi son asíncronos y lo son de maneras distintas: PSE publica la
 * URL del banco en una consulta y resuelve en la siguiente, y la tarjeta resuelve en la
 * primera. Tener la decisión en una función con nombre evita que el router acumule la
 * diferencia entre métodos, que es conocimiento de la pasarela y no del transporte.
 */
function resolvePendingTransaction(
  transaction: WompiTransaction,
  mockFactory: GatewayMockFactory,
): WompiTransaction {
  if (transaction.status !== "PENDING") {
    return transaction;
  }

  return transaction.payment_method?.type === "PSE"
    ? mockFactory.advancePseTransaction(transaction)
    : mockFactory.advanceCardTransaction(transaction);
}
