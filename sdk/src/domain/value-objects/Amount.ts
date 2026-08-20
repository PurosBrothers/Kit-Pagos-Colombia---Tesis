/**
 * Objeto de valor inmutable que encapsula el monto de una transaccion.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Amount encapsula un unico
 * atributo numerico con hasta dos decimales y expone toMinorUnits() para que
 * cada Adapter lo traduzca a la representacion nativa de su pasarela, ademas
 * de un metodo equals() para comparacion por valor."
 */
export class Amount {
  private readonly value: number;

  constructor(value: number) {
    if (Math.round(value * 100) !== value * 100) {
      throw new Error("Amount solo admite hasta dos decimales significativos");
    }
    if (value < 0) {
      throw new Error("Amount no puede ser negativo");
    }
    this.value = value;
  }

  /** Valor en la unidad mayor de la divisa (ej. pesos), con hasta 2 decimales. */
  getValue(): number {
    return this.value;
  }

  /** Traduccion a la unidad menor de la divisa (ej. centavos), como entero. */
  toMinorUnits(): number {
    return Math.round(this.value * 100);
  }

  equals(other: Amount): boolean {
    return this.value === other.value;
  }
}
