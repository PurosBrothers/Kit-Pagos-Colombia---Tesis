import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/rapyd/GatewayMockFactory";
import {
  RapydCreateCheckoutRequestBody,
  RapydCreateCustomerRequestBody,
  RapydCreatePaymentRequestBody,
} from "../gateways/rapyd/types";
import { randomUUID } from "node:crypto";
import { invalidCredentialRequested } from "../scenarios/invalidCredential";
import { resolveScenario, wholePesosFromDecimal } from "../scenarios/scenarioFromRequest";
import { bankListFailure, queryFailure, technicalFailure } from "../scenarios/technicalFailure";
import {
  rapydCheckoutMachine,
  rapydPaymentMachine,
} from "../state/rapydStateMachine";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { requestOrigin } from "../store/BankRedirectOrigins";
import { rapydCheckouts, rapydPayments } from "../store/GatewayStores";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
  rememberQueryFailure,
} from "../store/ScenarioMarks";

const DEFAULT_SCENARIO = "APPROVED";

/**
 * El cuerpo de `MALFORMED_BODY`: el sobre de éxito de Rapyd sin los campos de `data`.
 *
 * Nivel 3 — decisión del simulador. No imita una respuesta medida: existe para que el
 * normalizador del SDK encuentre un `200` sin `data.id` (issue #122).
 */
const MALFORMED_BODY = {
  status: {
    status: "SUCCESS",
    error_code: "",
    message: "",
    response_code: "",
    operation_id: "",
  },
  data: {},
} as const;

/** El cuerpo de Rapyd ante una página de pago que no existe; la fuente está en `GET /v1/checkout/:id`. */
const HOSTED_PAGE_NOT_FOUND = {
  status: {
    error_code: "ERROR_GET_HOSTED_PAGE_PAYMENT",
    status: "ERROR",
    message:
      "The request tried to retrieve a hosted page, but the page was not found. " +
      "The request was rejected. Corrective action: Use the ID of a valid hosted page.",
    response_code: "ERROR_GET_HOSTED_PAGE_PAYMENT",
    operation_id: "",
  },
} as const;

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
 * fabrica y resuelve el escenario aquí, sin pasar por `ScenarioEngine`. Ese
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
 * envia, pero validarlos aquí requiere la clase `SignatureGenerator` que
 * `layers-and-components.md` marca como pendiente en la API de Simulacion. Sin
 * eso, un adaptador que calcule mal la firma pasaria igual contra el mock: por
 * eso la correccion de la firma se cubre con pruebas unitarias del adaptador
 * contra el vector de la documentacion oficial, y no confiando en el mock.
 * 5. `GET  /v1/sim/rapyd/checkout/:checkoutId/pagar` — la visita del pagador a la pagina.
 */
/**
 * El rechazo de un `access_key` desconocido.
 *
 * Nivel 1 — medido contra `sandboxapi.rapyd.net` el 6 de octubre de 2026
 * (`docs/testing-data/rapyd.md`, sección 1, «Credenciales inválidas»): `401` con este cuerpo y
 * un `operation_id` nuevo en cada respuesta. Medido en `GET /v1/payment_methods/country` y,
 * entre las 14:05 y las 14:12, en `POST /v1/checkout`, `GET /v1/checkout/{id existente}` y
 * `GET /v1/payments/{id}`, exista o no el recurso. `POST /v1/payments` y `POST /v1/customers`
 * no se midieron y reciben el mismo cuerpo.
 */
function unauthenticatedApiCall() {
  return {
    status: {
      error_code: "UNAUTHENTICATED_API_CALL",
      status: "ERROR",
      message:
        "The request was rejected due to an authentication issue. Corrective action: Check the status of your account in the 'Account Details' page of the Client Portal.",
      response_code: "UNAUTHENTICATED_API_CALL",
      operation_id: randomUUID(),
    },
  };
}

