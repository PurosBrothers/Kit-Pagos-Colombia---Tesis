/**
 * El script de «Austral Mate», el prototipo D.
 *
 * El SDK vive solo en el servidor. La página tokeniza la tarjeta con `fetch` contra la API pública de
 * cada pasarela (o contra el simulador), sin el módulo de navegador de Kit Pagos, y al servidor de la
 * tienda solo llega el token (POST /api/payments). Rapyd recibe la tarjeta en su propia página.
 *
 * La vitrina, el carrito y la página de la orden son las de A y B, para que las cuatro tiendas se vean
 * iguales.
 */
"use strict";

const CART_KEY = "kit-pagos-prototipo-d:cart";
const MAX_QUANTITY = 9;
const POLL_INTERVAL_MS = 2500;
const POLL_ATTEMPTS = 8;

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

const RIBBONS = {
  sandbox: "Tienda de demostración · cobra en el sandbox oficial de cada pasarela, sin dinero real",
  simulator: "Tienda de demostración · cobra en la API de Simulación de Kit Pagos, sin dinero real",
};

const STATUS_LABELS = { APPROVED: "Aprobado", DECLINED: "Rechazado", PENDING: "Pendiente", ERROR: "Error técnico" };
const SOURCE_LABELS = { creation: "Creación", query: "Consulta", webhook: "Webhook" };

/** Lo que lee el comprador según el estado de su orden, como en A y B. */
const RESULTS = {
  APPROVED: { icon: "✓", title: "¡Gracias! Tu pago fue aprobado", detail: "Ya estamos empacando tu pedido. Te escribimos cuando salga para tu casa." },
  DECLINED: { icon: "✕", title: "Tu pago fue rechazado", detail: "La pasarela no aprobó el pago. Puedes volver a intentarlo con otra tarjeta o con PSE." },
  PENDING: { icon: "…", title: "Tu pago está en proceso", detail: "Estamos esperando la confirmación de la pasarela. Esta página se actualiza sola." },
  ERROR: { icon: "!", title: "No pudimos procesar el pago", detail: "Un fallo técnico no dejó completar el pago, y no quedó decidido. Vuelve a intentarlo en unos minutos." },
};

/** El motivo de un rechazo, por categoría; `UNKNOWN` y los rechazos sin motivo conservan el texto general. */
const DECLINE_DETAILS = {
  INSUFFICIENT_FUNDS: "La tarjeta no tiene fondos suficientes. Puedes intentarlo con otra tarjeta o con PSE.",
  INVALID_CARD_DATA: "El banco no aceptó los datos de la tarjeta. Revisa el número, la fecha y el código de seguridad, o intenta con otra tarjeta.",
  CARD_RESTRICTED: "El banco tiene restringida esta tarjeta. Comunícate con tu banco, o intenta con otra tarjeta o con PSE.",
  FRAUD_SUSPICION: "El pago no se aprobó por seguridad. Puedes intentarlo con otra tarjeta o con PSE.",
  NETWORK_ERROR: "El banco no respondió y el pago no se aprobó. Vuelve a intentarlo en unos minutos.",
  AUTHENTICATION_FAILED: "No se pudo confirmar que la tarjeta es tuya. Vuelve a intentarlo, o intenta con otra tarjeta.",
  DUPLICATED_PAYMENT: "Ya hay un pago igual a este. Revisa tus pagos antes de intentarlo otra vez.",
};

/** La configuración pública que manda el servidor: el ambiente y, por pasarela, su llave pública y su URL de tokenización. */
let appConfig = null;
let products = [];

function byId(id) {
  return document.getElementById(id);
}

function value(id) {
  return byId(id).value.trim();
}

