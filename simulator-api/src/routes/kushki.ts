import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/kushki/GatewayMockFactory";
import {
  KushkiChargeResponse,
  KushkiCreateChargeRequestBody,
  KushkiTransferInitRequestBody,
  KushkiTransferStatus,
} from "../gateways/kushki/types";
import {
  getSimulatorScenario,
  ScenarioEngine,
} from "../scenarios/ScenarioEngine";
import {
  kushkiChargeMachine,
  kushkiTransferMachine,
} from "../state/kushkiStateMachine";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { kushkiCharges, kushkiTransfers } from "../store/GatewayStores";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
} from "../store/ScenarioMarks";

/**
 * Router HTTP de Kushki (API de Simulación, issue #65 y #124).
 *
 * Expone:
 * 1. POST /v1/sim/kushki/card/v1/charges: crea un cobro con tarjeta. La ruta lleva el
 *    prefijo `card/v1` porque **es la ruta real**: se midió que `POST /charges`, que es
 *    la que el SDK usaba, responde `403 Forbidden` igual que una ruta inventada.
 * 2. GET /v1/sim/kushki/charges/:ticketNumber: consulta el estado por ticketNumber.
 *    **Esta no tiene equivalente medido**: contra la API real se probaron catorce rutas
 *    candidatas de consulta de cobros con tarjeta y ninguna existe. Se conserva para que
 *    el ejemplo pueda mostrar el ciclo de vida completo, y está declarado en el punto 50.
 * 3-6. El ciclo de Transfer In: `bankList`, emisión del token, `init` y consulta de estado.
 *
 * Punto crítico del cobro con tarjeta, explícito en el issue: un **rechazo** viaja con el
 * mismo código HTTP que una aprobación, y la decisión de éxito o fallo vive únicamente en
 * el estado dentro del cuerpo. Es justo el comportamiento que rompe un adaptador que decide
 * mirando `response.ok`. Lo que cambió es el código: `201` y no `200`, porque es el que
 * responde Kushki al crear.
 *
 * ## Los estados están en tablas, no en esta ruta
 *
 * Ninguna ruta de Kushki decide un estado. Las que se mueven lo hacen con la tabla de
 * `src/state/kushkiStateMachine.ts`, y el caso de `INITIALIZED` es el que hace obvio por
 * qué: el simulador necesita ese estado intermedio para el ciclo de vida, pero el verbo
 * HTTP que lo produce no existe. La tabla lo declara como `PENDING` y lo explica.
 */
