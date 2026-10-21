// @ts-check
/**
 * ============================================================================
 * AUSTRAL MATE — CHECKOUT CLIENT (SDK SOLO EN BACKEND)
 * ============================================================================
 * 
 * Este script corre 100% en el navegador del pagador.
 * 
 * REGLA ARQUITECTÓNICA DE LA TESIS:
 * - NO importa ni depende del módulo frontend del SDK.
 * - Realiza la tokenización de tarjeta DIRECTAMENTE contra los endpoints nativos
 *   de cada pasarela (Wompi, Mercado Pago, Kushki) utilizando fetch estándar.
 * - Para Rapyd, el cobro con tarjeta se realiza mediante Checkout Alojado (Hosted Page).
 * - Envía únicamente el token resultante al backend del comercio (POST /api/payments),
 *   donde el SDK de servidor orquesta el cobro.
 */

// Estado global de la aplicación cliente
let appConfig = null;
let products = [];
let cart = {}; // { [productId]: quantity }
let activeGateway = "WOMPI";
let activeMethod = "CARD";
let currentPollingTimer = null;

// Helpers de selección del DOM
function byId(id) {
  return document.getElementById(id);
}

function formatPesos(pesos) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(pesos);
}

// ----------------------------------------------------------------------------
// LOGS Y GAVETA DE INSPECCIÓN TÉCNICA
// ----------------------------------------------------------------------------
function logTrace(col, text) {
  console.log(`[${col.toUpperCase()}]`, text);
  const elementId = `trace-${col}-log`;
  const el = byId(elementId);
  if (el) {
    const timestamp = new Date().toLocaleTimeString();
    el.textContent = `[${timestamp}] ${text}`;
  }
}

function initDrawer() {
  const toggle = byId("drawer-toggle");
  const body = byId("drawer-body");
  const arrow = byId("drawer-arrow");

  if (toggle && body && arrow) {
    toggle.addEventListener("click", () => {
      const isHidden = body.classList.contains("hidden");
      if (isHidden) {
        body.classList.remove("hidden");
        arrow.textContent = "▼";
      } else {
        body.classList.add("hidden");
        arrow.textContent = "▲";
      }
    });
  }
}

// ----------------------------------------------------------------------------
// 1. CARGA INICIAL DE CONFIGURACIÓN Y PRODUCTOS
// ----------------------------------------------------------------------------
async function initApp() {
  initDrawer();
  setupCardPreview();

  try {
    // 1. Cargar Configuración pública
    const configRes = await fetch("/api/config");
    appConfig = await configRes.json();
    
    byId("env-text").textContent = `Ambiente: ${appConfig.environment.toUpperCase()}`;
    logTrace("front", `Configuración cargada. Ambiente: ${appConfig.environment}`);

    // 2. Cargar Catálogo de productos
    const prodRes = await fetch("/api/products");
    const prodData = await prodRes.json();
    products = prodData.products || [];
    renderCatalog();

    // 3. Configurar eventos de pasarelas y métodos
    setupGatewaySelector();
    setupMethodTabs();
    setupFormSubmission();

    // 4. Agregar un producto inicial de muestra al carrito
    if (products.length > 0) {
      cart[products[0].id] = 1;
      renderCart();
    }

    // 5. Cargar bancos para PSE de la pasarela activa
    loadBanksForGateway(activeGateway);

    // 6. Si volvemos del banco / checkout alojado, mostrar el resultado de esa orden
    await handleReturnFromGateway();
  } catch (err) {
    console.error("Error inicializando la tienda:", err);
    logTrace("front", `Error al inicializar: ${err.message}`);
  }
}

/**
 * Regreso desde PSE / Hosted Checkout: la URL trae ?retorno=1&orderId=...
 * Recupera la orden del backend y muestra el resultado, consultando el estado real
 * (KitPagos.getPaymentStatus) hasta que deje de estar PENDING.
 */