// ----------------------------------------------------------------------------
// La traza del navegador, en la consola (F12) con [tienda D], como en A y B: cada llamada de la
// página a la tienda y la tokenización, que sale directo a la pasarela. Nunca registra el cuerpo de
// la petición, que lleva la tarjeta, ni una llave completa.
// ----------------------------------------------------------------------------
const KEY_PATTERNS = [
  [/\b(pub|prv)_(test|prod|stagtest)_[A-Za-z0-9]+/g, "$1_$2_…"],
  [/\b(APP_USR|TEST)-[A-Za-z0-9-]+/g, "$1-…"],
];

function traceLine(...parts) {
  console.info("[tienda D]", ...parts);
}

function describeCall(method, url) {
  const parsed = new URL(url, window.location.href);
  const sameOrigin = parsed.origin === window.location.origin;
  const shown = sameOrigin ? parsed.pathname : `${parsed.host}${parsed.pathname}`;
  const masked = KEY_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), shown);
  return sameOrigin
    ? `navegador → tienda    ${method} ${masked}`
    : `navegador → pasarela  ${method} ${masked} (directo, sin pasar por la tienda)`;
}

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.url;
  const method = (init.method || "GET").toUpperCase();
  const started = performance.now();
  try {
    const response = await nativeFetch(input, init);
    traceLine(`${describeCall(method, url)} → ${response.status} · ${Math.round(performance.now() - started)} ms`);
    return response;
  } catch (error) {
    traceLine(`${describeCall(method, url)} → sin respuesta: ${error.message}`);
    throw error;
  }
};

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `La tienda respondió ${response.status}`);
  return body;
}

// ----------------------------------------------------------------------------
// El carrito, en el almacenamiento del navegador
// ----------------------------------------------------------------------------
function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  if (Object.keys(cart).length === 0) localStorage.removeItem(CART_KEY);
  else localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function cartCount(cart) {
  return Object.values(cart).reduce((count, quantity) => count + quantity, 0);
}

function renderCount(cart) {
  byId("cart-count").textContent = String(cartCount(cart));
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ----------------------------------------------------------------------------
// La tokenización en el navegador, sin el SDK
// ----------------------------------------------------------------------------
/**
 * Tokeniza la tarjeta directamente contra la API de la pasarela. El endpoint y la llave pública los
 * manda el servidor en /api/config, según el ambiente: el sandbox oficial o el simulador.
 */
async function tokenizeCardDirectly(gateway, cardData, totalAmountInPesos) {
  const gwConfig = appConfig?.gateways?.[gateway];
  if (!gwConfig) throw new Error(`No hay configuración disponible para ${gateway}`);
  const endpoint = gwConfig.tokenizationUrl;
  const pubKey = gwConfig.publicKey;

  // Wompi: POST /v1/tokens/cards con la llave pública en Authorization.
  if (gateway === "WOMPI") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pubKey}` },
      body: JSON.stringify({
        number: cardData.number,
        cvc: cardData.cvc,
        exp_month: cardData.expMonth,
        exp_year: cardData.expYear,
        card_holder: cardData.holder,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.data?.id) {
      const reason = data.error?.messages ? JSON.stringify(data.error.messages) : data.error?.reason || res.statusText;
      throw new Error(`Wompi rechazó la tarjeta: ${reason}`);
    }
    return data.data.id;
  }

  // Mercado Pago: POST /v1/card_tokens con la llave pública en la URL.
  if (gateway === "MERCADOPAGO") {
    const res = await fetch(`${endpoint}?public_key=${encodeURIComponent(pubKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_number: cardData.number,
        security_code: cardData.cvc,
        expiration_month: parseInt(cardData.expMonth, 10),
        expiration_year: parseInt(cardData.expYear.length === 2 ? `20${cardData.expYear}` : cardData.expYear, 10),
        cardholder: {
          name: cardData.holder,
          identification: { type: cardData.docType, number: cardData.docNumber },
        },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.id) {
      throw new Error(`Mercado Pago rechazó la tarjeta: ${data.message || data.cause?.[0]?.description || res.statusText}`);
    }
    return data.id;
  }

  // Kushki: POST /card/v1/tokens con el Public-Merchant-Id. El token queda atado al monto del cobro.
  if (gateway === "KUSHKI") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Public-Merchant-Id": pubKey },
      body: JSON.stringify({
        card: {
          name: cardData.holder,
          number: cardData.number,
          cvv: cardData.cvc,
          expiryMonth: cardData.expMonth.padStart(2, "0"),
          expiryYear: cardData.expYear.slice(-2),
        },
        currency: "COP",
        totalAmount: totalAmountInPesos,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) {
      throw new Error(`Kushki rechazó la tarjeta: ${data.message || res.statusText}${data.code ? ` (${data.code})` : ""}`);
    }
    return data.token;
  }

  // Rapyd no tokeniza en el navegador: el pago con tarjeta se hace en su página.
  if (gateway === "RAPYD") return undefined;

  throw new Error(`La pasarela ${gateway} no tokeniza en el navegador.`);
}

