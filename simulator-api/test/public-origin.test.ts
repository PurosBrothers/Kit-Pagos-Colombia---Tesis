import { buildApp } from "../src/app";
import * as credentialResolver from "../src/auth/CredentialResolver";
import { parsePublicOrigin } from "../src/store/BankRedirectOrigins";

describe("SIMULATOR_PUBLIC_ORIGIN", () => {
  it("is optional: an empty or missing value leaves the request origin in charge", () => {
    expect(parsePublicOrigin(undefined)).toBeUndefined();
    expect(parsePublicOrigin("")).toBeUndefined();
    expect(parsePublicOrigin("   ")).toBeUndefined();
  });

  it("is reduced to protocol, host and port", () => {
    expect(parsePublicOrigin(" https://kit-pagos-colombia.onrender.com/ ")).toBe(
      "https://kit-pagos-colombia.onrender.com",
    );
    expect(parsePublicOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it.each([
    ["not a URL", "kit-pagos-colombia.onrender.com", "is not a valid URL"],
    ["another protocol", "ftp://kit-pagos-colombia.onrender.com", "must use http or https"],
    ["credentials", "https://user:secret@kit-pagos-colombia.onrender.com", "must not carry credentials"],
    ["a path", "https://kit-pagos-colombia.onrender.com/v1/sim", "must be an origin"],
    ["a query", "https://kit-pagos-colombia.onrender.com/?a=1", "must be an origin"],
  ])("rejects %s", (_case, value, message) => {
    expect(() => parsePublicOrigin(value)).toThrow(message);
  });

  it("stops the start with an invalid value, like the webhook target", () => {
    expect(() => buildApp({ publicOrigin: "https://kit-pagos-colombia.onrender.com/v1/sim" })).toThrow(
      "SIMULATOR_PUBLIC_ORIGIN must be an origin",
    );
  });

  it("is read through loadServerEnv, so the root .env applies like the other variables", async () => {
    const loader = jest
      .spyOn(credentialResolver, "loadServerEnv")
      .mockReturnValue({ SIMULATOR_PUBLIC_ORIGIN: "https://kit-pagos-colombia.onrender.com" });
    try {
      const app = buildApp();
      expect(app.publicOrigin).toBe("https://kit-pagos-colombia.onrender.com");
      await app.close();
    } finally {
      loader.mockRestore();
    }
  });
});
