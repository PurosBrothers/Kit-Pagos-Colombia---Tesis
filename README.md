# Kit Pagos Colombia — Tesis

Integre una vez. Cambie de pasarela cambiando un valor.

- 🌐 **Página Web y Documentación Oficial:** [https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/](https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/)
- 📖 **Documentación Interactiva OpenAPI (Swagger UI):** [https://kit-pagos-colombia.onrender.com/docs](https://kit-pagos-colombia.onrender.com/docs)
- 📚 **Ruta de Lectura de la Documentación Técnica:** [`docs/README.md`](docs/README.md)

Kit Pagos Colombia son **tres componentes**, no uno:

| Componente | Qué es | Dónde vive |
|---|---|---|
| **SDK** | Paquete de TypeScript con arquitectura hexagonal que unifica cuatro pasarelas colombianas en el backend y expone `kit-pagos-colombia/browser` para tokenizar la tarjeta en el navegador, sin que pase por el servidor | [`sdk/`](sdk/) · [README del SDK](sdk/README.md) |
| **API de Simulación y Capa REST** | Servidor Fastify con dos caras: en `/v1/sim`, 33 rutas mock para probar flujos que los sandboxes bloquean; en `/v1/api`, el SDK expuesto como API REST. Documentado formalmente con OpenAPI 3.0 en [`/docs`](https://kit-pagos-colombia.onrender.com/docs) (Swagger UI) y desplegado en Render: [https://kit-pagos-colombia.onrender.com](https://kit-pagos-colombia.onrender.com) | [`simulator-api/`](simulator-api/) · [README de la API](simulator-api/README.md) |
| **Documentación de datos** | Tarjetas, bancos PSE y credenciales de prueba de las cuatro pasarelas, con nivel de evidencia 1 | [`docs/testing-data/`](docs/testing-data/README.md) |

Los tres juntos son el artefacto de un trabajo de grado en Ingeniería de Sistemas (Pontificia Universidad Javeriana). Métodos soportados: **tarjeta de crédito/débito y PSE**.

---

## Documentación Interactiva de la API (OpenAPI 3.0)

La capa REST y las rutas del simulador están completamente documentadas mediante **OpenAPI 3.0.3**:
- **Swagger UI interactivo:** [`https://kit-pagos-colombia.onrender.com/docs`](https://kit-pagos-colombia.onrender.com/docs)
- **Especificación cruda en JSON:** [`https://kit-pagos-colombia.onrender.com/docs/json`](https://kit-pagos-colombia.onrender.com/docs/json)

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

## Estructura del Monorepositorio

| Directorio | Propósito | Documentación |
|---|---|---|
| [`sdk/`](sdk/) | Código fuente del SDK en TypeScript, pruebas unitarias y métricas CK | [`sdk/README.md`](sdk/README.md) |
| [`simulator-api/`](simulator-api/) | Servidor Fastify con las 33 rutas mock de pasarelas y los 5 endpoints de Kit Pagos documentados con OpenAPI 3.0 | [`simulator-api/README.md`](simulator-api/README.md) |
| [`landing/`](landing/) | Página web interactiva y especificación técnica (Vite / Vanilla CSS) | [`docs/06-landing/`](docs/06-landing/) |
| [`examples/`](examples/) | Once programas ejecutables que demuestran la integración | [`examples/README.md`](examples/README.md) |
| [`docs/`](docs/) | Documentación completa: DSR, arquitectura C4, métricas y datos de prueba | [`docs/README.md`](docs/README.md) |

---

## Documentación

- **Página Web y Especificación Técnica Interactiva:** [https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/](https://purosbrothers.github.io/Kit-Pagos-Colombia---Tesis/)
- **Documentación Interactiva OpenAPI (Swagger UI):** [https://kit-pagos-colombia.onrender.com/docs](https://kit-pagos-colombia.onrender.com/docs)
- **Camino de lectura completo en el repositorio:** **Empiece por [`docs/README.md`](docs/README.md)**, que tiene el orden conceptual completo.

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

- [`docs/architecture/architecture-log.md`](docs/architecture/architecture-log.md) — El registro de decisiones del proyecto: más de 100 puntos técnicos documentados con los defectos medidos, las decisiones tomadas y las que siguen abiertas. Es la fuente de verdad de por qué el código es como es.
- [`docs/architecture/money-representation-analysis.md`](docs/architecture/money-representation-analysis.md) — Por qué el dinero es una cadena y no un número, auditado contra las cuatro pasarelas.
- [`docs/project-management/`](docs/project-management/) — La metodología (Design Science Research), los objetivos específicos y los prototipos, el cronograma y el plan de evaluación de los prototipos.
- [SAD (Software Architecture Document)](https://docs.google.com/document/d/1woixOGOkZ3N4OQ1YdFYthfP15brxFDec/edit) — El documento formal de arquitectura, fuera del repositorio.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — Estándares de commits, política de ramas y pull requests.

---

## Lo que encontramos en los sandboxes

Límites de las pasarelas, no del proyecto, que aparecieron probando la tienda del prototipo C contra los sandboxes oficiales. Quien integre cualquiera de las cuatro se los va a encontrar, con o sin Kit Pagos.

- **Mercado Pago: las credenciales de prueba no son las que parecen.** Las que sirven son el par `APP_USR-` de «Pruebas > Credenciales de prueba» de una aplicación de Checkout API vía Orders, cuya cuenta es un vendedor de prueba. Un par `TEST-` cobra tarjeta, pero la Orders API, la del PSE, le responde `401`; el `APP_USR-` de la aplicación de producción cobra de verdad ([`mercado-pago.md`](docs/testing-data/mercado-pago.md), punto 95).
- **Mercado Pago: el PSE no vuelve a `localhost`, y pide la IP del pagador.** Rechaza una `callback_url` local (`402 processing_error`), así que para probarlo en la máquina hay que servir la página por un túnel público (`cloudflared tunnel --url http://localhost:4100`), y la API detrás de un proxy tiene que tomar la IP de `X-Forwarded-For` ([guía de prueba](docs/05-ejemplos/checkout-frontend-rest-guia-de-prueba.md), sección 3).
- **Kushki: el UAT no cierra las transferencias PSE.** La página del banco y la vuelta funcionan, pero el estado se queda en `initializedTransaction`: Kushki activa la simulación de estados por comercio, y hay que pedírsela ([`kushki.md`](docs/testing-data/kushki.md), 5.2.2).
- **Kushki: el token de tarjeta queda atado al monto.** Su tokenización pide el monto del cobro, y cobrar el token por otro responde `400 K220`. La tarjeta que su documentación lista como aprobada no tokenizaba en esta cuenta, y el 17 de octubre de 2026 sí ([`kushki.md`](docs/testing-data/kushki.md), 1.3).
- **Rapyd: el sandbox solo cobra 9 de sus 50 bancos PSE.** Con los otros responde `400 ERROR_GET_GATEWAY`, el catálogo no dice cuáles son, y renombra métodos sin aviso (Davibank). Contra el sandbox, el SDK devuelve solo los 9 ([`rapyd.md`](docs/testing-data/rapyd.md), 5.8).
- **Rapyd: la tarjeta solo se cobra en su página.** No hay token en el navegador, y el cobro directo exige el número de la tarjeta en el servidor del comercio (PCI). El pagador la escribe en `sandboxcheckout.rapyd.net`, pasa por un simulador de 3DS (código `123456`) y vuelve solo ([`rapyd.md`](docs/testing-data/rapyd.md), 4.1).
- **Wompi: el PSE del sandbox no tiene página de banco.** Se elige el desenlace con tres bancos de prueba: «Banco que aprueba» (`1`), el que declina (`2`) y el que simula un error (`3`) ([`wompi.md`](docs/testing-data/wompi.md)).
- **Las llaves públicas del navegador tienen que ser del mismo par que las de la API.** La tarjeta se tokeniza con la llave pública que tiene la página y la cobra la API con sus credenciales; si son de cuentas o aplicaciones distintas, el token no sirve (`.env.example`).

---

## Lo que el proyecto no hace

- Los **códigos de banco de PSE** son distintos en cada pasarela (en Mercado Pago `1007`, en Rapyd `co_pse_bancolombia_bank`), pero `PseBankCode.BANCOLOMBIA` sirve en las cuatro: es el código de compensación de ACH Colombia, y el SDK lo traduce donde hace falta. Los bancos ficticios de los sandboxes solo existen con el código que devuelve `getPseBanks()`.
- El **token de tarjeta tampoco** es portable entre pasarelas: lo emite el frontend (`kit-pagos-colombia/browser`) contra cada pasarela respectiva.
- **Solo tarjeta y PSE.** No hay efectivo, ni Nequi, ni suscripciones, ni reembolsos.
- **Ni el SDK ni los prototipos protegen la página donde se escribe la tarjeta.**
  - La Content-Security-Policy la manda el servidor del comercio, y ninguno de los tres prototipos la manda.
  - En el prototipo C, además, el monto lo decide el navegador.
  - Los prototipos son demostraciones contra los sandboxes, no plantillas para producción. Lo que un comercio tiene que agregar está en la [guía de implementación](docs/03-sdk/4-guia-de-implementacion.md) §9.
- **La redirección no desaparece.** Con PSE redirigen las cuatro.
- Las **cifras comparativas todavía no existen.** Las produce el experimento de la Fase 5.

El detalle de cada límite está en [`docs/01-producto/4-por-que-kit-pagos.md`](docs/01-producto/4-por-que-kit-pagos.md).
