# Prototipo A: el SDK solo en el servidor («Austral Mate»)

Una tienda de yerba mate que cobra las cuatro pasarelas (Wompi, Mercado Pago, Kushki y Rapyd) con `kit-pagos-colombia` en su servidor, y **sin `kit-pagos-colombia/browser` en la página**. La página tokeniza la tarjeta con `fetch` contra la API de cada pasarela, y al servidor solo le llega el token.

A responde una pregunta que B, C y D no responden: ¿le sirve el SDK a un comercio que no quiere adoptar su módulo de navegador? Es el patrón 1 (el servidor del comercio hacia el SDK) sin el módulo de navegador. **No entra en la comparación del experimento** (plan de evaluación, §2): es una demostración de alcance, como C. Lo construyó Joshua en el PR #163, y lo que su revisión comprueba está en el issue #164.

## Cómo correrlo

```bash
cd prototypes/checkout-con-sdk-solo-back
npm ci
npm start                 # compila y abre http://localtest.me:4200
```

**La tienda se abre en `http://localtest.me:4200`, no en `localhost`.** `localtest.me` es un dominio público que resuelve a `127.0.0.1`. Mercado Pago no acepta volver a `localhost` al final de un PSE; con este origen, el banco devuelve al comprador a la máquina sin túnel (punto 120 del `architecture-log.md`). Si una red no lo resuelve, basta `127.0.0.1 localtest.me` en `/etc/hosts`.

