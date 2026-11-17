import { OrderPayload, externalHelper } from './types';

// Función suelta con tipo importado en firma, llamada directa y callback con ramas
export function processOrder(order: OrderPayload): number {
  const items = [1, 2, 3];
  // Llamada directa a función externa no declarada en este archivo
  externalHelper(order.id);
  // Callback con ramas dentro de una función, cuyas ramas se suman a la función que lo contiene
  const mapped = items.map((n) => (n > 2 ? n * 2 : n));
  if (mapped.length > 0) {
    return mapped[0];
  }
  return 0;
}

// Flecha asignada a una constante, con llamada con punto
export const calculateTax = (amount: number): number => {
  return Math.round(amount * 0.19);
};

// Métodos de un objeto literal
export const orderHandler = {
  validate(status: string): boolean {
    if (status === 'PAID') {
      return true;
    }
    return false;
  },
  format(id: string): string {
    return id.trim();
  },
};
