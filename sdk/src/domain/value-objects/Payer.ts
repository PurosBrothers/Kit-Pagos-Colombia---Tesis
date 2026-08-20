/**
 * Objeto de valor inmutable que agrupa los datos de quien paga.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Payer agrupa los datos de
 * quien paga y valida en su constructor que el campo email este presente,
 * siendo el unico atributo obligatorio."
 */
export interface PayerAttributes {
  email: string;
  fullName?: string;
  documentType?: string;
  documentNumber?: string;
  phone?: string;
}

export class Payer {
  public readonly email: string;
  public readonly fullName?: string;
  public readonly documentType?: string;
  public readonly documentNumber?: string;
  public readonly phone?: string;

  constructor(attributes: PayerAttributes) {
    if (!attributes.email) {
      throw new Error("Payer requiere el campo email");
    }
    this.email = attributes.email;
    this.fullName = attributes.fullName;
    this.documentType = attributes.documentType;
    this.documentNumber = attributes.documentNumber;
    this.phone = attributes.phone;
  }
}
