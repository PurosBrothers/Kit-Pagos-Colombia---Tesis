/**
 * El catálogo de «La Bodega de Chapinero», la tienda del prototipo B (punto 116 del
 * `architecture-log.md`). Los precios están en pesos enteros, y ningún pedido posible cae entre
 * 10 001 y 10 604, los montos que la API de Simulación reserva para escenarios de fallo
 * (`docs/02-arquitectura/3-api-de-simulacion.md`, sección 4): un pedido nunca dispara uno sin
 * querer, porque el vino más barato ya cuesta más.
 */
export interface Product {
  id: string;
  title: string;
  /** El país y la región, que la vitrina muestra arriba del nombre. */
  origin: string;
  winery: string;
  detail: string;
  blurb: string;
  priceInPesos: number;
  /** El `id` del `<symbol>` de la página con la botella. */
  art: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "casillero-del-diablo-cabernet",
    title: "Casillero del Diablo Cabernet Sauvignon",
    origin: "Chile · Valle Central",
    winery: "Concha y Toro",
    detail: "Tinto · 750 ml",
    blurb: "Frutos rojos, un toque de vainilla y taninos suaves. Va con carnes a la parrilla y pastas.",
    priceInPesos: 58_000,
    art: "art-casillero",
  },
  {
    id: "trapiche-malbec",
    title: "Trapiche Malbec",
    origin: "Argentina · Mendoza",
    winery: "Trapiche",
    detail: "Tinto · 750 ml",
    blurb: "Ciruela, mora y un final especiado. El Malbec de la cordillera para una noche de asado.",
    priceInPesos: 62_000,
    art: "art-malbec",
  },
  {
    id: "marques-de-puntalarga-tinto",
    title: "Marqués de Puntalarga Tinto",
    origin: "Colombia · Boyacá",
    winery: "Viñedo Puntalarga",
    detail: "Tinto · 750 ml",
    blurb: "Un tinto de altura de Nobsa, en el valle de Sugamuxi. Fresco y frutal, para probar lo nuestro.",
    priceInPesos: 89_000,
    art: "art-puntalarga",
  },
];

/** El máximo de un mismo vino por pedido. */
export const MAX_QUANTITY = 9;

/** Lo que pide la página: cuántas botellas de cada vino. */
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
  return `La Bodega de Chapinero · ${count} ${count === 1 ? "botella" : "botellas"}`;
}