export async function kushkiRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  /**
   * Contesta una falla técnica del escenario, si el escenario pide una.
   *
   * Devuelve `undefined` cuando el escenario no es una falla, para que la ruta siga con su
   * flujo normal. Todas las rutas de creación la usan, y esa es la razón: antes cada una
   * repetía su propia cadena de `if`, y la de `/transfer/v1/tokens` —que se escribió
   * después— no tuvo ninguna, así que un `TIMEOUT` pedía un token y recibía `201`. El
   * escenario se aceptaba y se ignoraba, que es el mismo defecto que tenía `/init` con
   * `DECLINED`.
   *
   * Ninguna de estas ramas guarda nada: una falla de transporte no crea ni muta estado, y
   * un error no es un cobro en estado de error.
   */
  function fallaTecnica(
    scenario: string,
    request: FastifyRequest,
    reply: FastifyReply,
  ): FastifyReply | undefined {
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

    return undefined;
  }

  /**
   * Traduce un escenario de negocio al vocabulario de **transferencia** de Kushki.
   *
   * Traducir aquí y no en la tabla es a propósito: `declinedTransaction` y `DECLINED` son
   * el mismo rechazo con dos nombres distintos, y quien sabe cuál corresponde a cuál es el
   * router, no la tabla. Devuelve `undefined` cuando el escenario no fija un desenlace —el
   * por defecto, o uno técnico ya resuelto— para que la tabla use su destino por defecto.
   */
  function destinoDeTransferencia(scenario: string): KushkiTransferStatus | undefined {
    if (scenario === "DECLINED" || scenario === "REJECTED") {
      return "declinedTransaction";
    }

    /*
     * `PENDING` es el caso interesante, y no un alias de "sin escenario".
     *
     * Registra `initializedTransaction` como destino, y el efecto es que la transferencia
     * nunca se acredita: el `init` la deja en ese estado —que es el real mientras el
     * pagador no ha pagado— y cada consulta se la devuelve igual. Es lo que permite
     * ejercitar el caso "el pagador nunca completó la transferencia", que antes solo se
     * podía provocar mandando `PENDING` en la consulta.
     *
     * No es un estado final, pero tampoco tiene salida: el destino registrado es él mismo,
     * así que la transición de la consulta termina en el estado del que salió.
     */
    if (scenario === "PENDING" || scenario === "INITIALIZED") {
      return "initializedTransaction";
    }

    return undefined;
  }

  app.post(
    "/v1/sim/kushki/card/v1/charges",
    async (request: FastifyRequest, reply: FastifyReply) => {
      let scenario = getSimulatorScenario(request);
      const requestBody = request.body as KushkiCreateChargeRequestBody;

      /*
       * Sin token no hay cobro, y el error es el que responde Kushki de verdad.
       *
       * Medido contra `api-uat.kushkipagos.com`: `POST /card/v1/charges` con
       * `token: "simulated-token"` —el literal que el SDK mandaba— responde
       * `400 K001 "Cuerpo de la petición inválido"`. El mock viejo aceptaba cualquier
       * token, así que el defecto era invisible para toda la suite (punto 50).
       */
      if (!requestBody?.token || requestBody.token === "simulated-token") {
        return reply
          .code(400)
          .send({ code: "K001", message: "Cuerpo de la petición inválido." });
      }

      const falla = fallaTecnica(scenario, request, reply);

      if (falla !== undefined) {
        return falla;
      }

      if (scenario === "FLAPPING") {
        const key = requestBody.token;
        if (nextFlappingAttempt(key)) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
        }
        scenario = "APPROVED";
      }

      if (scenario === "DUPLICATE_PAYMENT") {
        const dupKey = `dup_kushki_${requestBody.token}`;
        if (hasDuplicateMark(dupKey)) {
          return reply.code(409).send({
            code: "K409",
            message: `Transacción ya creada con el token '${requestBody.token}'`,
          });
        }
        markDuplicate(dupKey);
        scenario = "APPROVED";
      }

      /*
       * El escenario de negocio se aplica acá, en la creación, y la respuesta sale del
       * estado que la fábrica construyó. Un cobro con tarjeta se resuelve entero en el
       * `POST`: la pasarela aprueba o rechaza antes de responder, así que no hay nada que
       * decidir después.
       *
       * Después se guarda el registro con el estado que ya tiene, para que la consulta
       * pueda moverlo por la tabla en vez de fabricar uno. Antes no había nada guardado:
       * `GET /charges/:ticketNumber` armaba la respuesta de cero, con un monto fijo de
       * 50.000 y un estado que salía de la cabecera de la consulta.
       */
      let charge: KushkiChargeResponse;

      if (scenario === "DECLINED" || scenario === "REJECTED") {
        // HTTP 201 y no 4xx: Kushki nunca usa el status HTTP para señalar
        // un rechazo de negocio.
        charge = mockFactory.buildDeclinedResponse(requestBody);
      } else if (scenario === "EXPIRED") {
        charge = mockFactory.buildExpiredResponse(requestBody);
      } else if (scenario === "INITIALIZED" || scenario === "PENDING") {
        charge = mockFactory.buildInitializedResponse(requestBody);
      } else if (scenario === "APPROVED" || scenario === "APPROVAL") {
        charge = mockFactory.buildApprovedResponse(requestBody);
      } else {
        return reply
          .code(501)
          .send({ error: `Escenario aún no soportado: ${scenario}` });
      }

      kushkiCharges.save(charge.ticketNumber, charge);

      return reply.code(201).send(charge);
    },
  );

  app.get(
    "/v1/sim/kushki/charges/:ticketNumber",
    async (
      request: FastifyRequest<{ Params: { ticketNumber: string } }>,
      reply: FastifyReply,
    ) => {
      const { ticketNumber } = request.params;

      /*
       * Un token de transferencia consultado acá no existe, y hay que decirlo con
       * un 404.
       *
       * Importa para que el flujo de PSE se pueda probar de punta a punta: el
       * adaptador no sabe distinguir un token de transferencia de un ticket de
       * tarjeta —Kushki no publica cómo—, así que intenta esta ruta primero y pasa a
       * la de tarjeta solo si la de transferencia dice que no conoce el identificador.
       * Si el mock contestara 200 a cualquier identificador, la consulta de una
       * transferencia devolvería datos de un cobro con tarjeta.
       *
       * La regla de los 32 caracteres hexadecimales vive acá y no en el SDK a
       * propósito: **el mock es el que emite los dos identificadores**, así que sabe
       * cuál es cuál. El SDK no lo sabe y no debe inventarlo.
       */
      if (/^[0-9a-f]{32}$/.test(ticketNumber)) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const charge = kushkiCharges.findById(ticketNumber);

      if (charge === undefined) {
        return reply.code(404).send({
          code: "K404",
          message: "Transacción no encontrada",
        });
      }

      /*
       * La tabla mueve el cobro y la ruta guarda lo que se movió.
       *
       * La consulta no recibe un escenario de negocio: el desenlace ya lo decidió la
       * creación. Si lo recibiera, un `APPROVED` en la cabecera reportaría como cobrado
       * un cobro que el comercio pidió declinado, y el mismo cobro sería aprobado y
       * declinado según quién preguntara. Un estado que depende de la pregunta no es un
       * estado.
       *
       * Tampoco hay falla técnica: el cobro ya existe, así que una falla al consultarlo no
       * lo deshace, y simular un 504 acá devolvería un error donde la pasarela real
       * devolvería el cobro.
       */
      const movido = kushkiChargeMachine.transition(charge, "query");

      if (movido !== charge) {
        kushkiCharges.save(ticketNumber, movido);
      }

      return reply.code(200).send(movido);
    },
  );

  /**
   * Lista de bancos de PSE. Es el paso 1 de Transfer In y en Colombia **no es
   * opcional**: la referencia de Kushki dice que el endpoint es obligatorio para
   * este metodo de pago, porque el `bankId` del token tiene que venir de aca.
   */
  app.get(
    "/v1/sim/kushki/transfer/v1/bankList",
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send(mockFactory.buildBankList());
    },
  );

  /**
   * Token de transferencia, el paso 2.
   *
   * Aca es donde viaja la URL de retorno del comercio (`callbackUrl`), y no en el
   * cobro: es el unico caso de las cuatro pasarelas donde eso pasa. El mock exige
   * los dos campos sin los que el paso no tendria sentido, para que una prueba note
   * si el adaptador dejara de mandarlos.
   *
   * Esta es la creación de la transferencia, y por eso es acá donde el escenario queda
   * registrado: es la primera de las tres llamadas del ciclo, y las otras dos ya no
   * pueden decidir el desenlace.
   */
  app.post(
    "/v1/sim/kushki/transfer/v1/tokens",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scenario = getSimulatorScenario(request);
      const body = request.body as { bankId?: string; callbackUrl?: string };

      const falla = fallaTecnica(scenario, request, reply);

      if (falla !== undefined) {
        return falla;
      }

      if (!body?.bankId) {
        return reply.code(400).send({ code: "T001", message: "bankId es obligatorio" });
      }
      if (!body?.callbackUrl) {
        return reply.code(400).send({ code: "T002", message: "callbackUrl es obligatorio" });
      }

      const { token } = mockFactory.buildTransferToken();

      kushkiTransfers.save(
        token,
        mockFactory.buildTransferSeed(token, {
          bankId: body.bankId,
          callbackUrl: body.callbackUrl,
        }),
      );

      /*
       * El escenario se registra acá, en la creación, y la consulta lo aplica. Es el
       * orden que exige el issue #124: la creación decide el desenlace y el resto del
       * flujo solo lo ejecuta.
       *
       * Antes ninguna de las tres rutas de transferencia leía el escenario, así que un
       * `DECLINED` pedía un PSE de Kushki y la consulta respondía
       * `approvedTransaction`: el escenario se aceptaba con `201` y se ignoraba. Por eso
       * `declinedTransaction` era un estado que ninguna prueba podía alcanzar.
       *
       * Los escenarios técnicos se resuelven antes de llegar acá y no registran nada: una
       * falla técnica no crea ni muta estado, y esta transferencia no llegó a existir.
       */
      const destino = destinoDeTransferencia(scenario);

      if (destino !== undefined) {
        rememberScenarioTarget("kushki", "transfer", token, destino);
      }

      return reply.code(201).send({ token });
    },
  );

  /** Inicio de la transferencia, el paso 3. Devuelve la URL de redireccion. */
  app.post(
    "/v1/sim/kushki/transfer/v1/init",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scenario = getSimulatorScenario(request);
      const body = request.body as KushkiTransferInitRequestBody;

      const falla = fallaTecnica(scenario, request, reply);

      if (falla !== undefined) {
        return falla;
      }

      if (!body?.token) {
        return reply.code(400).send({ code: "T001", message: "Cuerpo de la petición inválido." });
      }

      /*
       * El monto es obligatorio acá, aunque ya viajó al pedir el token y Kushki lo
       * tenga guardado. Medido: `{ token }` a secas responde 400 T001 y
       * `{ token, amount }` responde 201. El mock lo exige para que una prueba note si
       * el adaptador dejara de repetirlo.
       */
      if (!body?.amount) {
        return reply.code(400).send({ code: "T001", message: "Cuerpo de la petición inválido." });
      }

      const transfer = kushkiTransfers.findById(body.token);

      if (transfer === undefined) {
        return reply
          .code(404)
          .send({ code: "T004", message: "Transferencia no encontrada" });
      }

      /*
       * `pay` y no `query`: es la acción que pone en marcha el cobro, no una lectura de
       * su estado. La respuesta medida del `init` no trae campo de estado, así que este
       * movimiento no se ve por la API —queda entre el `init` y la primera consulta— y
       * queda anotado en la tabla en vez de inventarse una segunda consulta que la API
       * real tampoco tiene.
       *
       * El monto del `init` es el que se guarda: el que vino en el token era una
       * estimación y el comercio lo repite acá, y la respuesta de estado tiene que
       * reportar el que se cobró.
       */
      const movida = kushkiTransferMachine.transition(
        { ...transfer, amount: body.amount },
        "pay",
      );

      kushkiTransfers.save(body.token, movida);

      return reply.code(201).send(mockFactory.buildTransferInit(body.token));
    },
  );

  /**
   * Consulta de estado de una transferencia.
   *
   * Es una ruta distinta de la de tarjeta, y esa es exactamente la razon por la que
   * el adaptador consulta las dos en orden: Kushki no publica como distinguir un
   * token de transferencia de un ticket de tarjeta.
   */
  app.get(
    "/v1/sim/kushki/transfer/v1/status/:token",
    async (
      request: FastifyRequest<{ Params: { token: string } }>,
      reply: FastifyReply,
    ) => {
      const { token } = request.params;

      /*
       * Un ticket de tarjeta consultado acá no es una transferencia, y hay que decirlo.
       *
       * Es la contraparte del 403 que ya daba la ruta de tarjeta ante un token de
       * transferencia, y hace falta por lo mismo: el adaptador prueba las dos rutas en
       * orden, y si esta contestara a cualquier identificador, un cobro con tarjeta se
       * reportaría con el vocabulario de transferencia —`approvedTransaction` en vez de
       * `APPROVAL`— y el orden de las rutas nunca se ejercitaría. Se distinguen por su
       * forma: el token de transferencia son 32 hex y el ticket de tarjeta son 18.
       */
      if (!/^[0-9a-f]{32}$/.test(token)) {
        return reply
          .code(404)
          .send({ code: "T004", message: "Transferencia no encontrada" });
      }

      const transfer = kushkiTransfers.findById(token);

      if (transfer === undefined) {
        return reply
          .code(404)
          .send({ code: "T004", message: "Transferencia no encontrada" });
      }

      /*
       * La tabla mueve la transferencia y la ruta guarda lo que se movió.
       *
       * Acá es donde el tiempo pasa: la primera consulta cierra la transferencia con el
       * desenlace que registró la creación, y la segunda se la devuelve igual, porque
       * `approvedTransaction` y `declinedTransaction` no tienen salida. Ese es el
       * criterio 1 del issue aplicado a Kushki.
       */
      const movida = kushkiTransferMachine.transition(transfer, "query");

      if (movida !== transfer) {
        kushkiTransfers.save(token, movida);
      }

      return reply.code(200).send(movida);
    },
  );
}