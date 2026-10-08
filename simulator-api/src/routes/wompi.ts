import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_SCENARIO,
  getSimulatorScenario,
  ScenarioEngine,
  UnsupportedScenarioError,
} from "../scenarios/ScenarioEngine";
import { resolveScenario, wholePesosFromCents } from "../scenarios/scenarioFromRequest";
import { bankListFailure, queryFailure, technicalFailure } from "../scenarios/technicalFailure";
import {
  hasInvalidCredentialMarker,
  invalidCredentialIn,
  invalidCredentialRequested,
} from "../scenarios/invalidCredential";
import { GatewayMockFactory } from "../gateways/wompi/GatewayMockFactory";
import {
  WompiCreateTransactionRequestBody,
  WompiTokenizeCardRequestBody,
} from "../gateways/wompi/types";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { wompiStateMachine } from "../state/wompiStateMachine";
import { rememberBankRedirectOrigin, requestOrigin } from "../store/BankRedirectOrigins";
import { wompiTransactions } from "../store/GatewayStores";
import { cardTokenOutcomeFor, rememberCardTokenOutcome } from "../store/CardTokenOutcomes";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
  rememberQueryFailure,
} from "../store/ScenarioMarks";

/**
 * La tarjeta de prueba que el sandbox de Wompi declina. Nivel 1, medido el 6 de octubre de
 * 2026 (`docs/testing-data/wompi.md`, sección 1.3): nace `PENDING` y la consulta la muestra
 * `DECLINED`; el `status_message` lo pone `wompiStateMachine.ts`.
 */
const DECLINING_TEST_CARD = "4111111111111111";

/** El patrón que Wompi exige al número de tarjeta, tal como lo cita en su `422`. */
const CARD_NUMBER_PATTERN = /^\d{12,19}$/;

/** El algoritmo de Luhn sobre un número que ya pasó `CARD_NUMBER_PATTERN`. */
function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index++) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/*
 * Credencial inválida. Nivel 1 — medido contra `sandbox.wompi.co` el 6 de octubre de 2026
 * (`docs/testing-data/wompi.md`, sección 1.3), con una llave privada inexistente y, aparte,
 * con una pública inexistente («Con una llave pública inexistente»), que es la que el SDK manda
 * en todas las rutas de Wompi.
 *
 * - `POST /transactions` con cuerpo válido: `401` con este cuerpo, con las dos llaves. Con
 *   cuerpo `{}` respondió `422`: Wompi valida el cuerpo antes que la llave, y la ruta conserva
 *   ese orden.
 * - `GET /transactions/{id}`: `403`, con otro `reason`, solo con la llave **privada**
 *   inexistente. Con la pública inexistente, sin `Authorization` o con una llave válida
 *   responde `200` con la transacción.
 * - `GET /merchants/{llave}` con la pública inexistente: `404`, también sin `Authorization`.
 * - `GET /pse/financial_institutions`: `200` con las dos llaves inexistentes; la ruta no mira
 *   la marca.
 *
 * No se imita la variante cuyo `reason` repite la llave recibida (la llave `garbage`), para no
 * devolver una credencial en una respuesta.
 */
const INVALID_KEY_ON_CREATE = {
  error: { type: "INVALID_ACCESS_TOKEN", reason: "Llave no válida" },
} as const;

const INVALID_KEY_ON_QUERY = {
  error: { type: "INVALID_ACCESS_TOKEN", reason: "El token no tiene suficientes permisos" },
} as const;

/** Nivel 1 — medido el 5 y el 6 de octubre de 2026: transacción o comercio inexistente. */
const NOT_FOUND = {
  error: { type: "NOT_FOUND_ERROR", reason: "La entidad solicitada no existe" },
} as const;

/** La página de `GET /v1/sim/wompi/pse/redirect`. La lee una persona, así que va en español. */
const PSE_REDIRECT_PAGE =
  '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
  "<title>Redirección simulada al banco (PSE)</title></head><body>" +
  "<h1>Redirección simulada al banco</h1>" +
  "<p>Esta página es de la API de Simulación de Kit Pagos Colombia. No es de Wompi ni de " +
  "un banco, y no imita la página real del banco.</p>" +
  "<p>El resultado del pago quedó decidido al crear la transacción. " +
  "Consulte la transacción para conocerlo.</p></body></html>";

