import { describe, expect, it } from "vitest";
import {
  addOne,
  CART_STORAGE_KEY,
  cartCount,
  cartLines,
  cartTotal,
  formatCop,
  loadCart,
  MAX_QUANTITY,
  PRODUCTS,
  saveCart,
  setQuantity,
  toApiAmount,
} from "../src/catalog";
import type { KeyValueStorage } from "../src/checkout";
import { gatewayLabel, shopperError, shopperMessage } from "../src/messages";
import { transaction } from "./helpers/fakeApi";

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const [grano, molido, taza] = PRODUCTS;

describe("the catalog", () => {
  it("has three products with prices outside the simulator's reserved amounts", () => {
    expect(PRODUCTS).toHaveLength(3);
    for (const product of PRODUCTS) {
      expect(product.price < 10_001 || product.price > 10_604).toBe(true);
    }
  });

  it("never totals an amount in the reserved range, whatever the quantities", () => {
    for (let a = 0; a <= 3; a += 1) {
      for (let b = 0; b <= 3; b += 1) {
        for (let c = 0; c <= 3; c += 1) {
          const total = grano.price * a + molido.price * b + taza.price * c;
          expect(total >= 10_001 && total <= 10_604).toBe(false);
        }
      }
    }
  });
});

describe("the cart", () => {
  it("adds, totals and counts the lines in catalog order", () => {
    const cart = addOne(addOne(addOne({}, taza.id), grano.id), grano.id);

    expect(cartLines(cart).map((line) => [line.product.id, line.quantity, line.subtotal])).toEqual([
      [grano.id, 2, grano.price * 2],
      [taza.id, 1, taza.price],
    ]);
    expect(cartCount(cart)).toBe(3);
    expect(cartTotal(cart)).toBe(grano.price * 2 + taza.price);
  });

  it("removes a product at zero and caps the quantity", () => {
    expect(setQuantity({ [grano.id]: 2 }, grano.id, 0)).toEqual({});
    expect(setQuantity({}, grano.id, 50)).toEqual({ [grano.id]: MAX_QUANTITY });
    expect(setQuantity({}, grano.id, -3)).toEqual({});
  });

  it("ignores a product that is not in the catalog", () => {
    expect(setQuantity({}, "no-existe", 2)).toEqual({});
  });

  it("formats the amount for the API and for the shopper", () => {
    expect(toApiAmount(84_000)).toBe("84000.00");
    expect(formatCop(84_000).replace(/\s/g, " ")).toMatch(/^\$ ?84\.000$/);
  });

  it("survives the trip to the bank in storage", () => {
    const storage = memoryStorage();
    saveCart(storage, { [molido.id]: 2 });

    expect(loadCart(storage)).toEqual({ [molido.id]: 2 });
  });

  it("clears the storage when the cart is empty", () => {
    const storage = memoryStorage();
    saveCart(storage, { [molido.id]: 1 });
    saveCart(storage, {});

    expect(storage.data.has(CART_STORAGE_KEY)).toBe(false);
  });

  it("treats a corrupt or tampered value as an empty cart", () => {
    const storage = memoryStorage();
    storage.setItem(CART_STORAGE_KEY, "{no es json");
    expect(loadCart(storage)).toEqual({});

    storage.setItem(CART_STORAGE_KEY, JSON.stringify({ [grano.id]: "3", otro: 2, [taza.id]: 99 }));
    expect(loadCart(storage)).toEqual({ [taza.id]: MAX_QUANTITY });
  });
});

describe("what the shopper reads", () => {
  it("thanks on an approved payment", () => {
    expect(shopperMessage({ kind: "final", transaction: transaction("t", "APPROVED", "APPROVED") })).toMatchObject({
      tone: "approved",
    });
  });

  it("explains a decline with the hint of its category, without native codes", () => {
    const declined = {
      ...transaction("t", "DECLINED", "rejected"),
      rejectionReason: { rejectionCode: "cc_rejected_insufficient_amount", rejectionCategory: "INSUFFICIENT_FUNDS" },
    };
    const message = shopperMessage({ kind: "final", transaction: declined });

    expect(message.tone).toBe("declined");
    expect(message.detail).toContain("fondos insuficientes");
    expect(message.detail).not.toContain("cc_rejected");
  });

  it("uses a generic decline when the category is unknown or missing", () => {
    const unknown = {
      ...transaction("t", "DECLINED", "failed"),
      rejectionReason: { rejectionCode: "processing_error", rejectionCategory: "UNKNOWN" },
    };

    expect(shopperMessage({ kind: "final", transaction: unknown }).detail).toContain("no aprobaron");
    expect(shopperMessage({ kind: "final", transaction: transaction("t", "DECLINED", "DECLINED") }).tone).toBe("declined");
  });

  it.each(["EXPIRED", "VOIDED"])("treats %s as a payment that did not complete", (status) => {
    expect(shopperMessage({ kind: "final", transaction: transaction("t", status, status) })).toMatchObject({
      tone: "declined",
      title: "El pago no se completó",
    });
  });

  it("reports a gateway error as an error", () => {
    expect(shopperMessage({ kind: "final", transaction: transaction("t", "ERROR", "ERR") }).tone).toBe("error");
  });

  it("offers to check again while the payment is pending", () => {
    const pending = { gateway: "g", gatewayTransactionId: "t", orderReference: "r", method: "PSE" as const };
    expect(
      shopperMessage({ kind: "pending", transaction: transaction("t", "PENDING", "PENDING", false), pending }).tone,
    ).toBe("pending");
  });
});

describe("errors the shopper reads", () => {
  it("shows what is missing on an invalid request", () => {
    expect(shopperError({ code: "INVALID_REQUEST", message: "Falta payer.phone" })).toEqual({
      tone: "error",
      title: "Revisa tus datos",
      detail: "Falta payer.phone",
    });
  });

  it.each(["UNSUPPORTED_OPERATION", "API_UNREACHABLE", "CARD_MODULE_UNAVAILABLE", "INVALID_CREDENTIALS"])(
    "translates %s",
    (code) => {
      const message = shopperError({ code, message: "detalle técnico" });
      expect(message.detail).not.toBe("detalle técnico");
      expect(message.detail.length).toBeGreaterThan(0);
    },
  );

  it("falls back to a generic message for anything else", () => {
    expect(shopperError(new Error("boom")).detail).toContain("No se hizo ningún cobro");
  });
});

describe("gatewayLabel", () => {
  it("capitalizes the id that /v1/api returns", () => {
    expect(gatewayLabel("abc")).toBe("Abc");
    expect(gatewayLabel("")).toBe("");
  });
});
