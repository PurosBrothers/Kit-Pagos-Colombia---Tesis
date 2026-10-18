/**
 * Un `/v1/api` falso con las respuestas medidas en memoria el 13 de octubre de 2026 contra
 * `buildApp()` del simulador con `kit-pagos-colombia@0.5.0`
 * (`.cursor/borradores/issue-109-medicion-inject.txt`, recogido en el punto 91). Las
 * pasarelas solo se nombran aquí, en los datos de la prueba.
 */

export interface RecordedCall {
  method: string;
  url: string;
  body?: string;
}

interface GatewayFixture {
  bank: { code: string; name: string; achCode?: string };
  pseCreated: Record<string, unknown>;
  pseFinal: Record<string, unknown>;
}

function transaction(id: string, status: string, rawStatus: string, isFinal = true) {
  return {
    gatewayTransactionId: id,
    orderReference: "C109-test",
    amount: "50000.00",
    currency: "COP",
    status,
    rawStatus,
    isApproved: status === "APPROVED",
    isPending: !isFinal,
    isFinal,
  };
}

function redirect(redirectUrl: string, gatewayTransactionId: string, rawStatus: string) {
  return { outcome: "REDIRECT_REQUIRED", redirect: { redirectUrl, gatewayTransactionId, rawStatus } };
}

export const FIXTURES: Record<string, GatewayFixture> = {
  wompi: {
    bank: { code: "1", name: "Banco que aprueba" },
    pseCreated: redirect(
      "http://localhost:3000/v1/sim/wompi/pse/redirect?ticket_id=8b65c139cb8e40a2b8df2756fe79878d",
      "8b65c139-cb8e-40a2-b8df-2756fe79878d",
      "PENDING",
    ),
    pseFinal: transaction("8b65c139-cb8e-40a2-b8df-2756fe79878d", "APPROVED", "APPROVED"),
  },
  mercadopago: {
    bank: { code: "1001", name: "Banco de Bogotá", achCode: "1001" },
    pseCreated: redirect(
      "http://localhost:3000/v1/sim/mercadopago/payments/PAY01333BYV13CI/bank_transfer",
      "ORD01IGY5S0YE85",
      "action_required",
    ),
    pseFinal: transaction("ORD01IGY5S0YE85", "APPROVED", "processed"),
  },
  kushki: {
    bank: { code: "001", name: "Bancolombia" },
    pseCreated: redirect(
      "http://localhost:3000/v1/sim/kushki/transfer/v1/agent?token=c5afaddcd31442a18e08ffa50a4c9d80",
      "c5afaddcd31442a18e08ffa50a4c9d80",
      "initializedTransaction",
    ),
    pseFinal: transaction("c5afaddcd31442a18e08ffa50a4c9d80", "APPROVED", "approvedTransaction"),
  },
  rapyd: {
    bank: { code: "co_pse_bancolombia_bank", name: "Bancolombia", achCode: "1007" },
    pseCreated: redirect(
      "http://localhost:3000/v1/sim/rapyd/complete-bank-payment?token=payment_678b16dd29e989c3040f52a1124ce90f",
      "payment_678b16dd29e989c3040f52a1124ce90f",
      "ACT",
    ),
    pseFinal: transaction("payment_678b16dd29e989c3040f52a1124ce90f", "APPROVED", "CLO"),
  },
};

export const GATEWAYS = Object.keys(FIXTURES);

/** `cardCapture` de `GET /v1/api/gateways`, como lo responde el simulador desde el punto 106. */
export const CARD_CAPTURE = {
  wompi: "BROWSER_TOKEN",
  mercadopago: "BROWSER_TOKEN",
  kushki: "BROWSER_TOKEN",
  rapyd: "HOSTED_PAGE",
} as const;

/** El pago con tarjeta sin token de la pasarela que cobra en su página. */
export const HOSTED_CARD_CREATED = redirect(
  "http://localhost:3000/v1/sim/rapyd/checkout/checkout_0f3c2a9d7e1b4c58a6d2e9f1b3c7a5d4/pay",
  "checkout_0f3c2a9d7e1b4c58a6d2e9f1b3c7a5d4",
  "NEW",
);

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * `fetch` falso. `cardCreated` y `statusSequence` permiten fijar la respuesta de un cobro con
 * tarjeta y la secuencia de consultas.
 */
export function createFakeApi(options: {
  cardCreated?: Record<string, unknown>;
  statusSequence?: Record<string, unknown>[];
  /** Una API anterior a `cardCapture`, como Render antes de desplegar el punto 106. */
  withoutCardCapture?: boolean;
} = {}) {
  const calls: RecordedCall[] = [];
  const queue = [...(options.statusSequence ?? [])];

  const fetchFn = async (input: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url: input, body });
    const url = new URL(input);
    const gateway = url.searchParams.get("gateway") ?? (body ? JSON.parse(body).gateway : undefined);

    if (url.pathname === "/v1/api/gateways") {
      return json(200, options.withoutCardCapture ? { gateways: GATEWAYS } : { gateways: GATEWAYS, cardCapture: CARD_CAPTURE });
    }
    if (url.pathname === "/v1/api/pse-banks") {
      return json(200, { pseBanks: [{ gateway, banks: [FIXTURES[gateway].bank] }] });
    }
    if (url.pathname === "/v1/api/payments" && method === "POST") {
      const parsed = JSON.parse(body ?? "{}");
      if (parsed.paymentMethod?.type === "CARD" && !parsed.paymentMethod.token) {
        return CARD_CAPTURE[gateway as keyof typeof CARD_CAPTURE] === "HOSTED_PAGE"
          ? json(201, HOSTED_CARD_CREATED)
          : json(400, { code: "INVALID_REQUEST", message: "La tarjeta necesita un token." });
      }
      if (parsed.paymentMethod?.type === "CARD") {
        return json(201, options.cardCreated ?? { outcome: "TRANSACTION", transaction: transaction("card-1", "APPROVED", "approved") });
      }
      return json(201, FIXTURES[gateway].pseCreated);
    }
    if (url.pathname.startsWith("/v1/api/payments/")) {
      return json(200, { gateway, transaction: queue.shift() ?? FIXTURES[gateway].pseFinal });
    }
    return json(404, { code: "RESOURCE_NOT_FOUND", message: `sin ruta ${url.pathname}` });
  };

  return { fetchFn, calls };
}

export { transaction };
