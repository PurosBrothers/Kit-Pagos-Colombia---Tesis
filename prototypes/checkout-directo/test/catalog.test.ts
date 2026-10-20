import { MAX_QUANTITY, PRODUCTS, findProduct, linesTotal, orderDescription, orderLines } from "../src/catalog";

// El más alto de los montos que la API de Simulación reserva para escenarios de fallo, entre
// 10 001 y 10 604 (3-api-de-simulacion.md, §4).
const LAST_RESERVED = 10_604;

describe("catalog", () => {
  const [batman, superman] = PRODUCTS;

  it("should never reach an amount the simulator reserves for a failure scenario", () => {
    const cheapest = Math.min(...PRODUCTS.map((product) => product.priceInPesos));

    expect(cheapest).toBeGreaterThan(LAST_RESERVED);
  });

  it("should find a product by id, and nothing for an unknown one", () => {
    expect(findProduct(batman.id)).toBe(batman);
    expect(findProduct("watchmen")).toBeUndefined();
  });

  it("should price the lines from the catalog, in catalog order, without unknown products", () => {
    const lines = orderLines([
      { productId: superman.id, quantity: 1 },
      { productId: "watchmen", quantity: 4 },
      { productId: batman.id, quantity: 2 },
    ]);

    expect(lines.map((line) => line.productId)).toEqual([batman.id, superman.id]);
    expect(linesTotal(lines)).toBe(2 * batman.priceInPesos + superman.priceInPesos);
  });

  it("should cap repeated lines at the maximum per comic", () => {
    const [line] = orderLines([
      { productId: batman.id, quantity: MAX_QUANTITY },
      { productId: batman.id, quantity: 3 },
    ]);

    expect(line.quantity).toBe(MAX_QUANTITY);
  });

  it("should describe the order briefly, in singular and in plural", () => {
    expect(orderDescription(orderLines([{ productId: batman.id, quantity: 1 }]))).toBe("La Candelaria Cómics · 1 cómic");
    expect(
      orderDescription(orderLines([
        { productId: batman.id, quantity: 2 },
        { productId: superman.id, quantity: 1 },
      ])),
    ).toBe("La Candelaria Cómics · 3 cómics");
  });
});
