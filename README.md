# Kit Pagos Colombia — Tesis

SDK unificado para la integración de pasarelas de pago colombianas.

## Pasarelas soportadas

| Enum `Gateway` | Proveedor | Notas |
|---|---|---|
| `Gateway.WOMPI` | [Wompi](https://docs.wompi.co) | Firma: SHA-256 header `x-event-checksum` |
| `Gateway.RAPYD` | [Rapyd / PayU GPO](https://docs.rapyd.net) | Adquisición completada 14 mar 2025. Firma webhook: HMAC-SHA256 header `signature` |
| `Gateway.MERCADOPAGO` | [Mercado Pago](https://mercadopago.com.co/developers) | Firma: HMAC-SHA256 header `x-signature` |
| `Gateway.KUSHKI` | [Kushki](https://docs.kushki.com/co) | Firma: HMAC-SHA256 header `x-kushki-signature` |

De las cuatro, solo Wompi tiene Adapter implementado en esta iteración. Las demás lanzan `SdkError(UNSUPPORTED_OPERATION)` al resolverse.

## Ejemplo rápido

```ts
import { KitPagos, Gateway, Amount, Currency, OrderReference, Payer } from "kit-pagos-colombia";

const kitPagos = new KitPagos({
  gateway: Gateway.WOMPI,
  credentials: { [Gateway.WOMPI]: { publicKey: "pub_test_...", privateKey: "prv_test_..." } },
});

const transaction = await kitPagos.createPayment({
  amount: new Amount(150000),
  currency: new Currency("COP"),
  orderReference: new OrderReference("ORDER-1042"),
  payer: new Payer({ email: "cliente@example.com" }),
});

console.log(transaction.getStatus(), transaction.isApproved());
```

Hay un ejemplo ejecutable completo, que corre contra la API de Simulación, en [`examples/`](examples/).

## Documentación

- [SAD (Software Architecture Document)](https://docs.google.com/document/d/1woixOGOkZ3N4OQ1YdFYthfP15brxFDec/edit) — Documento de arquitectura completo del proyecto
- [`docs/architecture/architecture-explained.md`](docs/architecture/architecture-explained.md) — Fundamentos y verificación en código
- [`docs/architecture/layers-and-components.md`](docs/architecture/layers-and-components.md) — Especificación oficial de componentes (C4 nivel 3)
- [`docs/architecture/ubiquitous-language.md`](docs/architecture/ubiquitous-language.md) — Lenguaje ubicuo por pasarela
- [`docs/architecture/architecture-log.md`](docs/architecture/architecture-log.md) — Inconsistencias SAD-vs-código, decisiones técnicas (migración Rapyd) y seguimiento de diagramas
- [`docs/architecture/money-representation-analysis.md`](docs/architecture/money-representation-analysis.md) — Auditoría del tipo de dato usado para dinero (`Amount`) frente a las 4 pasarelas
- [`docs/examples/simulated-payment.md`](docs/examples/simulated-payment.md) — Recorrido del ejemplo end-to-end de un pago simulado con Wompi
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Guía de contribución y flujo de trabajo