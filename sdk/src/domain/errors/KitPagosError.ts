import { KitPagosErrorCode } from "../value-objects/KitPagosErrorCode";
import { Gateway } from "../value-objects/Gateway";

/** Opciones de `KitPagosError`, con la misma forma que el segundo argumento de `Error` en ES2022. */
export interface KitPagosErrorOptions {
  /** El error que provocó este, por ejemplo el último intento fallido de un reintento. */
  cause?: unknown;
}

/**
 * `kit-pagos-colombia` y `kit-pagos-colombia/browser` llevan cada uno su copia de esta clase
 * (el bundle de esbuild la incluye), así que `instanceof` por cadena de prototipos falla entre
 * ellas: medido el 7 de octubre de 2026 sobre `dist/`. `Symbol.for` devuelve el mismo símbolo
 * en las dos copias porque vive en el registro global.
 */
const KIT_PAGOS_ERROR_BRAND = Symbol.for("kit-pagos-colombia.KitPagosError");

/**
 * Excepcion tipada y unificada de Kit Pagos Colombia.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - Renombrado de SdkError a
 * KitPagosError para evitar colisiones con clases de error genericas de otros
 * SDKs integrados por los comercios (decision de direccion de tesis,
 * docs/architecture/architecture-log.md, punto 23).
 */
export class KitPagosError extends Error {
  /**
   * Se declara aquí porque el SDK compila con `lib` ES2020, que no conoce `Error.cause`.
   * Se define como propiedad no enumerable, igual que la crea `new Error(msg, { cause })`,
   * para que `JSON.stringify` de un error no arrastre la cadena completa de causas.
   */
  declare readonly cause?: unknown;

  constructor(
    public readonly code: KitPagosErrorCode,
    public readonly gateway: Gateway,
    public readonly originalPayload: unknown,
    message?: string,
    options?: KitPagosErrorOptions,
  ) {
    super(message ?? code);
    this.name = "KitPagosError";
    Object.defineProperty(this, KIT_PAGOS_ERROR_BRAND, { value: true });
    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    }
  }
}

/**
 * Reconoce también los errores creados por la otra copia de la clase. Solo aplica a
 * `KitPagosError` y no a una subclase, para que `x instanceof Subclase` no acepte cualquier
 * error marcado.
 *
 * Se define fuera del cuerpo de la clase para que `KitPagosError.d.ts` no declare
 * `[Symbol.hasInstance]`: con el `lib` ES5 que TypeScript 5 usa por omisión, esa declaración
 * no compila en el proyecto del comercio (`TS2585`, medido el 7 de octubre de 2026).
 */
Object.defineProperty(KitPagosError, Symbol.hasInstance, {
  value: function hasInstance(this: unknown, instance: unknown): boolean {
    if (Function.prototype[Symbol.hasInstance].call(this, instance)) {
      return true;
    }
    return this === KitPagosError && typeof instance === "object" && instance !== null
      && (instance as Record<symbol, unknown>)[KIT_PAGOS_ERROR_BRAND] === true;
  },
});
