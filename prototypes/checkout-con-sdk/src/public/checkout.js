// Script de las páginas del checkout. Es del esqueleto común: no conoce ninguna pasarela.
// Lo único de pagos que usa es `tokenizeCard()`, que pone el módulo de pagos de cada
// prototipo en /payments/client.js.

const message = document.getElementById("message");

function show(text) {
  if (message) message.textContent = text;
}

async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `El checkout respondió ${response.status}`);
  return body;
}

function value(id) {
  return document.getElementById(id).value.trim();
}

async function loadPseBanks() {
  const select = document.getElementById("bankCode");
  try {
    const { banks } = await readJson(await fetch("/api/pse-banks"));
    select.replaceChildren(...banks.map((bank) => new Option(bank.name, bank.code)));
  } catch (error) {
    show(`No se pudo cargar la lista de bancos: ${error.message}`);
  }
}

async function cardMethod() {
  const config = await readJson(await fetch("/api/payments/config"));
  const { tokenizeCard } = await import("/payments/client.js");
  const cardToken = await tokenizeCard(
    {
      number: value("cardNumber").replace(/\s+/g, ""),
      cvc: value("cvc"),
      expMonth: value("expMonth"),
      expYear: value("expYear"),
      cardHolder: value("cardHolder"),
    },
    config,
  );
  return { type: "CARD", cardToken, installments: Number(value("installments")) || 1 };
}

function pseMethod() {
  return { type: "PSE", bankCode: value("bankCode"), personType: value("personType") };
}

function setUpCheckoutForm(form) {
  const cardFields = document.getElementById("card-fields");
  const pseFields = document.getElementById("pse-fields");
  let banksLoaded = false;

  form.addEventListener("change", (event) => {
    if (event.target.name !== "method") return;
    const isPse = event.target.value === "PSE";
    cardFields.hidden = isPse;
    pseFields.hidden = !isPse;
    if (isPse && !banksLoaded) {
      banksLoaded = true;
      loadPseBanks();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show("Procesando el pago…");
    try {
      const selected = form.querySelector("input[name=method]:checked").value;
      const method = selected === "PSE" ? pseMethod() : await cardMethod();
      const payer = {
        fullName: value("fullName"),
        email: value("email"),
        documentType: value("documentType"),
        documentNumber: value("documentNumber"),
        phone: value("phone"),
      };
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payer, method }),
      });
      const body = await response.json().catch(() => ({}));
      if (!body.order) throw new Error(body.error || `El checkout respondió ${response.status}`);
      window.location.assign(body.redirectUrl || `/orders/${body.order.id}`);
    } catch (error) {
      show(`No se pudo completar el pago: ${error.message}`);
    }
  });
}

function setUpOrderPage(button) {
  button.addEventListener("click", async () => {
    show("Consultando…");
    try {
      await readJson(await fetch(`/api/orders/${encodeURIComponent(button.dataset.orderId)}`));
      window.location.reload();
    } catch (error) {
      show(`No se pudo consultar el estado: ${error.message}`);
    }
  });
}

const form = document.getElementById("checkout-form");
if (form) setUpCheckoutForm(form);

const refresh = document.getElementById("refresh-order");
if (refresh) setUpOrderPage(refresh);