// ----------------------------------------------------------------------------
// La vitrina y el pedido
// ----------------------------------------------------------------------------
function productCard(product) {
  const item = element("li", "product");
  const art = element("div", "product__art");
  art.innerHTML = `<svg viewBox="0 0 200 220" preserveAspectRatio="xMidYMid slice" role="img"><use href="#${product.art}"></use></svg>`;
  art.firstElementChild.setAttribute("aria-label", product.name);
  const body = element("div", "product__body");
  const buy = element("div", "product__buy");
  const button = element("button", "add", "Agregar al pedido");
  button.type = "button";
  button.dataset.productId = product.id;
  buy.append(element("span", "price", pesos.format(product.price)), button);
  body.append(
    element("span", "product__origin", product.origin),
    element("h3", "product__title", product.name),
    element("p", "product__maker", product.subtitle),
    element("p", "product__detail", product.detail),
    element("p", "product__blurb", product.notes),
    buy,
  );
  item.append(art, body);
  return item;
}

function setUpStore() {
  const form = byId("checkout-form");
  const payButton = byId("pay-button");
  const lines = byId("cart-lines");
  const gatewaySelect = byId("gateway");
  const byProductId = new Map(products.map((product) => [product.id, product]));
  let cart = Object.fromEntries(
    Object.entries(loadCart()).filter(([id, quantity]) => byProductId.has(id) && Number.isInteger(quantity) && quantity > 0),
  );

  byId("products").replaceChildren(...products.map(productCard));
  for (const gateway of Object.values(appConfig.gateways)) {
    const option = new Option(gateway.name, gateway.gateway);
    option.dataset.hosted = String(gateway.isHosted);
    gatewaySelect.append(option);
  }

  const show = (text) => {
    byId("message").textContent = text;
  };

  function setQuantity(id, quantity) {
    const next = { ...cart };
    const clamped = Math.min(MAX_QUANTITY, Math.max(0, quantity));
    if (clamped === 0) delete next[id];
    else next[id] = clamped;
    cart = next;
    saveCart(cart);
    render();
  }

  function lineItem(product, quantity) {
    const item = element("li", "line");
    const stepper = element("span", "stepper");
    const less = element("button", "", "−");
    less.type = "button";
    less.setAttribute("aria-label", `Quitar un ${product.name}`);
    less.addEventListener("click", () => setQuantity(product.id, quantity - 1));
    const more = element("button", "", "+");
    more.type = "button";
    more.setAttribute("aria-label", `Agregar un ${product.name}`);
    more.disabled = quantity >= MAX_QUANTITY;
    more.addEventListener("click", () => setQuantity(product.id, quantity + 1));
    stepper.append(less, element("span", "", String(quantity)), more);
    item.append(
      element("span", "line__name", product.name),
      element("span", "line__price", pesos.format(product.price * quantity)),
      element("span", "line__detail", `${pesos.format(product.price)} c/u`),
      stepper,
    );
    return item;
  }

  function cartTotal() {
    return products.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0);
  }

  function render() {
    const entries = products.filter((product) => cart[product.id] > 0);
    const total = cartTotal();
    lines.replaceChildren(...entries.map((product) => lineItem(product, cart[product.id])));
    byId("cart-empty").hidden = entries.length > 0;
    byId("cart-totals").hidden = entries.length === 0;
    byId("subtotal").textContent = pesos.format(total);
    byId("total").textContent = pesos.format(total);
    form.hidden = entries.length === 0;
    payButton.textContent = `Pagar ${pesos.format(total)}`;
    for (const button of document.querySelectorAll(".add")) {
      const inCart = (cart[button.dataset.productId] ?? 0) > 0;
      button.classList.toggle("add--in-cart", inCart);
      button.textContent = inCart ? "Agregar otro" : "Agregar al pedido";
    }
    renderCount(cart);
  }

  for (const button of document.querySelectorAll(".add")) {
    button.addEventListener("click", () => setQuantity(button.dataset.productId, (cart[button.dataset.productId] ?? 0) + 1));
  }

  // Los bancos de PSE son de cada pasarela: se piden una vez por pasarela.
  const banksByGateway = new Map();

  const TEST_CARDS = {
    MERCADOPAGO: {
      number: "4013 5406 8274 6260",
      expMonth: "11",
      expYear: "30",
      cvc: "123",
      holder: "APRO Ruiz",
    },
    WOMPI: {
      number: "4242 4242 4242 4242",
      expMonth: "12",
      expYear: "30",
      cvc: "123",
      holder: "MATEO GOMEZ",
    },
    KUSHKI: {
      number: "4242 4242 4242 4242",
      expMonth: "12",
      expYear: "30",
      cvc: "123",
      holder: "MATEO GOMEZ",
    },
  };

  function updateCardFieldsForGateway(gatewayId) {
    const card = TEST_CARDS[gatewayId] || TEST_CARDS.WOMPI;
    if (byId("cardNumber")) byId("cardNumber").value = card.number;
    if (byId("expMonth")) byId("expMonth").value = card.expMonth;
    if (byId("expYear")) byId("expYear").value = card.expYear;
    if (byId("cvc")) byId("cvc").value = card.cvc;
    if (byId("cardHolder")) byId("cardHolder").value = card.holder;
  }

  function selectedMethod() {
    return form.querySelector("input[name=method]:checked").value;
  }

  function selectedGateway() {
    const option = gatewaySelect.selectedOptions[0];
    return { id: gatewaySelect.value, name: option?.textContent ?? "", hosted: option?.dataset.hosted === "true" };
  }

  async function loadPseBanks(gatewayId) {
    const select = byId("bankCode");
    select.replaceChildren(new Option("Cargando bancos…", ""));
    payButton.disabled = true;
    try {
      if (!banksByGateway.has(gatewayId)) {
        const { banks } = await readJson(await fetch(`/api/banks?gateway=${encodeURIComponent(gatewayId)}`));
        banksByGateway.set(gatewayId, banks);
      }
      if (gatewaySelect.value !== gatewayId) return;
      select.replaceChildren(...banksByGateway.get(gatewayId).map((bank) => new Option(bank.name, bank.code)));
      payButton.disabled = false;
    } catch (error) {
      show(`No se pudo cargar la lista de bancos: ${error.message}`);
    }
  }

  /** Lo que se ve depende del medio y de la pasarela: Rapyd recibe la tarjeta en su página. */
  function showMethod() {
    show("");
    const isPse = selectedMethod() === "PSE";
    const currentGateway = selectedGateway();
    const hosted = currentGateway.hosted;
    byId("card-fields").hidden = isPse || hosted;
    byId("hosted-card").hidden = isPse || !hosted;
    byId("pse-fields").hidden = !isPse;
    if (isPse) {
      loadPseBanks(gatewaySelect.value);
    } else {
      payButton.disabled = false;
      if (!hosted) {
        updateCardFieldsForGateway(currentGateway.id);
      }
    }
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "method" || event.target.name === "gateway") showMethod();
  });
  gatewaySelect.addEventListener("change", showMethod);

  form.addEventListener("input", () => {
    byId("buyer-summary").textContent = `${value("fullName")} · ${value("email")}`;
  });

  async function cardMethod(gateway) {
    const installments = Number(value("installments")) || 1;
    if (gateway.hosted) {
      traceLine(`tarjeta: ${gateway.name} la recibe en su propia página; la tienda no la ve`);
      return { type: "CARD", installments };
    }
    traceLine("tarjeta: la página la tokeniza con fetch, sin el SDK de navegador; al servidor solo llega el token");
    const cardToken = await tokenizeCardDirectly(
      gateway.id,
      {
        number: value("cardNumber").replace(/\D/g, ""),
        holder: value("cardHolder"),
        expMonth: value("expMonth"),
        expYear: value("expYear"),
        cvc: value("cvc"),
        docType: value("documentType"),
        docNumber: value("documentNumber"),
      },
      cartTotal(),
    );
    return { type: "CARD", cardToken, installments };
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("");
    payButton.disabled = true;
    payButton.textContent = "Procesando el pago…";
    try {
      const gateway = selectedGateway();
      const method =
        selectedMethod() === "PSE"
          ? { type: "PSE", bankCode: value("bankCode"), personType: value("personType") }
          : await cardMethod(gateway);
      // El servidor pone los precios y el monto con su catálogo.
      const items = products
        .filter((product) => cart[product.id] > 0)
        .map((product) => ({ productId: product.id, quantity: cart[product.id] }));
      const payer = {
        fullName: value("fullName"),
        email: value("email"),
        documentType: value("documentType"),
        documentNumber: value("documentNumber"),
        phone: value("phone"),
        streetName: value("streetName"),
        streetNumber: value("streetNumber"),
        neighborhood: value("neighborhood"),
        city: value("city"),
        zipCode: value("zipCode"),
      };
      traceLine(`pagar ${cartCount(cart)} ${cartCount(cart) === 1 ? "producto" : "productos"} con ${method.type === "PSE" ? "PSE" : "tarjeta"} por ${gateway.name}`);
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gateway: gateway.id, items, payer, method }),
      });
      const body = await response.json().catch(() => ({}));
      // Un fallo técnico también crea la orden, en ERROR: se muestra como en A y B.
      if (!body.orderId) throw new Error(body.error || `La tienda respondió ${response.status}`);
      // El carrito se queda hasta que la orden se apruebe: si el pago se rechaza, se reintenta sin armarlo otra vez.
      traceLine(body.redirectUrl ? `redirigiendo a otra página para pagar: ${new URL(body.redirectUrl).host}` : `abriendo la orden ${body.orderId}`);
      window.location.assign(body.redirectUrl || `/?orden=${encodeURIComponent(body.orderId)}`);
    } catch (error) {
      show(`No se pudo completar el pago: ${error.message}`);
      payButton.disabled = false;
      render();
    }
  });

  render();
  showMethod();
}

