# Kit Pagos Colombia — Tesis

Integre una vez. Cambie de pasarela cambiando un valor.

Sitio web y demostración interactiva: [https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/](https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/)

Kit Pagos Colombia son **tres componentes**, no uno:

| Componente | Qué es | Dónde vive |
|---|---|---|
| **SDK** | Un paquete de TypeScript con arquitectura hexagonal que unifica cuatro pasarelas colombianas en el servidor y expone `kit-pagos-colombia/browser` para tokenización de tarjeta en el navegador | [`sdk/`](sdk/) |
| **API de Simulación** | Un servidor con dos caras: en `/v1/sim`, cuatro mocks de las pasarelas para probar los flujos que los sandboxes reales no permiten probar; en `/v1/api`, el SDK expuesto como API REST, para cobrar sin instalarlo. Desplegado en vivo en Render: [https://kit-pagos-colombia.onrender.com](https://kit-pagos-colombia.onrender.com) | [`simulator-api/`](simulator-api/) |
| **Documentación de datos** | Las tarjetas, bancos y credenciales de prueba de las cuatro pasarelas, con su nivel de evidencia | [`docs/testing-data/`](docs/testing-data/README.md) |

Los tres juntos son el artefacto de un trabajo de grado. Métodos soportados: **tarjeta y PSE**.

---

## Pasarelas soportadas

| Enum `Gateway` | Proveedor | Firma del webhook |
|---|---|---|
| `Gateway.WOMPI` | [Wompi](https://docs.wompi.co) | SHA-256, cabecera `x-event-checksum` |
| `Gateway.RAPYD` | [Rapyd](https://docs.rapyd.net) | HMAC-SHA256 en hexadecimal y ese texto en base64, cabecera `signature` |
| `Gateway.MERCADOPAGO` | [Mercado Pago](https://mercadopago.com.co/developers) | HMAC-SHA256 en hexadecimal, cabecera `x-signature` |
| `Gateway.KUSHKI` | [Kushki](https://docs.kushki.com/co) | HMAC-SHA256 en hexadecimal, cabecera `x-kushki-signature` |

Las cuatro están implementadas y probadas: más de 600 pruebas unitarias en el SDK, más de 250 en la API de Simulación, 18 pruebas de contrato contra los sandboxes reales, y un ejemplo ejecutable que verifica por código que las cuatro devuelven el mismo resultado normalizado. Las cifras exactas las imprime cada suite al ejecutarse; el detalle está en [`docs/04-metricas-y-pruebas/2-pruebas-del-sdk.md`](docs/04-metricas-y-pruebas/2-pruebas-del-sdk.md).

Cuatro algoritmos de firma distintos y cuatro vocabularios de estado distintos —`APPROVED`, `CLO`, `approved`, `APPROVAL`— son, en resumen, el problema que el SDK resuelve. Uno de ellos, `CLO`, ni siquiera significa "pagado": significa "cerrado".

---

## Empezar

Las dos formas necesitan el SDK compilado, porque la API de Simulación y los ejemplos lo consumen desde `sdk/dist`. Después se levanta la API de Simulación y se deja corriendo (o se interactúa directamente con el despliegue en la nube en [Render](https://kit-pagos-colombia.onrender.com)):

```bash
cd sdk && npm install && npm run build
cd simulator-api && npm install && npm run dev
```

**Por la API REST, sin escribir código.** Con la API corriendo (localmente en `http://localhost:3000` o en la nube en `https://kit-pagos-colombia.onrender.com`), desde otra terminal:

```bash
curl http://localhost:3000/v1/api/gateways
curl -X POST http://localhost:3000/v1/api/payments -H "content-type: application/json" -H "x-gateway-public-key: demo" -H "x-gateway-private-key: demo" -d '{"gateway":"mercadopago","amount":"150000.00","currency":"COP","orderReference":"ORD-1","payer":{"email":"comprador@example.com"},"paymentMethod":{"type":"CARD","token":"tok_test","installments":1}}'
```

La primera lista las cuatro pasarelas. La segunda responde `201` con la transacción normalizada. Con el mismo cuerpo y otro valor de `gateway` responden también las otras tres, cada una con el desenlace correspondiente. Mediante la cabecera `x-kit-pagos-environment` (`simulator`, `sandbox` o `production`), el cliente declara el ambiente y la API resuelve la URL desde un catálogo cerrado sin exponer credenciales a servidores externos (Issue #123). Las rutas y sus reglas están en [`docs/02-arquitectura/3-api-de-simulacion.md`](docs/02-arquitectura/3-api-de-simulacion.md).

**Por el SDK, desde código.** Con la API corriendo:

```bash
cd examples && npm install && npm run simulate:wompi
```

El ejemplo rápido de código, con la firma exacta de cada llamada, está en la [guía rápida de uso del README del SDK](sdk/README.md#guía-rápida-de-uso). No se duplica aquí a propósito: los fragmentos de ese README se compilan contra el SDK construido en cada pull request con `npm run check:readme`, y una segunda copia sin esa guarda se desactualizaría sin que nada lo detecte. Ya pasó una vez, con diez fragmentos rotos publicados a la vez.

---

## Documentación

**Empiece por [`docs/README.md`](docs/README.md)**, que tiene el camino de lectura completo, ordenado por concepto.

| Sección | Para qué sirve |
|---|---|
| [`docs/00-entorno-de-desarrollo.md`](docs/00-entorno-de-desarrollo.md) | Instalar, compilar y ejecutar las tres partes |
| [`docs/01-producto/`](docs/01-producto/) | Qué es una pasarela de pago, los conceptos técnicos, las cuatro pasarelas comparadas, por qué existe el proyecto |
| [`docs/02-arquitectura/`](docs/02-arquitectura/) | Arquitectura hexagonal, su verificación contra el código real, y la API de Simulación con sus dos caras |
| [`docs/03-sdk/`](docs/03-sdk/) | El recorrido de una llamada, las 63 unidades de producción una por una (31 de ellas son clases), cada pasarela por dentro, y la guía de implementación |
| [`docs/04-metricas-y-pruebas/`](docs/04-metricas-y-pruebas/) | Las métricas CK, las tres suites de pruebas, y cómo se van a medir los prototipos |
| [`docs/05-ejemplos/`](docs/05-ejemplos/) | Los once ejemplos ejecutables y tres recorridos comentados |
| [`docs/06-landing/`](docs/06-landing/) | El alcance de la página de presentación ([sitio web en vivo](https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/)) |
| [`docs/testing-data/`](docs/testing-data/README.md) | El tercer componente: los datos de prueba de las cuatro pasarelas |

### Referencia y contexto académico

- [`docs/architecture/architecture-log.md`](docs/architecture/architecture-log.md) — El registro de decisiones del proyecto: más de setenta puntos numerados con los defectos medidos, las decisiones tomadas y las que siguen abiertas. Es la fuente de verdad de por qué el código es como es.
- [`docs/architecture/money-representation-analysis.md`](docs/architecture/money-representation-analysis.md) — Por qué el dinero es una cadena y no un número, auditado contra las cuatro pasarelas.
- [`docs/project-management/`](docs/project-management/) — La metodología (Design Science Research), los objetivos específicos y los prototipos, el cronograma y el plan de evaluación de los prototipos.
- [SAD (Software Architecture Document)](https://docs.google.com/document/d/1woixOGOkZ3N4OQ1YdFYthfP15brxFDec/edit) — El documento formal de arquitectura, fuera del repositorio.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Estándares de commits, política de ramas y pull requests.

---

## Lo que el proyecto no hace

- Los **códigos de banco de PSE** son distintos en cada pasarela (en Mercado Pago `1007`, en Rapyd `co_pse_bancolombia_bank`), pero `PseBankCode.BANCOLOMBIA` sirve en las cuatro: es el código de compensación de ACH Colombia, y el SDK lo traduce donde hace falta. Los bancos ficticios de los sandboxes solo existen con el código que devuelve `getPseBanks()`.
- El **token de tarjeta tampoco** es portable entre pasarelas: lo emite el frontend (`kit-pagos-colombia/browser`) contra cada pasarela respectiva.
- **Solo tarjeta y PSE.** No hay efectivo, ni Nequi, ni suscripciones, ni reembolsos.
- **La redirección no desaparece.** Con PSE redirigen las cuatro.
- Las **cifras comparativas todavía no existen.** Las produce el experimento de la Fase 5.

El detalle de cada límite está en [`docs/01-producto/4-por-que-kit-pagos.md`](docs/01-producto/4-por-que-kit-pagos.md).
