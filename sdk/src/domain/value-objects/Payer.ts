/**
 * Objeto de valor inmutable que agrupa los datos de quien paga.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Payer agrupa los datos de
 * quien paga y valida en su constructor que el campo email este presente,
 * siendo el unico atributo obligatorio."
 *
 * ## Por que hay campos que ninguna pasarela usa todavia
 *
 * Todos los campos menos `email` son opcionales, y eso es a proposito: cada
 * pasarela exige un subconjunto distinto, y el unico que exigen las cuatro es el
 * correo. Validar aca lo que pide una sola le daria a esa pasarela poder de veto
 * sobre las otras tres, que es exactamente lo que la Arquitectura Hexagonal
 * separa. Quien decide que falta es el adaptador, que sabe contra que API va a
 * hablar (ver `wompi-pse.ts` y `mercadopago-pse.ts`).
 */

/**
 * Direccion del pagador, que PSE en Mercado Pago exige completa.
 *
 * Los cinco subcampos son los que la Orders API rechaza por separado con
 * `'$.payer.address' - missing properties` (medido el 18 de septiembre de 2026,
 * ver `architecture-log.md`, punto 45). Es una interfaz y no una clase porque no
 * tiene invariantes propias que defender: la obligatoriedad depende de la
 * pasarela y del metodo de pago, no de la direccion en si.
 */
export interface PayerAddress {
  streetName: string;
  streetNumber: string;
  city: string;
  zipCode: string;
  neighborhood: string;
}

export interface PayerAttributes {
  email: string;
  fullName?: string;
  /**
   * Nombre y apellido por separado.
   *
   * Conviven con `fullName` en vez de derivarse de el porque **partir un nombre
   * no es una operacion segura**: en Colombia lo habitual son dos apellidos, y
   * "Juan Carlos Perez Gomez" no tiene una division correcta deducible. Mercado
   * Pago exige `first_name` y `last_name` como campos separados, asi que el
   * comercio los informa explicitamente o el pago falla con un error del SDK que
   * dice cual falta. `fullName` queda para mostrar.
   */
  firstName?: string;
  lastName?: string;
  documentType?: string;
  documentNumber?: string;
  phone?: string;
  /**
   * Indicativo telefonico, separado del numero porque Mercado Pago pide
   * `phone: { area_code, number }` en dos campos. Para Colombia es "57".
   */
  phoneAreaCode?: string;
  address?: PayerAddress;
}

export class Payer {
  public readonly email: string;
  public readonly fullName?: string;
  public readonly firstName?: string;
  public readonly lastName?: string;
  public readonly documentType?: string;
  public readonly documentNumber?: string;
  public readonly phone?: string;
  public readonly phoneAreaCode?: string;
  public readonly address?: PayerAddress;

  constructor(attributes: PayerAttributes) {
    if (!attributes.email) {
      throw new Error("Payer requiere el campo email");
    }
    this.email = attributes.email;
    this.fullName = attributes.fullName;
    this.firstName = attributes.firstName;
    this.lastName = attributes.lastName;
    this.documentType = attributes.documentType;
    this.documentNumber = attributes.documentNumber;
    this.phone = attributes.phone;
    this.phoneAreaCode = attributes.phoneAreaCode;
    this.address = attributes.address;
  }
}
