import { Amount } from "../../../domain/value-objects/Amount";
import { Currency } from "../../../domain/value-objects/Currency";
import { amountToString, atCurrencyScale } from "./payload-utils";

describe("atCurrencyScale", () => {
  const COP = new Currency("COP");

  it("should pad an amount that a gateway sent as a JSON number to the two decimals of COP", () => {
    const amount = atCurrencyScale(new Amount(amountToString(75000)), COP);

    expect(amount.getValue()).toBe("75000.00");
  });

  it("should complete a single decimal instead of reading 19.9 as a different amount from 19.90", () => {
    expect(atCurrencyScale(new Amount("19.9"), COP).getValue()).toBe("19.90");
  });

  it("should leave an amount that already has the currency scale as it is", () => {
    const amount = new Amount("19.90");

    expect(atCurrencyScale(amount, COP)).toBe(amount);
  });

  it("should never drop decimals the gateway reported, even beyond what the currency allows", () => {
    expect(atCurrencyScale(new Amount("100.50"), new Currency("CLP")).getValue()).toBe("100.50");
  });

  it("should keep the value, so the padded amount equals the original", () => {
    const original = new Amount("150000");

    expect(atCurrencyScale(original, COP).equals(original)).toBe(true);
  });
});
