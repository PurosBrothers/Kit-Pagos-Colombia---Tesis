import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { GatewayMockFactory } from "../gateways/rapyd/GatewayMockFactory";
import {
  RapydCreateCustomerRequestBody,
  RapydCreatePaymentRequestBody,
} from "../gateways/rapyd/types";

const SCENARIO_HEADER = "x-simulate-scenario";
const DEFAULT_SCENARIO = "APPROVED";

/**
 * Router HTTP de Rapyd (issue #52).
 *
 * Expone las dos operaciones que el `RapydAdapter` del SDK necesita, con las
 * mismas rutas que la API real bajo el prefijo de simulacion:
 *
 * 1. `POST /v1/sim/rapyd/payments` — creacion de pago (201).
 * 2. `GET  /v1/sim/rapyd/payments/:paymentId` — consulta de estado (200).
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
 */
export async function rapydRoutes(app: FastifyInstance): Promise<void> {
  const mockFactory = new GatewayMockFactory();

  app.post(
    "/v1/sim/rapyd/payments",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Fastify tipa las cabeceras como string | string[] | undefined. La rama
      // del arreglo no se alcanza por HTTP (Node colapsa cabeceras repetidas en
      // un solo string), se conserva para satisfacer el tipo.
      const scenarioHeader = request.headers[SCENARIO_HEADER];
      const scenario = Array.isArray(scenarioHeader)
        ? scenarioHeader[0]
        : (scenarioHeader ?? DEFAULT_SCENARIO);

      const requestBody = request.body as RapydCreatePaymentRequestBody;

      if (scenario.toUpperCase() !== DEFAULT_SCENARIO) {
        // 501 y no 400: el escenario es legitimo, simplemente todavia no se
        // sabe producir. Los demas escenarios son el issue #65.
        return reply
          .code(501)
          .send({ error: `Escenario aun no soportado: ${scenario}` });
      }

      // PSE se reconoce por el prefijo del metodo de pago, que en Rapyd son 47
      // tipos `co_pse_{banco}_bank` en vez de un metodo con un campo de banco.
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

        return reply.code(201).send(mockFactory.buildPseCreatedResponse(requestBody));
      }

      return reply.code(201).send(mockFactory.buildApprovedResponse(requestBody));
    },
  );

  app.get(
    "/v1/sim/rapyd/payments/:paymentId",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { paymentId } = request.params as { paymentId: string };

      return reply.code(200).send(mockFactory.buildStatusResponse(paymentId));
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
