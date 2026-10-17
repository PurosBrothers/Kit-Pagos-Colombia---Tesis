import { describe, expect, it, vi } from "vitest";
import { createKitPagosApi, KitPagosApiError } from "../src/api";
import {
  CardModuleError,
  describeOutcome,
  forgetPending,
  offersStatusQuery,
  payWithCard,
  payWithPse,
  peekPending,
  PENDING_STORAGE_KEY,
  pollUntilFinal,
  queryPending,
  rememberPending,
  type KeyValueStorage,
  type Order,
  type PendingPayment,
  type PollOptions,
} from "../src/checkout";
import { KIT_PAGOS_BROWSER_URL, loadCardTokenizer, type CardTokenizer } from "../src/tokenizer";
import { createFakeApi, FIXTURES, GATEWAYS, transaction } from "./helpers/fakeApi";

const API = "http://localhost:3000/v1/api";
const NO_WAIT: PollOptions = { maxAttempts: 5, intervalMs: 1000, sleep: async () => undefined };
const CARD_NUMBER = "4242424242424242";

function orderFor(gateway: string): Order {
  return {
    gateway,
    amount: "50000.00",
    currency: "COP",
    orderReference: `C109-${gateway}`,
    returnUrl: "http://localhost:4100/?retorno=1",
    payer: {
      email: "pagador.c@example.com",
      firstName: "Felipe",
      lastName: "Ruiz",
      fullName: "Felipe Ruiz",
      documentType: "CC",
      documentNumber: "1020304050",
      phone: "3001234567",
      phoneAreaCode: "57",
      address: { streetName: "Carrera 7", streetNumber: "71-21", city: "Bogota", zipCode: "110221", neighborhood: "Chapinero" },
    },
  };
}

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const CARD = { number: CARD_NUMBER, cvc: "123", expMonth: "12", expYear: "2030", cardHolder: "APRO Ruiz", docType: "CC", docNumber: "1020304050" };

describe("PSE through /v1/api, the same code for the four gateways", () => {
  it.each(GATEWAYS)("%s: lists the banks, redirects and reads the final status after the return", async (gateway) => {
    const { fetchFn, calls } = createFakeApi();
    const api = createKitPagosApi(API, fetchFn);
    const storage = memoryStorage();

    const [bank] = await api.listPseBanks(gateway);
    const step = await payWithPse(api, orderFor(gateway), bank.code, NO_WAIT);

    expect(step.kind).toBe("redirect");
    if (step.kind !== "redirect") return;
    expect(step.redirectUrl).toBe((FIXTURES[gateway].pseCreated as { redirect: { redirectUrl: string } }).redirect.redirectUrl);

    expect(step.pending.method).toBe("PSE");
    rememberPending(storage, step.pending);
    const pending = peekPending(storage);
    expect(pending).toEqual(step.pending);

    const final = await queryPending(api, storage, pending!, NO_WAIT);
    expect(final.kind).toBe("final");
    expect(final.kind !== "redirect" && final.transaction.status).toBe("APPROVED");
    expect(peekPending(storage)).toBeUndefined();

    const sent = JSON.parse(calls.find((call) => call.method === "POST")!.body!);
    expect(sent).toEqual({
      gateway,
      amount: "50000.00",
      currency: "COP",
      orderReference: `C109-${gateway}`,
      payer: orderFor(gateway).payer,
      paymentMethod: { type: "PSE", bankCode: bank.code, payerKind: "NATURAL" },
      returnUrlConfig: { returnUrl: "http://localhost:4100/?retorno=1" },
    });
    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /v1/api/pse-banks",
      "POST /v1/api/payments",
      `GET /v1/api/payments/${encodeURIComponent(step.pending.gatewayTransactionId)}`,
    ]);
  });

  it("sends no credentials and no Authorization header, only the environment", async () => {
    const { fetchFn } = createFakeApi();
    const spy = vi.fn(fetchFn);
    await payWithPse(createKitPagosApi(API, spy), orderFor("wompi"), "1", NO_WAIT);

    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of spy.mock.calls) {
      const headers = new Headers(init?.headers);
      expect([...headers.keys()].filter((name) => name !== "content-type").sort()).toEqual(["x-kit-pagos-environment"]);
    }
  });

  it("returns a declined PSE as final without redirecting (Wompi bank 2, measured)", async () => {
    const { fetchFn } = createFakeApi();
    const api = createKitPagosApi(API, async (input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ outcome: "TRANSACTION", transaction: transaction("t-2", "DECLINED", "DECLINED") }), { status: 201 });
      }
      return fetchFn(input, init);
    });

    const step = await payWithPse(api, orderFor("wompi"), "2", NO_WAIT);

    expect(step).toEqual({ kind: "final", transaction: transaction("t-2", "DECLINED", "DECLINED") });
  });
});

