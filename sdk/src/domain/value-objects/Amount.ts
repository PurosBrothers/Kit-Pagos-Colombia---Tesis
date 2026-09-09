import Big from "big.js";
import { Currency } from "./Currency";

/**
 * Modo de redondeo a aplicar cuando una operacion produce mas decimales de los
 * que la escala pedida admite.
 *
 * Se declara aca en vez de reexportar las constantes numericas de big.js para
 * que la libreria no se filtre a la superficie publica del SDK: el comercio
 * pide "medio arriba" sin enterarse de con que se implementa por dentro, y
 * cambiar de libreria decimal no rompe a nadie.
 */
export enum RoundingMode {
  /** Trunca hacia cero. */
  DOWN = "DOWN",
  /** 0.5 sube. Es la convencion comercial habitual y el valor por defecto. */
  HALF_UP = "HALF_UP",
  /** 0.5 va al par mas cercano (redondeo bancario). */
  HALF_EVEN = "HALF_EVEN",
  /** Se aleja de cero siempre que haya resto. */
  UP = "UP",
}

/**
 * Objeto de valor inmutable que encapsula el monto de una transaccion.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Amount encapsula un unico
 * atributo numerico con hasta dos decimales y expone toMinorUnits() para que
 * cada Adapter lo traduzca a la representacion nativa de su pasarela, ademas
 * de un metodo equals() para comparacion por valor."
 *
 * ## Por que el monto se guarda como string y no como `number`
 *
 * El issue #28 audito el tipo de dato y concluyo mantener `number`, con el
 * argumento de que `Amount` no ejecutaba aritmetica sobre si mismo. Esa
 * decision se revirtio por pedido de la direccion de tesis y por dos razones
 * concretas; el detalle completo esta en
 * docs/architecture/money-representation-analysis.md.
 *
 * 1. `number` no puede representar `19.90`. En JavaScript `(19.90).toString()`
 *    devuelve `"19.9"`: el cero final se pierde y no hay forma de recuperarlo.
 *    Rapyd calcula la firma HMAC sobre el cuerpo serializado de la peticion, de
 *    modo que necesita el monto como string decimal de escala fija. Con
 *    `number` ese requisito es imposible de cumplir porque el dato ya llego sin
 *    el cero.
 *
 * 2. Kushki exige el monto descompuesto por IVA. Descomponer implica dividir, y
 *    una division sobre `number` arrastra el error de punto flotante
 *    (`100000 / 1.19` da `84033.61344537816`).
 *
 * Lo que NO motivo el cambio: `toMinorUnits()` no estaba devolviendo resultados
 * incorrectos con la implementacion anterior. `Math.round(v * 100)` acertaba
 * para todos los montos COP realistas, porque el error del producto intermedio
 * queda muy por debajo de 0.5 y el redondeo lo absorbe. El problema no era un
 * calculo mal hecho, era la imposibilidad de representar la escala.
 *
 * ## Como se reparte el trabajo por dentro
 *
 * La forma canonica de entrada se guarda tal cual en un string, porque es lo
 * unico que conserva la escala: `new Big("19.90").toString()` tambien devuelve
 * `"19.9"`, asi que guardar un `Big` perderia justo lo que se quiere proteger.
 * `Big` se usa solamente para operar, y el resultado vuelve a string con una
 * escala explicita.
 *
 * Las conversiones de unidad (`toMinorUnits`, `fromMinorUnits`) no usan `Big`
 * ni aritmetica: corren el punto decimal sobre el string, que es exacto por
 * construccion y no depende de ninguna libreria.
 */
export class Amount {
  /**
   * Decimales maximos que admite un monto. Se mantiene en 2 para no
   * contradecir la seccion 15.1 del SAD ("hasta dos decimales") y porque es lo
   * que necesitan las cuatro pasarelas del proyecto, todas colombianas.
   *
   * Limitacion conocida y deliberada: las divisas de exponente 3 (KWD, BHD y
   * las demas que Currency reporta con 3) no se pueden representar a su
   * precision completa. Queda fuera del alcance de la tesis; si algun dia
   * entra, este es el unico numero que hay que mover.
   */
  private static readonly MAX_SCALE = 2;

