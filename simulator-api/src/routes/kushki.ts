import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/kushki/GatewayMockFactory";
import {
  KushkiChargeResponse,
  KushkiCreateChargeRequestBody,
  KushkiTransferInitRequestBody,
  KushkiTransferStatus,
  KushkiTransferTokenRequestBody,
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
 * `src/state/kushkiStateMachine.ts`. El cobro con tarjeta `INITIALIZED` no se mueve: el
 * simulador necesita ese estado intermedio para el ciclo de vida, pero no hay fuente de
 * cómo termina, así que la tabla lo declara sin salida y lo explica.
 */

/** Las dos respuestas de Transfer In ante un identificador que no sirve, medidas el 5 de octubre de 2026. */
const INVALID_BODY = { code: "T001", message: "Cuerpo de la petición inválido." } as const;
const TRANSFER_NOT_FOUND = { code: "T004", message: "No existe la transacción" } as const;

/** Los escenarios de negocio que una transferencia sabe producir al emitir su token. */
const TRANSFER_SCENARIOS: ReadonlySet<string> = new Set([
  "APPROVED",
  "APPROVAL",
  "DECLINED",
  "REJECTED",
  "PENDING",
  "INITIALIZED",
]);

/**
 * Kushki solo busca la transferencia si el identificador tiene 32 caracteres; con
 * cualquier otra longitud responde `T001` sin buscarla (medido el 5 de octubre de 2026).
 */
function hasTransferIdLength(id: string): boolean {
  return id.length === 32;
}

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
  function technicalFailure(
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
  function transferTargetFor(scenario: string): KushkiTransferStatus | undefined {
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

      const failure = technicalFailure(scenario, request, reply);

      if (failure !== undefined) {
        return failure;
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
       * El escenario de negocio se aplica aquí, en la creación, y la respuesta sale del
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
       * un error.
       *
       * Importa para que el flujo de PSE se pueda probar de punta a punta: el
       * adaptador no sabe distinguir un token de transferencia de un ticket de
       * tarjeta —Kushki no publica cómo—, así que intenta esta ruta primero y pasa a
       * la de tarjeta solo si la de transferencia dice que no conoce el identificador.
       * Si el mock contestara 200 a cualquier identificador, la consulta de una
       * transferencia devolvería datos de un cobro con tarjeta.
       *
       * Responde **403** y no 404 porque es lo que mide la API real: `GET /charges/{id}`
       * en Kushki contesta `403 Forbidden` para cualquier identificador, igual que una
       * ruta que no existe. El mock reproduce eso para que se vea que por esta ruta no
       * se puede encadenar nada, que es la razón por la que la de transferencia va
       * primero (punto 48 del architecture-log).
       *
       * La regla de los 32 caracteres hexadecimales vive acá y no en el SDK a
       * propósito: **el mock es el que emite los dos identificadores**, así que sabe
       * cuál es cuál. El SDK no lo sabe y no debe inventarlo.
       */
      if (/^[0-9a-f]{32}$/.test(ticketNumber)) {
        return reply.code(403).send({ message: "Forbidden" });
      }

      const charge = kushkiCharges.findById(ticketNumber);

      /*
       * Nivel 3 — decisión del simulador. Esta ruta no existe en Kushki (ver el
       * encabezado), así que no hay respuesta real que imitar para un ticket que no se
       * creó: `K404` es un código propio del simulador, no de la pasarela. Se queda en 404
       * porque el SDK lo traduce a `RESOURCE_NOT_FOUND`, que es lo que pasó.
       */
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
       * lo deshace, y simular un 504 aquí devolvería un error donde la pasarela real
       * devolvería el cobro.
       */
      const moved = kushkiChargeMachine.transition(charge, "query");

      if (moved !== charge) {
        kushkiCharges.save(ticketNumber, moved);
      }

      return reply.code(200).send(moved);
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
   * Esta es la creación de la transferencia, y por eso es aquí donde el escenario queda
   * registrado: es la primera de las tres llamadas del ciclo, y las otras dos ya no
   * pueden decidir el desenlace.
   */
  app.post(
    "/v1/sim/kushki/transfer/v1/tokens",
    async (request: FastifyRequest, reply: FastifyReply) => {
      let scenario = getSimulatorScenario(request);
      const body = request.body as KushkiTransferTokenRequestBody | undefined;

      const failure = technicalFailure(scenario, request, reply);

      if (failure !== undefined) {
        return failure;
      }

      if (!body?.bankId) {
        return reply.code(400).send({ code: "T001", message: "bankId es obligatorio" });
      }
      if (!body?.callbackUrl) {
        return reply.code(400).send({ code: "T002", message: "callbackUrl es obligatorio" });
      }

      /*
       * Una transferencia vencida no tiene estado colombiano que la represente.
       * `expiredTransaction` existe en la referencia de Kushki, pero «solo aplica a
       * México» (`docs/testing-data/kushki.md`, línea 369). Antes `EXPIRED` no registraba
       * destino y la transferencia terminaba `approvedTransaction`: un PSE vencido
       * reportado como cobrado. Se rechaza antes de emitir el token, así que no queda
       * nada guardado.
       */
      if (scenario === "EXPIRED") {
        return reply.code(501).send({
          error:
            "Escenario aún no soportado: EXPIRED. Kushki no tiene un estado de transferencia vencida para Colombia.",
        });
      }

      // Igual que en el cobro con tarjeta: falla la primera petición y la siguiente con la
      // misma referencia emite el token. Es una falla de transporte, así que no guarda nada.
      if (scenario === "FLAPPING") {
        const key = `kushki_transfer_${body.paymentDescription ?? body.bankId}`;
        if (nextFlappingAttempt(key)) {
          return reply.code(503).send(mockFactory.buildServerErrorResponse(503));
        }
        scenario = "APPROVED";
      }

      /*
       * Un escenario que la transferencia no sabe producir responde `501` antes de emitir
       * el token, como en las demás rutas de creación. Antes `FLAPPING`, `DUPLICATE_PAYMENT`
       * o un nombre inventado se aceptaban con `201` y la transferencia terminaba
       * `approvedTransaction`. `DUPLICATE_PAYMENT` no se imita aquí porque el `409` del cobro
       * con tarjeta es un código del simulador y no hay medición para Transfer In.
       */
      if (!TRANSFER_SCENARIOS.has(scenario)) {
        return reply
          .code(501)
          .send({ error: `Escenario aún no soportado: ${scenario}` });
      }

      const { token } = mockFactory.buildTransferToken();

      kushkiTransfers.save(
        token,
        mockFactory.buildTransferSeed(token, body),
      );

      /*
       * El escenario se registra aquí, en la creación, y la consulta lo aplica. Es el
       * orden que exige el issue #124: la creación decide el desenlace y el resto del
       * flujo solo lo ejecuta.
       *
       * Antes las dos rutas que crean la transferencia (token e `init`) ignoraban el
       * escenario, así que un `DECLINED` pedía un PSE de Kushki, recibía `201` y la
       * consulta sin cabecera respondía `approvedTransaction`. Solo se llegaba a
       * `declinedTransaction` enviando el escenario en la consulta.
       *
       * Los escenarios técnicos se resuelven antes de llegar aquí y no registran nada: una
       * falla técnica no crea ni muta estado, y esta transferencia no llegó a existir.
       */
      const target = transferTargetFor(scenario);

      if (target !== undefined) {
        rememberScenarioTarget("kushki", "transfer", token, target);
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

      const failure = technicalFailure(scenario, request, reply);

      if (failure !== undefined) {
        return failure;
      }

      /*
       * El monto es obligatorio acá, aunque ya viajó al pedir el token y Kushki lo
       * tenga guardado. Medido: `{ token }` a secas responde 400 T001 y
       * `{ token, amount }` responde 201. El mock lo exige para que una prueba note si
       * el adaptador dejara de repetirlo.
       *
       * Nivel 1 — medido contra `api-uat.kushkipagos.com` el 5 de octubre de 2026: Kushki
       * valida el cuerpo antes que la existencia. Un token que no tiene 32 caracteres
       * (`"abc123"`) o un cuerpo sin `amount` responden `400 T001`, aunque el token no
       * exista.
       */
      if (!body?.token || !body?.amount || !hasTransferIdLength(body.token)) {
        return reply.code(400).send(INVALID_BODY);
      }

      const transfer = kushkiTransfers.findById(body.token);

      /*
       * Nivel 1 — medido el 5 de octubre de 2026: `{ token, amount }` con un token de 32
       * caracteres que Kushki no emitió responde `400 T004 "No existe la transacción"`.
       */
      if (transfer === undefined) {
        return reply.code(400).send(TRANSFER_NOT_FOUND);
      }

      /*
       * `pay` y no `query`: es la acción que pone en marcha el cobro, no una lectura de
       * su estado. La respuesta medida del `init` no trae campo de estado, así que este
       * movimiento no se ve por la API —queda entre el `init` y la primera consulta— y
       * queda anotado en la tabla en vez de inventarse una segunda consulta que la API
       * real tampoco tiene.
       *
       * El monto del `init` es el que se guarda: el que vino en el token era una
       * estimación y el comercio lo repite aquí, y la respuesta de estado tiene que
       * reportar el que se cobró.
       */
      const moved = kushkiTransferMachine.transition(
        { ...transfer, amount: body.amount },
        "pay",
      );

      kushkiTransfers.save(body.token, moved);

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
       * `APPROVAL`— y el orden de las rutas nunca se ejercitaría.
       *
       * Nivel 1 — medido contra `api-uat.kushkipagos.com` el 5 de octubre de 2026: lo que
       * decide la respuesta es la longitud. Un identificador de exactamente 32
       * caracteres —hexadecimal o no, en mayúsculas o minúsculas— que no existe responde
       * `400 T004 "No existe la transacción"`; uno de cualquier otra longitud (6, 18, 31,
       * 33 y 36 medidos) responde `400 T001 "Cuerpo de la petición inválido."`. El ticket
       * de tarjeta tiene 18 caracteres, así que cae en `T001`. El SDK traduce los dos a
       * `INVALID_REQUEST`, y `isUnknownToRoute()` acepta ese código para pasar a la ruta
       * de tarjeta.
       */
      if (!hasTransferIdLength(token)) {
        return reply.code(400).send(INVALID_BODY);
      }

      const transfer = kushkiTransfers.findById(token);

      if (transfer === undefined) {
        return reply.code(400).send(TRANSFER_NOT_FOUND);
      }

      /*
       * La tabla mueve la transferencia y la ruta guarda lo que se movió.
       *
       * Aquí es donde el tiempo pasa: la primera consulta cierra la transferencia con el
       * desenlace que registró la creación, y la segunda se la devuelve igual, porque
       * `approvedTransaction` y `declinedTransaction` no tienen salida. Ese es el
       * criterio 1 del issue aplicado a Kushki.
       */
      const moved = kushkiTransferMachine.transition(transfer, "query");

      if (moved !== transfer) {
        kushkiTransfers.save(token, moved);
      }

      return reply.code(200).send(moved);
    },
  );
}