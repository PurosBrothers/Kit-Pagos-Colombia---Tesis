import { getPublicGatewayConfigs, resolveConfig } from "../src/config";

describe("resolveConfig", () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it("abre la tienda en localtest.me, que resuelve a esta máquina, en el puerto configurado (punto 120)", () => {
    delete process.env.PUBLIC_BASE_URL;
    process.env.PORT = "4321";

    expect(resolveConfig().publicBaseUrl).toBe("http://localtest.me:4321");
  });

  it("toma PUBLIC_BASE_URL sin la barra final", () => {
    process.env.PUBLIC_BASE_URL = "https://tienda.example/";

    expect(resolveConfig().publicBaseUrl).toBe("https://tienda.example");
  });

  it("lee el secreto de webhooks de Kushki y la URL registrada en Rapyd, sin las que sus avisos no verifican", () => {
    process.env.KUSHKI_WEBHOOK_SECRET = "kushki-secreto";
    process.env.RAPYD_WEBHOOK_URL = "https://tienda.example/webhooks/rapyd";

    const { credentials } = resolveConfig();

    expect(credentials.kushki.webhookSecret).toBe("kushki-secreto");
    expect(credentials.rapyd.webhookUrl).toBe("https://tienda.example/webhooks/rapyd");
  });

  it("cobra en el sandbox por omisión, o en el simulador si se pide", () => {
    delete process.env.KIT_PAGOS_ENVIRONMENT;
    expect(resolveConfig().environment).toBe("sandbox");

    process.env.KIT_PAGOS_ENVIRONMENT = "simulator";
    expect(resolveConfig().environment).toBe("simulator");
  });

  it("no arranca con otro ambiente, como A y B: la página solo tokeniza contra los hosts de sandbox", () => {
    process.env.KIT_PAGOS_ENVIRONMENT = "production";

    expect(() => resolveConfig()).toThrow("KIT_PAGOS_ENVIRONMENT tiene que ser sandbox o simulator, no «production».");
  });

  it("nombra las pasarelas como A y B", () => {
    const names = Object.values(getPublicGatewayConfigs(resolveConfig())).map((gateway) => gateway.name);

    expect(names).toEqual(["Wompi", "Mercado Pago", "Kushki", "Rapyd"]);
  });
});