  /** Solo digitos, con punto y hasta MAX_SCALE decimales. Sin signo, sin notacion exponencial. */
  private static readonly CANONICAL_PATTERN = /^\d+(\.\d{1,2})?$/;

  private static readonly ROUNDING_MODES: Readonly<Record<RoundingMode, 0 | 1 | 2 | 3>> = {
    [RoundingMode.DOWN]: 0,
    [RoundingMode.HALF_UP]: 1,
    [RoundingMode.HALF_EVEN]: 2,
    [RoundingMode.UP]: 3,
  };

  private readonly value: string;

  /**
   * Recibe el monto como string en la unidad mayor de la divisa (pesos, no
   * centavos). Se rechaza `number` en la firma a proposito: aceptarlo "por
   * comodidad" reabriria por esa puerta el problema del cero final que motiva
   * toda esta clase.
   *
   * La validacion es puramente sintactica sobre el string recibido. No se
   * delega a big.js porque big.js es mas permisivo de lo que conviene aca:
   * acepta notacion exponencial (`"1e3"`), signo, y cualquier cantidad de
   * decimales.
   */
  constructor(value: string) {
    if (typeof value !== "string") {
      throw new Error("Amount debe recibir el monto como string, no como number");
    }
    if (value.startsWith("-")) {
      throw new Error("Amount no puede ser negativo");
    }
    if (!Amount.CANONICAL_PATTERN.test(value)) {
      throw new Error(
        `Amount solo admite digitos con hasta ${Amount.MAX_SCALE} decimales, sin signo ni notacion exponencial (recibido: "${value}")`,
      );
    }
    this.value = value;
  }

  /**
   * Construye un monto a partir de su representacion en la unidad menor de la
   * divisa, que es como responden varias pasarelas (Wompi devuelve
   * `amount_in_cents`).
   *
   * Inserta el punto decimal sobre los digitos en vez de dividir, de modo que
   * 1990 centavos devuelven `"19.90"` con el cero final intacto. Dividir entre
   * 100 daria `19.9` y el comercio veria un monto distinto del que cobro.
   */
  static fromMinorUnits(minor: string | number, currency: Currency): Amount {
    const digits = typeof minor === "number" ? String(minor) : minor;
    if (!/^\d+$/.test(digits)) {
      throw new Error(
        `Amount.fromMinorUnits espera un entero no negativo de unidades menores (recibido: "${digits}")`,
      );
    }

    const exponent = currency.getMinorUnitExponent();
    if (exponent === 0) {
      return new Amount(Amount.stripLeadingZeros(digits));
    }

    const padded = digits.padStart(exponent + 1, "0");
    const cut = padded.length - exponent;
    const integerPart = Amount.stripLeadingZeros(padded.slice(0, cut));
    return new Amount(`${integerPart}.${padded.slice(cut)}`);
  }

  /** Valor en la unidad mayor de la divisa, conservando la escala con la que se construyo. */
  getValue(): string {
    return this.value;
  }

  /** Cuantos decimales tiene el monto tal como fue escrito. `"19.90"` devuelve 2. */
  getScale(): number {
    return this.value.split(".")[1]?.length ?? 0;
  }

  /**
   * Traduccion a la unidad menor de la divisa, como string de digitos.
   *
   * Corre el punto decimal usando el exponente que Currency conoce por ISO
   * 4217, sin multiplicar. Devuelve string y no `number` para que la conversion
   * a numero, cuando el formato de cable la exija, quede visible en el Adapter
   * y no escondida aca.
   *
   * Lanza si el monto tiene mas decimales de los que la divisa admite, en vez
   * de truncarlos: un monto de `"19.99"` en una divisa de cero decimales es un
   * error del comercio que conviene que explote, no que se convierta
   * silenciosamente en otro monto.
   */
  toMinorUnits(currency: Currency): string {
    const exponent = currency.getMinorUnitExponent();
    const scale = this.getScale();
    if (scale > exponent) {
      throw new Error(
        `Amount de ${scale} decimales no cabe en ${currency.getCode()}, que admite ${exponent} segun ISO 4217`,
      );
    }

    const [integerPart, decimalPart = ""] = this.value.split(".");
    const shifted = integerPart + decimalPart.padEnd(exponent, "0");
    return Amount.stripLeadingZeros(shifted);
  }

