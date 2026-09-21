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

/**
 * Formas de pago que el contrato sabe expresar.
 *
 * Son dos, y eso es una decisión de alcance, no una etapa intermedia: el trabajo
 * unifica **tarjeta y PSE**, que son los dos métodos dominantes en Colombia.
 * Hubo un tercer valor, `CASH`, agregado en el PR #85 pensando en Efecty y
 * equivalentes; se quitó al cerrar el issue #64 porque ninguna de las cuatro
 * pasarelas lo implementaba y ninguna iba a implementarlo. Un valor que el tipo
 * admite y que los cuatro adaptadores rechazan no es extensibilidad: es una
 * promesa que el compilador deja escribir y que falla en ejecución. Ver el punto
 * 49 del `architecture-log.md`.
 */
export type PaymentMethodType = "CARD" | "PSE";

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
    public readonly installments?: number,
  ) {}

  /**
   * Tarjeta, a partir de un token emitido por la pasarela.
   *
   * El SDK nunca recibe el número de tarjeta: tokenizar es responsabilidad del
   * frontend contra la pasarela, y aceptar el número acá metería al SDK y a todo
   * lo que lo integre dentro del alcance de PCI DSS.
   *
   * **`cardToken` es opcional, y no por comodidad.** Tres de las cuatro pasarelas
   * cobran con un token que el comercio consigue antes: Wompi en `POST /tokens/cards`,
   * Mercado Pago en `POST /v1/card_tokens` y Kushki en `POST /card/v1/tokens`. Rapyd
   * no: cobrar un token de tarjeta guardado responde `ERROR_CARD_NOT_AUTHENTICATED`, y
   * su único camino servidor-a-servidor que funciona exige el número de tarjeta en la
   * petición, que es exactamente lo que este SDK no acepta. Así que en Rapyd la tarjeta
   * se cobra por su página y no hay token que mandar. Las tres que lo exigen fallan con
   * `INVALID_REQUEST` si falta, así que la omisión no se descubre como un HTTP 400 de
   * la pasarela. Ver el punto 50 del `architecture-log.md`.
   *
   * `installments` son las cuotas. Existe porque **Mercado Pago las exige**: un cobro
   * sin ellas responde `400 Invalid installments`. Wompi las acepta y no las pide,
   * Kushki las llama `months`, y en Rapyd las decide el pagador en la página. El valor
   * por omisión es 1, que es un pago de una cuota, y no se admite 0 ni fracciones.
   */
  static card(
    cardToken?: string,
    attributes?: { installments?: number },
  ): PaymentMethod {
    if (cardToken !== undefined && !cardToken) {
      throw new Error("PaymentMethod.card requiere cardToken");
    }

    const installments = attributes?.installments ?? 1;
    if (!Number.isInteger(installments) || installments < 1) {
      throw new Error(
        "PaymentMethod.card requiere installments entero y mayor o igual a 1",
      );
    }

    return new PaymentMethod("CARD", cardToken, undefined, undefined, installments);
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