Por omisión cobra en el sandbox oficial de cada pasarela, con las llaves del `.env` de la raíz, las mismas de B y D ([`prototypes/README.md`](../README.md#cómo-correrlos)). Una variable del entorno gana sobre el archivo.

| Variable | Por omisión | Qué es |
|---|---|---|
| `PORT` | `4200` | El puerto de la tienda |
| `PUBLIC_BASE_URL` | `http://localtest.me:<PORT>` | El origen público, para la URL de retorno del banco |
| `KIT_PAGOS_ENVIRONMENT` | `sandbox` | `sandbox` o `simulator`. Con otro valor la tienda no arranca: la página solo tokeniza contra los hosts de sandbox |
| `SIMULATOR_SDK_BASE_URL` | `http://localhost:3000` | La API de Simulación, con `simulator` |
| `KUSHKI_WEBHOOK_SECRET` | (vacío) | El secreto con que se verifican los webhooks de Kushki |
| `RAPYD_WEBHOOK_URL` | (vacío) | La URL exacta registrada en el panel de Rapyd, porque Rapyd la firma |

Contra el simulador de la máquina (`simulator-api`, `npm run dev` en `localhost:3000`):

```bash
KIT_PAGOS_ENVIRONMENT=simulator npm start
```

**A diferencia de B y D, el prototipo A ofrece las cuatro pasarelas aunque falten sus llaves.** Sin ellas, la tokenización o el cobro fallan con el error de la pasarela. Kushki responde `401` sin cabeceras CORS, y la página lo muestra como «Failed to fetch».

## Lo que comparte con B y D, y lo que no

El 24 de octubre de 2026, Joan decidió que A conserve su estructura y tome el aspecto de B y D (punto 123).

**Lo que conserva:**

- `src/payments/PaymentService.ts`, que crea un `KitPagos` por pasarela;
- su HTML estático (`src/public/`);
- sus rutas `/api/*`.

No parte del esqueleto común (`PaymentsPort`, las páginas del servidor, la traza `[checkout]`), y `check-skeleton-parity.sh` no lo compara.

**Lo que toma de B y D:**

- **El aspecto.** La franja de demostración, el recuadro «Este prototipo es», el catálogo con dibujos, el carrito, la página de la orden con su «Detalle técnico» y el texto de cada rechazo por categoría.
- **El comportamiento de los pagos:**
  - el monto lo pone el servidor con su catálogo, y del navegador solo cuentan el producto y la cantidad;
  - los webhooks llegan a `/webhooks/<pasarela>`, y se verifican sobre el cuerpo tal como llegó;
  - el historial guarda el estado nativo;
  - la tarjeta de Rapyd se encuentra por la referencia de la orden;
  - un `PENDING` tardío no cambia el desenlace;
  - un aviso pendiente se resuelve consultando el pago.

## Los webhooks

Llegan a `/webhooks/<pasarela>`: `wompi`, `mercadopago`, `kushki` o `rapyd`. Una pasarela desconocida responde `404`, una firma inválida `401`, y un aviso de una orden que la tienda no tiene, `200` con `matched: false`.

- **En el sandbox**, cada pasarela notifica a la URL registrada en su panel, que tiene que ser pública. Hace falta un túnel, como en [«Los webhooks reales, en vivo»](../README.md#los-webhooks-reales-en-vivo). Sin él, la orden se resuelve con la consulta de su página.
- **Con el simulador local**, el webhook llega solo. `simulator-api` se arranca con `SIMULATOR_WEBHOOK_AUTO=true` y `SIMULATOR_WEBHOOK_TARGET_URL=http://localtest.me:4200/webhooks/{gateway}`. El simulador y A tienen que leer los mismos secretos y la misma `RAPYD_WEBHOOK_URL` (`http://localtest.me:4200/webhooks/rapyd`). Kushki no tiene secreto en el `.env`, porque no hubo acceso a su consola de UAT: para probarlo basta cualquier valor de `KUSHKI_WEBHOOK_SECRET`, el mismo en los dos.

## Cómo captura la tarjeta cada pasarela, y qué alcance de PCI DSS deja

Según el PCI SSC, un comercio califica para **SAQ A** cuando toda la página de pago la entrega un proveedor certificado: una redirección a su página o su formulario en un iframe. Califica para **SAQ A-EP** cuando su sitio arma el formulario y los datos van del navegador al procesador, o cuando carga un script que interviene en cómo se envían ([SAQ Instructions and Guidelines v4.0.1 r1](https://www.pcisecuritystandards.org/document_library/), abril de 2025, p. 9). Desde abril de 2025, el SAQ A con iframes exige además confirmar que la página no es susceptible a scripts maliciosos; ese criterio no aplica a una redirección ([FAQ 1588](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants)).

| Pasarela | Cómo la captura A | Alcance | Lo que ofrece la pasarela para SAQ A |
|---|---|---|---|
| Wompi | Formulario propio; `fetch` a `POST /v1/tokens/cards` con la llave pública, en la variante simple | SAQ A-EP | Su widget y su Web Checkout. Su documentación recomienda por defecto tokenizar cifrando la tarjeta (JWE), y deja la variante simple para cuando no se pueda cifrar ([Métodos de pago](https://docs.wompi.co/docs/colombia/metodos-de-pago/)). A usa la simple, como el SDK (punto 81) |
| Mercado Pago | Formulario propio; `fetch` a `POST /v1/card_tokens?public_key=…` | SAQ A-EP | Los campos de Checkout API y los Bricks, que salen de sus servidores. Su tabla les asigna SAQ A ([PCI DSS](https://www.mercadopago.com.ar/developers/en/docs/subscriptions/additional-content/security/pci)). Documenta `card_tokens` directo «para vendedores que cumplen con las normativas PCI» ([Recibir pagos siendo PCI Compliant](https://www.mercadopago.com.ar/developers/es/docs/resources-pci-compliant-merchants/receiving-payment-by-card)) |
| Kushki | Formulario propio; `fetch` a `POST /card/v1/tokens` con el `Public-Merchant-Id` (punto 106) | SAQ A-EP | Kushki.js Hosted Fields: los campos son iframes alojados por Kushki, y es su camino recomendado para quien no tiene certificación PCI ([Kushki.js Hosted Fields](https://api-docs.kushkipagos.com/es/kushki-js-hosted-fields-2087851m0)) |
| Rapyd | Su página de pago alojada: la tienda redirige y no ve la tarjeta | SAQ A | Es lo que usa A. Rapyd la describe como certificada PCI DSS y utilizable sin certificación PCI ([Rapyd Checkout](https://docs.rapyd.net/en/rapyd-checkout-overview.html), [Create Checkout Page](https://docs.rapyd.net/en/create-checkout-page.html)) |

**Ninguno de estos alcances es una certificación.** El cuestionario lo decide el adquirente o la marca con el comercio. Lo que A muestra:

- **El número no pasa por el servidor del comercio.** Una prueba (`no-browser-sdk.test.ts`) comprueba que la página solo le manda el token.
- **Con un formulario propio, la página queda en el alcance.** Un script que corra en ella puede leer la tarjeta antes de tokenizarla. B y D están igual con `KitPagosBrowser`.
- **A no manda Content-Security-Policy**, como B, C y D, por decisión de Joan del 19 de octubre de 2026 (punto 114). Lo que costaría está en la [guía de implementación](../../docs/03-sdk/4-guia-de-implementacion.md) §9.

## Lo medido

Contra los sandboxes oficiales, en el navegador, el 24 y el 25 de octubre de 2026 (punto 123):

| Pasarela | Tarjeta | PSE |
|---|---|---|
| Wompi | 4242 4242 4242 4242: `PENDING` al crear y `APPROVED` con la consulta de la página | Banco 1: `APPROVED` al crear |
| Mercado Pago | 4013 5406 8274 6260, 11/30, titular `APRO Ruiz`: `APPROVED (processed)`. Titular `FUND`: rechazo `insufficient_amount (INSUFFICIENT_FUNDS)` | «Banco Prueba PSE»: vuelve a `localtest.me` y la consulta deja `APPROVED (processed)` |
| Kushki | 4242 4242 4242 4242: `APPROVED (APPROVAL)`. 4349 0012 1084 6432: rechazo `021 (INSUFFICIENT_FUNDS)`, «La tarjeta no tiene fondos suficientes» | Llega a «Kushki Bank» y vuelve, pero queda `initializedTransaction`: UAT no cierra las transferencias |
| Rapyd | En su página: 4111 1111 1111 1111, 12/30, CVV 123 y el código `123456` de su 3DS. Vuelve y la consulta deja `APPROVED (CLO)` | Solo cobra con 9 de sus bancos, los que lista la tienda; «Rapyd Bank Payment Simulation» con Success: `APPROVED (CLO)` |

Al elegir la pasarela, la página precarga su tarjeta aprobada de esta tabla; la de Rapyd se escribe en su página. Las de rechazo se escriben a mano.

Los webhooks de las cuatro, firmados por el simulador local, verifican y actualizan la orden. La tarjeta de Rapyd manda tres avisos y los tres encuentran la orden por su referencia. Los webhooks reales del sandbox no se midieron en A; en B y D sí, por un túnel (punto 121). Se miden en el ensayo con ngrok del issue #165.

## Límites

- **La tarjeta de Kushki no tiene consulta de estado** en Colombia: la orden conserva el estado con que nació.
- **El rechazo de Rapyd con tarjeta** se queda en su página alojada, que deja reintentar y no devuelve al comprador (punto 122).
- **El rechazo de Kushki al tokenizar** se queda en el formulario, porque todavía no hay orden.
- **A no manda el identificador de dispositivo de Mercado Pago** (`X-meli-session-id`), que MercadoPago.js obtiene solo (punto 78).

## Pruebas

```bash
npm run typecheck
npm test -- --coverage
```

El umbral de A es 80 % de líneas, funciones e instrucciones, y 60 % de ramas. Las pruebas no necesitan el `.env` ni la red: las de las rutas usan un servicio de pagos falso, y las de `PaymentService` verifican firmas con cuerpos de prueba.