async function handleReturnFromGateway() {
  const params = new URLSearchParams(window.location.search);
  const orderId = params.get("orderId");
  if (params.get("retorno") !== "1" || !orderId) return;

  try {
    const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
    if (!res.ok) {
      window.history.replaceState({}, "", window.location.pathname);
      logTrace("front", `Orden ${orderId} no encontrada (las órdenes viven en memoria y se pierden al reiniciar el servidor).`);
      return;
    }
    const { order } = await res.json();
    const last = order.history[order.history.length - 1] || {};
    activeGateway = order.gateway;
    window.history.replaceState({}, "", window.location.pathname);
    logTrace("front", `Regreso del banco. Orden ${order.id}, consultando estado real...`);
    showResult({
      orderId: order.id,
      transactionId: order.transactionId,
      status: order.status === "ERROR" ? "PENDING" : order.status,
      nativeStatus: last.nativeStatus,
    });
    if (order.transactionId) {
      // Consulta inmediata, sin esperar el primer ciclo de polling
      const data = await checkStatusOnce(order.gateway, order.transactionId);
      if (data && data.status === "PENDING") startStatusPolling(order.gateway, order.transactionId);
    }
  } catch (err) {
    logTrace("front", `No se pudo recuperar la orden: ${err.message}`);
  }
}

