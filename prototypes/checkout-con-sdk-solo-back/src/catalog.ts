export interface Product {
  id: string;
  name: string;
  subtitle: string;
  origin: string;
  detail: string;
  notes: string;
  price: number;
  /** El dibujo de la tarjeta: el id de un `<symbol>` del sprite de `index.html`. */
  art: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: "mate-tradicional",
    name: "Yerba Mate Tradicional Orgánica",
    subtitle: "El clásico equilibrio misionero",
    origin: "Apóstoles, Misiones",
    detail: "Bolsa de lienzo kraft con cierre ziploc · 500 g",
    notes: "Hierbas silvestres, notas a pasto fresco y amargor aterciopelado de larga duración",
    price: 28_000,
    art: "art-yerba-tradicional",
  },
  {
    id: "mate-barbacua",
    name: "Yerba Mate Barbacuá Ahumada",
    subtitle: "Secado lento a leña de maderas nobles",
    origin: "Oberá, Misiones",
    detail: "Estacionamiento natural de 24 meses · 500 g",
    notes: "Toques tostados a roble y cedro, cuerpo denso, retrogusto complejo a frutos secos",
    price: 34_000,
    art: "art-yerba-barbacua",
  },
  {
    id: "mate-despalada",
    name: "Yerba Mate Selección Despalada",
    subtitle: "Pura hoja seleccionada al estilo uruguayo",
    origin: "Corrientes, Argentina",
    detail: "Molienda fina sin palo · 500 g",
    notes: "Intensa, espumosa, alta concentración mineral y máxima persistencia de infusión",
    price: 38_000,
    art: "art-yerba-despalada",
  },
  {
    id: "set-imperial",
    name: "Set Mate Imperial + Bombilla Alpaca",
    subtitle: "Calabaza gruesa con virola de alpaca",
    origin: "Taller artesanal, Misiones",
    detail: "Calabaza seleccionada forrada en cuero vaqueta legítimo y bombilla cincelada",
    notes: "Base de cuatro patas reforzada con costuras manuales y virola cincelada a mano",
    price: 125_000,
    art: "art-mate-imperial",
  },
  {
    id: "bombilla-cincelada",
    name: "Bombilla Pico de Loro de Acero Quirúrgico",
    subtitle: "Filtro cuchara ranurado y refrigerador labial",
    origin: "Montevideo, Uruguay",
    detail: "Acero inoxidable 304 · 19 cm · Desmontable",
    notes: "Diseño ergonómico curvo, fácil limpieza interior y cero retención de sedimentos",
    price: 32_000,
    art: "art-bombilla",
  },
];

export type Cart = Record<string, number>;

export interface CartLine {
  product: Product;
  quantity: number;
  subtotal: number;
}

export function setQuantity(cart: Cart, productId: string, quantity: number): Cart {
  const next = { ...cart };
  const clamped = Math.min(9, Math.max(0, Math.trunc(quantity)));
  if (clamped === 0 || !PRODUCTS.some((p) => p.id === productId)) {
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

const COP = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

export function formatCop(pesos: number): string {
  return COP.format(pesos);
}
