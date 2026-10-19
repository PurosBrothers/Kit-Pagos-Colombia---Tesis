import type { PaymentGatewayPort } from "../../application/ports/PaymentGatewayPort";
import { KitPagosError } from "../../domain/errors/KitPagosError";
import type { Credentials } from "../../domain/value-objects/Credentials";
import { redactCredentials } from "./http-failure";

function redactError(error: unknown, credentials: Credentials | undefined): unknown {
  return error instanceof KitPagosError ? redactCredentials(error, credentials) : error;
}

/**
 * Envuelve un adaptador para que ningún `KitPagosError` que salga de él lleve un valor de
 * credencial configurado en su `message` ni en su `originalPayload`.
 *
 * `httpFailure()` ya limpiaba el error HTTP con cuerpo, pero no los demás caminos: el error
 * nativo con estado 200 (un cuerpo de Rapyd con `status.status: "ERROR"` y sin `data`, que
 * sale como `MALFORMED_RESPONSE` con el cuerpo entero), el de parseo (el `SyntaxError` de
 * `JSON.parse` repite el principio del texto recibido) y el de red. Cubrirlos uno por uno en
 * los cuatro adaptadores habría repetido la llamada en cada `catch`, y el próximo camino nuevo
 * habría salido sin ella. Aquí se aplica una vez, a todo lo que el puerto rechace o lance.
 * Ver el punto 87 del architecture-log.md.
 *
 * Es un `Proxy` y no un objeto con los cuatro métodos para que el adaptador siga siendo
 * `instanceof` su clase y para que un método nuevo del puerto quede cubierto sin tocar esto.
 */
export function withCredentialRedaction(
  port: PaymentGatewayPort,
  credentials: Credentials | undefined,
): PaymentGatewayPort {
  return new Proxy(port, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        try {
          const result: unknown = value.apply(target, args);
          return result instanceof Promise
            ? result.catch((error: unknown) => {
                throw redactError(error, credentials);
              })
            : result;
        } catch (error) {
          throw redactError(error, credentials);
        }
      };
    },
  });
}
