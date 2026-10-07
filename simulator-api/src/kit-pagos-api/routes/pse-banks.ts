import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Gateway, KitPagosErrorCode, PseBank } from "kit-pagos-colombia";
import { CLIENT_CREDENTIAL_HEADERS, RequestHeaders } from "../../auth/CredentialResolver";
import { gatewayClientFor } from "../gateway-client";
import { SUPPORTED_GATEWAYS, parseGateway, unsupportedGatewayBody } from "../gateway-param";

/**
 * Serializa un `PseBank` del SDK a JSON para la respuesta HTTP.
 *
 * `achCode` solo aparece cuando el banco esta en el catalogo de codigos de PSE de
 * la red ACH (`PseBankCode`); los bancos ficticios de los sandboxes de Wompi y
 * Kushki no tienen equivalente y no pueden llevar el campo falsificado (punto 68).
 */
function serializePseBank(bank: PseBank): {
  code: string;
  name: string;
  achCode?: string;
} {
  return {
    code: bank.code,
    name: bank.name,
    ...(bank.achCode ? { achCode: bank.achCode } : {}),
  };
}

/**
 * Cuerpo de la respuesta 400 cuando la peticion trae credenciales propias pero no
 * dice a que pasarela pertenecen.
 *
 * Las cabeceras `x-gateway-public-key` y `x-gateway-private-key` no llevan el nombre de
 * la pasarela: son el par de llaves, sin más. Ante cuatro pasarelas, la peticion que las
 * trae solo puede estar dirigida a una, y mandarlas a las otras tres seria filtrarlas.
 */
function gatewayRequiredBody(): { code: KitPagosErrorCode; message: string } {
  return {
    code: KitPagosErrorCode.INVALID_REQUEST,
    message:
      `La peticion trae credenciales propias en ${CLIENT_CREDENTIAL_HEADERS.join(" y ")}, ` +
      `pero no dice de que pasarela son. Indiquela en ?gateway=<pasarela>; ` +
      `si quiere las cuatro listas a la vez, no envie esas cabeceras y use las ` +
      `credenciales del servidor. Pasarelas soportadas: ${SUPPORTED_GATEWAYS.join(", ")}.`,
  };
}

/**
 * Si la peticion trae credenciales propias, aunque le falte una de las dos.
 *
 * Se mira la presencia y no la completitud a proposito: con media pareja de llaves la
 * peticion tampoco puede atribuirse a una pasarela, y mandarla a las cuatro seria peor.
 */
function bringsOwnCredentials(headers: RequestHeaders): boolean {
  return CLIENT_CREDENTIAL_HEADERS.some((header) => headers[header] !== undefined);
}

/**
 * GET /v1/api/pse-banks: lista los bancos habilitados para PSE en cada pasarela.
 *
 * Agrupa la lista por pasarela con su `gateway`, porque los `code` que da cada
 * una solo sirven en ella: cambiar de pasarela obliga a volver a pedir la lista.
 * Es la misma advertencia que el SDK le da a `getPseBanks()` (punto 68).
 *
 * `?gateway=<pasarela>` acota la consulta a una. Sin el parametro se listan las cuatro,
 * que es lo que puede hacer quien no trae credenciales propias: usa las del servidor y
 * las cuatro listas son legitimas. Con credenciales propias el parametro es obligatorio,
 * porque las cabeceras no dicen de que pasarela son y mandarlas a las otras tres seria
 * filtrar las llaves privadas de un comercio a tres proveedores (punto 69). Es la misma
 * regla que ya obligaba en `POST /v1/api/payments`, y por eso la ruta no puede quedar
 * como estaba: contra produccion respondia 401 siempre, porque la regla de credenciales
 * caia recien adentro del bucle, en la primera pasarela.
 *
 * Sin cache: cada peticion vuelve a consultar las pasarelas, porque la lista
 * cambia (entran y salen entidades) y una cache invalidable no aporta frente a
 * cuatro llamadas idempotentes ya protegidas por `RetryHandler`.
 *
 * Falla rapido: si una pasarela no responde, el KitPagosError viaja al error
 * handler global en vez de devolver una lista parcial que el comercio tomara por
 * completa.
 */
export async function pseBanksRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { gateway?: string } }>(
    "/pse-banks",
    async (
      request: FastifyRequest<{ Querystring: { gateway?: string } }>,
      reply: FastifyReply,
    ) => {
      const requestedGateway = parseGateway(request.query.gateway);

      // Un valor presente que no es una pasarela es una peticion mal formada, con o sin
      // credenciales: se responde antes de mirar las cabeceras para no seguir leyendo una
      // peticion que ya se sabe invalida.
      if (request.query.gateway !== undefined && !requestedGateway) {
        return reply.status(400).send(unsupportedGatewayBody());
      }

      if (!requestedGateway && bringsOwnCredentials(request.headers)) {
        return reply.status(400).send(gatewayRequiredBody());
      }

      const gateways = requestedGateway ? [requestedGateway] : Object.values(Gateway);
      const byGateway: Array<{
        gateway: string;
        banks: ReturnType<typeof serializePseBank>[];
      }> = [];

      for (const gateway of gateways) {
        const kitPagos = gatewayClientFor(app, request, reply, gateway);
        const banks = await kitPagos.getPseBanks();
        byGateway.push({
          gateway: gateway.toLowerCase(),
          banks: banks.map(serializePseBank),
        });
      }

      return reply.status(200).send({ pseBanks: byGateway });
    },
  );
}
