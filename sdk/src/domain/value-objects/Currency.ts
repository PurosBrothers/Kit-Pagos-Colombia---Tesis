/**
 * Objeto de valor inmutable que representa una divisa ISO 4217.
 * Fuente: SAD, seccion 15.1 (Nucleo del dominio) - "Currency valida en su
 * constructor que el codigo recibido tenga exactamente tres letras
 * mayusculas conforme a ISO 4217, con 'COP' como valor por defecto."
 */
export class Currency {
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

  equals(other: Currency): boolean {
    return this.code === other.code;
  }
}
