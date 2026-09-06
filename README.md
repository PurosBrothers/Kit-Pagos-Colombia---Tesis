# Kit Pagos Colombia — Tesis

SDK unificado para la integración de pasarelas de pago colombianas.

## Pasarelas soportadas

| Enum `Gateway` | Proveedor | Notas |
|---|---|---|
| `Gateway.WOMPI` | [Wompi](https://docs.wompi.co) | Firma: SHA-256 header `x-event-checksum` |
| `Gateway.RAPYD` | [Rapyd / PayU GPO](https://docs.rapyd.net) | Adquisición completada 14 mar 2025. Firma webhook: HMAC-SHA256 header `signature` |
| `Gateway.MERCADOPAGO` | [Mercado Pago](https://mercadopago.com.co/developers) | Firma: HMAC-SHA256 header `x-signature` |
| `Gateway.KUSHKI` | [Kushki](https://docs.kushki.com/co) | Firma: HMAC-SHA256 header `x-kushki-signature` |

## Documentación

- [SAD (Software Architecture Document)](https://docs.google.com/document/d/1woixOGOkZ3N4OQ1YdFYthfP15brxFDec/edit) — Documento de arquitectura completo del proyecto
- [`docs/architecture/architecture-explained.md`](docs/architecture/architecture-explained.md) — Fundamentos y verificación en código
- [`docs/architecture/layers-and-components.md`](docs/architecture/layers-and-components.md) — Especificación oficial de componentes (C4 nivel 3)
- [`docs/architecture/ubiquitous-language.md`](docs/architecture/ubiquitous-language.md) — Lenguaje ubicuo por pasarela
- [`docs/architecture/architecture-log.md`](docs/architecture/architecture-log.md) — Inconsistencias SAD-vs-código, decisiones técnicas (migración Rapyd) y seguimiento de diagramas
- [`docs/architecture/money-representation-analysis.md`](docs/architecture/money-representation-analysis.md) — Auditoría del tipo de dato usado para dinero (`Amount`) frente a las 4 pasarelas
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Guía de contribución y flujo de trabajo