import "./styles.css";
import { createKitPagosApi } from "./api";
import {
  addOne,
  cartCount,
  cartLines,
  cartTotal,
  formatCop,
  loadCart,
  PRODUCTS,
  saveCart,
  setQuantity,
  toApiAmount,
  type Cart,
  type CartLine,
} from "./catalog";
import {
  DEFAULT_POLL,
  describeOutcome,
  offersStatusQuery,
  payOnHostedPage,
  payWithCard,
  payWithPse,
  peekPending,
  queryPending,
  rememberPending,
  type CheckoutStep,
  type Order,
  type PollOptions,
} from "./checkout";
import { cardTokenizationProblem, cardUnavailableFor, loadConfig, missingPublicKeysProblem } from "./config";
import { gatewayLabel, shopperError, shopperMessage, type ShopperMessage } from "./messages";
import { loadCardTokenizer } from "./tokenizer";

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const shop = byId<HTMLElement>("shop");
const productList = byId<HTMLUListElement>("products");
const cartCountBadge = byId<HTMLSpanElement>("cart-count");
const cartEmpty = byId<HTMLParagraphElement>("cart-empty");
const cartLinesList = byId<HTMLUListElement>("cart-lines");
const cartTotals = byId<HTMLDListElement>("cart-totals");
const subtotalCell = byId<HTMLElement>("subtotal");
const totalCell = byId<HTMLElement>("total");
const form = byId<HTMLFormElement>("checkout");
const buyerSummary = byId<HTMLSpanElement>("buyer-summary");
const gatewaySelect = byId<HTMLSelectElement>("gateway");
const bankSelect = byId<HTMLSelectElement>("bank");
const pseFields = byId<HTMLDivElement>("pse-fields");
const cardFields = byId<HTMLDivElement>("card-fields");
const cardHosted = byId<HTMLParagraphElement>("card-hosted");
const cardMethod = byId<HTMLLabelElement>("card-method");
const cardUnavailable = byId<HTMLParagraphElement>("card-unavailable");
const payButton = byId<HTMLButtonElement>("pay-button");
const formError = byId<HTMLParagraphElement>("form-error");
const pendingNotice = byId<HTMLParagraphElement>("pending-notice");
const pendingText = byId<HTMLSpanElement>("pending-text");
const pendingCheck = byId<HTMLButtonElement>("pending-check");
const ribbon = byId<HTMLParagraphElement>("demo-ribbon");
const result = byId<HTMLElement>("result");
const resultIcon = byId<HTMLDivElement>("result-icon");
const resultTitle = byId<HTMLHeadingElement>("result-title");
const resultDetail = byId<HTMLParagraphElement>("result-detail");
const resultRef = byId<HTMLParagraphElement>("result-ref");
const resultLines = byId<HTMLUListElement>("result-lines");
const resultCheck = byId<HTMLButtonElement>("result-check");
const resultBack = byId<HTMLAnchorElement>("result-back");

const returnUrl = `${location.origin}${location.pathname}?retorno=1`;

/** Las consultas de estado, con el avance de la espera a la vista del comprador. */
function pollShowing(show: (text: string) => void): PollOptions {
  return {
    ...DEFAULT_POLL,
    onAttempt: (attempt, maxAttempts) => show(`Consultando con la pasarela (${attempt} de ${maxAttempts})…`),
  };
}
const CHOICE_STORAGE_KEY = "kit-pagos-checkout-c:choice";

/**
 * La traza técnica va a la consola del navegador (F12), no a la página: cada llamada a
 * `/v1/api`, los avisos de la API, el estado nativo de cada pago y la URL a la que se redirige.
 */
function log(...parts: unknown[]): void {
  console.info("[tienda C]", ...parts);
}

async function tracingFetch(input: string, init?: RequestInit): Promise<Response> {
  const url = new URL(input);
  const response = await fetch(input, init);
  log(`${init?.method ?? "GET"} ${url.pathname}${url.search} -> ${response.status}`);
  return response;
}

function field(data: FormData, name: string): string {
  return String(data.get(name) ?? "").trim();
}

let cart: Cart = loadCart(sessionStorage);

