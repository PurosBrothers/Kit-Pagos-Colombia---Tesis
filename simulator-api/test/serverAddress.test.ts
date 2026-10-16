import { Gateway } from "kit-pagos-colombia";
import * as credentialResolver from "../src/auth/CredentialResolver";
import { listenAddress, serverPort } from "../src/serverAddress";
import { KitPagosProvider } from "../src/services/KitPagosProvider";
import { bankRedirectOriginFor } from "../src/store/BankRedirectOrigins";

/**
 * El puerto de la API sale de un solo lugar. Antes `server.ts` leía `process.env.PORT` y
 * `KitPagosProvider` y `BankRedirectOrigins` lo leían de `loadServerEnv()`: un `PORT` puesto solo
 * en un `.env` movía las URL que la API arma hacia sí misma, pero no el puerto en el que escuchaba.
 */
describe("serverPort", () => {
  it.each([
    ["missing", {}],
    ["empty", { PORT: "" }],
    ["blank", { PORT: "   " }],
  ])("should be 3000 when PORT is %s", (_case, env) => {
    expect(serverPort(env)).toBe(3000);
  });

  it.each([
    ["10000", 10000],
    [" 4000 ", 4000],
    ["1", 1],
    ["65535", 65535],
  ])("should read PORT %p as %p", (value, expected) => {
    expect(serverPort({ PORT: value })).toBe(expected);
  });

  it.each([["0"], ["65536"], ["abc"], ["3000.5"], ["-1"], ["1e3"], ["0x10"]])(
    "should reject PORT %p instead of listening somewhere else",
    (value) => {
      expect(() => serverPort({ PORT: value })).toThrow(`PORT debe ser un entero entre 1 y 65535, y vale "${value}".`);
    },
  );
});

describe("listenAddress", () => {
  it("should listen on 0.0.0.0:3000 without PORT or HOST", () => {
    expect(listenAddress({})).toEqual({ port: 3000, host: "0.0.0.0" });
    expect(listenAddress({ HOST: "  " })).toEqual({ port: 3000, host: "0.0.0.0" });
  });

  it("should take PORT and HOST when they come", () => {
    expect(listenAddress({ PORT: "10000", HOST: " :: " })).toEqual({ port: 10000, host: "::" });
  });
});

describe("the port of the whole server", () => {
  it("should be the same for the listener, the SDK and the bank origin when PORT is only in a .env", () => {
    const loader = jest.spyOn(credentialResolver, "loadServerEnv").mockReturnValue({ PORT: "4567" });
    try {
      expect(listenAddress().port).toBe(4567);
      expect(new KitPagosProvider().resolveSimulatorBaseUrl(Gateway.WOMPI)).toBe("http://localhost:4567/v1/sim/wompi");
      expect(bankRedirectOriginFor("wompi", "cobro-sin-registro")).toBe("http://localhost:4567");
    } finally {
      loader.mockRestore();
    }
  });

  it("should fail in the three places alike with an invalid PORT", () => {
    const loader = jest.spyOn(credentialResolver, "loadServerEnv").mockReturnValue({ PORT: "abc" });
    try {
      expect(() => listenAddress()).toThrow("PORT debe ser un entero");
      expect(() => new KitPagosProvider().resolveSimulatorBaseUrl(Gateway.WOMPI)).toThrow("PORT debe ser un entero");
      expect(() => bankRedirectOriginFor("wompi", "cobro-sin-registro")).toThrow("PORT debe ser un entero");
    } finally {
      loader.mockRestore();
    }
  });
});