/** La página de `GET /v1/sim/wompi/terms`. La lee una persona, así que va en español. */
const TERMS_PAGE =
  '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
  "<title>Términos de aceptación simulados</title></head><body>" +
  "<h1>Términos de aceptación simulados</h1>" +
  "<p>Esta página es de la API de Simulación de Kit Pagos Colombia: no son los términos de " +
  "Wompi.</p>" +
  "<p>En producción, el comercio debe mostrarle al pagador el <code>permalink</code> real " +
  "que entrega Wompi en <code>presigned_acceptance</code>.</p></body></html>";

/** Si la petición llega con una llave privada (`Bearer prv_…`). */
function sendsPrivateKey(request: FastifyRequest): boolean {
  return request.headers.authorization?.startsWith("Bearer prv_") ?? false;
}

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

      if (invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(401).send(INVALID_KEY_ON_CREATE);
      }

      // La tarjeta de prueba decide antes que el monto; ver `resolveScenario()`.
      const resolved = resolveScenario(request, {
        gatewayData: cardTokenOutcomeFor("wompi", requestBody.payment_method?.token)?.scenario,
        wholePesos: wholePesosFromCents(requestBody.amount_in_cents),
      });
      let scenario = resolved.scenario;

      const failure = await technicalFailure(scenario, request, reply, mockFactory, { data: {} });

      if (failure !== undefined) {
        return failure;
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

        // La URL del banco se publica en una consulta, que no sabe con qué host se creó el PSE.
        if (response.data.payment_method?.type === "PSE") {
          rememberBankRedirectOrigin("wompi", response.data.id, requestOrigin(request));
        }

        // `PENDING` nace igual que el aprobado; lo que lo distingue es que la consulta no lo
        // resuelve. Es una decisión del simulador (nivel 3), ver `wompiStateMachine.ts`.
        if (scenario === "PENDING") {
          rememberScenarioTarget("wompi", "transaction", response.data.id, "PENDING");
        }

        // Un PSE rechazado nace pendiente y la primera consulta lo cierra con la URL del
        // banco, igual que el banco `2` (medido el 6 de octubre de 2026). Antes nacía
        // `DECLINED` sin URL, y el SDK la esperaba hasta agotar su plazo.
        if (
          (scenario === "DECLINED" || scenario === "REJECTED") &&
          response.data.payment_method?.type === "PSE"
        ) {
          rememberScenarioTarget("wompi", "transaction", response.data.id, "DECLINED");
        }

        // La tarjeta `4111` nace pendiente, como toda tarjeta en Wompi, y la consulta la
        // resuelve declinada, que es el desenlace que el sandbox documenta para ese número.
        if (scenario === "PENDING_THEN_DECLINED") {
          rememberScenarioTarget("wompi", "transaction", response.data.id, "DECLINED");
        }

        if (resolved.queryFailure !== undefined) {
          rememberQueryFailure("wompi", "transaction", response.data.id, resolved.queryFailure);
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

      // Solo la llave privada inexistente da `403`; la pública inexistente lee la transacción
      // (medido el 6 de octubre de 2026). La llave se revisa antes de buscar la transacción;
      // con un id inexistente no se midió cuál de las dos respuestas gana.
      if (sendsPrivateKey(request) && invalidCredentialRequested(request, ["authorization"])) {
        return reply.code(403).send(INVALID_KEY_ON_QUERY);
      }

      const transaction = wompiTransactions.findById(id);

      if (!transaction) {
        // Nivel 1 — medido contra `sandbox.wompi.co` el 5 de octubre de 2026: un id
        // inexistente (uuid o con la forma del id nativo, con o sin `Authorization`)
        // responde este 404, sin el id en el mensaje. El SDK lo traduce a
        // RESOURCE_NOT_FOUND con `ErrorHandler`.
        return reply.code(404).send(NOT_FOUND);
      }

      /*
       * La falla de consulta que pidió la creación (issue #122) no se aplica mientras un PSE
       * no publique la URL del banco: esa consulta la hace el propio SDK dentro de
       * `createPayment()` (`resolvePendingRedirect`), y fallarla haría fallar la creación,
       * que es la operación que el SDK no reintenta.
       */
      const awaitingBankUrl =
        transaction.payment_method?.type === "PSE" &&
        transaction.payment_method.extra?.async_payment_url === undefined;

      if (!awaitingBankUrl) {
        const failure = await queryFailure(
          { gateway: "wompi", resource: "transaction", id },
          reply,
          mockFactory,
        );
        if (failure !== undefined) {
          return failure;
        }
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
  // `acceptance_token` firmado y de un solo uso. Existe aquí para que el SDK
  // tenga un solo camino de código y no una rama "modo simulador".
  app.get(
    "/v1/sim/wompi/merchants/:publicKey",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // La llave va en la ruta y Wompi responde igual sin `Authorization` (medido el 6 de
      // octubre de 2026), así que la marca se lee de la ruta y no de la cabecera.
      const { publicKey } = request.params as { publicKey: string };

      if (invalidCredentialIn(request, [publicKey])) {
        return reply.code(404).send(NOT_FOUND);
      }

      return reply.code(200).send(mockFactory.buildMerchantResponse(requestOrigin(request)));
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const failure = bankListFailure(request, reply, mockFactory, "wompi");
      if (failure !== undefined) {
        return failure;
      }

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

  /**
   * El destino de `async_payment_url`: la redirección al banco de un PSE (issue #122).
   *
   * Nivel 3 — convención del simulador. La ruta existe en Wompi (medida como URL el 6 de
   * octubre de 2026, `docs/testing-data/wompi.md`, sección 3), pero el contenido de la página
   * del banco no se imita. Antes la URL apuntaba aquí y la ruta no estaba registrada: abrirla
   * daba 404.
   *
   * No mueve la transacción: en Wompi el desenlace lo decide el banco de prueba elegido al
   * crearla y se ve al consultarla (`wompiStateMachine.ts`). Tampoco repite `ticket_id` en
   * la página, para no devolver en HTML algo que vino en la URL.
   */
  app.get("/v1/sim/wompi/pse/redirect", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).header("content-type", "text/html; charset=utf-8").send(PSE_REDIRECT_PAGE);
  });

  /**
   * El destino del `permalink` de `presigned_acceptance` en `GET /merchants/{llave}`.
   *
   * Nivel 3 — convención del simulador. Lo que devuelve el `permalink` real de Wompi no está
   * medido en `docs/testing-data/wompi.md`, así que la página no imita nada: dice que es del
   * simulador. Antes el `permalink` apuntaba aquí y la ruta no estaba registrada: abrirlo daba
   * 404.
   */
  app.get("/v1/sim/wompi/terms", async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(200).header("content-type", "text/html; charset=utf-8").send(TERMS_PAGE);
  });

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
      if (hasInvalidCredentialMarker(publicKey)) {
        return reply.code(404).send({
          error: {
            type: "NOT_FOUND",
            reason: `Comercio con llave ${publicKey} no encontrado`,
            code: "MERCHANT_NOT_FOUND",
          },
        });
      }

      const failure = await technicalFailure(
        getSimulatorScenario(request),
        request,
        reply,
        mockFactory,
        { status: "CREATED", data: {} },
      );
      if (failure !== undefined) {
        return failure;
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

      /*
       * Nivel 1 — medido contra `sandbox.wompi.co` el 6 de octubre de 2026, con la llave
       * pública (`docs/testing-data/wompi.md`, sección 1.4): el número se valida contra `^\d{12,19}$` sin quitar espacios (`4242` y
       * `4242 4242 4242 4242` dan este `422`), y solo después con Luhn. «patron» va sin tilde,
       * como lo escribe Wompi.
       */
      const cleanNumber = String(body.number);
      if (!CARD_NUMBER_PATTERN.test(cleanNumber)) {
        return reply.code(422).send({
          error: {
            type: "INPUT_VALIDATION_ERROR",
            messages: { number: ['debe coincidir con el patron "^\\d{12,19}$"'] },
          },
        });
      }

      // Nivel 1, la misma medición: un número de 16 o de 19 dígitos que no pasa Luhn.
      if (!passesLuhn(cleanNumber)) {
        return reply.code(422).send({
          error: {
            type: "INPUT_VALIDATION_ERROR",
            messages: { number: ["El número de tarjeta es inválido. Luhn check falló."] },
          },
        });
      }

      const response = mockFactory.buildTokenCardResponse(body);

      if (cleanNumber === DECLINING_TEST_CARD) {
        rememberCardTokenOutcome("wompi", response.data.id, { scenario: "PENDING_THEN_DECLINED" });
      }

      return reply.code(201).send(response);
    },
  );
}


