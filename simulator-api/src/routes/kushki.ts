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
  headerScenario,
  resolveScenario,
  wholePesosFromKushkiAmount,
} from "../scenarios/scenarioFromRequest";
import { bankListFailure, queryFailure, technicalFailure } from "../scenarios/technicalFailure";
import { invalidCredentialRequested } from "../scenarios/invalidCredential";
import {
  kushkiChargeMachine,
  kushkiTransferMachine,
} from "../state/kushkiStateMachine";
import { rememberScenarioTarget } from "../state/scenarioTarget";
import { kushkiCharges, kushkiTransfers } from "../store/GatewayStores";
import { rememberTraceabilityCode } from "../store/TransferTraceability";
import {
  hasDuplicateMark,
  markDuplicate,
  nextFlappingAttempt,
  rememberQueryFailure,
} from "../store/ScenarioMarks";

/**
 * El desenlace que fuerza el número de documento del pagador en Transfer In (issue #122).
 *
 * Nivel 3 — documentación del sandbox, `docs/testing-data/kushki.md`, líneas 365 a 370. Lo
 * medido el 18 de septiembre de 2026 es solo el comienzo: con los cuatro documentos la
 * transferencia pasa de `requestedToken` a `initializedTransaction`, y el desenlace llega
 * cuando alguien autoriza en el banco, que no se midió. «Cualquier otro número» termina
 * `Failed` según la misma tabla; el simulador no lo imita para no cambiar los cobros que ya
 * usan otros documentos.
 */
/*
 * Credencial inválida. Nivel 1 — medido contra `api-uat.kushkipagos.com` el 6 de octubre de
 * 2026 (`docs/testing-data/kushki.md`, sección 1.2), con llaves inexistentes de 32 caracteres.
 *
 * Las rutas de transferencia responden el `403` de AWS API Gateway, con `Message` en
 * mayúscula y sin `code`. Medido en `bankList` y `tokens` (`Public-Merchant-Id`) y en `init`
 * y `status` (`Private-Merchant-Id`); `init`, con un token válido. Se revisa antes que todo
 * lo demás de la ruta; que gane también sobre un cuerpo inválido no se midió.
 *
 * El cobro con tarjeta responde `400 K004`, y lo revisa antes que el cuerpo: con la llave
 * inválida y un token mal formado respondió `K004`, y con la llave válida, `K001`.
 */
const TRANSFER_UNAUTHORIZED = {
  Message:
    "User is not authorized to access this resource because no identity-based policy allows the execute-api:Invoke action",
} as const;

const CARD_INVALID_CREDENTIAL = {
  message: "ID de comercio o credencial no válido",
  code: "K004",
} as const;

