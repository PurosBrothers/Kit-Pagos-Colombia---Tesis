import { FastifyInstance, FastifyRequest } from "fastify";
import { CreatePaymentRequest } from "kit-pagos-colombia";
import { buildApp } from "../src/app";
import { normalizePayerIp, parseTrustForwardedFor, payerIpOf } from "../src/kit-pagos-api/payer-ip";
import { KitPagosProvider } from "../src/services/KitPagosProvider";

/**
 * La IP del pagador en `POST /v1/api/payments` (punto 92): la del cuerpo si llega, y si no, la
 * de la petición, en los dos casos sin espacios y con `::ffff:a.b.c.d` y `::1` escritas como IPv4,
 * que es como las acepta Mercado Pago. Un proveedor falso captura lo que la ruta le pasa al SDK.
 */

const SOCKET_IP = "203.0.113.7";

function appCapturing(trustForwardedFor: boolean) {
  const received: CreatePaymentRequest[] = [];
  const kitPagos = {
    createPayment: async (paymentRequest: CreatePaymentRequest) => {
      received.push(paymentRequest);
      return {
        outcome: "REDIRECT_REQUIRED",
        redirect: {
          redirectUrl: "https://banco.example.com/pse",
          gatewayTransactionId: { value: "ORD-TEST-1" },
          rawStatus: "action_required",
        },
      };
    },
  };
  const provider = { resolveClient: () => ({ kitPagos, target: "simulator" }) } as unknown as KitPagosProvider;
  const app = buildApp({ logger: false, kitPagosProvider: provider, trustForwardedFor, webhooks: {} });
  return { app, received };
}

function pse(ipAddress?: string) {
  return {
    gateway: "mercadopago",
    amount: "50000.00",
    currency: "COP",
    orderReference: `ORD-IP-${Date.now()}`,
    payer: { email: "pagador@example.com" },
    paymentMethod: { type: "PSE", bankCode: "1001" },
    ...(ipAddress === undefined ? {} : { ipAddress }),
  };
}

async function ipSent(
  app: FastifyInstance,
  received: CreatePaymentRequest[],
  body: object,
  headers: Record<string, string> = {},
  remoteAddress: string = SOCKET_IP,
): Promise<string | undefined> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/api/payments",
    payload: body,
    headers,
    remoteAddress,
  });
  expect(response.statusCode).toBe(201);
  return received[received.length - 1]?.ipAddress;
}

