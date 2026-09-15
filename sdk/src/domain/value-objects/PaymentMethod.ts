/**
 * Objeto de valor inmutable que describe **con qué** se paga, no cuánto ni quién.
 *
 * ## Por qué existe
 *
 * Hasta el issue #64 el SDK solo sabía crear pagos con el método por defecto de
 * cada pasarela, que en las cuatro es tarjeta. `CreatePaymentRequest` no tenía
 * dónde decir "esto es un PSE contra Bancolombia", así que PSE era inexpresable.
 *
 * ## Qué NO va acá, y por qué
 *
 * El **documento del pagador** no vive en este objeto: vive en `Payer`, que ya
 * declara `documentType` y `documentNumber`. Duplicarlo acá crearía dos fuentes
 * de verdad para el mismo dato y la pregunta "¿cuál gana?" no tendría respuesta
 * buena. Lo que sí aporta este objeto es saber **cuándo ese dato pasa a ser
 * obligatorio**, que es lo que expone `requiresPayerDocument()`.
 *
 * ## El campo `bankCode` no es portable entre pasarelas
 *
 * Esta es la limitación honesta del modelo y conviene tenerla escrita. Las
 * cuatro pasarelas piden el banco de PSE, pero **ninguna usa el mismo
 * identificador**:
 *
 * - Wompi lo recibe en `financial_institution_code` (en sandbox, `"1"` aprueba
 *   y `"2"` declina).
 * - Kushki lo recibe en `bankId`, tomado de `GET /transfer/v1/bankList`.
 * - Rapyd no lo recibe como campo: lo **concatena en el nombre del método**,
 *   con el patrón `co_pse_{banco}_bank` (ver `architecture-log.md`, punto 19).
 *
 * Por eso `bankCode` es un string opaco con alcance de pasarela: el adaptador
 * sabe cómo interpretarlo, el dominio no. La consecuencia para el comercio es
 * que **el código de banco no se puede reutilizar al cambiar de pasarela**, a
 * diferencia del monto, la divisa o la referencia. Es el único dato del contrato
 * con esa propiedad, y está documentado en `docs/testing-data/`.
 */

/** Formas de pago que el contrato sabe expresar. */
export type PaymentMethodType = "CARD" | "PSE" | "CASH";

/**
 * Naturaleza jurídica del pagador, que PSE exige distinguir por regulación
 * colombiana. Wompi lo modela como `user_type` (`0` natural, `1` jurídica) y
 * Kushki como `userType`; el dominio lo nombra en vez de usar un número, porque
 * `0` y `1` no se leen.
 */
export type PayerKind = "NATURAL" | "LEGAL";

export class PaymentMethod {
  /**
   * Privado a propósito: se construye por los constructores nombrados de abajo.
   * Un constructor público permitiría `new PaymentMethod("PSE")` sin banco, que
   * es justo el estado inválido que este objeto existe para hacer imposible.
   */
  private constructor(
    public readonly type: PaymentMethodType,
    public readonly cardToken?: string,
    public readonly bankCode?: string,
    public readonly payerKind?: PayerKind,
    public readonly cashNetwork?: string,
  ) {}

  /**
   * Tarjeta, a partir de un token emitido por la pasarela.
   *
   * El SDK nunca recibe el número de tarjeta: tokenizar es responsabilidad del
   * frontend contra la pasarela, y aceptar el número acá metería al SDK y a todo
   * lo que lo integre dentro del alcance de PCI DSS.
   */
  static card(cardToken: string): PaymentMethod {
    if (!cardToken) {
      throw new Error("PaymentMethod.card requiere cardToken");
    }
    return new PaymentMethod("CARD", cardToken);
  }

  /**
   * PSE, contra un banco concreto.
   *
   * `bankCode` es obligatorio porque en PSE no existe "el banco por defecto":
   * el pagador siempre elige uno, y la lista sale de la pasarela activa.
   * `payerKind` es por defecto `NATURAL`, que es el caso mayoritario, en vez de
   * obligar a informarlo en cada llamada.
   */
  static pse(attributes: {
    bankCode: string;
    payerKind?: PayerKind;
  }): PaymentMethod {
    if (!attributes.bankCode) {
      throw new Error("PaymentMethod.pse requiere bankCode");
    }
    return new PaymentMethod(
      "PSE",
      undefined,
      attributes.bankCode,
      attributes.payerKind ?? "NATURAL",
    );
  }

  /**
   * Efectivo en red física (Efecty, SuRed, MovilRed y equivalentes).
   *
   * `network` es opcional porque hay pasarelas que exponen una sola red y no
   * piden elegir; cuando se omite, decide la pasarela.
   */
  static cash(attributes?: { network?: string }): PaymentMethod {
    return new PaymentMethod(
      "CASH",
      undefined,
      undefined,
      undefined,
      attributes?.network,
    );
  }

  /**
   * Si este método obliga a que `Payer` traiga `documentType` y
   * `documentNumber`.
   *
   * Solo PSE lo exige, y lo exige en las cuatro pasarelas: es requisito de la
   * red, no de un proveedor. En Rapyd son `customer_identification_type` y
   * `customer_identification_number`, ambos con `is_required: true` en los 47
   * métodos `co_pse_*` del catálogo colombiano.
   *
   * Se expresa como pregunta al método y no como validación dentro de `Payer`
   * porque `Payer` no sabe con qué se va a pagar: el mismo pagador es válido sin
   * documento para tarjeta e inválido sin documento para PSE.
   */
  requiresPayerDocument(): boolean {
    return this.type === "PSE";
  }
}
