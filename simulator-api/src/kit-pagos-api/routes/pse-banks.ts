import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Gateway, PseBank } from "kit-pagos-colombia";
import { gatewayClientFor } from "../gateway-client";

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
 * GET /v1/api/pse-banks: lista los bancos habilitados para PSE en cada pasarela.
 *
 * Agrupa la lista por pasarela con su `gateway`, porque los `code` que da cada
 * una solo sirven en ella: cambiar de pasarela obliga a volver a pedir la lista.
 * Es la misma advertencia que el SDK le da a `getPseBanks()` (punto 68).
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
  app.get("/pse-banks", async (request: FastifyRequest, reply: FastifyReply) => {
    const byGateway: Array<{ gateway: string; banks: ReturnType<typeof serializePseBank>[] }> = [];

    for (const gateway of Object.values(Gateway)) {
      const kitPagos = gatewayClientFor(app, request, reply, gateway);
      const banks = await kitPagos.getPseBanks();
      byGateway.push({
        gateway: gateway.toLowerCase(),
        banks: banks.map(serializePseBank),
      });
    }

    return reply.status(200).send({ pseBanks: byGateway });
  });
}