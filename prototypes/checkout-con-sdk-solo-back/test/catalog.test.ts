import {
  PRODUCTS,
  Cart,
  setQuantity,
  addOne,
  cartLines,
  cartCount,
  cartTotal,
  formatCop,
} from "../src/catalog";

describe("Catalog & Cart utilities", () => {
  it("contiene los 5 productos de yerba mate y accesorios", () => {
    expect(PRODUCTS).toHaveLength(5);
    expect(PRODUCTS[0].id).toBe("mate-tradicional");
  });

  it("permite agregar productos y modificar cantidades", () => {
    let cart: Cart = {};
    cart = setQuantity(cart, "mate-tradicional", 2);
    expect(cart["mate-tradicional"]).toBe(2);

    cart = addOne(cart, "mate-tradicional");
    expect(cart["mate-tradicional"]).toBe(3);

    // Reducir a 0 lo elimina
    cart = setQuantity(cart, "mate-tradicional", 0);
    expect(cart["mate-tradicional"]).toBeUndefined();

    // No permite cantidades negativas ni productos inexistentes
    cart = setQuantity(cart, "producto-falso", 1);
    expect(cart["producto-falso"]).toBeUndefined();

    cart = setQuantity(cart, "mate-barbacua", -5);
    expect(cart["mate-barbacua"]).toBeUndefined();

    // Clamped a 9
    cart = setQuantity(cart, "mate-barbacua", 20);
    expect(cart["mate-barbacua"]).toBe(9);
  });

  it("calcula líneas, conteo y total del carrito", () => {
    let cart = {
      "mate-tradicional": 2, // 28000 * 2 = 56000
      "mate-barbacua": 1,    // 34000 * 1 = 34000
    };

    const lines = cartLines(cart);
    expect(lines).toHaveLength(2);
    expect(lines[0].subtotal).toBe(56000);
    expect(lines[1].subtotal).toBe(34000);

    expect(cartCount(cart)).toBe(3);
    expect(cartTotal(cart)).toBe(90000);

    const formatted = formatCop(90000);
    expect(formatted).toContain("90.000");
  });
});
