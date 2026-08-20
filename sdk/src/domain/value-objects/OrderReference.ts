/**
 * Objeto de valor inmutable que representa la referencia de orden generada
 * por el comercio. Fuente: SAD, seccion 15.1 (Nucleo del dominio) -
 * "OrderReference valida unicamente que su valor no este vacio, sin generar
 * ni garantizar unicidad."
 */
export class OrderReference {
  private readonly value: string;

  constructor(value: string) {
    if (!value || value.trim().length === 0) {
      throw new Error("OrderReference no puede estar vacio");
    }
    this.value = value;
  }

  getValue(): string {
    return this.value;
  }

  equals(other: OrderReference): boolean {
    return this.value === other.value;
  }
}
