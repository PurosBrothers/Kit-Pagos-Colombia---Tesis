# Kit Pagos Colombia — Tesis

Integrá una vez. Cambiá de pasarela cambiando un valor.

Kit Pagos Colombia son **tres componentes**, no uno:

| Componente | Qué es | Dónde vive |
|---|---|---|
| **SDK** | Un paquete de TypeScript con arquitectura hexagonal que unifica cuatro pasarelas colombianas | [`sdk/`](sdk/) |
| **API de Simulación** | Cuatro mocks locales, para probar los flujos que los sandboxes reales no permiten probar | [`simulator-api/`](simulator-api/) |
| **Documentación de datos** | Las tarjetas, bancos y credenciales de prueba de las cuatro pasarelas, con su nivel de evidencia | [`docs/testing-data/`](docs/testing-data/README.md) |

Los tres juntos son el artefacto de un trabajo de grado. Métodos soportados: **tarjeta y PSE**.

---

## Pasarelas soportadas

| Enum `Gateway` | Proveedor | Firma del webhook |
|---|---|---|
| `Gateway.WOMPI` | [Wompi](https://docs.wompi.co) | SHA-256, cabecera `x-event-checksum` |
| `Gateway.RAPYD` | [Rapyd](https://docs.rapyd.net) | HMAC-SHA256 en base64, cabecera `signature` |
| `Gateway.MERCADOPAGO` | [Mercado Pago](https://mercadopago.com.co/developers) | HMAC-SHA256 en hexadecimal, cabecera `x-signature` |
| `Gateway.KUSHKI` | [Kushki](https://docs.kushki.com/co) | HMAC-SHA256 en hexadecimal, cabecera `x-kushki-signature` |

Las cuatro están implementadas y probadas: 586 pruebas unitarias, 16 pruebas de contrato contra los sandboxes reales, y un ejemplo ejecutable que verifica por código que las cuatro devuelven el mismo resultado normalizado.

Cuatro algoritmos de firma distintos y cuatro vocabularios de estado distintos —`APPROVED`, `CLO`, `approved`, `APPROVAL`— son, en resumen, el problema que el SDK resuelve. Uno de ellos, `CLO`, ni siquiera significa "pagado": significa "cerrado".

---

## Empezar

```bash
cd sdk && npm install && npm run build
cd simulator-api && npm install && npm run dev   # dejar corriendo
cd examples && npm install && npm run simulate:wompi
```

El ejemplo rápido de código, con la firma exacta de cada llamada, está en la [guía rápida de uso del README del SDK](sdk/README.md#guía-rápida-de-uso). No se duplica acá a propósito: los fragmentos de ese README se compilan contra el SDK construido en cada pull request con `npm run check:readme`, y una segunda copia sin esa guarda se desactualizaría sin que nada lo detecte. Ya pasó una vez, con diez fragmentos rotos publicados a la vez.

---

## Documentación

**Empezá por [`docs/README.md`](docs/README.md)**, que tiene el camino de lectura completo, ordenado por concepto.

| Sección | Para qué sirve |
|---|---|
| [`docs/00-entorno-de-desarrollo.md`](docs/00-entorno-de-desarrollo.md) | Instalar, compilar y correr las tres partes |
| [`docs/01-producto/`](docs/01-producto/) | Qué es una pasarela de pago, los conceptos técnicos, las cuatro pasarelas comparadas, por qué existe el proyecto |
| [`docs/02-arquitectura/`](docs/02-arquitectura/) | Arquitectura hexagonal, su verificación contra el código real, y la API de Simulación |
| [`docs/03-sdk/`](docs/03-sdk/) | El recorrido de una llamada, las 31 clases, cada pasarela por dentro, y la guía de implementación |
| [`docs/04-metricas-y-pruebas/`](docs/04-metricas-y-pruebas/) | Las métricas CK, las tres suites de pruebas, y cómo se van a medir los prototipos |
| [`docs/05-ejemplos/`](docs/05-ejemplos/) | Los diez ejemplos ejecutables y dos recorridos comentados |
| [`docs/06-landing/`](docs/06-landing/) | El alcance de la página de presentación |
| [`docs/testing-data/`](docs/testing-data/README.md) | El tercer componente: los datos de prueba de las cuatro pasarelas |

### Referencia y contexto académico

- [`docs/architecture/architecture-log.md`](docs/architecture/architecture-log.md) — El registro de decisiones del proyecto: 59 puntos con los defectos medidos, las decisiones tomadas y las que siguen abiertas. Es la fuente de verdad de por qué el código es como es.
- [`docs/architecture/money-representation-analysis.md`](docs/architecture/money-representation-analysis.md) — Por qué el dinero es una cadena y no un número, auditado contra las cuatro pasarelas.
- [`docs/project-management/`](docs/project-management/) — La metodología (Design Science Research), el cronograma y el plan de evaluación de los prototipos.
- [SAD (Software Architecture Document)](https://docs.google.com/document/d/1woixOGOkZ3N4OQ1YdFYthfP15brxFDec/edit) — El documento formal de arquitectura, fuera del repositorio.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Estándares de commits, política de ramas y pull requests.

---

## Lo que el proyecto no hace

- Los **códigos de banco de PSE no son portables** entre pasarelas: en Wompi es `1`, en Mercado Pago `1007`, en Rapyd `co_pse_bancolombia_bank`. El SDK unifica cómo se piden, no los códigos.
- El **token de tarjeta tampoco** es portable: lo emite el frontend de cada pasarela.
- **Solo tarjeta y PSE.** No hay efectivo, ni Nequi, ni suscripciones, ni reembolsos.
- **La redirección no desaparece.** Con PSE redirigen las cuatro.
- Las **cifras comparativas todavía no existen.** Las produce el experimento de la Fase 5.

El detalle de cada límite está en [`docs/01-producto/4-por-que-kit-pagos.md`](docs/01-producto/4-por-que-kit-pagos.md).