  /**
   * Representacion con una escala exacta, rellenando con ceros a la derecha.
   * Es lo que necesita Rapyd para el cuerpo que participa del calculo de la
   * firma, donde `"19.90"` y `"19.9"` producen firmas distintas.
   *
   * Lanza si la escala pedida es menor que la que tiene el monto, porque eso
   * seria descartar informacion. Reducir escala es un redondeo y para eso estan
   * multiply() y divide(), que exigen declarar el modo.
   */
  toFixedScale(scale: number): string {
    if (!Number.isInteger(scale) || scale < 0) {
      throw new Error("La escala debe ser un entero no negativo");
    }
    if (scale < this.getScale()) {
      throw new Error(
        `No se puede representar un monto de ${this.getScale()} decimales con escala ${scale} sin perder informacion`,
      );
    }
    return new Big(this.value).toFixed(scale);
  }

  /** Suma exacta: no necesita escala porque el resultado no gana decimales. */
  add(other: Amount): Amount {
    return new Amount(
      new Big(this.value).plus(new Big(other.value)).toFixed(
        Math.max(this.getScale(), other.getScale()),
      ),
    );
  }

  /**
   * Resta exacta. Lanza si el resultado quedaria negativo, porque un monto
   * negativo no es un concepto valido del dominio.
   */
  subtract(other: Amount): Amount {
    const result = new Big(this.value).minus(new Big(other.value));
    if (result.lt(0)) {
      throw new Error(
        `Restar ${other.getValue()} de ${this.value} daria un monto negativo`,
      );
    }
    return new Amount(
      result.toFixed(Math.max(this.getScale(), other.getScale())),
    );
  }

  /**
   * Multiplicacion con escala obligatoria. La escala no tiene valor por
   * defecto porque multiplicar por una tasa casi siempre produce mas decimales
   * de los que el dinero admite (un 19% sobre `"100.00"` da `19.0000`), y quien
   * llama es el unico que sabe a cuantos decimales corresponde redondear.
   */
  multiply(factor: string, scale: number, rounding: RoundingMode = RoundingMode.HALF_UP): Amount {
    return new Amount(
      new Big(this.value)
        .times(new Big(factor))
        .round(scale, Amount.ROUNDING_MODES[rounding])
        .toFixed(scale),
    );
  }

  /**
   * Division con escala obligatoria, por el mismo motivo que multiply(): casi
   * ninguna division de dinero da un resultado exacto. `"100000"` entre `1.19`
   * da `84033.613445...`, y sin decidir la escala no hay forma de convertirlo
   * en un monto valido.
   */
  divide(divisor: string, scale: number, rounding: RoundingMode = RoundingMode.HALF_UP): Amount {
    const divisorBig = new Big(divisor);
    if (divisorBig.eq(0)) {
      throw new Error("No se puede dividir un monto entre cero");
    }
    return new Amount(
      new Big(this.value)
        .div(divisorBig)
        .round(scale, Amount.ROUNDING_MODES[rounding])
        .toFixed(scale),
    );
  }

  /**
   * Comparacion por valor y no por string: `"19.9"` y `"19.90"` son el mismo
   * monto aunque se hayan escrito distinto.
   */
  equals(other: Amount): boolean {
    return new Big(this.value).eq(new Big(other.value));
  }

  /** Quita ceros a la izquierda dejando al menos un digito. `"007"` da `"7"`, `"000"` da `"0"`. */
  private static stripLeadingZeros(digits: string): string {
    return digits.replace(/^0+(?=\d)/, "");
  }
}