// ----------------------------------------------------------------------------
// La página de la orden, como en A y B
// ----------------------------------------------------------------------------
function declineText(reason) {
  return reason ? `Rechazo ${reason.rejectionCode} (${reason.rejectionCategory})` : "";
}

function renderOrder(order) {
  const result = RESULTS[order.status] ?? RESULTS.PENDING;
  const category = order.status === "DECLINED" ? order.rejectionReason?.rejectionCategory : undefined;
  const gatewayName = appConfig.gateways[order.gateway]?.name ?? order.gateway;
  byId("order-result").className = `result__card result--${order.status}`;
  byId("order-result").dataset.status = order.status;
  byId("result-icon").textContent = result.icon;
  byId("result-title").textContent = result.title;
  byId("order-detail").textContent = (category && DECLINE_DETAILS[category]) || result.detail;
  const ref = byId("result-ref");
  ref.replaceChildren(
    `Orden ${order.id} · ${order.method === "CARD" ? "Tarjeta" : "PSE"} con ${gatewayName} · Estado: `,
    element("strong", "", STATUS_LABELS[order.status] ?? order.status),
  );
  byId("result-lines").replaceChildren(
    ...order.items.map((line) => {
      const item = element("li", "line");
      item.append(
        element("span", "line__name", line.productName),
        element("span", "line__price", pesos.format(line.subtotal)),
        element("span", "line__detail", `${line.quantity} × ${pesos.format(line.unitPrice)}`),
      );
      return item;
    }),
  );
  byId("result-total").textContent = pesos.format(order.amountInPesos);
  byId("result-transaction").textContent = order.transactionId ?? "sin crear";
  byId("result-history").replaceChildren(
    ...order.history.map((entry) => {
      const row = element("tr");
      const detail = [declineText(entry.rejectionReason), entry.detail ?? ""].filter(Boolean).join(" · ");
      for (const text of [entry.at, SOURCE_LABELS[entry.source] ?? entry.source, STATUS_LABELS[entry.status] ?? entry.status, entry.nativeStatus ?? "", detail]) {
        row.append(element("td", "", text));
      }
      return row;
    }),
  );
}

