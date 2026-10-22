import { MAX_QUANTITY, PRODUCTS, findProduct, linesTotal, orderDescription, orderLines } from "../src/catalog";

// El más alto de los montos que la API de Simulación reserva para escenarios de fallo, entre
// 10 001 y 10 604 (3-api-de-simulacion.md, §4).
const LAST_RESERVED = 10_604;

describe("catalog", () => {
  const [casillero, malbec] = PRODUCTS;

  it("should carry the Casillero del Diablo", () => {
    expect(PRODUCTS.map((product) => product.title)).toContain("Casillero del Diablo Cabernet Sauvignon");
  });

  it("should never reach an amount the simulator reserves for a failure scenario", () => {
    const cheapest = Math.min(...PRODUCTS.map((product) => product.priceInPesos));

    expect(cheapest).toBeGreaterThan(LAST_RESERVED);
  });

  it("should find a product by id, and nothing for an unknown one", () => {
    expect(findProduct(casillero.id)).toBe(casillero);
    expect(findProduct("vino-de-la-casa")).toBeUndefined();
  });

  it("should price the lines from the catalog, in catalog order, without unknown products", () => {
    const lines = orderLines([
      { productId: malbec.id, quantity: 1 },
      { productId: "vino-de-la-casa", quantity: 4 },
      { productId: casillero.id, quantity: 2 },
    ]);

    expect(lines.map((line) => line.productId)).toEqual([casillero.id, malbec.id]);
    expect(linesTotal(lines)).toBe(2 * casillero.priceInPesos + malbec.priceInPesos);
  });

  it("should cap repeated lines at the maximum per wine", () => {
    const [line] = orderLines([
      { productId: casillero.id, quantity: MAX_QUANTITY },
      { productId: casillero.id, quantity: 3 },
    ]);

    expect(line.quantity).toBe(MAX_QUANTITY);
  });

  it("should describe the order briefly, in singular and in plural", () => {
    expect(orderDescription(orderLines([{ productId: casillero.id, quantity: 1 }]))).toBe("La Bodega de Chapinero · 1 botella");
    expect(
      orderDescription(orderLines([
        { productId: casillero.id, quantity: 2 },
        { productId: malbec.id, quantity: 1 },
      ])),
    ).toBe("La Bodega de Chapinero · 3 botellas");
  });
});