export async function rapydRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  /*
   * Todas las rutas de la API de Rapyd revisan la llave antes que el cuerpo, porque la firma
   * se verifica sobre la petición entera. El orden frente a las validaciones del cuerpo no se
   * midió. La página `/pagar` queda fuera: es del simulador y el pagador no manda llaves.
   */
  const API_ROUTES = new Set([
    "/v1/sim/rapyd/payments",
    "/v1/sim/rapyd/payments/:paymentId",
    "/v1/sim/rapyd/checkout",
    "/v1/sim/rapyd/checkout/:checkoutId",
    "/v1/sim/rapyd/customers",
    "/v1/sim/rapyd/payment_methods/country",
  ]);

  app.addHook("preHandler", async (request, reply) => {
    if (API_ROUTES.has(request.routeOptions.url ?? "") && invalidCredentialRequested(request, ["access_key"])) {
      return reply.code(401).send(unauthenticatedApiCall());
    }
  });

  app.post(
    "/v1/sim/rapyd/payments",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const requestBody = request.body as RapydCreatePaymentRequestBody;
      const resolved = resolveScenario(request, {
        wholePesos: wholePesosFromDecimal(requestBody?.amount),
      });
      let scenario = resolved.scenario;

      const failure = await technicalFailure(scenario, request, reply, mockFactory, MALFORMED_BODY);

      if (failure !== undefined) {
        return failure;
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

      // La falla de consulta que pidió el monto se ata al pago recién guardado.
      const rememberFailure = (paymentId: string): void => {
        if (resolved.queryFailure !== undefined) {
          rememberQueryFailure("rapyd", "payment", paymentId, resolved.queryFailure);
        }
      };

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

      // PSE se reconoce por el prefijo del metodo de pago, que en Rapyd son 47
      // tipos `co_pse_{banco}_bank` en vez de un metodo con un campo de banco.
      const methodType = (requestBody.payment_method as { type?: unknown })?.type;
      const isPse =
        typeof methodType === "string" && methodType.startsWith("co_pse_");

      /*
       * `PENDING` solo existe para PSE, que es el único pago de esta ruta que nace sin
       * resolver. Con tarjeta el pago nace cerrado, y un pendiente sería un estado que nadie
       * midió en ese camino.
       */
      const wantsPending = scenario === "PENDING" && isPse;

      if (
        scenario !== DEFAULT_SCENARIO &&
        scenario !== "APPROVED" &&
        scenario !== "APPROVAL" &&
        !wantsPending
      ) {
        return reply
          .code(501)
          .send({ error: `Escenario aun no soportado: ${scenario}` });
      }

      if (isPse) {
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
         * tabla cuando el comercio consulta, salvo que la creación haya pedido que siga
         * pendiente.
         */
        const pse = mockFactory.buildPseCreatedResponse(requestBody);
        rapydPayments.save(pse.data.id, pse.data);
        rememberFailure(pse.data.id);

        if (wantsPending) {
          rememberScenarioTarget("rapyd", "payment", pse.data.id, "ACT");
        }

        return reply.code(201).send(pse);
      }

      const approved = mockFactory.buildApprovedResponse(requestBody);
      rapydPayments.save(approved.data.id, approved.data);
      rememberFailure(approved.data.id);

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

      const resolved = resolveScenario(request, {
        wholePesos: wholePesosFromDecimal(requestBody.amount),
      });
      let scenario = resolved.scenario;

      const failure = await technicalFailure(scenario, request, reply, mockFactory, MALFORMED_BODY);

      if (failure !== undefined) {
        return failure;
      }

      /*
       * El monto 10101 pide el pendiente nativo de este camino: la página que nadie visitó
       * se queda en `NEW` (nivel 1, medido). Con la cabecera `PENDING` la ruta sigue
       * respondiendo `501`, como antes del issue #122, porque esa prueba existe y no cambia.
       */
      if (resolved.source === "amount" && scenario === "PENDING") {
        scenario = DEFAULT_SCENARIO;
      }

      // La misma falla transitoria que en `POST /payments`: dos `503` y después la página.
      // Antes respondía `501`; ninguna prueba lo fijaba y el camino de tarjeta de Rapyd era
      // el único de creación sin reintento ejercitable (issue #122).
      if (scenario === "FLAPPING") {
        const key = `rapyd_checkout_${requestBody.merchant_reference_id ?? "flapping"}`;
        if (nextFlappingAttempt(key)) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
        }
        scenario = DEFAULT_SCENARIO;
      }

      const wantsDecline = scenario === "DECLINED" || scenario === "REJECTED";

      /*
       * Solo el aprobado y el rechazo tienen un desenlace en este camino.
       *
       * Un checkout pendiente no necesita escenario: es el que nadie visitó, y se queda en
       * `NEW` (medido). Para `EXPIRED` no hay medición de cómo termina una página vencida, y
       * aceptarlo sin aplicarlo dejaría pagar la página igual. Responder 501 hace ruido en
       * vez de cobrar lo que se pidió que fallara.
       */
      if (
        scenario !== DEFAULT_SCENARIO &&
        scenario !== "APPROVAL" &&
        !wantsDecline
      ) {
        return reply
          .code(501)
          .send({ error: `Escenario aun no soportado: ${scenario}` });
      }

      // 200 y no 201: se midió que Rapyd responde 200 al crear una página de pago, a
      // diferencia de `POST /v1/payments`, que responde 201. La misma API usa los dos.
      const created = mockFactory.buildCheckoutCreatedResponse(
        requestBody,
        requestOrigin(request),
      );
      rapydCheckouts.save(created.data.id, created.data);

      /*
       * El rechazo se registra aquí y lo aplica la visita a la página, que es donde nace el
       * pago. La página se crea igual, porque en Rapyd la tarjeta se escribe en ella: el
       * rechazo solo puede ocurrir después.
       */
      if (wantsDecline) {
        rememberScenarioTarget("rapyd", "checkout", created.data.id, "ERR");
      }

      if (resolved.queryFailure !== undefined) {
        rememberQueryFailure("rapyd", "checkout", created.data.id, resolved.queryFailure);
      }

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

      /*
       * Nivel 1 — medido contra `sandboxapi.rapyd.net` el 5 de octubre de 2026:
       * `GET /v1/checkout/checkout_<32 hex>` inexistente responde `400` con
       * `ERROR_GET_HOSTED_PAGE_PAYMENT`. El código que tenía el simulador,
       * `ERROR_GET_CHECKOUT_PAGE`, no era el de Rapyd. La medición registró el comienzo del
       * mensaje; el texto completo es el del ejemplo de la documentación oficial
       * (https://docs.rapyd.net/en/retrieve-checkout-page.html, consultada el 5 de octubre
       * de 2026), que empieza igual.
       */
      if (!checkout) {
        return reply.code(400).send(HOSTED_PAGE_NOT_FOUND);
      }

      const failure = await queryFailure(
        { gateway: "rapyd", resource: "checkout", id: checkoutId },
        reply,
        mockFactory,
      );
      if (failure !== undefined) {
        return failure;
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

      // Esta página es del simulador y no de la API de Rapyd: el 404 es una decisión del
      // simulador (nivel 3). El cuerpo es el que Rapyd responde por una página
      // inexistente, para no tener dos códigos para el mismo caso.
      if (!checkout) {
        return reply.code(404).send(HOSTED_PAGE_NOT_FOUND);
      }

      /*
       * `pay` y no `query`: esta es la visita del pagador, no una lectura.
       *
       * La tabla decide que un checkout en `NEW` pasa a `DON` y que de paso nazca el pago.
       * El método `payCheckout` de la fábrica hacía exactamente eso, y por eso se borró: dos
       * copias de la misma regla —una en la tabla y otra en la fábrica— son dos lugares que
       * pueden discrepar, y ya discrepaban. La diferencia real con Wompi sigue en pie y es
       * intencionada: aquí el simulador representa la visita a la página; en Wompi avanza por
       * consultas porque la URL del banco es un destino externo que no puede servir.
       */
      const paidCheckout = rapydCheckoutMachine.transition(checkout, "pay");

      if (paidCheckout !== checkout) {
        rapydCheckouts.save(checkoutId, paidCheckout);

        /*
         * El pago que acaba de nacer también es un registro consultable.
         *
         * Rapyd guarda el checkout y el pago en recursos distintos, y esa separación es real:
         * el adaptador elige la ruta de consulta por el prefijo del identificador, y un id
         * de checkout en `/payments/{id}` responde `400 ERROR_GET_PAYMENT` contra la API
         * real. Guardar el pago solo dentro del checkout hacía que, una vez consultado el
         * checkout y devuelto el pago como identificador de la transacción, la segunda
         * consulta pidiera `/payments/payment_...` y no encontrara nada.
         *
         * Antes no se notaba porque `buildStatusResponse` respondía cualquier identificador
         * con un pago inventado. El detalle de que el pago consultable sea el que nació
         * dentro del checkout, y no el que se crea con `POST /payments`, es lo que hace que
         * el flujo de tarjeta de Rapyd tenga la misma forma de ciclo de vida que el de PSE.
         */
        const checkoutPayment = mockFactory.buildPaymentFromCheckout(paidCheckout);

        if (checkoutPayment !== undefined) {
          rapydPayments.save(checkoutPayment.id, checkoutPayment);
        }
      }

      return reply
        .code(200)
        .send({ paid: paidCheckout.payment.paid === true, payment_id: paidCheckout.payment.id });
    },
  );

  app.get(
    "/v1/sim/rapyd/payments/:paymentId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { paymentId } = request.params as { paymentId: string };

      /*
       * La consulta responde el pago que existe, no uno armado aquí.
       *
       * Antes `buildStatusResponse` devolvía siempre `CLO`, `paid: true`, `amount: "0"` y
       * la referencia vacía, para cualquier identificador. Eso hacía pasar por aprobado un
       * pago que no existía y, cuando sí existía, escondía su monto y su referencia: el
       * comercio no podía conciliar contra nada. Un pago que se declinó además se reportaba
       * cobrado, porque el método no miraba el estado guardado.
       *
       * La tabla mueve `ACT` a `CLO`, salvo que la creación haya pedido que siga pendiente,
       * y un pago ya final se devuelve como está. Que el escenario de la consulta no
       * intervenga es el criterio 1 del issue: el desenlace lo fijó la creación.
       */
      const payment = rapydPayments.findById(paymentId);

      /*
       * Un pago que no existe responde `400`, no `404`.
       *
       * Nivel 1 — medido contra el sandbox el 5 de octubre de 2026: `GET
       * /v1/payments/payment_<32 hex>` inexistente responde `400 ERROR_GET_PAYMENT` con
       * este mensaje, el mismo del ejemplo «Payment Not Found» de la documentación oficial
       * (https://docs.rapyd.net/en/retrieve-payment.html). El SDK lo traduce a
       * INVALID_REQUEST y no a RESOURCE_NOT_FOUND, que es lo mismo que va a recibir contra
       * Rapyd real.
       */
      if (!payment) {
        return reply.code(400).send({
          status: {
            error_code: "ERROR_GET_PAYMENT",
            status: "ERROR",
            message:
              "The request tried to retrieve a payment, but the payment was not found. " +
              "The request was rejected. Corrective action: Use a valid payment ID.",
            response_code: "ERROR_GET_PAYMENT",
            operation_id: "",
          },
        });
      }

      const failure = await queryFailure(
        { gateway: "rapyd", resource: "payment", id: paymentId },
        reply,
        mockFactory,
      );
      if (failure !== undefined) {
        return failure;
      }

      const moved = rapydPaymentMachine.transition(payment, "query");

      if (moved !== payment) {
        rapydPayments.save(paymentId, moved);
      }

      return reply.code(200).send({
        status: {
          status: "SUCCESS",
          error_code: "",
          message: "",
          response_code: "",
          operation_id: "",
        },
        data: moved,
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
    async (request: FastifyRequest, reply: FastifyReply) => {
      const failure = bankListFailure(request, reply, mockFactory, "rapyd");
      if (failure !== undefined) {
        return failure;
      }

      return reply.code(200).send(mockFactory.buildPaymentMethodsResponse());
    },
  );
}
