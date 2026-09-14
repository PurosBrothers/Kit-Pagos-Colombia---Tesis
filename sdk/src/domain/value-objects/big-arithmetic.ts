/**
 * Aritmetica decimal exacta: unico punto del SDK que conoce big.js.
 *
 * ## Por que existe
 *
 * El docblock de `Amount` promete que "cambiar de libreria decimal no rompe a
 * nadie". Antes de este modulo esa promesa era teorica: `Amount` invocaba nueve
 * metodos distintos de `Big` (`plus`, `minus`, `times`, `div`, `round`,
 * `toFixed`, `lt`, `eq`, y el constructor) repartidos entre seis de sus
 * metodos, de modo que sustituir la libreria obligaba a reescribir la clase
 * entera. Concentrando esas llamadas aca, la promesa se vuelve verificable:
 * cambiar de libreria es reescribir este archivo y nada mas.
 *
 * Las funciones reciben y devuelven `string`, nunca `Big`. Devolver un `Big`
 * dejaria que el tipo de la libreria se filtre a `Amount` y el seam no serviria
 * de nada.
 *
 * ## Por que son funciones de modulo y no una clase
 *
 * Son transformaciones puras sin estado: no hay nada que instanciar ni que
 * mantener entre llamadas. En TypeScript el lugar natural de una funcion pura
 * es el modulo; envolverlas en una clase de metodos estaticos seria un
 * Java-ismo sin beneficio.
 *
 * Como efecto secundario, esto tambien saca los nueve nombres de metodo de
 * `Big` del calculo de RFC de `Amount` y `TaxBreakdown`, porque el script
 * `scripts/ck-metrics.ts` solo analiza clases y solo cuenta llamadas con
 * notacion de punto. Es una consecuencia del cambio, no su motivo: el seam
 * vale por si mismo aunque el umbral no existiera.
 * Ver architecture-log.md, punto 33.
 */
import Big from "big.js";

/**
 * Codigos de modo de redondeo de big.js. Se declaran como tipo propio para que
 * quien llame no tenga que importar las constantes de la libreria y el seam
 * quede completo.
 *
 * 0 = trunca hacia cero, 1 = 0.5 sube, 2 = 0.5 al par mas cercano, 3 = se
 * aleja de cero.
 */
export type BigRoundingCode = 0 | 1 | 2 | 3;

/** Representacion con escala exacta, rellenando con ceros a la derecha. */
export function bigFixed(value: string, scale: number): string {
  return new Big(value).toFixed(scale);
}

/** Suma exacta con escala explicita. */
export function bigAdd(a: string, b: string, scale: number): string {
  return new Big(a).plus(new Big(b)).toFixed(scale);
}

/**
 * Resta exacta.
 *
 * Devuelve el resultado junto con el flag de negatividad en vez de lanzar por
 * su cuenta, porque el mensaje de error que corresponde depende del dominio de
 * quien llama: `Amount.subtract()` necesita nombrar los dos montos originales,
 * y eso solo lo sabe `Amount`.
 */
export function bigSubtract(
  a: string,
  b: string,
  scale: number,
): { value: string; isNegative: boolean } {
  const result = new Big(a).minus(new Big(b));
  return { value: result.toFixed(scale), isNegative: result.lt(0) };
}

/** Multiplicacion con escala y modo de redondeo obligatorios. */
export function bigMultiply(
  a: string,
  factor: string,
  scale: number,
  rounding: BigRoundingCode,
): string {
  return new Big(a).times(new Big(factor)).round(scale, rounding).toFixed(scale);
}

/**
 * Division con escala y modo de redondeo obligatorios.
 *
 * La guarda del divisor cero vive aca y no en quien llama porque es una
 * propiedad de la division, no del dominio del monto.
 */
export function bigDivide(
  a: string,
  divisor: string,
  scale: number,
  rounding: BigRoundingCode,
): string {
  if (new Big(divisor).eq(0)) {
    throw new Error("No se puede dividir un monto entre cero");
  }
  return new Big(a).div(new Big(divisor)).round(scale, rounding).toFixed(scale);
}

/** Comparacion por valor: `"19.9"` y `"19.90"` son el mismo numero. */
export function bigEquals(a: string, b: string): boolean {
  return new Big(a).eq(new Big(b));
}

/**
 * Convierte una tasa en el divisor de un precio con impuesto incluido:
 * `"0.19"` da `"1.19"`.
 *
 * No pasa por `Amount` a proposito, aunque `"0.19"` sea un string de monto
 * valido: una tasa no es dinero, y `Amount` la limitaria a dos decimales sin
 * ninguna razon (una tasa de `"0.195"` es perfectamente posible).
 */
export function bigOnePlus(rate: string): string {
  return new Big(1).plus(new Big(rate)).toString();
}
