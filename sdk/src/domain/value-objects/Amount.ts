/**
 * Objeto de valor inmutable que encapsula el monto de una transaccion.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Amount encapsula un unico
 * atributo numerico con hasta dos decimales y expone toMinorUnits() para que
 * cada Adapter lo traduzca a la representacion nativa de su pasarela, ademas
 * de un metodo equals() para comparacion por valor."
 *
 * Decision de usar `number` (en vez de BigInt, enteros forzados en unidad
 * menor, o una libreria de precision decimal) auditada y justificada contra
 * las 4 pasarelas del proyecto en docs/architecture/money-representation-analysis.md
 * (issue #28).
 *
 * La validacion de decimales NO multiplica por 100 para comparar, porque esa
 * comparacion aritmetica hereda el mismo error de punto flotante que motiva
 * esta clase (ej. 19.99 * 100 = 1998.9999999999998 en IEEE 754, lo que
 * rechazaria por error un monto valido de 2 decimales). En su lugar se lee
 * la representacion en string del numero, que refleja fielmente cuantos
 * decimales tiene sin necesidad de aritmetica. Ver la seccion "Solucion
 * propuesta para el defecto encontrado" del documento citado arriba para la
 * comparacion completa contra la alternativa de tolerancia numerica.
 */
export class Amount {
  private readonly value: number;

  constructor(value: number) {
    if (!Number.isFinite(value)) {
      throw new Error("Amount debe ser un numero finito");
    }
    // Numero de decimales leido del string canonico (mas corto que reproduce
    // el mismo double), no de una multiplicacion. Evita el falso rechazo de
    // montos validos como 19.99 o 1.15 (ver docblock de la clase).
    const decimalPart = value.toString().split(".")[1] ?? "";
    if (decimalPart.length > 2) {
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