async function readOrder(orderId) {
  const { order } = await readJson(await fetch(`/api/orders/${encodeURIComponent(orderId)}`));
  return order;
}

/** Le pregunta a la pasarela, por el SDK en el servidor, y vuelve a leer la orden. */
async function refreshOrder(order) {
  if (order.transactionId) {
    const response = await fetch(`/api/payments/${encodeURIComponent(order.gateway)}/${encodeURIComponent(order.transactionId)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `La tienda respondió ${response.status}`);
    }
  }
  return readOrder(order.id);
}

async function setUpOrderPage(orderId) {
  byId("store").hidden = true;
  byId("order-view").hidden = false;
  const message = byId("order-message");
  renderCount(loadCart());
  let order = await readOrder(orderId);
  renderOrder(order);
  traceLine(`orden ${order.id}: ${order.status}${order.status === "PENDING" ? "; la página la consulta sola" : ""}`);
  if (order.status === "APPROVED") {
    saveCart({});
    renderCount({});
  }

  byId("refresh-order").addEventListener("click", async () => {
    message.textContent = "Consultando…";
    try {
      order = await refreshOrder(order);
      renderOrder(order);
      message.textContent = "";
    } catch (error) {
      message.textContent = `No se pudo consultar el estado: ${error.message}`;
    }
  });

  // Al volver del banco el pago suele seguir en proceso: se consulta solo hasta que cambie.
  if (order.status !== "PENDING") return;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    try {
      const next = await refreshOrder(order);
      if (next.status !== order.status || next.history.length !== order.history.length) {
        order = next;
        renderOrder(order);
        if (order.status === "APPROVED") saveCart({});
      }
      if (order.status !== "PENDING") return;
    } catch {
      // La siguiente vuelta lo intenta otra vez; el botón queda para hacerlo a mano.
    }
  }
}

async function main() {
  appConfig = await readJson(await fetch("/api/config"));
  byId("ribbon").textContent = RIBBONS[appConfig.environment] ?? RIBBONS.sandbox;
  const params = new URLSearchParams(window.location.search);
  // La vuelta del banco o de la página de Rapyd trae ?retorno=1&orderId=…; la creación, ?orden=….
  const orderId = params.get("orden") || (params.get("retorno") === "1" ? params.get("orderId") : null);
  if (orderId) {
    await setUpOrderPage(orderId);
    return;
  }
  ({ products } = await readJson(await fetch("/api/products")));
  setUpStore();
}

main().catch((error) => {
  traceLine(`no se pudo cargar la tienda: ${error.message}`);
  const message = byId("order-view").hidden ? byId("message") : byId("order-message");
  message.textContent = `No se pudo cargar la tienda: ${error.message}`;
  byId("checkout-form").hidden = false;
});
