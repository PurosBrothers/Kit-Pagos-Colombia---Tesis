/**
 * Objeto de valor inmutable que representa una divisa ISO 4217.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Currency valida en su
 * constructor que el codigo recibido tenga exactamente tres letras
 * mayusculas conforme a ISO 4217, con 'COP' como valor por defecto."
 *
 * Ademas del codigo, Currency conoce el exponente de unidad menor que ISO 4217
 * asigna a cada divisa (la columna "Minor unit" de las tablas A.1 y A.2). Ese
 * dato vive aca y no en los Adapters a proposito: las cuatro pasarelas del
 * proyecto esperan el monto en representaciones distintas (Wompi en centavos,
 * Rapyd en la unidad mayor, Kushki descompuesto), y si cada Adapter guardara su
 * propia constante de "cuantos decimales tiene COP" habria cuatro copias del
 * mismo hecho ISO listas para divergir.
 */
export class Currency {
  /**
   * Excepciones al exponente 2. ISO 4217 asigna 2 a la gran mayoria de las
   * divisas, de modo que solo se listan las que difieren; ver DEFAULT_EXPONENT.
   * Se registran las excepciones y no las 180 divisas para que agregar una
   * divisa nueva no exija tocar esta tabla salvo que sea excepcion.
   *
   * Exponente 0: no tienen unidad menor en uso.
   * Exponente 3: ratio 1000:1 en vez de 100:1.
   */
  private static readonly MINOR_UNIT_EXPONENTS: Readonly<Record<string, number>> =
    {
      // Exponente 0
      BIF: 0,
      CLP: 0,
      DJF: 0,
      GNF: 0,
      ISK: 0,
      JPY: 0,
      KMF: 0,
      KRW: 0,
      PYG: 0,
      RWF: 0,
      UGX: 0,
      VND: 0,
      VUV: 0,
      XAF: 0,
      XOF: 0,
      XPF: 0,
      // Exponente 3
      BHD: 3,
      IQD: 3,
      JOD: 3,
      KWD: 3,
      LYD: 3,
      OMR: 3,
      TND: 3,
    };

  /**
   * Exponente asumido para cualquier divisa que no sea excepcion.
   *
   * COP cae aca: ISO 4217 le asigna exponente 2 (1 peso = 100 centavos), no 0.
   * Es un dato que conviene tener claro porque los centavos colombianos no se
   * usan en la practica, y de ahi sale la confusion de tratar COP como divisa
   * de cero decimales. Que no se usen no cambia el estandar, y Wompi lo
   * confirma al exigir el monto en su campo `amount_in_cents`.
   *
   * Si una pasarela concreta decide tratar COP como entero de pesos, eso es una
   * convencion de esa pasarela y se resuelve en su Adapter, no aca.
   */
  private static readonly DEFAULT_EXPONENT = 2;

  private readonly code: string;

  constructor(code: string = "COP") {
    if (!/^[A-Z]{3}$/.test(code)) {
      throw new Error(
        "Currency debe tener exactamente tres letras mayusculas (ISO 4217)",
      );
    }
    this.code = code;
  }

  getCode(): string {
    return this.code;
  }

  /**
   * Cuantos decimales admite la divisa segun ISO 4217, es decir la potencia de
   * 10 que separa la unidad mayor de la menor. Para COP devuelve 2: un peso
   * son 100 centavos.
   */
  getMinorUnitExponent(): number {
    return (
      Currency.MINOR_UNIT_EXPONENTS[this.code] ?? Currency.DEFAULT_EXPONENT
    );
  }

  equals(other: Currency): boolean {
    return this.code === other.code;
  }
}
