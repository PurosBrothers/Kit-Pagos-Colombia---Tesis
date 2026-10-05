import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/rapyd/GatewayMockFactory";
import {
  RapydCreateCheckoutRequestBody,
  RapydCreateCustomerRequestBody,
  RapydCreatePaymentRequestBody,
} from "../gateways/rapyd/types";
import {
  getSimulatorScenario,
  ScenarioEngine,
} from "../scenarios/ScenarioEngine";
import {
  rapydCheckoutMachine,
  rapydPaymentMachine,
} from "../state/rapydStateMachine";
import { rapydCheckouts, rapydPayments } from "../store/GatewayStores";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
} from "../store/ScenarioMarks";

const DEFAULT_SCENARIO = "APPROVED";

/**
 * Router HTTP de Rapyd (issue #52).
 * Router HTTP de Rapyd (issue #52 & #65).
 *
 * Expone las dos operaciones que el `RapydAdapter` del SDK necesita, con las
 * Expone las operaciones que el `RapydAdapter` del SDK necesita, con las
 * mismas rutas que la API real bajo el prefijo de simulacion:
 *
 * 1. `POST /v1/sim/rapyd/payments` — creacion de pago (201), que es el camino de PSE.
 * 2. `GET  /v1/sim/rapyd/payments/:paymentId` — consulta de estado (200).
 * 3. `POST /v1/sim/rapyd/checkout` — pagina de pago alojada (201), el camino de tarjeta.
 * 4. `GET  /v1/sim/rapyd/checkout/:checkoutId` — consulta de la pagina (200).
 * 5. `GET  /v1/sim/rapyd/checkout/:checkoutId/pagar` — la visita del pagador a la pagina,
 *    que es el unico punto donde el cobro se concreta. No es una ruta de la API de Rapyd:
 *    es el destino de `redirect_url`.
 *
 * Sigue el mismo reparto que la ruta de Mercado Pago: instancia su propia
 * fabrica y resuelve el escenario aca, sin pasar por `ScenarioEngine`. Ese
 * motor hoy esta tipado contra el cuerpo y la respuesta de Wompi, y
 * generalizarlo para recibir la pasarela como parametro es trabajo declarado de
 * la Iteracion 3 en `layers-and-components.md`. Forzarlo ahora obligaria a
 * tocar la rebanada de Wompi, que ya esta cerrada y en verde.
 *
 * Consecuencia que conviene tener anotada: de las tres rebanadas, solo Wompi
 * pasa por `ScenarioEngine`. Es deriva conocida, no un descuido, y se resuelve
 * cuando ese motor se generalice.
 *
 * **El mock no verifica la firma de las peticiones entrantes.** Rapyd exige
 * `access_key`, `salt`, `timestamp` y `signature` en cada request, y el SDK los
 * envia, pero validarlos aca requiere la clase `SignatureGenerator` que
 * `layers-and-components.md` marca como pendiente en la API de Simulacion. Sin
 * eso, un adaptador que calcule mal la firma pasaria igual contra el mock: por
 * eso la correccion de la firma se cubre con pruebas unitarias del adaptador
 * contra el vector de la documentacion oficial, y no confiando en el mock.
 * 5. `GET  /v1/sim/rapyd/checkout/:checkoutId/pagar` — la visita del pagador a la pagina.
 */
