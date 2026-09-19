/**
 * Una entidad financiera habilitada para cobrar por PSE.
 *
 * ## Por qué el SDK tiene que poder dar esta lista
 *
 * Porque en PSE el pagador **siempre** elige su banco antes de que exista el
 * pago, y esa lista cambia: entran y salen entidades, y algunas se caen
 * temporalmente. Sin una forma de pedirla, el comercio tiene dos salidas y las dos
 * son malas: hardcodearla —y mostrarle al pagador un banco que ya no está, o
 * esconderle uno que sí— o hablarle directo a la pasarela, y ahí pierde lo único
 * que el SDK le prometía, que es no tener que saber con cuál está hablando.
 *
 * ## Por qué `code` es opaco y está bien que lo sea
 *
 * Las cuatro pasarelas identifican a los bancos de formas que no se parecen:
 * Wompi y Mercado Pago usan números (`"1051"`), Kushki un `bankId` y Rapyd el
 * nombre del método de pago entero (`"co_pse_bancolombia_bank"`), porque en Rapyd
 * PSE son 47 métodos distintos y no uno con un campo de banco (punto 19).
 *
 * El SDK **no** traduce eso a un catálogo propio de bancos colombianos, y la razón
 * es que no hace falta: el `code` que sale de acá solo se usa para volver a
 * entrar al SDK, en `PaymentMethod.pse({ bankCode })`. El comercio nunca lo
 * interpreta, lo pasa. Un catálogo propio agregaría una traducción en los dos
 * sentidos, un mapa que mantener cada vez que una pasarela suma una entidad, y una
 * fuente nueva de desacuerdos, para resolver un problema que nadie tiene.
 *
 * Lo que sí hay que respetar es que un `code` de una pasarela **no sirve en otra**.
 * Los adaptadores lo verifican y fallan con un mensaje que lo dice, en vez de
 * dejar que la pasarela responda un error propio y confuso.
 *
 * ## Por qué es una interfaz y no una clase
 *
 * Por lo mismo que `PayerAddress`: no tiene invariantes propias que defender. Que
 * un código sea válido lo decide la pasarela, no la forma del objeto, y una clase
 * que solo guarda dos strings es ceremonia que además sumaría al conteo de clases
 * de las métricas CK sin defender nada.
 */
export interface PseBank {
  /**
   * Identificador de la entidad **tal como lo espera su pasarela**. Va derecho a
   * `PaymentMethod.pse({ bankCode })`, sin transformarlo.
   */
  code: string;

  /**
   * Nombre para mostrarle al pagador, tal como lo devuelve la pasarela.
   *
   * No se normaliza ni se corrige: en el sandbox de Wompi los tres bancos de
   * prueba se llaman "Banco que aprueba", "Banco que declina" y "Banco que simula
   * un error" (medido, punto 43), y eso es información útil sobre el entorno que
   * el SDK no debería disimular.
   */
  name: string;
}
