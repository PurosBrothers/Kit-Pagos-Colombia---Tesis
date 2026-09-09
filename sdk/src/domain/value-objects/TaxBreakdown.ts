import Big from "big.js";
import { Amount } from "./Amount";
import { Currency } from "./Currency";

/**
 * Descomposicion de un monto en su base gravable y sus impuestos.
 *
 * Existe porque Kushki no acepta el monto como escalar: su API espera un objeto
 * con `subtotalIva0`, `subtotalIva`, `iva` e `ice` (ver
 * docs/architecture/ubiquitous-language.md, fila `amount`). Aun asi la clase
 * vive en el dominio y no en el KushkiAdapter: descomponer un precio en base e
 * impuesto es una regla de dinero, no un detalle de una pasarela. Kushki
 * simplemente es la unica de las cuatro que la necesita explicita; el Adapter
 * solo renombra estos campos a los suyos.
 *
 * ## La invariante que sostiene la clase
 *
 * Los cuatro componentes deben sumar exactamente el total que el comercio
 * quiere cobrar. Si no suman, el comercio cobra un monto distinto del que
 * mostro, y esa clase de descuadre es dificil de rastrear despues.
 *
 * Para garantizarlo, los constructores derivados calculan un lado y obtienen el
 * otro **por resta**, nunca redondeando ambos por separado. Con dos componentes
 * y redondeo simetrico, redondear ambos lados suele cuadrar igual, pero solo
 * "suele": la resta lo vuelve una certeza en vez de una coincidencia, y deja de
 * depender de cuantos componentes tenga la descomposicion.
 *
 * ## Por que no guarda la divisa
 *
 * Los constructores reciben una `Currency` para saber a cuantos decimales
 * redondear, pero el objeto no la conserva. La divisa ya viaja en el
 * `CreatePaymentRequest` y en `Transaction`, y tenerla en dos lugares abre la
 * posibilidad de que discrepen.
 */
export class TaxBreakdown {
  /**
   * Los cuatro componentes se exponen como campos de solo lectura, igual que
   * los de `Transaction`, porque aca no hay nada que calcular al leerlos.
   */
  private constructor(
    /** Parte del monto no sujeta a IVA (exenta o excluida). */
    public readonly subtotalIva0: Amount,
    /** Base gravable, es decir la parte sobre la que se calcula el IVA. */
    public readonly subtotalIva: Amount,
    /** Impuesto al valor agregado correspondiente a `subtotalIva`. */
    public readonly iva: Amount,
    /** Impuesto al consumo. Cero salvo que el comercio lo informe. */
    public readonly ice: Amount,
  ) {}

  /**
   * Monto total a cobrar: la suma de los cuatro componentes. Es la unica fuente
   * de verdad del total, de modo que no puede discrepar de sus partes.
   */
  getTotal(): Amount {
    return this.subtotalIva0.add(this.subtotalIva).add(this.iva).add(this.ice);
  }

  /**
   * Todo el monto queda fuera de IVA. Es el caso por defecto que documenta el
   * lenguaje ubicuo para Kushki cuando el comercio no informa desglose, y es lo
   * que corresponde usar mientras no haya un impuesto que declarar: inventar un
   * IVA que el comercio no pidio seria peor que no descomponer.
   */
  static exempt(total: Amount, currency: Currency): TaxBreakdown {
    const zero = TaxBreakdown.zero(currency);
    return new TaxBreakdown(total, zero, zero, zero);
  }

  /**
   * Descompone un precio que **ya incluye** el impuesto, que es como se cotiza
   * habitualmente en Colombia: si el comercio muestra 119.000 con IVA del 19%,
   * la base es 100.000 y el impuesto 19.000.
   *
   * La base se obtiene dividiendo entre (1 + tasa) y el impuesto se deriva
   * restando la base al total, para que los dos sumen el total exacto.
   *
   * @param rate Tasa como string decimal: `"0.19"` para un IVA del 19%.
   */
  static fromTaxIncluded(
    total: Amount,
    rate: string,
    currency: Currency,
  ): TaxBreakdown {
    const scale = currency.getMinorUnitExponent();
    const base = total.divide(TaxBreakdown.onePlus(rate), scale);
    const iva = total.subtract(base);
    const breakdown = new TaxBreakdown(
      TaxBreakdown.zero(currency),
      base,
      iva,
      TaxBreakdown.zero(currency),
    );
    TaxBreakdown.assertSumsTo(breakdown, total);
    return breakdown;
  }

  /**
   * Descompone un precio al que **todavia hay que sumarle** el impuesto. El
   * total resultante es mayor que el monto recibido, a diferencia de
   * fromTaxIncluded().
   *
   * @param rate Tasa como string decimal: `"0.19"` para un IVA del 19%.
   */
  static fromTaxExcluded(
    base: Amount,
    rate: string,
    currency: Currency,
  ): TaxBreakdown {
    TaxBreakdown.assertValidRate(rate);
    const scale = currency.getMinorUnitExponent();
    const iva = base.multiply(rate, scale);
    return new TaxBreakdown(
      TaxBreakdown.zero(currency),
      base,
      iva,
      TaxBreakdown.zero(currency),
    );
  }

  /**
   * Construye la descomposicion a partir de componentes que el comercio ya
   * calculo. Util cuando el comercio maneja varias tarifas o una parte exenta,
   * casos que no se pueden derivar de un total y una sola tasa.
   */
  static fromComponents(components: {
    subtotalIva0: Amount;
    subtotalIva: Amount;
    iva: Amount;
    ice?: Amount;
    currency: Currency;
  }): TaxBreakdown {
    return new TaxBreakdown(
      components.subtotalIva0,
      components.subtotalIva,
      components.iva,
      components.ice ?? TaxBreakdown.zero(components.currency),
    );
  }

  /** Cero con la escala de la divisa, para que todos los componentes sean homogeneos. */
  private static zero(currency: Currency): Amount {
    return Amount.fromMinorUnits(0, currency);
  }

  /**
   * Convierte una tasa (`"0.19"`) en el divisor de un precio con impuesto
   * incluido (`"1.19"`).
   *
   * No usa `Amount` para esta cuenta aunque `"0.19"` sea un string valido de
   * monto: una tasa no es dinero, y pasarla por `Amount` la limitaria a dos
   * decimales sin ninguna razon (una tasa de `"0.195"` es perfectamente
   * posible). Es el unico lugar del dominio, fuera de `Amount`, que toca big.js
   * directamente, y es por eso.
   */
  private static onePlus(rate: string): string {
    TaxBreakdown.assertValidRate(rate);
    return new Big(1).plus(new Big(rate)).toString();
  }

  /** Una tasa es un decimal no negativo sin signo ni notacion exponencial: `"0.19"`, `"0"`, `"0.195"`. */
  private static assertValidRate(rate: string): void {
    if (typeof rate !== "string" || !/^\d+(\.\d+)?$/.test(rate)) {
      throw new Error(
        `La tasa de impuesto debe ser un decimal no negativo sin signo (recibido: "${rate}")`,
      );
    }
  }

  /**
   * Red de seguridad de la invariante. No deberia dispararse nunca, porque el
   * impuesto se deriva por resta; si se dispara, es que alguien cambio la forma
   * de calcularlo y rompio la garantia.
   */
  private static assertSumsTo(breakdown: TaxBreakdown, total: Amount): void {
    if (!breakdown.getTotal().equals(total)) {
      throw new Error(
        `La descomposicion suma ${breakdown.getTotal().getValue()} y no cuadra con el total ${total.getValue()}`,
      );
    }
  }
}
