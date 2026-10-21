/** El único producto del checkout mínimo (plan de evaluación, §2: «mostrar un producto»). */
export interface Product {
  id: string;
  name: string;
  description: string;
  priceInPesos: number;
}

export const PRODUCT: Product = {
  id: "camiseta-kit-pagos",
  name: "Camiseta Kit Pagos",
  description: "Camiseta de algodón con el logo del proyecto.",
  priceInPesos: 50000,
};
