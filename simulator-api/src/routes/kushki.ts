import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/kushki/GatewayMockFactory";
import {
  KushkiCreateChargeRequestBody,
  KushkiTransferInitRequestBody,
} from "../gateways/kushki/types";

const SCENARIO_HEADER = "x-simulate-scenario";
const DEFAULT_SCENARIO = "APPROVED";

/**
 * Router HTTP de Kushki (API de Simulación).
 *
 * Expone:
 * 1. POST /v1/sim/kushki/card/v1/charges: crea un cobro con tarjeta. La ruta lleva el
 *    prefijo `card/v1` porque **es la ruta real**: se midió que `POST /charges`, que es
 *    la que el SDK usaba, responde `403 Forbidden` igual que una ruta inventada.
 * 2. GET /v1/sim/kushki/charges/:ticketNumber: consulta el estado por ticketNumber.
 *    **Esta no tiene equivalente medido**: contra la API real se probaron catorce rutas
 *    candidatas de consulta de cobros con tarjeta y ninguna existe. Se conserva para que
 *    el ejemplo pueda mostrar el ciclo de vida completo, y está declarado en el punto 50.
 *
 * Punto crítico de esta ruta, explícito en el issue: un **rechazo** viaja con el mismo
 * código HTTP que una aprobación, y la decisión de éxito o fallo vive únicamente en el
 * estado dentro del cuerpo. Es justo el comportamiento que rompe un adaptador que decide
 * mirando `response.ok`. Lo que cambió es el código: `201` y no `200`, porque es el que
 * responde Kushki al crear.
 */
export async function kushkiRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  app.post(
    "/v1/sim/kushki/card/v1/charges",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = (
        Array.isArray(scenarioHeader)
          ? scenarioHeader[0]
          : (scenarioHeader ?? DEFAULT_SCENARIO)
      ).toUpperCase();

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

      if (scenario === "DECLINED" || scenario === "REJECTED") {
        // HTTP 200, no 4xx: Kushki nunca usa el status HTTP para señalar
        // un rechazo de negocio.
        return reply
          .code(201)
          .send(mockFactory.buildDeclinedResponse(requestBody));
      }

      if (scenario === "INITIALIZED" || scenario === "PENDING") {
        return reply
          .code(201)
          .send(mockFactory.buildInitializedResponse(requestBody));
      }

      if (scenario === "APPROVED" || scenario === "APPROVAL") {
        return reply
          .code(201)
          .send(mockFactory.buildApprovedResponse(requestBody));
      }

      return reply
        .code(501)
        .send({ error: `Escenario aún no soportado: ${scenario}` });
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

      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = (
        Array.isArray(scenarioHeader)
          ? scenarioHeader[0]
          : (scenarioHeader ?? DEFAULT_SCENARIO)
      ).toUpperCase();

      const placeholderRequest: KushkiCreateChargeRequestBody = {
        token: "query-only",
        amount: {
          subtotalIva0: 50000,
          subtotalIva: 0,
          iva: 0,
          ice: 0,
          currency: "COP",
        },
      };

      const response =
        scenario === "DECLINED" || scenario === "REJECTED"
          ? mockFactory.buildDeclinedResponse(placeholderRequest)
          : mockFactory.buildApprovedResponse(placeholderRequest);

      response.ticketNumber = ticketNumber;
      return reply.code(200).send(response);
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
   */
  app.post(
    "/v1/sim/kushki/transfer/v1/tokens",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { bankId?: string; callbackUrl?: string };

      if (!body?.bankId) {
        return reply.code(400).send({ code: "T001", message: "bankId es obligatorio" });
      }
      if (!body?.callbackUrl) {
        return reply.code(400).send({ code: "T002", message: "callbackUrl es obligatorio" });
      }

      return reply.code(201).send(mockFactory.buildTransferToken());
    },
  );

  /** Inicio de la transferencia, el paso 3. Devuelve la URL de redireccion. */
  app.post(
    "/v1/sim/kushki/transfer/v1/init",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as KushkiTransferInitRequestBody;

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
       * Es la contraparte del 404 que ya daba la ruta de tarjeta ante un token de
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

      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = (
        Array.isArray(scenarioHeader)
          ? scenarioHeader[0]
          : (scenarioHeader ?? DEFAULT_SCENARIO)
      ).toUpperCase();

      /*
       * Los estados son los del vocabulario de transferencia, no los de tarjeta:
       * `initializedTransaction` medido contra la API real, y los finales según la
       * documentación de Kushki. Antes el mock devolvía `APPROVAL` e `INITIALIZED`,
       * que son de tarjeta y que Kushki no usa acá.
       */
      if (scenario === "DECLINED" || scenario === "REJECTED") {
        return reply
          .code(200)
          .send(mockFactory.buildTransferStatus(token, "declinedTransaction"));
      }
      if (scenario === "INITIALIZED" || scenario === "PENDING") {
        return reply
          .code(200)
          .send(mockFactory.buildTransferStatus(token, "initializedTransaction"));
      }

      return reply
        .code(200)
        .send(mockFactory.buildTransferStatus(token, "approvedTransaction"));
    },
  );
}