describe("the payer IP of POST /v1/api/payments", () => {
  describe("without trusting X-Forwarded-For (the default)", () => {
    const { app, received } = appCapturing(false);
    afterAll(() => app.close());

    it("should keep the IP the body sends, as a backend calling the API does", async () => {
      await expect(ipSent(app, received, pse("186.84.90.12"))).resolves.toBe("186.84.90.12");
    });

    it("should take the socket IP when the body has none, as a browser calling the API does", async () => {
      await expect(ipSent(app, received, pse())).resolves.toBe(SOCKET_IP);
    });

    it("should treat a blank IP in the body as missing", async () => {
      await expect(ipSent(app, received, pse("   "))).resolves.toBe(SOCKET_IP);
    });

    it("should ignore X-Forwarded-For, which any client can write", async () => {
      const ip = await ipSent(app, received, pse(), { "x-forwarded-for": "198.51.100.23" });

      expect(ip).toBe(SOCKET_IP);
    });

    it("should send the socket IP of a dual-stack server as IPv4, the form Mercado Pago accepts", async () => {
      await expect(ipSent(app, received, pse(), {}, "::ffff:203.0.113.7")).resolves.toBe("203.0.113.7");
    });

    it("should send the IPv6 loopback of the socket as 127.0.0.1", async () => {
      await expect(ipSent(app, received, pse(), {}, "::1")).resolves.toBe("127.0.0.1");
    });

    it("should normalize the same forms in the body, without changing the address", async () => {
      await expect(ipSent(app, received, pse("::ffff:186.84.90.12"))).resolves.toBe("186.84.90.12");
      await expect(ipSent(app, received, pse("::1"))).resolves.toBe("127.0.0.1");
      await expect(ipSent(app, received, pse(" 186.84.90.12 "))).resolves.toBe("186.84.90.12");
    });

    it("should keep an IPv6 of the body that Mercado Pago accepts as it came", async () => {
      await expect(ipSent(app, received, pse("2800:484:1a2b:3c00::20"))).resolves.toBe("2800:484:1a2b:3c00::20");
    });
  });

  describe("trusting X-Forwarded-For, as behind Render", () => {
    const { app, received } = appCapturing(true);
    afterAll(() => app.close());

    it("should take the first address of X-Forwarded-For", async () => {
      const ip = await ipSent(app, received, pse(), { "x-forwarded-for": " 198.51.100.23 , 10.1.2.3" });

      expect(ip).toBe("198.51.100.23");
    });

    it("should still prefer the IP of the body", async () => {
      const ip = await ipSent(app, received, pse("186.84.90.12"), { "x-forwarded-for": "198.51.100.23" });

      expect(ip).toBe("186.84.90.12");
    });

    it("should fall back to the socket IP when the header is missing or empty", async () => {
      await expect(ipSent(app, received, pse())).resolves.toBe(SOCKET_IP);
      await expect(ipSent(app, received, pse(), { "x-forwarded-for": " , 10.1.2.3" })).resolves.toBe(SOCKET_IP);
    });

    it.each([
      ["::ffff:198.51.100.23, 10.1.2.3", "198.51.100.23"],
      [" ::1 , 10.1.2.3", "127.0.0.1"],
      ["::FFFF:10.0.0.5", "10.0.0.5"],
      ["2800:484:1a2b:3c00::20, 10.1.2.3", "2800:484:1a2b:3c00::20"],
    ])("should normalize the first address of X-Forwarded-For %p to %p", async (header, expected) => {
      await expect(ipSent(app, received, pse(), { "x-forwarded-for": header })).resolves.toBe(expected);
    });

    it("should normalize the socket IP it falls back to", async () => {
      await expect(ipSent(app, received, pse(), { "x-forwarded-for": " , 10.1.2.3" }, "::ffff:203.0.113.7")).resolves.toBe(
        "203.0.113.7",
      );
    });
  });

  it("should take the first address when X-Forwarded-For arrives as several headers", () => {
    const request = {
      headers: { "x-forwarded-for": ["::ffff:198.51.100.23", "10.1.2.3"] },
      ip: SOCKET_IP,
    } as unknown as FastifyRequest;

    expect(payerIpOf(request, true)).toBe("198.51.100.23");
  });

  it("should not invent an IP when the socket has none", () => {
    const request = { headers: {}, ip: "" } as unknown as FastifyRequest;

    expect(payerIpOf(request, false)).toBe("");
  });
});

describe("normalizePayerIp", () => {
  it.each([
    ["::ffff:127.0.0.1", "127.0.0.1"],
    ["::ffff:186.84.90.12", "186.84.90.12"],
    ["::FFFF:10.0.0.5", "10.0.0.5"],
    ["::1", "127.0.0.1"],
    [" 186.84.90.12", "186.84.90.12"],
    ["186.84.90.12\t", "186.84.90.12"],
    [" ::ffff:192.168.1.20 ", "192.168.1.20"],
  ])("should rewrite %p as %p", (value, expected) => {
    expect(normalizePayerIp(value)).toBe(expected);
  });

  it.each([
    ["127.0.0.1"],
    ["10.0.0.5"],
    ["192.168.1.20"],
    ["186.84.90.12"],
    ["2800:484:1a2b:3c00::20"],
    ["0:0:0:0:0:0:0:1"],
    ["::ffff:7f00:1"],
    ["::ffff:186.84.90"],
  ])("should keep %p as it came", (value) => {
    expect(normalizePayerIp(value)).toBe(value);
  });

  it.each([[undefined], [""], ["   "]])("should read %p as no IP", (value) => {
    expect(normalizePayerIp(value)).toBeUndefined();
  });
});

describe("SIMULATOR_TRUST_FORWARDED_FOR", () => {
  it.each([
    ["true", true],
    [" TRUE ", true],
    ["1", false],
    ["yes", false],
    ["", false],
    [undefined, false],
  ])("should read %p as %p", (value, expected) => {
    expect(parseTrustForwardedFor(value)).toBe(expected);
  });

  it("should be read from the environment when buildApp() gets no option", async () => {
    const previous = process.env.SIMULATOR_TRUST_FORWARDED_FOR;
    process.env.SIMULATOR_TRUST_FORWARDED_FOR = "true";
    try {
      const app = buildApp({ logger: false, webhooks: {} });
      expect(app.trustForwardedFor).toBe(true);
      await app.close();
    } finally {
      if (previous === undefined) {
        delete process.env.SIMULATOR_TRUST_FORWARDED_FOR;
      } else {
        process.env.SIMULATOR_TRUST_FORWARDED_FOR = previous;
      }
    }
  });
});