describe("card payments", () => {
  function tokenizerSpy(result: Promise<{ token: string }>) {
    const tokenizeCard = vi.fn<CardTokenizer["tokenizeCard"]>(() => result);
    return { tokenizer: { tokenizeCard }, tokenizeCard };
  }

  it("tokenizes in the browser and only sends the token to /v1/api", async () => {
    const { fetchFn, calls } = createFakeApi();
    const { tokenizer, tokenizeCard } = tokenizerSpy(Promise.resolve({ token: "tok_sim_abc" }));

    const step = await payWithCard(
      {
        api: createKitPagosApi(API, fetchFn),
        loadTokenizer: async () => tokenizer,
        publicKeys: { wompi: "pub_test_placeholder" },
        environment: "simulator",
      },
      orderFor("wompi"),
      CARD,
      NO_WAIT,
    );

    expect(tokenizeCard).toHaveBeenCalledWith({
      gateway: "wompi",
      publicKey: "pub_test_placeholder",
      environment: "simulator",
      card: CARD,
    });
    expect(step.kind).toBe("final");
    const post = calls.find((call) => call.method === "POST")!;
    expect(JSON.parse(post.body!).paymentMethod).toEqual({ type: "CARD", token: "tok_sim_abc", installments: 1 });
    for (const call of calls) {
      expect(`${call.url} ${call.body ?? ""}`).not.toContain(CARD_NUMBER);
      expect(`${call.url} ${call.body ?? ""}`).not.toContain(CARD.cvc + '"');
    }
  });

  it("lets KitPagosBrowser reject a gateway that does not tokenize, before calling /v1/api", async () => {
    const { fetchFn, calls } = createFakeApi();
    const unsupported = Object.assign(new Error("La pasarela 'kushki' no admite tokenización en frontend."), {
      code: "UNSUPPORTED_OPERATION",
    });
    const { tokenizer } = tokenizerSpy(Promise.reject(unsupported));

    await expect(
      payWithCard(
        { api: createKitPagosApi(API, fetchFn), loadTokenizer: async () => tokenizer, publicKeys: {}, environment: "simulator" },
        orderFor("kushki"),
        CARD,
        NO_WAIT,
      ),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    expect(calls).toEqual([]);
  });

  it("says the card module did not load or failed integrity, keeps the browser's error, and calls nothing", async () => {
    const { fetchFn, calls } = createFakeApi();
    const browserError = new TypeError(`Failed to fetch dynamically imported module: ${KIT_PAGOS_BROWSER_URL}`);
    const importer = vi.fn(async () => {
      throw browserError;
    });

    const paying = payWithCard(
      {
        api: createKitPagosApi(API, fetchFn),
        loadTokenizer: () => loadCardTokenizer(importer),
        publicKeys: { wompi: "pub_test_placeholder" },
        environment: "simulator",
      },
      orderFor("wompi"),
      CARD,
      NO_WAIT,
    );

    await expect(paying).rejects.toBeInstanceOf(CardModuleError);
    await expect(paying).rejects.toMatchObject({
      code: "CARD_MODULE_UNAVAILABLE",
      message: "No se pudo cargar el módulo de tarjeta o no pasó la verificación de integridad. La tarjeta no se envió.",
      cause: browserError,
    });
    expect(importer).toHaveBeenCalledWith(KIT_PAGOS_BROWSER_URL);
    expect(calls).toEqual([]);
  });

  it("passes an empty public key when the deployment has none, so the SDK reports it", async () => {
    const { tokenizer, tokenizeCard } = tokenizerSpy(Promise.resolve({ token: "t" }));
    const { fetchFn } = createFakeApi();

    await payWithCard(
      { api: createKitPagosApi(API, fetchFn), loadTokenizer: async () => tokenizer, publicKeys: {}, environment: "simulator" },
      orderFor("mercadopago"),
      CARD,
      NO_WAIT,
    );

    expect(tokenizeCard.mock.calls[0][0].publicKey).toBe("");
  });

  it("polls a card payment that is created PENDING until it is final (Wompi, measured)", async () => {
    const { fetchFn, calls } = createFakeApi({
      cardCreated: { outcome: "TRANSACTION", transaction: transaction("w-1", "PENDING", "PENDING", false) },
      statusSequence: [transaction("w-1", "APPROVED", "APPROVED")],
    });
    const { tokenizer } = tokenizerSpy(Promise.resolve({ token: "tok" }));

    const step = await payWithCard(
      { api: createKitPagosApi(API, fetchFn), loadTokenizer: async () => tokenizer, publicKeys: {}, environment: "simulator" },
      orderFor("wompi"),
      CARD,
      NO_WAIT,
    );

    expect(step.kind === "final" && step.transaction.status).toBe("APPROVED");
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });

  it("keeps a card payment that stays PENDING as the payment to query again, with its method", async () => {
    const stuck = transaction("w-2", "PENDING", "PENDING", false);
    const { fetchFn } = createFakeApi({ cardCreated: { outcome: "TRANSACTION", transaction: stuck }, statusSequence: [stuck, stuck] });
    const { tokenizer } = tokenizerSpy(Promise.resolve({ token: "tok" }));

    const step = await payWithCard(
      { api: createKitPagosApi(API, fetchFn), loadTokenizer: async () => tokenizer, publicKeys: {}, environment: "simulator" },
      orderFor("wompi"),
      CARD,
      { ...NO_WAIT, maxAttempts: 2 },
    );

    expect(step).toEqual({
      kind: "pending",
      transaction: stuck,
      pending: { gateway: "wompi", gatewayTransactionId: "w-2", orderReference: "C109-wompi", method: "CARD" },
    });
    expect(offersStatusQuery(step)).toBe(true);
  });
});

describe("pollUntilFinal", () => {
  const pending: PendingPayment = { gateway: "rapyd", gatewayTransactionId: "payment_1", orderReference: "C109", method: "PSE" };

  it("waits between queries and stops at the first final status", async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetchFn, calls } = createFakeApi({
      statusSequence: [transaction("p", "PENDING", "ACT", false), transaction("p", "PENDING", "ACT", false), transaction("p", "APPROVED", "CLO")],
    });

    const step = await pollUntilFinal(createKitPagosApi(API, fetchFn), pending, { maxAttempts: 5, intervalMs: 250, sleep });

    expect(step.kind).toBe("final");
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("gives up after maxAttempts and reports the payment as pending", async () => {
    const stuck = transaction("p", "PENDING", "ACT", false);
    const { fetchFn, calls } = createFakeApi({ statusSequence: [stuck, stuck, stuck, stuck] });

    const step = await pollUntilFinal(createKitPagosApi(API, fetchFn), pending, { ...NO_WAIT, maxAttempts: 3 });

    expect(step).toEqual({ kind: "pending", transaction: stuck, pending });
    expect(calls).toHaveLength(3);
    expect(describeOutcome(step)).toContain("sigue pendiente");
  });

  it("reports each attempt before making it, so the page can show the wait", async () => {
    const stuck = transaction("p", "PENDING", "ACT", false);
    const { fetchFn } = createFakeApi({ statusSequence: [stuck, stuck, transaction("p", "APPROVED", "CLO")] });
    const onAttempt = vi.fn();

    await pollUntilFinal(createKitPagosApi(API, fetchFn), pending, { ...NO_WAIT, onAttempt });

    expect(onAttempt.mock.calls).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
    ]);
  });
});