function orderFrom(data: FormData): Order {
  return {
    gateway: field(data, "gateway"),
    amount: toApiAmount(cartTotal(cart)),
    currency: "COP",
    orderReference: `CEIBA-${Date.now()}`,
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

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function art(symbolId: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 200 160");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#${symbolId}`);
  svg.append(use);
  return svg;
}

function renderProducts(): void {
  productList.replaceChildren(
    ...PRODUCTS.map((product) => {
      const item = element("li", "product");
      const picture = element("div", "product__art");
      picture.append(art(product.art));
      const body = element("div", "product__body");
      const buy = element("div", "product__buy");
      const inCart = cart[product.id] ?? 0;
      const add = element("button", inCart > 0 ? "add add--in-cart" : "add", inCart > 0 ? `En tu pedido · ${inCart}` : "Agregar");
      add.type = "button";
      add.addEventListener("click", () => updateCart(addOne(cart, product.id)));
      buy.append(element("span", "price", formatCop(product.price)), add);
      body.append(
        element("span", "product__origin", product.origin),
        element("h2", "product__name", product.name),
        element("p", "product__detail", product.detail),
        element("p", "product__notes", product.notes),
        buy,
      );
      item.append(picture, body);
      return item;
    }),
  );
}

function lineItem(line: CartLine, editable: boolean): HTMLLIElement {
  const item = element("li", "line");
  const name = element("div", "");
  name.append(element("div", "line__name", line.product.name), element("div", "line__detail", line.product.detail));
  item.append(name, element("div", "line__price", formatCop(line.subtotal)));
  if (editable) {
    const stepper = element("div", "stepper");
    const less = element("button", "", "−");
    const more = element("button", "", "+");
    less.type = more.type = "button";
    less.setAttribute("aria-label", `Quitar un ${line.product.name}`);
    more.setAttribute("aria-label", `Agregar un ${line.product.name}`);
    less.addEventListener("click", () => updateCart(setQuantity(cart, line.product.id, line.quantity - 1)));
    more.addEventListener("click", () => updateCart(setQuantity(cart, line.product.id, line.quantity + 1)));
    stepper.append(less, element("span", "", String(line.quantity)), more);
    item.append(element("div", "line__detail", `${formatCop(line.product.price)} c/u`), stepper);
  } else {
    item.append(element("div", "line__detail", `${line.quantity} × ${formatCop(line.product.price)}`));
  }
  return item;
}

function renderCart(): void {
  const lines = cartLines(cart);
  const total = cartTotal(cart);
  cartCountBadge.textContent = String(cartCount(cart));
  cartEmpty.hidden = lines.length > 0;
  cartTotals.hidden = lines.length === 0;
  form.hidden = lines.length === 0;
  cartLinesList.replaceChildren(...lines.map((line) => lineItem(line, true)));
  subtotalCell.textContent = totalCell.textContent = formatCop(total);
  payButton.textContent = `Pagar ${formatCop(total)}`;
}

function updateCart(next: Cart): void {
  cart = next;
  saveCart(sessionStorage, cart);
  renderProducts();
  renderCart();
}

function renderBuyerSummary(): void {
  const data = new FormData(form);
  buyerSummary.textContent = `${field(data, "firstName")} ${field(data, "lastName")} · ${field(data, "streetName")} ${field(data, "streetNumber")}, ${field(data, "city")}`;
}

const ICONS: Record<ShopperMessage["tone"] | "redirect", string> = {
  approved: "✓",
  declined: "✕",
  error: "!",
  pending: "…",
  redirect: "→",
};

function showResult(message: Omit<ShopperMessage, "tone"> & { tone: ShopperMessage["tone"] | "redirect" }, reference: string, lines: CartLine[]): void {
  shop.hidden = true;
  result.hidden = false;
  result.className = `result result--${message.tone}`;
  resultIcon.textContent = ICONS[message.tone];
  resultTitle.textContent = message.title;
  resultDetail.textContent = message.detail;
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  resultRef.textContent = [reference && `Pedido ${reference}`, total > 0 && `Total ${formatCop(total)}`].filter(Boolean).join(" · ");
  resultLines.replaceChildren(...lines.map((line) => lineItem(line, false)));
  resultCheck.hidden = message.tone !== "pending";
  resultBack.hidden = message.tone === "redirect";
  resultBack.textContent = message.tone === "approved" ? "Seguir comprando" : "Volver al pedido";
  window.scrollTo({ top: 0 });
}

function showFormError(error: unknown): void {
  const { code, message, cause } = error as { code?: string; message?: string; cause?: unknown };
  console.error("[tienda C]", `error ${code ?? "ERROR"}: ${message ?? String(error)}`, cause ?? "");
  const shown = shopperError(error);
  formError.replaceChildren(element("strong", "", shown.title), document.createTextNode(shown.detail));
  formError.hidden = false;
  payButton.disabled = false;
  renderCart();
}

/** Lo que pasa después de crear o consultar el pago. Una redirección no se muestra: se sigue. */
function handle(step: CheckoutStep, reference: string): void {
  if (step.kind !== "final") {
    rememberPending(sessionStorage, step.pending);
  }
  if (step.kind === "redirect") {
    log(describeOutcome(step), step.redirectUrl);
    saveCart(sessionStorage, cart);
    const title = step.pending.method === "CARD" ? "Te llevamos a la página de pago" : "Te llevamos a tu banco";
    showResult(
      { tone: "redirect", title, detail: "Abriendo la página de pago de la pasarela…" },
      reference,
      cartLines(cart),
    );
    location.assign(step.redirectUrl);
    return;
  }
  const { gatewayTransactionId, status, rawStatus, rejectionReason } = step.transaction;
  log(describeOutcome(step), { gatewayTransactionId, status, rawStatus, rejectionReason });
  const message = shopperMessage(step);
  const lines = cartLines(cart);
  if (message.tone === "approved") {
    updateCart({});
  }
  resultCheck.hidden = !offersStatusQuery(step);
  showResult(message, reference, lines);
}

async function main(): Promise<void> {
  const config = await loadConfig();
  log("config", { api: config.apiBaseUrl, ambiente: config.environment, llavesPublicas: Object.keys(config.publicKeys) });
  ribbon.textContent =
    config.environment === "sandbox"
      ? "Tienda de demostración · pagos de prueba en el sandbox de cada pasarela, sin dinero real"
      : "Tienda de demostración · pagos simulados, sin dinero real";

  const warnings = new Set<string>();
  const api = createKitPagosApi(config.apiBaseUrl, tracingFetch, {
    environment: config.environment,
    onWarning: (message) => {
      if (!warnings.has(message)) {
        warnings.add(message);
        console.warn("[tienda C]", `aviso de la API: ${message}`);
      }
    },
  });

  renderProducts();
  renderCart();
  renderBuyerSummary();
  form.addEventListener("input", renderBuyerSummary);
  resultCheck.addEventListener("click", () => location.assign(returnUrl));
  pendingCheck.addEventListener("click", () => location.assign(returnUrl));

  const pending = peekPending(sessionStorage);
  const returning = new URLSearchParams(location.search).has("retorno");
  if (returning && pending) {
    log(`retorno del pagador, orden ${pending.orderReference}`, location.search);
    showResult(
      { tone: "pending", title: "Confirmando tu pago…", detail: "Un momento, estamos consultando con la pasarela." },
      pending.orderReference,
      cartLines(cart),
    );
    resultCheck.hidden = true;
    const poll = pollShowing((text) => (resultDetail.textContent = text));
    handle(await queryPending(api, sessionStorage, pending, poll), pending.orderReference);
    return;
  }
  if (returning) {
    log("retorno sin un pago pendiente que consultar");
  }

  const cardProblem = cardTokenizationProblem(config);
  const keysProblem = missingPublicKeysProblem(config);
  if (cardProblem) {
    log("tarjeta deshabilitada:", cardProblem);
  } else if (keysProblem) {
    console.warn("[tienda C]", keysProblem);
  }
  const cardInput = cardMethod.querySelector("input") as HTMLInputElement;
  const methodInput = form.elements.namedItem("method") as RadioNodeList;
  const catalog = await api.listGateways();
  const captureOf = (gateway: string) => catalog.cardCapture[gateway];

  function showMethodFields(): void {
    const card = new FormData(form).get("method") === "CARD";
    const hosted = captureOf(gatewaySelect.value) === "HOSTED_PAGE";
    pseFields.hidden = card;
    cardFields.hidden = !card || hosted;
    cardHosted.hidden = !card || !hosted;
  }

  /**
   * La tarjeta se ofrece según lo que la API dice de la pasarela elegida. El problema del modo
   * solo toca a las que tokenizan en el navegador: la página de la pasarela no depende de él.
   */
  function updateCardAvailability(): void {
    const capture = captureOf(gatewaySelect.value);
    const reason =
      cardProblem && capture === "BROWSER_TOKEN"
        ? "El pago con tarjeta no está disponible en este modo de la tienda. Paga con PSE."
        : cardUnavailableFor(config, capture, gatewaySelect.value);
    log(`tarjeta con ${gatewaySelect.value}: ${capture ?? "la API no dice cómo la recibe"}${reason ? " (deshabilitada)" : ""}`);
    cardInput.disabled = reason !== undefined;
    cardUnavailable.hidden = reason === undefined;
    cardUnavailable.textContent = reason ?? "";
    if (reason && methodInput.value === "CARD") {
      methodInput.value = "PSE";
    }
    showMethodFields();
  }

  /** Mientras llega la lista de la pasarela nueva no se puede pagar con un banco de la anterior. */
  async function refreshBanks(): Promise<void> {
    bankSelect.replaceChildren(new Option("Cargando bancos…", ""));
    bankSelect.disabled = payButton.disabled = true;
    try {
      const banks = await api.listPseBanks(gatewaySelect.value);
      bankSelect.replaceChildren(...banks.map((bank) => new Option(bank.name, bank.code)));
    } finally {
      bankSelect.disabled = payButton.disabled = false;
    }
  }

  const { gateways } = catalog;
  gatewaySelect.replaceChildren(...gateways.map((gateway) => new Option(gatewayLabel(gateway), gateway)));
  const choice = pending ?? (JSON.parse(sessionStorage.getItem(CHOICE_STORAGE_KEY) ?? "null") as { gateway?: string; method?: string } | null);
  if (choice?.gateway && gateways.includes(choice.gateway)) {
    gatewaySelect.value = choice.gateway;
  }
  if (choice?.method === "PSE" || choice?.method === "CARD") {
    methodInput.value = choice.method;
  }
  gatewaySelect.addEventListener("change", () => {
    updateCardAvailability();
    void refreshBanks().catch(showFormError);
  });
  form.addEventListener("change", showMethodFields);
  updateCardAvailability();
  await refreshBanks();

  if (pending) {
    pendingText.textContent = `Tienes un pago en proceso (pedido ${pending.orderReference}). Si ya pagaste en tu banco, `;
    pendingNotice.hidden = false;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (cartCount(cart) === 0) {
      return;
    }
    const data = new FormData(form);
    const order = orderFrom(data);
    sessionStorage.setItem(CHOICE_STORAGE_KEY, JSON.stringify({ gateway: order.gateway, method: data.get("method") }));
    formError.hidden = true;
    payButton.disabled = true;
    payButton.textContent = "Procesando tu pago…";
    log(`pedido ${order.orderReference}`, { pasarela: order.gateway, metodo: data.get("method"), monto: order.amount });
    const poll = pollShowing((text) => (payButton.textContent = text));
    const step =
      data.get("method") === "PSE"
        ? payWithPse(api, order, field(data, "bank"), poll)
        : captureOf(order.gateway) === "HOSTED_PAGE"
          ? payOnHostedPage(api, order, poll)
          : payWithCard(
              {
                api,
                loadTokenizer: loadCardTokenizer,
                publicKeys: config.publicKeys,
                environment: config.environment,
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
              poll,
            );
    step.then((outcome) => handle(outcome, order.orderReference)).catch(showFormError);
  });
}

main().catch((error) => {
  console.error("[tienda C]", error);
  showResult(shopperError(error), "", []);
});