// ----------------------------------------------------------------------------
// 2. RENDER DEL CATÁLOGO DE YERBA MATE
// ----------------------------------------------------------------------------
function renderCatalog() {
  const grid = byId("products-grid");
  if (!grid) return;
  grid.innerHTML = "";

  byId("catalog-count").textContent = `${products.length} variedades`;

  products.forEach((prod) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-top">
        <div class="product-icon">${prod.icon}</div>
        <span class="product-tag">${prod.tag}</span>
      </div>
      <h3 class="product-name">${prod.name}</h3>
      <span class="product-subtitle">${prod.subtitle}</span>
      <p class="product-notes">${prod.notes}</p>
      <span class="product-origin">📍 ${prod.origin} · ${prod.detail}</span>
      <div class="product-footer">
        <span class="product-price">${formatPesos(prod.price)}</span>
        <button type="button" class="btn-add-cart" data-id="${prod.id}">
          <span>+ Agregar</span>
        </button>
      </div>
    `;

    const addBtn = card.querySelector(".btn-add-cart");
    addBtn.addEventListener("click", () => {
      cart[prod.id] = (cart[prod.id] || 0) + 1;
      renderCart();
    });

    grid.appendChild(card);
  });
}

// ----------------------------------------------------------------------------
// 3. GESTIÓN DEL CARRITO DE COMPRAS
// ----------------------------------------------------------------------------
function renderCart() {
  const cartEmpty = byId("cart-empty");
  const cartContent = byId("cart-content");
  const cartItemsList = byId("cart-items");
  const cartCountBadge = byId("cart-badge-count");
  const cartSubtotal = byId("cart-subtotal");
  const cartTotal = byId("cart-total");
  const btnTotalAmount = byId("btn-total-amount");
  const submitBtn = byId("pay-submit-btn");

  const items = Object.entries(cart)
    .filter(([_, qty]) => qty > 0)
    .map(([id, qty]) => {
      const p = products.find((prod) => prod.id === id);
      return { product: p, quantity: qty, subtotal: p ? p.price * qty : 0 };
    })
    .filter((item) => item.product !== undefined);

  const totalQty = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);

  cartCountBadge.textContent = `${totalQty} ${totalQty === 1 ? "ítem" : "ítems"}`;

  if (items.length === 0) {
    cartEmpty.classList.remove("hidden");
    cartContent.classList.add("hidden");
    submitBtn.disabled = true;
    btnTotalAmount.textContent = "$0 COP";
    return;
  }

  cartEmpty.classList.add("hidden");
  cartContent.classList.remove("hidden");
  submitBtn.disabled = false;

  cartItemsList.innerHTML = "";
  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "cart-item";
    li.innerHTML = `
      <div class="item-info">
        <span class="item-name">${item.product.name}</span>
        <span class="item-unit-price">${formatPesos(item.product.price)} c/u</span>
      </div>
      <div class="item-qty-controls">
        <button type="button" class="btn-qty" data-action="dec" data-id="${item.product.id}">−</button>
        <span class="item-qty">${item.quantity}</span>
        <button type="button" class="btn-qty" data-action="inc" data-id="${item.product.id}">+</button>
      </div>
      <span class="item-total">${formatPesos(item.subtotal)}</span>
    `;

    li.querySelector('[data-action="dec"]').addEventListener("click", () => {
      if (cart[item.product.id] > 1) {
        cart[item.product.id] -= 1;
      } else {
        delete cart[item.product.id];
      }
      renderCart();
    });

    li.querySelector('[data-action="inc"]').addEventListener("click", () => {
      cart[item.product.id] = Math.min(9, cart[item.product.id] + 1);
      renderCart();
    });

    cartItemsList.appendChild(li);
  });

  const formattedTotal = formatPesos(totalAmount);
  cartSubtotal.textContent = formattedTotal;
  cartTotal.textContent = formattedTotal;
  btnTotalAmount.textContent = formattedTotal;
}

// ----------------------------------------------------------------------------
// 4. CONFIGURACIÓN DE SELECTORES (PASARELAS Y MÉTODOS)
// ----------------------------------------------------------------------------
function setupGatewaySelector() {
  const options = document.querySelectorAll(".gateway-option");
  options.forEach((opt) => {
    opt.addEventListener("click", () => {
      options.forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      const radio = opt.querySelector('input[type="radio"]');
      radio.checked = true;
      activeGateway = radio.value;

      updateGatewayUi(activeGateway);
      logTrace("front", `Pasarela cambiada a: ${activeGateway}`);
    });
  });
}

function updateGatewayUi(gateway) {
  const tokenAlertDesc = byId("tokenization-desc");
  const rapydHostedNotice = byId("rapyd-hosted-notice");
  const cardFieldsInputs = byId("card-fields-inputs");
  const cardPreview = byId("card-preview");
  const tabPse = byId("tab-pse");

  if (gateway === "RAPYD") {
    // Rapyd usa hosted checkout para tarjeta, no tokeniza en browser
    rapydHostedNotice.classList.remove("hidden");
    cardFieldsInputs.classList.add("hidden");
    cardPreview.classList.add("hidden");
    tokenAlertDesc.textContent = "Rapyd redirige a su Hosted Checkout seguro. Cero datos de tarjeta en el cliente.";
    // Rapyd: tarjeta por Hosted Checkout, pero PSE sí está soportado (lista de bancos co_pse_*)
    tabPse.style.display = "block";
  } else {
    rapydHostedNotice.classList.add("hidden");
    cardFieldsInputs.classList.remove("hidden");
    cardPreview.classList.remove("hidden");
    tabPse.style.display = "block";

    if (gateway === "WOMPI") {
      tokenAlertDesc.textContent = "Tokenización nativa directa contra endpoint de Wompi (POST /v1/tokens/cards).";
      byId("card-number").value = "4242 4242 4242 4242";
      byId("card-holder").value = "Mateo Gómez Silveira";
      byId("card-month").value = "12";
      byId("card-year").value = "30";
      byId("card-cvc").value = "123";
      byId("payer-name").value = "Mateo Gómez Silveira";
      byId("payer-doc-type").value = "CC";
      byId("payer-doc-num").value = "1098765432";
      byId("card-number").dispatchEvent(new Event("input"));
      byId("card-holder").dispatchEvent(new Event("input"));
      byId("card-month").dispatchEvent(new Event("change"));
    } else if (gateway === "MERCADOPAGO") {
      tokenAlertDesc.textContent = "Tokenización nativa directa contra endpoint de Mercado Pago (POST /v1/card_tokens).";
      // Autocompletar con tarjeta y titular APRO homologados para sandbox de Mercado Pago
      byId("card-number").value = "5254 1336 7440 3564";
      byId("card-holder").value = "APRO";
      byId("card-month").value = "11";
      byId("card-year").value = "30";
      byId("card-cvc").value = "123";
      byId("payer-name").value = "APRO";
      byId("payer-doc-type").value = "CC";
      byId("payer-doc-num").value = "123456789";
      byId("card-number").dispatchEvent(new Event("input"));
      byId("card-holder").dispatchEvent(new Event("input"));
      byId("card-month").dispatchEvent(new Event("change"));
    } else if (gateway === "KUSHKI") {
      tokenAlertDesc.textContent = "Tokenización nativa directa contra endpoint de Kushki (POST /card/v1/tokens).";
      byId("card-number").value = "4242 4242 4242 4242";
      byId("card-holder").value = "Mateo Gómez Silveira";
      byId("card-month").value = "12";
      byId("card-year").value = "30";
      byId("card-cvc").value = "123";
      byId("payer-name").value = "Mateo Gómez Silveira";
      byId("payer-doc-type").value = "CC";
      byId("payer-doc-num").value = "1098765432";
      byId("card-number").dispatchEvent(new Event("input"));
      byId("card-holder").dispatchEvent(new Event("input"));
      byId("card-month").dispatchEvent(new Event("change"));
    }
  }

  // Si estamos en la pestaña PSE, recargar los bancos de esa pasarela
  if (activeMethod === "PSE") {
    loadBanksForGateway(gateway);
  }
}

function setupMethodTabs() {
  const tabs = document.querySelectorAll(".tab-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const method = tab.getAttribute("data-method");
      switchMethod(method);
    });
  });
}

function switchMethod(method) {
  activeMethod = method;
  document.querySelectorAll(".tab-btn").forEach((t) => {
    if (t.getAttribute("data-method") === method) {
      t.classList.add("active");
    } else {
      t.classList.remove("active");
    }
  });

  const cardPanel = byId("card-panel");
  const psePanel = byId("pse-panel");

  if (method === "CARD") {
    cardPanel.classList.remove("hidden");
    psePanel.classList.add("hidden");
  } else {
    cardPanel.classList.add("hidden");
    psePanel.classList.remove("hidden");
    loadBanksForGateway(activeGateway);
  }
  logTrace("front", `Método seleccionado: ${method}`);
}

async function loadBanksForGateway(gateway) {
  const bankSelect = byId("pse-bank");
  if (!bankSelect) return;
  bankSelect.innerHTML = '<option value="">Cargando lista oficial de bancos...</option>';

  try {
    const res = await fetch(`/api/banks?gateway=${gateway}`);
    const data = await res.json();
    if (data.banks && data.banks.length > 0) {
      bankSelect.innerHTML = data.banks
        .map((b) => `<option value="${b.code}">${b.name}</option>`)
        .join("");
      logTrace("back", `Bancos PSE cargados desde Backend (KitPagos.getPseBanks): ${data.banks.length} entidades.`);
    } else {
      bankSelect.innerHTML = '<option value="1">Banco de Pruebas PSE (Sandbox)</option>';
    }
  } catch (err) {
    bankSelect.innerHTML = '<option value="1">Banco Unión de Pruebas (Mock)</option>';
  }
}

// ----------------------------------------------------------------------------
// 5. INTERACTIVIDAD DE LA TARJETA (PREVIEW Y FORMATEO)
// ----------------------------------------------------------------------------
function setupCardPreview() {
  const numInput = byId("card-number");
  const holderInput = byId("card-holder");
  const monthSelect = byId("card-month");
  const yearSelect = byId("card-year");

  const numDisplay = byId("card-number-display");
  const holderDisplay = byId("card-holder-display");
  const expDisplay = byId("card-exp-display");
  const brandDisplay = byId("card-brand-display");

  numInput.addEventListener("input", (e) => {
    let val = e.target.value.replace(/\D/g, "").slice(0, 16);
    // Formatear en bloques de 4
    let formatted = val.match(/.{1,4}/g)?.join(" ") || "";
    e.target.value = formatted;
    numDisplay.textContent = formatted || "•••• •••• •••• ••••";

    // Detección de franquicia
    if (val.startsWith("4")) {
      brandDisplay.textContent = "VISA";
    } else if (/^5[1-5]/.test(val)) {
      brandDisplay.textContent = "MASTERCARD";
    } else if (/^3[47]/.test(val)) {
      brandDisplay.textContent = "AMEX";
    } else {
      brandDisplay.textContent = "CARD";
    }
  });

  holderInput.addEventListener("input", (e) => {
    holderDisplay.textContent = e.target.value.toUpperCase() || "TITULAR";
  });

  const updateExp = () => {
    expDisplay.textContent = `${monthSelect.value}/${yearSelect.value}`;
  };
  monthSelect.addEventListener("change", updateExp);
  yearSelect.addEventListener("change", updateExp);
  updateExp();
}

// ----------------------------------------------------------------------------
// 6. TOKENIZACIÓN NATIVA EN FRONTEND (SIN SDK)
// ----------------------------------------------------------------------------
/**
 * Tokeniza la tarjeta DIRECTAMENTE contra la API nativa de la pasarela.
 * Esta función demuestra que el navegador NO usa el SDK de navegador.
 */
async function tokenizeCardDirectly(gateway, cardData, totalAmountInPesos) {
  const gwConfig = appConfig?.gateways?.[gateway];
  if (!gwConfig) {
    throw new Error(`No hay configuración disponible para ${gateway}`);
  }

  const endpoint = gwConfig.tokenizationUrl;
  const pubKey = gwConfig.publicKey;

  // NOTA DE ARQUITECTURA (Simulador vs Pasarelas Externas):
  // El 'endpoint' lo provee el backend en /api/config según el ambiente activo:
  // - En 'sandbox' (por defecto): Apunta a la API oficial de pruebas (sandbox.wompi.co, api.mercadopago.com, api-uat.kushkipagos.com).
  // - En 'simulator': Apunta a NUESTRO simulador local de tesis (simulator-api en /v1/sim/{gateway}/...).
  logTrace(
    "front",
    `[TOKENIZACIÓN NATIVA] Iniciando llamada directa a ${gateway} (${endpoint})...`
  );

  // 1. WOMPI NATIVO (POST /v1/tokens/cards o /v1/sim/wompi/tokens/cards)
  if (gateway === "WOMPI") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pubKey}`,
      },
      body: JSON.stringify({
        number: cardData.number,
        cvc: cardData.cvc,
        exp_month: cardData.expMonth,
        exp_year: cardData.expYear,
        card_holder: cardData.holder,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.data?.id) {
      const errDetail = data.error?.messages ? JSON.stringify(data.error.messages) : data.error?.reason || res.statusText;
      throw new Error(`Error tokenizando con Wompi: ${errDetail}`);
    }

    logTrace("front", `[WOMPI TOKEN RECIBIDO]: ${data.data.id}`);
    return data.data.id;
  }

  // 2. MERCADO PAGO NATIVO
  if (gateway === "MERCADOPAGO") {
    const url = `${endpoint}?public_key=${encodeURIComponent(pubKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_number: cardData.number,
        security_code: cardData.cvc,
        expiration_month: parseInt(cardData.expMonth, 10),
        expiration_year: parseInt(`20${cardData.expYear}`, 10),
        cardholder: {
          name: cardData.holder,
          identification: {
            type: cardData.docType,
            number: cardData.docNumber,
          },
        },
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.id) {
      const msg = data.message || data.cause?.[0]?.description || res.statusText;
      throw new Error(`Error tokenizando con Mercado Pago: ${msg}`);
    }

    logTrace("front", `[MERCADO PAGO TOKEN RECIBIDO]: ${data.id}`);
    return data.id;
  }

  // 3. KUSHKI NATIVO
  if (gateway === "KUSHKI") {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Public-Merchant-Id": pubKey,
      },
      body: JSON.stringify({
        card: {
          name: cardData.holder,
          number: cardData.number,
          cvv: cardData.cvc,
          expiryMonth: cardData.expMonth,
          expiryYear: cardData.expYear,
        },
        currency: "COP",
        totalAmount: totalAmountInPesos,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.token) {
      const msg = data.message || res.statusText;
      throw new Error(`Error tokenizando con Kushki: ${msg}`);
    }

    logTrace("front", `[KUSHKI TOKEN RECIBIDO]: ${data.token}`);
    return data.token;
  }

  // 4. RAPYD
  if (gateway === "RAPYD") {
    // No requiere token de navegador: cobrará por checkout alojado
    return undefined;
  }

  throw new Error(`Pasarela ${gateway} no admite tokenización nativa en frontend.`);
}

// ----------------------------------------------------------------------------
// 7. ENVÍO DEL PAGO AL BACKEND DEL COMERCIO
// ----------------------------------------------------------------------------
function setupFormSubmission() {
  const form = byId("checkout-form");
  const submitBtn = byId("pay-submit-btn");
  const spinner = byId("btn-spinner");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const items = Object.entries(cart)
      .filter(([_, qty]) => qty > 0)
      .map(([id, qty]) => {
        const p = products.find((prod) => prod.id === id);
        return {
          productId: p.id,
          productName: p.name,
          quantity: qty,
          unitPrice: p.price,
          subtotal: p.price * qty,
        };
      });

    const totalAmount = items.reduce((sum, item) => sum + item.subtotal, 0);
    if (totalAmount <= 0) {
      alert("Por favor agrega al menos una hierba o accesorio al carrito.");
      return;
    }

    submitBtn.disabled = true;
    spinner.classList.remove("hidden");

    const payer = {
      fullName: byId("payer-name").value.trim(),
      email: byId("payer-email").value.trim(),
      phone: byId("payer-phone").value.trim(),
      documentType: byId("payer-doc-type").value,
      documentNumber: byId("payer-doc-num").value.trim(),
    };

    let paymentMethodPayload;

    try {
      if (activeMethod === "CARD") {
        let cardToken;
        if (activeGateway !== "RAPYD") {
          const rawNum = byId("card-number").value.replace(/\D/g, "");
          const cardData = {
            number: rawNum,
            holder: byId("card-holder").value.trim(),
            expMonth: byId("card-month").value,
            expYear: byId("card-year").value,
            cvc: byId("card-cvc").value.trim(),
            docType: payer.documentType,
            docNumber: payer.documentNumber,
          };

          cardToken = await tokenizeCardDirectly(activeGateway, cardData, totalAmount);
        }

        paymentMethodPayload = {
          type: "CARD",
          cardToken,
          installments: parseInt(byId("card-installments").value, 10) || 1,
        };
      } else {
        // PSE
        const bankCode = byId("pse-bank").value;
        if (!bankCode) {
          throw new Error("Por favor selecciona un banco para continuar con PSE.");
        }
        paymentMethodPayload = {
          type: "PSE",
          bankCode,
          personType: byId("pse-person-type").value,
        };
      }

      // Despacho seguro al backend del comercio
      logTrace("back", `[POST /api/payments] Enviando orden a backend con token efímero...`);

      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway: activeGateway,
          items,
          amountInPesos: totalAmount,
          payer,
          method: paymentMethodPayload,
        }),
      });

      const paymentResult = await res.json();
      if (!res.ok) {
        throw new Error(paymentResult.error || `Fallo en el servidor: HTTP ${res.status}`);
      }

      logTrace("sdk", `[SDK EN BACKEND]: Pago creado exitosamente. Status: ${paymentResult.status}, TX: ${paymentResult.transactionId}`);
      showResult(paymentResult);
    } catch (err) {
      alert(`No se pudo procesar el pago: ${err.message}`);
      logTrace("front", `Error procesando pago: ${err.message}`);
      submitBtn.disabled = false;
      spinner.classList.add("hidden");
    }
  });
}

// ----------------------------------------------------------------------------
// 8. RESULTADO, REDIRECCIÓN Y POLLING
// ----------------------------------------------------------------------------
function showResult(result) {
  byId("checkout-section").classList.add("hidden");
  const resultCard = byId("result-card");
  resultCard.classList.remove("hidden");

  byId("res-order-id").textContent = result.orderId || "-";
  byId("res-tx-id").textContent = result.transactionId || "-";
  byId("res-gateway").textContent = activeGateway;
  byId("res-native-status").textContent = result.nativeStatus || "-";

  updateStatusBadge(result.status);

  const redirectBtn = byId("btn-redirect-bank");
  if (result.redirectUrl) {
    // Redirección inmediata (PSE / Hosted Checkout), sin pedir clic al usuario
    redirectBtn.href = result.redirectUrl;
    redirectBtn.style.display = "none";
    byId("result-title").textContent = "Redirigiendo...";
    byId("result-subtitle").textContent = "Te estamos llevando a la plataforma autorizada para completar tu pago.";
    byId("result-icon").textContent = "🔄";
    window.location.assign(result.redirectUrl);
    return;
  } else {
    redirectBtn.style.display = "none";
  }

  // Si está pendiente y tenemos ID de transacción, iniciar polling
  if (result.status === "PENDING" && result.transactionId && !result.redirectUrl) {
    startStatusPolling(activeGateway, result.transactionId);
  } else if (result.status === "APPROVED") {
    byId("result-title").textContent = "¡Pago Aprobado!";
    byId("result-subtitle").textContent = "Tu pedido de hierbas de mate ha sido confirmado exitosamente.";
    byId("result-icon").textContent = "🎉";
    // Vaciar carrito
    cart = {};
    renderCart();
  } else if (result.status === "DECLINED") {
    byId("result-title").textContent = "Pago Rechazado";
    byId("result-subtitle").textContent = "La pasarela no autorizó la transacción.";
    byId("result-icon").textContent = "❌";
  }

  // Botón nueva compra
  byId("btn-new-order").addEventListener("click", () => {
    if (currentPollingTimer) clearInterval(currentPollingTimer);
    resultCard.classList.add("hidden");
    byId("checkout-section").classList.remove("hidden");
    byId("pay-submit-btn").disabled = false;
    byId("btn-spinner").classList.add("hidden");
  });

  // Botón reintentar consulta
  byId("btn-recheck").addEventListener("click", () => {
    if (result.transactionId) {
      checkStatusOnce(activeGateway, result.transactionId);
    }
  });
}

function updateStatusBadge(status) {
  const badge = byId("res-status-badge");
  badge.className = `status-badge ${status}`;
  badge.textContent = status;
}

async function checkStatusOnce(gateway, txId) {
  try {
    logTrace("sdk", `Consultando estado con KitPagos.getPaymentStatus('${txId}')...`);
    const res = await fetch(`/api/payments/${gateway}/${txId}`);
    const data = await res.json();
    if (res.ok) {
      byId("res-native-status").textContent = data.nativeStatus;
      updateStatusBadge(data.status);
      if (data.status === "APPROVED") {
        byId("result-title").textContent = "¡Pago Aprobado!";
        byId("result-subtitle").textContent = "Transacción confirmada por la pasarela.";
        byId("result-icon").textContent = "✅";
      } else if (data.status === "DECLINED") {
        byId("result-title").textContent = "Pago Rechazado";
        byId("result-icon").textContent = "❌";
      }
      return data;
    }
  } catch (err) {
    console.warn("Fallo temporal consultando estado:", err);
  }
  return null;
}

function startStatusPolling(gateway, txId) {
  let attempt = 0;
  const maxAttempts = 10;
  const progressBar = byId("progress-fill");

  byId("result-title").textContent = "Esperando Confirmación...";
  byId("result-subtitle").textContent = "Consultando el estado de la transacción en la pasarela...";

  if (currentPollingTimer) clearInterval(currentPollingTimer);

  currentPollingTimer = setInterval(async () => {
    attempt += 1;
    const pct = (attempt / maxAttempts) * 100;
    progressBar.style.width = `${pct}%`;

    const statusRes = await checkStatusOnce(gateway, txId);
    if (statusRes && statusRes.status !== "PENDING") {
      clearInterval(currentPollingTimer);
      progressBar.style.width = "100%";
      return;
    }

    if (attempt >= maxAttempts) {
      clearInterval(currentPollingTimer);
      byId("result-subtitle").textContent = "El pago continúa en validación asíncrona. Puedes consultar de nuevo más tarde.";
    }
  }, 1800);
}

// ----------------------------------------------------------------------------
// INICIALIZACIÓN
// ----------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", initApp);