describe("the payer's return: the pending payment lives until a final status", () => {
  const pending: PendingPayment = { gateway: "kushki", gatewayTransactionId: "token-1", orderReference: "C109-k", method: "PSE" };
  const stuck = transaction("token-1", "PENDING", "initializedTransaction", false);

  it("keeps a payment that is still pending and offers to query it again (Kushki sandbox, measured)", async () => {
    const storage = memoryStorage();
    rememberPending(storage, pending);
    const { fetchFn } = createFakeApi({ statusSequence: [stuck, stuck] });

    const step = await queryPending(createKitPagosApi(API, fetchFn), storage, pending, { ...NO_WAIT, maxAttempts: 2 });

    expect(step.kind).toBe("pending");
    expect(offersStatusQuery(step)).toBe(true);
    expect(peekPending(storage)).toEqual(pending);
  });

  it("queries again with «Ya pagué» and forgets the payment once it is final", async () => {
    const storage = memoryStorage();
    rememberPending(storage, pending);
    const { fetchFn, calls } = createFakeApi({
      statusSequence: [stuck, transaction("token-1", "APPROVED", "approvedTransaction")],
    });
    const api = createKitPagosApi(API, fetchFn);

    const first = await queryPending(api, storage, peekPending(storage)!, { ...NO_WAIT, maxAttempts: 1 });
    const second = await queryPending(api, storage, peekPending(storage)!, { ...NO_WAIT, maxAttempts: 1 });

    expect(first.kind).toBe("pending");
    expect(second.kind).toBe("final");
    expect(offersStatusQuery(second)).toBe(false);
    expect(peekPending(storage)).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("does not forget another payment the payer started while the query was running", async () => {
    const storage = memoryStorage();
    const other: PendingPayment = { ...pending, gatewayTransactionId: "token-2", orderReference: "C109-otra" };
    rememberPending(storage, other);
    const { fetchFn } = createFakeApi({ statusSequence: [transaction("token-1", "DECLINED", "declinedTransaction")] });

    const step = await queryPending(createKitPagosApi(API, fetchFn), storage, pending, NO_WAIT);

    expect(step.kind).toBe("final");
    expect(peekPending(storage)).toEqual(other);
  });

  it("offers the query while the payer is at the bank too, but not after a final status", () => {
    expect(offersStatusQuery({ kind: "redirect", redirectUrl: "u", pending })).toBe(true);
    expect(offersStatusQuery({ kind: "final", transaction: transaction("t", "APPROVED", "APPROVED") })).toBe(false);
  });
});

describe("the API client", () => {
  it("turns an error body into KitPagosApiError with the SDK code", async () => {
    const api = createKitPagosApi(`${API}/`, async () =>
      new Response(JSON.stringify({ code: "INVALID_REQUEST", message: "Missing required fields: payer" }), { status: 400 }),
    );

    await expect(api.listGateways()).rejects.toEqual(new KitPagosApiError(400, "INVALID_REQUEST", "Missing required fields: payer"));
  });

  it("uses the error field of a 401 and survives a body that is not JSON", async () => {
    const unauthorized = createKitPagosApi(API, async () => new Response(JSON.stringify({ error: "Unauthorized", message: "x" }), { status: 401 }));
    await expect(unauthorized.listGateways()).rejects.toMatchObject({ status: 401, code: "Unauthorized" });

    const html = createKitPagosApi(API, async () => new Response("<h1>502</h1>", { status: 502 }));
    await expect(html.listGateways()).rejects.toMatchObject({ code: "HTTP_502", message: "<h1>502</h1>" });

    const empty = createKitPagosApi(API, async () => new Response("", { status: 503 }));
    await expect(empty.listGateways()).rejects.toMatchObject({ code: "HTTP_503", message: "La API respondió 503." });
  });

  it("lists the gateways the API offers", async () => {
    const { fetchFn } = createFakeApi();
    await expect(createKitPagosApi(API, fetchFn).listGateways()).resolves.toEqual(GATEWAYS);
  });
});

describe("pending payment storage", () => {
  const stored: PendingPayment = { gateway: "g", gatewayTransactionId: "id", orderReference: "o", method: "CARD" };

  it("peeks at the pending payment without removing it, for a payer who came back with Back", () => {
    const storage = memoryStorage();
    expect(peekPending(storage)).toBeUndefined();

    rememberPending(storage, stored);

    expect(peekPending(storage)).toEqual(stored);
    expect(peekPending(storage)).toEqual(stored);
  });

  it("forgets the pending payment only if it is the same one", () => {
    const storage = memoryStorage();
    rememberPending(storage, stored);

    forgetPending(storage, { ...stored, gatewayTransactionId: "otro" });
    expect(peekPending(storage)).toEqual(stored);

    forgetPending(storage, stored);
    expect(peekPending(storage)).toBeUndefined();
  });

  it("ignores a corrupt or incomplete value, and one without a known method", () => {
    const storage = memoryStorage();
    storage.setItem(PENDING_STORAGE_KEY, "{no es json");
    expect(peekPending(storage)).toBeUndefined();

    storage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ gateway: "g" }));
    expect(peekPending(storage)).toBeUndefined();

    storage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ ...stored, method: undefined }));
    expect(peekPending(storage)).toBeUndefined();

    storage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ ...stored, method: "NEQUI" }));
    expect(peekPending(storage)).toBeUndefined();
  });
});

