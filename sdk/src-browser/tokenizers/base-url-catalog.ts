import { Gateway } from "../../src/domain/value-objects/Gateway";
import { KitPagosErrorCode } from "../../src/domain/value-objects/KitPagosErrorCode";
import { KitPagosError } from "../../src/domain/errors/KitPagosError";
import { BrowserEnvironment } from "../types";

/**
 * Resuelve la URL base de un catálogo cerrado, o lanza `INVALID_REQUEST`.
 *
 * Sin valor por defecto y solo con claves propias del objeto: un `environment` mal
 * escrito o heredado del prototipo (`"constructor"`) produciría una URL sin esquema
 * que el navegador resuelve contra el origen de la página, y la tarjeta viajaría al
 * servidor del comercio (ver el punto 77 del architecture-log.md).
 */
export function resolveCatalogUrl(
  catalog: Readonly<Record<BrowserEnvironment, string>>,
  environment: BrowserEnvironment,
  gateway: Gateway,
): string {
  if (!Object.prototype.hasOwnProperty.call(catalog, environment)) {
    throw new KitPagosError(
      KitPagosErrorCode.INVALID_REQUEST,
      gateway,
      null,
      `Ambiente '${String(environment)}' no válido: use sandbox, production o simulator.`,
    );
  }
  return catalog[environment];
}
