import type { KeyValueStorage } from "./checkout";

/**
 * El catálogo de la tienda y el carrito. Los precios están en pesos enteros y ninguno cae entre
 * 10 001 y 10 604, los montos que la API de Simulación reserva para escenarios de fallo
 * (`docs/02-arquitectura/3-api-de-simulacion.md`, sección 4): un pedido de la tienda nunca
 * dispara uno sin querer.
 */
export interface Product {
  id: string;
  name: string;
  origin: string;
  detail: string;
  notes: string;
  price: number;
  /** El `id` del `<symbol>` de `index.html` con la ilustración. */
  art: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "huila-grano",
    name: "Huila lavado",
    origin: "Pitalito, Huila",
    detail: "Café en grano · 500 g",
    notes: "Panela, naranja y un final de chocolate",
    price: 48_000,
    art: "art-grano",
  },
  {
    id: "narino-molido",
    name: "Nariño honey",
    origin: "La Unión, Nariño",
    detail: "Café molido · 250 g",
    notes: "Cacao, mora y miel de caña",
    price: 29_000,
    art: "art-molido",
  },
  {
    id: "taza-gres",
    name: "Taza de gres",
    origin: "Ráquira, Boyacá",
    detail: "Cerámica hecha a mano · 300 ml",
    notes: "Esmalte arena, cada una distinta",
    price: 36_000,
    art: "art-taza",
  },
];

/** Cantidad por producto. Un producto que no está, o con cero, no va en el pedido. */
export type Cart = Record<string, number>;

export const MAX_QUANTITY = 9;

export interface CartLine {
  product: Product;
  quantity: number;
  subtotal: number;
}

export function setQuantity(cart: Cart, productId: string, quantity: number): Cart {
  const next = { ...cart };
  const clamped = Math.min(MAX_QUANTITY, Math.max(0, Math.trunc(quantity)));
  if (clamped === 0 || !PRODUCTS.some((product) => product.id === productId)) {
    delete next[productId];
  } else {
    next[productId] = clamped;
  }
  return next;
}

export function addOne(cart: Cart, productId: string): Cart {
  return setQuantity(cart, productId, (cart[productId] ?? 0) + 1);
}

export function cartLines(cart: Cart): CartLine[] {
  return PRODUCTS.filter((product) => (cart[product.id] ?? 0) > 0).map((product) => ({
    product,
    quantity: cart[product.id],
    subtotal: product.price * cart[product.id],
  }));
}

export function cartCount(cart: Cart): number {
  return cartLines(cart).reduce((count, line) => count + line.quantity, 0);
}

export function cartTotal(cart: Cart): number {
  return cartLines(cart).reduce((total, line) => total + line.subtotal, 0);
}

/** El monto como lo recibe `/v1/api`: pesos con dos decimales. */
export function toApiAmount(pesos: number): string {
  return pesos.toFixed(2);
}

const COP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export function formatCop(pesos: number): string {
  return COP.format(pesos);
}

export const CART_STORAGE_KEY = "kit-pagos-checkout-c:cart";

/** El carrito sobrevive a la ida al banco: al volver, la confirmación muestra lo que se pagó. */
export function saveCart(storage: KeyValueStorage, cart: Cart): void {
  if (cartCount(cart) === 0) {
    storage.removeItem(CART_STORAGE_KEY);
    return;
  }
  storage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

export function loadCart(storage: KeyValueStorage): Cart {
  const raw = storage.getItem(CART_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed).reduce<Cart>(
      (cart, [id, quantity]) => (typeof quantity === "number" ? setQuantity(cart, id, quantity) : cart),
      {},
    );
  } catch {
    return {};
  }
}