const DOCUMENT_OUTCOMES: ReadonlyMap<string, string> = new Map([
  ["123456789", "APPROVED"],
  ["999999990", "PENDING"],
  ["100000002", "DECLINED"],
]);

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
      if (invalidCredentialRequested(request, ["private-merchant-id"])) {
        return reply.code(400).send(CARD_INVALID_CREDENTIAL);
      }

      const requestBody = request.body as KushkiCreateChargeRequestBody;
      // Kushki.js tokeniza en el navegador y el simulador no ve la tarjeta: solo hay monto.
      const resolved = resolveScenario(request, {
        wholePesos: wholePesosFromKushkiAmount(requestBody?.amount),
      });
      let scenario = resolved.scenario;

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

      const failure = await technicalFailure(scenario, request, reply, mockFactory);

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

      if (resolved.queryFailure !== undefined) {
        rememberQueryFailure("kushki", "charge", charge.ticketNumber, resolved.queryFailure);
      }

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
       * Un token de transferencia consultado aquí no existe, y hay que decirlo con
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
       * La regla de los 32 caracteres hexadecimales vive aquí y no en el SDK a
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
       * La única falla técnica es la que pidió la creación con un monto reservado (issue
       * #122): la consulta es la operación que el SDK reintenta, y es donde un reintento se
       * puede ver. Sin ese monto, el cobro existe y se devuelve.
       */
      const failure = await queryFailure(
        { gateway: "kushki", resource: "charge", id: ticketNumber },
        reply,
        mockFactory,
      );
      if (failure !== undefined) {
        return failure;
      }

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
   * este metodo de pago, porque el `bankId` del token tiene que venir de aquí.
   */
  app.get(
    "/v1/sim/kushki/transfer/v1/bankList",
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (invalidCredentialRequested(request, ["public-merchant-id"])) {
        return reply.code(403).send(TRANSFER_UNAUTHORIZED);
      }

      const failure = bankListFailure(request, reply, mockFactory, "kushki");
      if (failure !== undefined) {
        return failure;
      }

      return reply.code(200).send(mockFactory.buildBankList());
    },
  );

  /**
   * Token de transferencia, el paso 2.
   *
   * Aquí es donde viaja la URL de retorno del comercio (`callbackUrl`), y no en el
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
      if (invalidCredentialRequested(request, ["public-merchant-id"])) {
        return reply.code(403).send(TRANSFER_UNAUTHORIZED);
      }

      const body = request.body as KushkiTransferTokenRequestBody | undefined;
      const resolved = resolveScenario(request, {
        gatewayData: DOCUMENT_OUTCOMES.get(body?.documentNumber ?? ""),
        wholePesos: wholePesosFromKushkiAmount(body?.amount),
      });
      let scenario = resolved.scenario;

      const failure = await technicalFailure(scenario, request, reply, mockFactory);

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

      if (resolved.queryFailure !== undefined) {
        rememberQueryFailure("kushki", "transfer", token, resolved.queryFailure);
      }

      return reply.code(201).send({ token });
    },
  );

  /** Inicio de la transferencia, el paso 3. Devuelve la URL de redireccion. */
  app.post(
    "/v1/sim/kushki/transfer/v1/init",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Solo la cabecera: el monto y el documento ya decidieron al pedir el token.
      if (invalidCredentialRequested(request, ["private-merchant-id"])) {
        return reply.code(403).send(TRANSFER_UNAUTHORIZED);
      }

      const scenario = headerScenario(request);
      const body = request.body as KushkiTransferInitRequestBody;

      if (scenario !== undefined) {
        const failure = await technicalFailure(scenario, request, reply, mockFactory);

        if (failure !== undefined) {
          return failure;
        }
      }

      /*
       * El monto es obligatorio aquí, aunque ya viajó al pedir el token y Kushki lo
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
       * Un escenario de negocio en la cabecera del `init` reemplaza el que quedó al pedir el
       * token (issue #122). Antes se aceptaba y se ignoraba: `DECLINED` en el `init`
       * respondía `201` y la transferencia terminaba aprobada. Se descartó rechazarlo con
       * `501` porque el `init` es la llamada en la que el comercio ya tiene el token, y un
       * escenario explícito es más reciente que el del token.
       *
       * Lo que la transferencia no sabe producir responde `501` antes de moverla, igual que
       * en el token, así que la transferencia se queda en `requestedToken`.
       */
      if (scenario !== undefined) {
        if (!TRANSFER_SCENARIOS.has(scenario)) {
          return reply
            .code(501)
            .send({ error: `Escenario aún no soportado: ${scenario}` });
        }

        rememberScenarioTarget(
          "kushki",
          "transfer",
          body.token,
          transferTargetFor(scenario) ?? "approvedTransaction",
        );
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

      const initResponse = mockFactory.buildTransferInit(body.token);
      rememberTraceabilityCode(body.token, initResponse.trazabilityCode);

      return reply.code(201).send(initResponse);
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

      // Antes que la longitud del identificador: el `403` lo da API Gateway, delante de la
      // ruta. Que gane también con un identificador de otra longitud no se midió.
      if (invalidCredentialRequested(request, ["private-merchant-id"])) {
        return reply.code(403).send(TRANSFER_UNAUTHORIZED);
      }

      /*
       * Un ticket de tarjeta consultado aquí no es una transferencia, y hay que decirlo.
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

      const failure = await queryFailure(
        { gateway: "kushki", resource: "transfer", id: token },
        reply,
        mockFactory,
      );
      if (failure !== undefined) {
        return failure;
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