import { isPseBankCode, type PseBankCode } from "./PseBankCode";

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
 * ## Dos códigos: el de la pasarela y el de PSE
 *
 * Las cuatro pasarelas identifican a los bancos de formas que no se parecen.
 * Mercado Pago usa el código de compensación de ACH (`"1051"`); Wompi y Kushki
 * también en producción, pero sus sandboxes tienen bancos ficticios con otros
 * códigos (`"1"`, `"0001"`); y Rapyd usa el nombre del método de pago entero
 * (`"co_pse_bancolombia_bank"`), porque en Rapyd PSE son 47 métodos distintos y no
 * uno con un campo de banco (punto 19).
 *
 * `code` es el de la pasarela, sin tocar, y es el único que existe para todos los
 * bancos de la lista, incluidos los de prueba. `achCode` es el código de PSE, que
 * es el mismo en las cuatro, y existe cuando el banco está en `PseBankCode`. Un
 * comercio que solo quiera Bancolombia no necesita la lista: le pasa
 * `PseBankCode.BANCOLOMBIA` a `PaymentMethod.pse()`. La lista sigue haciendo falta
 * para armar el selector del pagador, y `achCode` sirve para, por ejemplo,
 * destacar los bancos más usados sin depender de cómo los nombra cada pasarela
 * (punto 68).
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

  /**
   * Código de compensación de PSE, igual en las cuatro pasarelas. Falta cuando la
   * entidad no está en `PseBankCode`, como los bancos ficticios de los sandboxes de
   * Wompi y Kushki.
   */
  achCode?: PseBankCode;
}

/**
 * Arma un `PseBank` y agrega el código de PSE solo si `achCode` es del catálogo.
 *
 * Por omisión `achCode` es el mismo `code`, que es el caso de las pasarelas que
 * usan el código de compensación como identificador propio. Rapyd le pasa el que
 * resulta de su tabla de traducción.
 */
export function describePseBank(code: string, name: string, achCode: string = code): PseBank {
  return isPseBankCode(achCode) ? { code, name, achCode } : { code, name };
}
