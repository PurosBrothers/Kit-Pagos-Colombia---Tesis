/**
 * Conversion entre la unidad mayor y la unidad menor de una divisa, corriendo
 * el punto decimal sobre el string.
 *
 * ## Por que es un modulo aparte de Amount
 *
 * `Amount` mezclaba tres responsabilidades: ser objeto de valor (validar,
 * comparar, exponer), hacer aritmetica decimal, y convertir entre pesos y
 * centavos. La tercera es la unica que no necesita saber nada de dinero: es
 * manipulacion de digitos guiada por el exponente ISO 4217, y se puede razonar
 * y probar sin `Amount` de por medio.
 *
 * Aca no se usa `Big` ni aritmetica de ningun tipo. Correr el punto decimal
 * sobre el string es exacto por construccion: multiplicar por 100 introduciria
 * el error de punto flotante que toda la representacion como string existe para
 * evitar, y dividir entre 100 destruiria el cero final (`1990` centavos daria
 * `19.9` en vez de `"19.90"`).
 *
 * Son funciones de modulo por lo mismo que en `big-arithmetic.ts`: son
 * transformaciones puras de string a string, sin estado que instanciar.
 * Ver architecture-log.md, punto 33.
 */

/** Solo digitos decimales, sin punto, signo ni notacion exponencial. */
const ALL_DIGITS_PATTERN = /^\d+$/;

/** Digitos con punto y hasta dos decimales. Sin signo, sin notacion exponencial. */
const CANONICAL_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** Decimal no negativo sin signo: `"0.19"`, `"0"`, `"0.195"`. */
const RATE_PATTERN = /^\d+(\.\d+)?$/;

/**
 * True si el string es la forma canonica de un monto: digitos con hasta dos
 * decimales.
 *
 * La validacion no se delega a big.js porque big.js es mas permisivo de lo que
 * conviene: acepta notacion exponencial (`"1e3"`), signo, y cualquier cantidad
 * de decimales.
 */
export function isCanonicalAmount(value: string): boolean {
  return CANONICAL_AMOUNT_PATTERN.test(value);
}

/** True si el string contiene unicamente digitos decimales. */
export function isAllDigits(value: string): boolean {
  return ALL_DIGITS_PATTERN.test(value);
}

/** True si el string es una tasa valida: decimal no negativo sin signo. */
export function isValidRate(rate: string): boolean {
  return typeof rate === "string" && RATE_PATTERN.test(rate);
}

/**
 * Reconstruye la representacion en unidad mayor a partir de los digitos de la
 * unidad menor, insertando el punto decimal.
 *
 * `("1990", 2)` da `"19.90"`, con el cero final intacto. El relleno a la
 * izquierda cubre los montos mas cortos que el exponente: `("5", 2)` da
 * `"0.05"`.
 *
 * @param digits Digitos de la unidad menor. Debe validarse antes con isAllDigits().
 * @param exponent Decimales que la divisa admite segun ISO 4217.
 */
export function shiftFromMinorUnits(digits: string, exponent: number): string {
  if (exponent === 0) {
    return stripLeadingZeros(digits);
  }

  const padded = digits.padStart(exponent + 1, "0");
  const cut = padded.length - exponent;
  const integerPart = stripLeadingZeros(padded.slice(0, cut));
  return `${integerPart}.${padded.slice(cut)}`;
}

/**
 * Traduce la representacion en unidad mayor a los digitos de la unidad menor,
 * quitando el punto decimal y rellenando a la derecha.
 *
 * `("19.90", 2)` da `"1990"`. `("19.9", 2)` tambien da `"1990"`: el relleno
 * completa la escala que la divisa espera.
 *
 * @param value Monto en forma canonica. Su escala debe caber en el exponente;
 *              validarlo es responsabilidad de quien llama, que es el unico que
 *              puede construir un mensaje de error con la divisa involucrada.
 * @param exponent Decimales que la divisa admite segun ISO 4217.
 */
export function shiftToMinorUnits(value: string, exponent: number): string {
  const [integerPart, decimalPart = ""] = value.split(".");
  return stripLeadingZeros(integerPart + decimalPart.padEnd(exponent, "0"));
}

/**
 * Quita ceros a la izquierda dejando al menos un digito.
 * `"007"` da `"7"`, `"000"` da `"0"`.
 *
 * El lookahead es lo que garantiza el ultimo digito: sin el, `"000"` quedaria
 * como string vacio y dejaria de ser un monto valido.
 */
function stripLeadingZeros(digits: string): string {
  return digits.replace(/^0+(?=\d)/, "");
}
