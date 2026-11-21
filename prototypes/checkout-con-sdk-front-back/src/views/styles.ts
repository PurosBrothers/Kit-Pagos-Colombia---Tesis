/** Los estilos de «La Bodega de Chapinero». Van en la página para que la tienda sea un solo HTML. */
export const STORE_CSS = `
:root {
  --paper: #f6f1ea;
  --card: #fffdf9;
  --ink: #23161a;
  --ink-soft: #6c5b5e;
  --line: #e7dbd3;
  --wine: #7b1e3a;
  --wine-dark: #5a1229;
  --gold: #b88a2e;
  --gold-soft: #f1e3c2;
  --sand: #efe6dc;
  --ok: #2f6b3a;
  --bad: #a3221f;
  --wait: #93670c;
  --display: Georgia, "Times New Roman", serif;
  --sans: -apple-system, "Segoe UI", system-ui, sans-serif;
  --shadow: 0 1px 2px rgba(35, 22, 26, 0.08), 0 8px 24px rgba(35, 22, 26, 0.08);
}
* { box-sizing: border-box; }
body { margin: 0; padding-bottom: 4.5rem; background: var(--paper); color: var(--ink); font: 16px/1.5 var(--sans); }
h1, h2 { font-family: var(--display); font-weight: 700; letter-spacing: 0.01em; line-height: 1.15; }
button, input, select { font: inherit; color: inherit; }
[hidden] { display: none !important; }
code { font-size: 0.85em; }
.sprite { position: absolute; width: 0; height: 0; }
.demo-ribbon {
  margin: 0; padding: 0.35rem 1rem; background: var(--wine-dark); color: #f6e9e0;
  font-size: 0.8rem; text-align: center; letter-spacing: 0.02em;
}
.masthead { border-bottom: 1px solid var(--line); background: var(--card); }
.masthead__inner {
  max-width: 72rem; margin: 0 auto; padding: 1rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
}
.masthead__nav { display: flex; align-items: center; gap: 1.1rem; flex-wrap: wrap; }
.brand { display: flex; align-items: center; gap: 0.75rem; color: inherit; text-decoration: none; }
.brand__mark {
  width: 2.8rem; height: 2.8rem; border-radius: 50%; display: grid; place-items: center;
  background: var(--wine); border: 2px solid var(--gold); color: var(--gold-soft);
  font: 700 1.05rem var(--display); letter-spacing: 0.04em;
}
.brand__name { display: block; font: 700 1.5rem/1.1 var(--display); }
.brand__tagline { display: block; color: var(--ink-soft); font-size: 0.85rem; }
.nav-link, .cart-link { color: inherit; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 0.45rem; }
.nav-link:hover, .cart-link:hover { color: var(--wine); }
.nav-link__count {
  min-width: 1.65rem; height: 1.65rem; padding: 0 0.45rem; border-radius: 999px;
  background: var(--sand); border: 1px solid var(--line); color: var(--ink);
  display: inline-grid; place-items: center; font-size: 0.85rem;
}
.cart-link__count {
  min-width: 1.7rem; height: 1.7rem; padding: 0 0.45rem; border-radius: 999px;
  background: var(--wine); color: #fff; display: inline-grid; place-items: center; font-size: 0.85rem;
}
.shop { max-width: 72rem; margin: 0 auto; padding: 2rem 1.25rem 3rem; display: grid; gap: 2rem; }
@media (min-width: 60rem) {
  .shop { grid-template-columns: minmax(0, 1fr) 23rem; align-items: start; }
  .order { position: sticky; top: 1.25rem; }
}
.catalog__title { margin: 0 0 0.6rem; font-size: 2.3rem; }
.about {
  margin: 0 0 1.25rem; padding: 0.9rem 1.1rem; border: 1px solid var(--line); border-left: 4px solid var(--gold);
  border-radius: 10px; background: var(--card); box-shadow: var(--shadow);
  color: var(--ink-soft); font-size: 0.9rem;
}
.about p { margin: 0 0 0.45rem; }
.about p:last-child { margin-bottom: 0; }
.about__title { color: var(--wine-dark); font-weight: 800; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.08em; }
.about strong { color: var(--ink); }
.catalog__intro { margin: 0 0 1.5rem; color: var(--ink-soft); max-width: 36rem; }
.products { list-style: none; margin: 0; padding: 0; display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); }
.product {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column; box-shadow: var(--shadow);
}
.product__art { background: var(--ink); }
.product__art svg { display: block; width: 100%; height: 13rem; }
.product__body { padding: 0.9rem 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.25rem; flex: 1; }
.product__origin { color: var(--gold); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 800; }
.product__title { margin: 0; font: 700 1.2rem/1.2 var(--display); }
.product__winery, .product__detail { margin: 0; color: var(--ink-soft); font-size: 0.85rem; }
.product__blurb { margin: 0.2rem 0 0; font-size: 0.9rem; }
.product__buy { margin-top: auto; padding-top: 0.85rem; display: flex; flex-direction: column; gap: 0.6rem; }
.price { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 1.1rem; }
.add {
  border: 1px solid var(--wine); background: var(--wine); color: #fff; border-radius: 999px;
  padding: 0.45rem 0.95rem; cursor: pointer; font-weight: 700; font-size: 0.9rem;
}
.add:hover { background: var(--wine-dark); }
.add--in-cart { background: var(--card); color: var(--wine); }
.order { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.25rem 1.25rem 1.4rem; box-shadow: var(--shadow); }
.order h2 { margin: 0 0 0.75rem; font-size: 1.7rem; }
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
.checkout input:focus, .checkout select:focus { outline: 2px solid var(--gold); outline-offset: 1px; }
.checkout .adult { flex-direction: row; align-items: center; gap: 0.5rem; color: var(--ink); font-size: 0.9rem; }
.checkout .adult input { width: 1.05rem; height: 1.05rem; accent-color: var(--wine); }
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
.method:has(input:checked) { border-color: var(--wine); box-shadow: inset 0 0 0 1px var(--wine); background: #fbf1f3; }
.hint { margin: -0.5rem 0 0; color: var(--ink-soft); font-size: 0.78rem; }
.grid .hint { margin: 0; }
.pay {
  display: inline-block; text-decoration: none; border: 0; border-radius: 999px; padding: 0.85rem 1.2rem;
  background: var(--wine); color: #fff; font-weight: 800; font-size: 1rem; cursor: pointer;
}
.pay:hover { background: var(--wine-dark); }
.pay:disabled { opacity: 0.6; cursor: progress; }
.form-error { margin: 0; padding: 0.65rem 0.8rem; border-radius: 10px; background: #f8e1dc; color: var(--bad); font-size: 0.9rem; }
.form-error:empty { display: none; }
.result { max-width: 38rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
.result__card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 2rem 1.75rem; text-align: center; box-shadow: var(--shadow); }
.result__card h1 { margin: 0.75rem 0 0.5rem; font-size: 2rem; }
.result__card > p { margin: 0 0 0.5rem; color: var(--ink-soft); }
.result__icon { width: 3.6rem; height: 3.6rem; margin: 0 auto; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line); background: var(--sand); font: 800 1.6rem var(--sans); }
.result--APPROVED .result__icon { background: #dcefd8; color: var(--ok); }
.result--DECLINED .result__icon, .result--ERROR .result__icon { background: #f6dcd5; color: var(--bad); }
.result--PENDING .result__icon { background: #f8ecc9; color: var(--wait); }
.result__ref { font-size: 0.85rem; }
.lines--summary { text-align: left; margin: 1.25rem 0 0.5rem; }
.result__actions { display: flex; flex-direction: column; gap: 0.6rem; align-items: center; margin-top: 1rem; }
.secondary { color: var(--wine-dark); font-weight: 700; }
.audit { margin-top: 1.5rem; text-align: left; border-top: 1px dashed var(--line); padding-top: 1rem; }
.audit summary { cursor: pointer; font-weight: 700; }
.audit p { color: var(--ink-soft); font-size: 0.85rem; }
.audit table { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
.audit th, .audit td { border-bottom: 1px solid var(--line); padding: 0.35rem 0.3rem; text-align: left; vertical-align: top; }
.orders-page { max-width: 60rem; margin: 0 auto; padding: 2.25rem 1.25rem 4rem; display: flex; flex-direction: column; gap: 1.25rem; }
.orders-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
.orders-header h1 { margin: 0 0 0.35rem; font-size: 2.1rem; }
.orders-header p { margin: 0; color: var(--ink-soft); }
.orders-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; }
.kpi { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 0.8rem 1rem; box-shadow: var(--shadow); }
.kpi__label { display: block; color: var(--ink-soft); font-size: 0.8rem; }
.kpi__value { display: block; font-size: 1.45rem; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 0.15rem; }
.orders-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.9rem; }
.order-item {
  background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.05rem 1.15rem;
  box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 0.45rem;
}
.order-item__top { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; }
.order-item__title { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
.order-item__id { font-weight: 800; color: var(--wine-dark); text-decoration: none; }
.order-item__id:hover { text-decoration: underline; }
.order-item__date { color: var(--ink-soft); font-size: 0.8rem; }
.order-item__total { font-variant-numeric: tabular-nums; font-size: 1.05rem; }
.order-item__meta { margin: 0; font-size: 0.92rem; }
.order-item__audit { margin: 0; color: var(--ink-soft); font-size: 0.82rem; word-break: break-word; }
.order-item__actions { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap; margin-top: 0.25rem; }
.badge {
  display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.78rem; font-weight: 700;
  background: var(--sand); color: var(--ink);
}
.badge--APPROVED { background: #dcefd8; color: var(--ok); }
.badge--DECLINED, .badge--ERROR { background: #f6dcd5; color: var(--bad); }
.badge--PENDING { background: #f8ecc9; color: var(--wait); }
.refresh-inline {
  border: 1px solid var(--wine); background: var(--card); color: var(--wine); border-radius: 999px;
  padding: 0.35rem 0.85rem; cursor: pointer; font-weight: 700; font-size: 0.85rem;
}
.refresh-inline:hover { background: #fbf1f3; }
.refresh-inline:disabled { opacity: 0.6; cursor: progress; }
.monitor-toggle {
  border: 1px solid var(--gold); background: var(--ink); color: var(--gold-soft); border-radius: 999px;
  padding: 0.35rem 0.8rem; cursor: pointer; font-weight: 700; font-size: 0.85rem;
}
.monitor-toggle:hover { background: var(--wine-dark); color: #fff; }
.sdk-monitor {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
  background: #171215; color: #efe7e2; border-top: 2px solid var(--gold);
  box-shadow: 0 -8px 28px rgba(23, 18, 21, 0.35);
  font-size: 0.85rem;
}
.sdk-monitor__bar {
  max-width: 72rem; margin: 0 auto; padding: 0.55rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
}
.sdk-monitor__title { display: flex; align-items: center; gap: 0.55rem; flex-wrap: wrap; }
.sdk-monitor__dot {
  width: 0.6rem; height: 0.6rem; border-radius: 50%; background: #56c271;
  box-shadow: 0 0 0 0 rgba(86, 194, 113, 0.65); animation: sdk-pulse 2s infinite;
}
@keyframes sdk-pulse {
  0% { box-shadow: 0 0 0 0 rgba(86, 194, 113, 0.65); }
  70% { box-shadow: 0 0 0 6px rgba(86, 194, 113, 0); }
  100% { box-shadow: 0 0 0 0 rgba(86, 194, 113, 0); }
}
.sdk-monitor__env {
  padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.75rem; font-weight: 700;
  background: rgba(184, 138, 46, 0.2); border: 1px solid rgba(184, 138, 46, 0.55); color: var(--gold-soft);
}
.sdk-monitor__controls { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
.sdk-monitor__pause { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; color: #d8c8be; cursor: pointer; }
.sdk-monitor__pause input { accent-color: var(--gold); }
.sdk-monitor__btn {
  border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.08); color: #f6e9e0;
  border-radius: 999px; padding: 0.25rem 0.7rem; cursor: pointer; font-size: 0.78rem; font-weight: 700;
}
.sdk-monitor__btn:hover { background: rgba(255, 255, 255, 0.16); }
.sdk-monitor__body {
  max-width: 72rem; margin: 0 auto; padding: 0.25rem 1.25rem 0.9rem;
  display: flex; flex-direction: column; gap: 0.65rem;
}
.sdk-pipeline {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); gap: 0.5rem;
}
.sdk-stage {
  position: relative; padding: 0.45rem 0.6rem 0.45rem 2.15rem; border-radius: 8px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.12);
}
.sdk-stage__num {
  position: absolute; left: 0.55rem; top: 0.55rem; width: 1.2rem; height: 1.2rem; border-radius: 50%;
  background: rgba(255, 255, 255, 0.14); display: grid; place-items: center; font-size: 0.72rem; font-weight: 800;
}
.sdk-stage strong { display: block; font-size: 0.8rem; color: #fff; }
.sdk-stage__status { display: block; font-size: 0.74rem; color: #bfb0a7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sdk-stage[data-state="active"] { border-color: var(--gold); background: rgba(184, 138, 46, 0.16); }
.sdk-stage[data-state="active"] .sdk-stage__num { background: var(--gold); color: #171215; }
.sdk-stage[data-state="ok"] { border-color: #4ea864; background: rgba(78, 168, 100, 0.14); }
.sdk-stage[data-state="ok"] .sdk-stage__num { background: #4ea864; color: #112215; }
.sdk-stage[data-state="warn"] { border-color: #e0ad38; background: rgba(224, 173, 56, 0.15); }
.sdk-stage[data-state="warn"] .sdk-stage__num { background: #e0ad38; color: #1f1705; }
.sdk-stage[data-state="error"] { border-color: #e0645c; background: rgba(224, 100, 92, 0.15); }
.sdk-stage[data-state="error"] .sdk-stage__num { background: #e0645c; color: #fff; }
.sdk-monitor__continue-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; flex-wrap: wrap;
  padding: 0.5rem 0.75rem; border-radius: 8px;
  background: rgba(184, 138, 46, 0.22); border: 1px solid var(--gold); color: var(--gold-soft);
}
.sdk-monitor__continue {
  border: 0; border-radius: 999px; padding: 0.38rem 0.9rem; cursor: pointer;
  background: var(--gold); color: #171215; font-weight: 800; font-size: 0.82rem;
}
.sdk-log__empty { margin: 0; color: #a7968d; font-size: 0.8rem; }
.sdk-log {
  list-style: none; margin: 0; padding: 0.5rem 0.7rem; max-height: 11rem; overflow-y: auto;
  border-radius: 8px; background: #0e0a0c; border: 1px solid rgba(255, 255, 255, 0.08);
  font: 0.78rem/1.45 ui-monospace, "Cascadia Code", Consolas, monospace;
  display: flex; flex-direction: column; gap: 0.25rem;
}
.sdk-log:empty { display: none; }
.sdk-log__item { display: flex; align-items: baseline; gap: 0.45rem; flex-wrap: wrap; }
.sdk-log__time { color: #8c7b73; }
.sdk-log__tag {
  padding: 0.05rem 0.35rem; border-radius: 4px; font-weight: 700; font-size: 0.72rem;
  background: rgba(255, 255, 255, 0.12); color: #f6e9e0;
}
.sdk-log__tag--front { background: rgba(114, 168, 224, 0.24); color: #b7dafc; }
.sdk-log__tag--browser { background: rgba(192, 132, 252, 0.24); color: #e2c2ff; }
.sdk-log__tag--backend { background: rgba(184, 138, 46, 0.28); color: #f7dfa4; }
.sdk-log__tag--sandbox { background: rgba(78, 168, 100, 0.24); color: #b6f0c4; }
.sdk-log__tag--response { background: rgba(240, 173, 78, 0.25); color: #ffe1ab; }
.sdk-log__tag--error { background: rgba(224, 100, 92, 0.28); color: #ffbdb8; }
.sdk-log__label { color: #fff; font-weight: 700; }
.sdk-log__detail { color: #d1c3bb; }
.sdk-log__ms { margin-left: auto; color: #9a8a82; }
.footer { border-top: 1px solid var(--line); padding: 1.5rem 1.25rem 2.5rem; text-align: center; color: var(--ink-soft); font-size: 0.85rem; }
.footer p { margin: 0.2rem 0; }
.footer__legal { font-weight: 700; color: var(--ink); font-size: 0.8rem; }
.footer__small { font-size: 0.75rem; }
`;