describe("the environment of the calls", () => {
  it("sends x-kit-pagos-environment on every call, GET and POST, with the environment of the config", async () => {
    for (const environment of ["simulator", "sandbox"] as const) {
      const { fetchFn } = createFakeApi();
      const spy = vi.fn(fetchFn);
      const api = createKitPagosApi(API, spy, { environment });

      await api.listGateways();
      await payWithPse(api, orderFor("wompi"), "1", NO_WAIT);

      expect(spy.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["x-kit-pagos-environment"])).toEqual(
        Array(spy.mock.calls.length).fill(environment),
      );
      expect(spy.mock.calls.map(([input, init]) => `${init?.method ?? "GET"} ${new URL(input).pathname}`)).toEqual([
        "GET /v1/api/gateways",
        "POST /v1/api/payments",
      ]);
    }
  });

  it("defaults to simulator, which is also the default of the API", async () => {
    const spy = vi.fn(createFakeApi().fetchFn);

    await createKitPagosApi(API, spy).listGateways();

    expect((spy.mock.calls[0][1]?.headers as Record<string, string>)["x-kit-pagos-environment"]).toBe("simulator");
  });

  it("tokenizes the card in the same environment it charges in", async () => {
    const { fetchFn } = createFakeApi();
    const tokenizeCard = vi.fn<CardTokenizer["tokenizeCard"]>(async () => ({ token: "tok" }));

    await payWithCard(
      {
        api: createKitPagosApi(API, fetchFn, { environment: "sandbox" }),
        loadTokenizer: async () => ({ tokenizeCard }),
        publicKeys: { wompi: "pub_test_placeholder" },
        environment: "sandbox",
      },
      orderFor("wompi"),
      CARD,
      NO_WAIT,
    );

    expect(tokenizeCard.mock.calls[0][0].environment).toBe("sandbox");
  });

  it("hands the x-kit-pagos-warning header to the caller, which is how sandbox warns", async () => {
    const warning = "Se usaron las credenciales de sandbox del servidor.";
    const onWarning = vi.fn();
    const api = createKitPagosApi(
      API,
      async () =>
        new Response(JSON.stringify({ gateways: ["g"] }), { headers: { "x-kit-pagos-warning": warning } }),
      { environment: "sandbox", onWarning },
    );

    await api.listGateways();

    expect(onWarning).toHaveBeenCalledWith(warning);
  });

  it("does not call onWarning when the API sends no warning", async () => {
    const onWarning = vi.fn();
    const api = createKitPagosApi(API, createFakeApi().fetchFn, { onWarning });

    await api.listGateways();

    expect(onWarning).not.toHaveBeenCalled();
  });

  /*
   * El mismo `TypeError` sale con la API apagada y con una respuesta que el navegador no deja
   * leer por CORS: medido el 15 de octubre de 2026, un túnel de Cloudflare cambió un 502 de la
   * API por su página sin `access-control-allow-origin`, y la página decía que la API estaba apagada.
   */
  it("names the API's origin, both possible causes and the browser's error", async () => {
    const api = createKitPagosApi("https://api.example.com/v1/api", async () => {
      throw new TypeError("Failed to fetch");
    });

    const failure = await api.listGateways().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(KitPagosApiError);
    expect(failure).toMatchObject({ status: 0, code: "API_UNREACHABLE" });
    expect((failure as Error).message).toBe(
      "No se pudo leer la respuesta de la API en https://api.example.com. Hay dos causas posibles: " +
        "la API no respondió (verifique que esté encendida; si es la desplegada en Render, puede estar despertando), " +
        "o respondió y el navegador no pudo leer la respuesta, como pasa cuando un proxy (un túnel de Cloudflare, " +
        "por ejemplo) reemplaza un error de la API por una página propia sin CORS. " +
        "El registro de la API dice si la petición llegó. (TypeError: Failed to fetch)",
    );
  });
});

describe("describeOutcome", () => {
  it("names the final status, the native one and the rejection reason with the SDK's fields", () => {
    const declined = {
      ...transaction("t", "DECLINED", "failed"),
      rejectionReason: { rejectionCode: "rejected_by_issuer", rejectionCategory: "UNKNOWN" },
    };

    expect(describeOutcome({ kind: "final", transaction: declined })).toBe(
      "Estado final: DECLINED (nativo failed). Motivo: rejected_by_issuer (categoría UNKNOWN).",
    );
    expect(
      describeOutcome({
        kind: "redirect",
        redirectUrl: "u",
        pending: { gateway: "g", gatewayTransactionId: "i", orderReference: "o", method: "PSE" },
      }),
    ).toContain("redirigir");
  });

  it("says nothing about a reason when the API sends none (Wompi)", () => {
    expect(describeOutcome({ kind: "final", transaction: transaction("t", "DECLINED", "DECLINED") })).toBe(
      "Estado final: DECLINED (nativo DECLINED).",
    );
  });
});