export async function rapydRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  app.post(
    "/v1/sim/rapyd/payments",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Fastify tipa las cabeceras como string | string[] | undefined. La rama
      // del arreglo no se alcanza por HTTP (Node colapsa cabeceras repetidas en
      // un solo string), se conserva para satisfacer el tipo.
      let scenario = getSimulatorScenario(request);
      const requestBody = request.body as RapydCreatePaymentRequestBody;

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
        const key = requestBody.merchant_reference_id ?? "rapyd_flapping";
        const isFailing = nextFlappingAttempt(key);
        if (isFailing) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
        }
        scenario = DEFAULT_SCENARIO;
      }

      if (scenario === "DUPLICATE_PAYMENT") {
        const dupKey = `dup_rapyd_${requestBody.merchant_reference_id}`;
        if (hasDuplicateMark(dupKey)) {
          return reply.code(409).send({
            status: {
              error_code: "DUPLICATE_MERCHANT_REFERENCE_ID",
              status: "ERROR",
              message: `Payment already exists for merchant_reference_id '${requestBody.merchant_reference_id}'`,
              response_code: "DUPLICATE_MERCHANT_REFERENCE_ID",
              operation_id: "",
            },
          });
        }
        markDuplicate(dupKey);
        scenario = DEFAULT_SCENARIO;
      }

      if (scenario === "DECLINED" || scenario === "REJECTED") {
        const declined = mockFactory.buildDeclinedResponse(requestBody);
        rapydPayments.save(declined.data.id, declined.data);

        return reply.code(201).send(declined);
      }

      if (scenario === "EXPIRED") {
        const expired = mockFactory.buildExpiredResponse(requestBody);
        rapydPayments.save(expired.data.id, expired.data);

        return reply.code(201).send(expired);
      }

      if (
        scenario !== DEFAULT_SCENARIO &&
        scenario !== "APPROVED" &&
        scenario !== "APPROVAL"
      ) {
        return reply
          .code(501)
          .send({ error: `Escenario aun no soportado: ${scenario}` });
      }

      // PSE se reconoce por el prefijo del metodo de pago, que en Rapyd son 47
      // tipos `co_pse_{banco}_bank` en vez de un metodo con un campo de banco.
      // PSE se reconoce por el prefijo del metodo de pago
      const methodType = (requestBody.payment_method as { type?: unknown })?.type;
      const esPse =
        typeof methodType === "string" && methodType.startsWith("co_pse_");

      if (esPse) {
        // Rapyd rechaza el pago sin cliente previo, medido como
        // `MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]`. El mock lo
        // reproduce para que una prueba note si el adaptador se saltara la
        // primera llamada.
        if (!requestBody.customer) {
          return reply.code(400).send({
            status: {
              error_code: "MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]",
              status: "ERROR",
              message: "Please contact Rapyd Client Support.",
              response_code: "MISSING_PAYMENT_METHOD_REQUIRED_FIELD - [CUSTOMER]",
              operation_id: "",
            },
          });
        }

        /*
         * El pago de PSE nace activo y sin cobrar, y se guarda así.
         *
         * `buildPseCreatedResponse` ya no persiste —la fábrica solo construye—, así que
         * sin esta línea el pago de PSE no se podría consultar y el flujo de Rapyd con
         * PSE quedaría sin poder ejercitar de punta a punta, que es justo para lo que
         * existe la ruta de consulta.
         *
         * Guardar el estado `ACT` y no el final es lo correcto: el pago todavía no se
         * cobró, y `next_action: "pending_confirmation"` dice exactamente eso. Lo mueve la
         * tabla cuando el comercio consulta.
         */
        const pse = mockFactory.buildPseCreatedResponse(requestBody);
        rapydPayments.save(pse.data.id, pse.data);

        return reply.code(201).send(pse);
      }

      const approved = mockFactory.buildApprovedResponse(requestBody);
      rapydPayments.save(approved.data.id, approved.data);

      return reply.code(201).send(approved);
    },
  );

  /**
   * Página de pago alojada: el camino de tarjeta de Rapyd.
   *
   * No es una alternativa de diseño, es el único camino medido que cobra una tarjeta sin
   * que el número pase por el servidor del comercio. `POST /v1/payments` con un método
   * `co_visa_card` guardado responde `ERROR_CARD_NOT_AUTHENTICATED`, y la variante que
   * funciona exige `number`, `expiration_month` y `cvv` en la petición.
   */
  app.post(
    "/v1/sim/rapyd/checkout",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestBody = request.body as RapydCreateCheckoutRequestBody;

      // Rapyd no crea una página sin monto, divisa y país; el mock tampoco, para que una
      // prueba note si el adaptador dejara de mandar alguno.
      if (!requestBody?.amount || !requestBody?.currency || !requestBody?.country) {
        return reply.code(400).send({
          status: {
            error_code: "MISSING_REQUIRED_FIELD",
            status: "ERROR",
            message: "amount, currency and country are required.",
            response_code: "MISSING_REQUIRED_FIELD",
            operation_id: "",
          },
        });
      }

      // 200 y no 201: se midió que Rapyd responde 200 al crear una página de pago, a
      // diferencia de `POST /v1/payments`, que responde 201. La misma API usa los dos.
      const created = mockFactory.buildCheckoutCreatedResponse(requestBody);
      rapydCheckouts.save(created.data.id, created.data);

      return reply.code(200).send(created);
    },
  );

  /**
   * Consulta de una página de pago.
   *
   * Es una ruta aparte de la de pagos y no un detalle: un identificador `checkout_`
   * consultado en `/payments/{id}` responde `400 ERROR_GET_PAYMENT` contra la API real.
   */
  app.get(
    "/v1/sim/rapyd/checkout/:checkoutId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { checkoutId } = request.params as { checkoutId: string };
      const checkout = rapydCheckouts.findById(checkoutId);

      if (!checkout) {
        return reply.code(400).send({
          status: {
            error_code: "ERROR_GET_CHECKOUT_PAGE",
            status: "ERROR",
            message: "",
            response_code: "ERROR_GET_CHECKOUT_PAGE",
            operation_id: "",
          },
        });
      }

      // Lectura pura: la página se paga cuando alguien la visita, no cuando el comercio
      // pregunta por ella.
      return reply.code(200).send({
        status: {
          status: "SUCCESS",
          error_code: "",
          message: "",
          response_code: "",
          operation_id: "",
        },
        data: checkout,
      });
    },
  );

  /**
   * La página que vería el pagador, y el único lugar donde el cobro se concreta.
   *
   * No representa una ruta de la API de Rapyd: es el destino de `redirect_url`, o sea la
   * página alojada a la que Rapyd manda al pagador. Existe para que el ejemplo pueda
   * recorrer el flujo en el orden real —crear, redirigir, pagar, consultar— en vez de
   * suponer que el pago aparece solo.
   */
  app.get(
    "/v1/sim/rapyd/checkout/:checkoutId/pagar",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { checkoutId } = request.params as { checkoutId: string };
      const checkout = rapydCheckouts.findById(checkoutId);

      if (!checkout) {
        return reply.code(404).send({
          status: {
            error_code: "ERROR_GET_CHECKOUT_PAGE",
            status: "ERROR",
            message: "",
            response_code: "ERROR_GET_CHECKOUT_PAGE",
            operation_id: "",
          },
        });
      }

      /*
       * `pay` y no `query`: esta es la visita del pagador, no una lectura.
       *
       * La tabla decide que un checkout en `NEW` pasa a `DON` y que de paso nazca el pago.
       * El método `payCheckout` de la fábrica hacía exactamente eso, y por eso se borró: dos
       * copias de la misma regla —una en la tabla y otra en la fábrica— son dos lugares que
       * pueden discrepar, y ya discrepaban. La diferencia real con Wompi sigue en pie y es
       * intencionada: acá el simulador representa la visita a la página; en Wompi avanza por
       * consultas porque la URL del banco es un destino externo que no puede servir.
       */
      const pagado = rapydCheckoutMachine.transition(checkout, "pay");

      if (pagado !== checkout) {
        rapydCheckouts.save(checkoutId, pagado);
      }

      return reply.code(200).send({ paid: true, payment_id: pagado.payment.id });
    },
  );

  app.get(
    "/v1/sim/rapyd/payments/:paymentId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { paymentId } = request.params as { paymentId: string };

      /*
       * La consulta responde el pago que existe, no uno armado acá.
       *
       * Antes `buildStatusResponse` devolvía siempre `CLO`, `paid: true`, `amount: "0"` y
       * la referencia vacía, para cualquier identificador. Eso hacía pasar por aprobado un
       * pago que no existía y, cuando sí existía, escondía su monto y su referencia: el
       * comercio no podía conciliar contra nada. Un pago que seDeclinó además se reportaba
       * cobrado, porque el método no miraba el estado guardado.
       *
       * La tabla mueve `ACT` a `CLO` y un pago ya final se devuelve como está. Que el
       * escenario no intervenga es el criterio 1 del issue: el desenlace lo fijó la
       * creación.
       */
      const payment = rapydPayments.findById(paymentId);

      if (!payment) {
        return reply.code(404).send({
          status: {
            error_code: "ERROR_GET_PAYMENT",
            status: "ERROR",
            message: "",
            response_code: "ERROR_GET_PAYMENT",
            operation_id: "",
          },
        });
      }

      const movido = rapydPaymentMachine.transition(payment, "query");

      if (movido !== payment) {
        rapydPayments.save(paymentId, movido);
      }

      return reply.code(200).send({
        status: {
          status: "SUCCESS",
          error_code: "",
          message: "",
          response_code: "",
          operation_id: "",
        },
        data: movido,
      });
    },
  );

  /**
   * Creacion de cliente, la primera de las dos llamadas de PSE.
   *
   * Existe como ruta aparte y no como un paso implicito del pago porque asi es en
   * Rapyd: el `customer` es una entidad propia, y el pago la referencia. Que el
   * mock la exponga separada es lo que permite que una prueba verifique que el
   * adaptador hace las dos llamadas en orden, y no solo que el resultado final sea
   * el esperado.
   */
  app.post(
    "/v1/sim/rapyd/customers",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestBody = request.body as RapydCreateCustomerRequestBody;

      // Rapyd valida el nombre antes que nada, y responde con un codigo propio
      // distinto del de los campos que faltan.
      if (!requestBody.name) {
        return reply.code(400).send({
          status: {
            error_code: "INVALID_CUSTOMER_NAME",
            status: "ERROR",
            message: "",
            response_code: "INVALID_CUSTOMER_NAME",
            operation_id: "",
          },
        });
      }

      return reply.code(200).send(mockFactory.buildCustomerResponse(requestBody));
    },
  );

  /**
   * Catalogo de metodos de pago de un pais, del que se filtra la lista de bancos.
   *
   * El parametro `country` se acepta y se ignora: el SDK manda siempre `CO` porque
   * PSE no existe fuera de Colombia, y devolver un catalogo distinto por pais seria
   * simular una funcionalidad que el SDK no usa.
   */
  app.get(
    "/v1/sim/rapyd/payment_methods/country",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send(mockFactory.buildPaymentMethodsResponse());
    },
  );
}
