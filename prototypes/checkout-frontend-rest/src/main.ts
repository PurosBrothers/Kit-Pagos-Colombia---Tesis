import { createKitPagosApi } from "./api";
import {
  describeOutcome,
  payWithCard,
  payWithPse,
  peekPending,
  pollUntilFinal,
  rememberPending,
  takePending,
  type CheckoutStep,
  type Order,
} from "./checkout";
import { loadConfig } from "./config";
import { loadCardTokenizer } from "./tokenizer";

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const form = byId<HTMLFormElement>("checkout");
const gatewaySelect = byId<HTMLSelectElement>("gateway");
const bankSelect = byId<HTMLSelectElement>("bank");
const pseFields = byId<HTMLFieldSetElement>("pse-fields");
const cardFields = byId<HTMLFieldSetElement>("card-fields");
const statusLine = byId<HTMLParagraphElement>("status");
const redirectLink = byId<HTMLAnchorElement>("redirect-link");
const returnButton = byId<HTMLButtonElement>("return-button");
const trace = byId<HTMLPreElement>("trace");

const returnUrl = `${location.origin}${location.pathname}?retorno=1`;

function note(line: string): void {
  trace.textContent += `${new Date().toISOString().slice(11, 23)}  ${line}\n`;
}

/** Deja en la página cada llamada a `/v1/api`, sin el cuerpo: la traza es lo que se documenta. */
async function tracingFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  const response = await fetch(input, init);
  note(`${init?.method ?? "GET"} ${url.pathname}${url.search} -> ${response.status}`);
  return response;
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

function orderFrom(data: FormData): Order {
  return {
    gateway: field(data, "gateway"),
    amount: field(data, "amount"),
    currency: "COP",
    orderReference: `C109-${Date.now()}`,
    returnUrl,
    payer: {
      email: field(data, "email"),
      firstName: field(data, "firstName"),
      lastName: field(data, "lastName"),
      fullName: `${field(data, "firstName")} ${field(data, "lastName")}`,
      documentType: field(data, "documentType"),
      documentNumber: field(data, "documentNumber"),
      phone: field(data, "phone"),
      phoneAreaCode: "57",
      address: {
        streetName: field(data, "streetName"),
        streetNumber: field(data, "streetNumber"),
        city: field(data, "city"),
        zipCode: field(data, "zipCode"),
        neighborhood: field(data, "neighborhood"),
      },
    },
  };
}

function show(step: CheckoutStep): void {
  statusLine.textContent = describeOutcome(step);
  const redirecting = step.kind === "redirect";
  redirectLink.hidden = !redirecting;
  returnButton.hidden = !redirecting;
  if (step.kind === "redirect") {
    rememberPending(sessionStorage, step.pending);
    redirectLink.href = step.redirectUrl;
    redirectLink.textContent = `Ir a ${new URL(step.redirectUrl).host} para pagar`;
    note(`redirectUrl ${step.redirectUrl}`);
  } else {
    const { gatewayTransactionId, status, rawStatus } = step.transaction;
    note(`${step.kind} ${status}/${rawStatus} id=${gatewayTransactionId}`);
  }
}

function showError(error: unknown): void {
  const { code, message } = error as { code?: string; message?: string };
  statusLine.textContent = `${code ?? "ERROR"}: ${message ?? String(error)}`;
  note(`error ${code ?? "ERROR"}`);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  const api = createKitPagosApi(config.apiBaseUrl, tracingFetch);

  async function refreshBanks(): Promise<void> {
    const banks = await api.listPseBanks(gatewaySelect.value);
    bankSelect.replaceChildren(...banks.map((bank) => new Option(`${bank.name} (${bank.code})`, bank.code)));
  }

  function showMethodFields(): void {
    const method = new FormData(form).get("method");
    pseFields.hidden = method !== "PSE";
    cardFields.hidden = method !== "CARD";
  }

  const gateways = await api.listGateways();
  gatewaySelect.replaceChildren(...gateways.map((gateway) => new Option(gateway, gateway)));
  gatewaySelect.addEventListener("change", () => void refreshBanks().catch(showError));
  form.addEventListener("change", showMethodFields);
  showMethodFields();
  await refreshBanks();

  returnButton.addEventListener("click", () => location.assign(returnUrl));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const order = orderFrom(data);
    statusLine.textContent = "Procesando…";
    const step =
      data.get("method") === "PSE"
        ? payWithPse(api, order, field(data, "bank"))
        : payWithCard(
            {
              api,
              loadTokenizer: loadCardTokenizer,
              publicKeys: config.publicKeys,
              tokenizationEnvironment: config.tokenizationEnvironment,
            },
            order,
            {
              number: field(data, "cardNumber"),
              cvc: field(data, "cvc"),
              expMonth: field(data, "expMonth"),
              expYear: field(data, "expYear"),
              cardHolder: field(data, "cardHolder"),
              docType: order.payer.documentType,
              docNumber: order.payer.documentNumber,
            },
          );
    step.then(show).catch(showError);
  });

  if (new URLSearchParams(location.search).has("retorno")) {
    const pending = takePending(sessionStorage);
    if (pending) {
      note(`retorno del pagador, orden ${pending.orderReference}`);
      statusLine.textContent = "Consultando el estado del pago…";
      show(await pollUntilFinal(api, pending));
    } else {
      statusLine.textContent = "No hay un pago pendiente que consultar.";
    }
    return;
  }

  const waiting = peekPending(sessionStorage);
  returnButton.hidden = waiting === undefined;
  statusLine.textContent = waiting
    ? `Hay un pago pendiente (orden ${waiting.orderReference}). Si ya pagó en el banco, vuelva al comercio.`
    : "Elija la pasarela y el método de pago.";
}

main().catch(showError);
