/** Los estilos de «La Candelaria Cómics». Van en la página para que la tienda sea un solo HTML. */
export const STORE_CSS = `
:root {
  --paper: #f7f3ea;
  --card: #fffdf8;
  --ink: #16130f;
  --ink-soft: #5e5649;
  --line: #e2d9c7;
  --red: #c8102e;
  --red-dark: #9c0c24;
  --blue: #1d4e9e;
  --yellow: #f4c20d;
  --sand: #efe7d6;
  --ok: #2f6b3a;
  --bad: #a3221f;
  --wait: #93670c;
  --display: "Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif;
  --sans: -apple-system, "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 var(--sans); }
h1, h2 { font-family: var(--display); font-weight: 400; letter-spacing: 0.02em; line-height: 1.1; }
button, input, select { font: inherit; color: inherit; }
[hidden] { display: none !important; }
code { font-size: 0.85em; }
.sprite { position: absolute; width: 0; height: 0; }
.demo-ribbon {
  margin: 0; padding: 0.35rem 1rem; background: var(--ink); color: #f7eedc;
  font-size: 0.8rem; text-align: center; letter-spacing: 0.02em;
}
.masthead { border-bottom: 3px solid var(--ink); background: var(--card); }
.masthead__inner {
  max-width: 72rem; margin: 0 auto; padding: 1rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
}
.brand { display: flex; align-items: center; gap: 0.75rem; color: inherit; text-decoration: none; }
.brand__mark {
  width: 2.8rem; height: 2.8rem; border-radius: 50%; display: grid; place-items: center;
  background: var(--yellow); border: 3px solid var(--ink); color: var(--ink);
  font: 400 1.25rem var(--display); transform: rotate(-6deg);
}
.brand__name { display: block; font: 400 1.6rem/1 var(--display); letter-spacing: 0.03em; }
.brand__tagline { display: block; color: var(--ink-soft); font-size: 0.85rem; }
.cart-link { color: inherit; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 0.5rem; }
.cart-link__count {
  min-width: 1.7rem; height: 1.7rem; padding: 0 0.45rem; border-radius: 999px;
  background: var(--red); color: #fff; display: inline-grid; place-items: center; font-size: 0.85rem;
}
.shop { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; display: grid; gap: 2rem; }
@media (min-width: 60rem) {
  .shop { grid-template-columns: minmax(0, 1fr) 23rem; align-items: start; }
  .order { position: sticky; top: 1.25rem; }
}
.catalog__title { margin: 0 0 0.6rem; font-size: 2.4rem; }
.about {
  margin: 0 0 1.25rem; padding: 0.9rem 1.1rem; border: 2px solid var(--ink);
  border-radius: 10px; background: var(--card); box-shadow: 4px 4px 0 var(--yellow);
  color: var(--ink-soft); font-size: 0.9rem;
}
.about p { margin: 0 0 0.45rem; }
.about p:last-child { margin-bottom: 0; }
.about__title { color: var(--red-dark); font-weight: 800; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; }
.about strong { color: var(--ink); }
.catalog__intro { margin: 0 0 1.5rem; color: var(--ink-soft); max-width: 36rem; }
.products { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); }
.product {
  background: var(--card); border: 2px solid var(--ink); border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column; box-shadow: 4px 4px 0 var(--ink);
}
.product__art { background: var(--ink); border-bottom: 2px solid var(--ink); }
.product__art svg { display: block; width: 100%; height: 13rem; }
.product__body { padding: 0.9rem 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
.product__hero { color: var(--blue); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
.product__title { margin: 0; font: 400 1.35rem/1.1 var(--display); letter-spacing: 0.02em; }
.product__credits, .product__detail { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
.product__blurb { margin: 0.2rem 0 0; font-size: 0.9rem; }
.product__buy { margin-top: auto; padding-top: 0.85rem; display: flex; flex-direction: column; gap: 0.6rem; }
.price { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 1.1rem; }
.add {
  border: 2px solid var(--ink); background: var(--yellow); border-radius: 999px;
  padding: 0.4rem 0.95rem; cursor: pointer; font-weight: 800; font-size: 0.9rem;
}
.add:hover { background: var(--ink); color: var(--yellow); }
.add--in-cart { background: var(--card); }
.order { background: var(--card); border: 2px solid var(--ink); border-radius: 12px; padding: 1.25rem 1.25rem 1.4rem; box-shadow: 4px 4px 0 var(--ink); }
.order h2 { margin: 0 0 0.75rem; font-size: 1.8rem; }
.order__empty { color: var(--ink-soft); margin: 0; }
.lines { list-style: none; margin: 0; padding: 0; }
.line { display: grid; grid-template-columns: 1fr auto; gap: 0.15rem 0.75rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); }
.line__name { font-weight: 700; }
.line__detail { color: var(--ink-soft); font-size: 0.85rem; }
.line__price { text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
.stepper { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; justify-self: end; }
.stepper button { width: 1.9rem; height: 1.9rem; border: 0; background: none; cursor: pointer; font-size: 1rem; }
.stepper span { min-width: 1.4rem; text-align: center; font-variant-numeric: tabular-nums; }
.totals { margin: 0.75rem 0 1.25rem; }
.totals div { display: flex; justify-content: space-between; padding: 0.2rem 0; color: var(--ink-soft); }
.totals dt, .totals dd { margin: 0; }
.totals dd { font-variant-numeric: tabular-nums; }
.totals__grand { color: var(--ink) !important; font-weight: 800; font-size: 1.15rem; border-top: 1px solid var(--line); margin-top: 0.35rem; padding-top: 0.55rem !important; }
.checkout { display: flex; flex-direction: column; gap: 0.9rem; }
.checkout label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: var(--ink-soft); }
.checkout input, .checkout select { border: 1px solid var(--line); border-radius: 8px; padding: 0.5rem 0.6rem; background: #fff; color: var(--ink); font-size: 0.95rem; }
.checkout input:focus, .checkout select:focus { outline: 2px solid var(--blue); outline-offset: 1px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.6rem 0.75rem; }
.grid__wide { grid-column: 1 / -1; }
.buyer { border: 1px solid var(--line); border-radius: 10px; padding: 0.6rem 0.8rem; }
.buyer summary { cursor: pointer; list-style: none; display: flex; flex-direction: column; }
.buyer summary::-webkit-details-marker { display: none; }
.buyer__title { font-weight: 700; }
.buyer__summary { color: var(--ink-soft); font-size: 0.85rem; }
.buyer[open] .grid { margin-top: 0.75rem; }
.methods { border: 0; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
.methods legend { font-weight: 700; margin-bottom: 0.45rem; padding: 0; }
.method { border: 1px solid var(--line); border-radius: 10px; padding: 0.6rem 0.75rem; cursor: pointer; color: var(--ink) !important; position: relative; }
.method input { position: absolute; opacity: 0; }
.method span { font-weight: 700; font-size: 1rem; }
.method small { color: var(--ink-soft); }
.method:has(input:checked) { border-color: var(--red); box-shadow: inset 0 0 0 1px var(--red); background: #fff4f2; }
.hint { margin: -0.5rem 0 0; color: var(--ink-soft); font-size: 0.78rem; }
.grid .hint { margin: 0; }
.pay {
  border: 2px solid var(--ink); border-radius: 999px; padding: 0.85rem 1.2rem; background: var(--red);
  color: #fff; font-weight: 800; font-size: 1rem; cursor: pointer; box-shadow: 3px 3px 0 var(--ink);
}
.pay:hover { background: var(--red-dark); }
.pay:disabled { opacity: 0.6; cursor: progress; }
.form-error { margin: 0; padding: 0.65rem 0.8rem; border-radius: 10px; background: #f8e1dc; color: var(--bad); font-size: 0.9rem; }
.form-error:empty { display: none; }
.result { max-width: 38rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
.result__card { background: var(--card); border: 2px solid var(--ink); border-radius: 14px; padding: 2rem 1.75rem; text-align: center; box-shadow: 5px 5px 0 var(--ink); }
.result__card h1 { margin: 0.75rem 0 0.5rem; font-size: 2.1rem; }
.result__card > p { margin: 0 0 0.5rem; color: var(--ink-soft); }
.result__icon { width: 3.6rem; height: 3.6rem; margin: 0 auto; border-radius: 50%; display: grid; place-items: center; border: 2px solid var(--ink); background: var(--sand); font: 800 1.6rem var(--sans); }
.result--APPROVED .result__icon { background: #dcefd8; color: var(--ok); }
.result--DECLINED .result__icon, .result--ERROR .result__icon { background: #f6dcd5; color: var(--bad); }
.result--PENDING .result__icon { background: #f8ecc9; color: var(--wait); }
.result__ref { font-size: 0.85rem; }
.lines--summary { text-align: left; margin: 1.25rem 0 0.5rem; }
.result__actions { display: flex; flex-direction: column; gap: 0.6rem; align-items: center; margin-top: 1rem; }
.secondary { color: var(--red-dark); font-weight: 700; }
.audit { margin-top: 1.5rem; text-align: left; border-top: 1px dashed var(--line); padding-top: 1rem; }
.audit summary { cursor: pointer; font-weight: 700; }
.audit p { color: var(--ink-soft); font-size: 0.85rem; }
.audit table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
.audit th, .audit td { border-bottom: 1px solid var(--line); padding: 0.35rem 0.3rem; text-align: left; vertical-align: top; }
.footer { border-top: 3px solid var(--ink); padding: 1.5rem 1.25rem 2.5rem; text-align: center; color: var(--ink-soft); font-size: 0.85rem; }
.footer p { margin: 0.2rem 0; }
.footer__small { font-size: 0.75rem; }
`;
