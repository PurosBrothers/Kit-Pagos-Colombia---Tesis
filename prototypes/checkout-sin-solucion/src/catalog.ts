/**
 * El catálogo de «La Candelaria Cómics», la tienda del prototipo A (punto 110 del
 * `architecture-log.md`). Los precios están en pesos enteros, y ningún pedido posible cae entre
 * 10 001 y 10 604, los montos que la API de Simulación reserva para escenarios de fallo
 * (`docs/02-arquitectura/3-api-de-simulacion.md`, sección 4): un pedido nunca dispara uno sin
 * querer, porque el cómic más barato ya cuesta más.
 */
export interface Product {
  id: string;
  title: string;
  /** El personaje, que la vitrina muestra arriba del título. */
  hero: string;
  credits: string;
  detail: string;
  blurb: string;
  priceInPesos: number;
  /** El `id` del `<symbol>` de la página con la portada. */
  art: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "batman-ano-uno",
    title: "Batman: Año Uno",
    hero: "Batman",
    credits: "Frank Miller y David Mazzucchelli",
    detail: "Tapa dura · 144 páginas",
    blurb: "El primer año de Bruce Wayne con la capa, y el de Jim Gordon en una Gotham corrupta.",
    priceInPesos: 68_000,
    art: "art-batman",
  },
  {
    id: "superman-hijo-rojo",
    title: "Superman: Hijo Rojo",
    hero: "Superman",
    credits: "Mark Millar y Dave Johnson",
    detail: "Tapa blanda · 168 páginas",
    blurb: "¿Y si la nave de Kal-El hubiera caído en una granja de Ucrania y no en Kansas?",
    priceInPesos: 79_000,
    art: "art-superman",
  },
  {
    id: "spiderman-caceria-de-kraven",
    title: "Spider-Man: La última cacería de Kraven",
    hero: "Spider-Man",
    credits: "J. M. DeMatteis y Mike Zeck",
    detail: "Tapa blanda · 152 páginas",
    blurb: "Kraven entierra a Spider-Man y sale a las calles de Nueva York con su traje.",
    priceInPesos: 74_000,
    art: "art-spiderman",
  },
];

/** El máximo de un mismo cómic por pedido. */
export const MAX_QUANTITY = 9;

/** Lo que pide la página: cuántos de cada cómic. */
export interface RequestedItem {
  productId: string;
  quantity: number;
}

/** Una línea del pedido, con el precio del catálogo en el momento de comprar. */
export interface OrderLine {
  productId: string;
  title: string;
  quantity: number;
  unitPriceInPesos: number;
}

export function findProduct(productId: string): Product | undefined {
  return PRODUCTS.find((product) => product.id === productId);
}

/**
 * Las líneas del pedido con los precios del catálogo: el servidor no confía en un precio que
 * venga del navegador. Junta las líneas repetidas y descarta los productos que no existen; el
 * schema de la ruta ya rechazó las cantidades fuera de rango.
 */
export function orderLines(items: readonly RequestedItem[]): OrderLine[] {
  const quantities = new Map<string, number>();
  for (const item of items) {
    if (findProduct(item.productId)) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
  }
  return PRODUCTS.filter((product) => quantities.has(product.id)).map((product) => ({
    productId: product.id,
    title: product.title,
    quantity: Math.min(MAX_QUANTITY, quantities.get(product.id) ?? 0),
    unitPriceInPesos: product.priceInPesos,
  }));
}

export function linesTotal(lines: readonly OrderLine[]): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitPriceInPesos, 0);
}

/** La descripción que ve el pagador en su banco: corta, sin la lista completa. */
export function orderDescription(lines: readonly OrderLine[]): string {
  const count = lines.reduce((total, line) => total + line.quantity, 0);
  return `La Candelaria Cómics · ${count} ${count === 1 ? "cómic" : "cómics"}`;
}
