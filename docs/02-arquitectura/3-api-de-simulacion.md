# La API de Simulación: el segundo componente

Un servidor Fastify que imita a las cuatro pasarelas. Este documento explica por qué existe, qué expone, hasta dónde llega su fidelidad y qué le falta para estar completo.

---

## 1. Por qué existe

La respuesta corta es que **los sandboxes reales no permiten ejercitar los flujos completos**. No es una suposición; está medido, y cada caso está registrado en el [architecture-log](../architecture/architecture-log.md):

| Lo que se midió | Consecuencia |
|---|---|
| El sandbox de Wompi publica la URL de redirección de PSE **en el mismo instante** en que resuelve el pago (punto 43) | No existe ninguna ventana de tiempo en la que redirigir tenga sentido. El flujo de PSE de Wompi no se puede ejercitar contra su sandbox |
| La Orders API de Mercado Pago, la única con PSE, responde `401` con credenciales de prueba y exige token de producción (punto 45) | El PSE de Mercado Pago no se puede probar en sandbox en absoluto |
| Kushki no registra los cobros síncronos de tarjeta en la ruta de consulta que publica: responde `CAS004 "No existe la transacción"` (punto 54) | El ciclo de vida completo de un cobro con tarjeta en Kushki no se puede mostrar contra su sandbox |

Y hay una razón más, que aplica a los cuatro: **un sandbox real declina cuando quiere.** Por eso las 16 pruebas de contrato del proyecto no afirman `APPROVED`, solo que la petición fue aceptada y la respuesta tiene la forma esperada. Una prueba automatizada que necesite un desenlace concreto no puede depender de un servicio de un tercero.

El simulador resuelve las dos cosas: es **determinista**, así que una prueba puede afirmar un resultado, y **no necesita credenciales**, así que corre en CI y cualquiera lo puede levantar recién clonado el repositorio.

---

## 2. Cómo está construido

```text
simulator-api/src/
├── server.ts                 pone a escuchar el puerto
├── app.ts                    construye la instancia de Fastify, hooks y registra las rutas
├── auth/
│   ├── CredentialResolver.ts resolución híbrida de credenciales (headers > env)
│   └── authHook.ts           hook onRequest de autenticación Bearer en tiempo constante
├── services/
│   └── KitPagosProvider.ts   ciclo de vida e instanciación del SDK (npm)
├── logger/
│   └── redactSerializer.ts   redacción estricta de credenciales en logs de Pino
├── routes/
│   ├── health.ts             GET /health
│   ├── wompi.ts              4 rutas
│   ├── mercadopago.ts        5 rutas
│   ├── rapyd.ts              7 rutas
│   └── kushki.ts             6 rutas
├── gateways/
│   ├── wompi/                GatewayMockFactory.ts + types.ts
│   ├── mercadopago/          GatewayMockFactory.ts + types.ts
│   ├── rapyd/                GatewayMockFactory.ts + types.ts
│   └── kushki/               GatewayMockFactory.ts + types.ts
├── scenarios/
│   └── ScenarioEngine.ts     decide qué desenlace producir
└── store/
    └── TransactionStore.ts   memoria de las transacciones creadas
```

**`app.ts` está separado de `server.ts` a propósito.** `buildApp()` construye la instancia de Fastify sin ponerla a escuchar, y `server.ts` es lo único que llama a `listen()`. Así las suites de prueba usan `app.inject()` sobre la misma aplicación que corre en producción, sin abrir un socket. La diferencia práctica es que las pruebas no pueden quedarse colgadas esperando la red ni chocar por el puerto ocupado.

**Capa de autenticación y resolución de credenciales (`src/auth/`):**
- `CredentialResolver`: Implementa la resolución híbrida. Primero inspecciona las cabeceras `x-gateway-public-key`, `x-gateway-private-key` (e `integrity-secret`). Si no están presentes, recurre al perfil de sandbox del `.env` del servidor. Por seguridad estricta, `webhookSecret` **nunca** se acepta desde el cliente HTTP para evitar invalidar la verificación criptográfica. Si faltan credenciales, lanza `MissingCredentialsError` (HTTP 401).
- `authHook`: Hook `onRequest` que protege los endpoints REST mediante token Bearer (`API_AUTH_TOKEN`). Realiza comparaciones en tiempo constante (`crypto.timingSafeEqual`) para mitigar ataques de temporización. Si `API_AUTH_TOKEN` no está configurado, opera en modo desarrollo abierto con advertencia en logs. Rutas públicas como `/health` y los endpoints mock `/v1/sim/*` están exentos por prefijo.

**Capa de servicio SDK (`src/services/`):**
- `KitPagosProvider`: Administra las instancias de `KitPagos` (importado del paquete publicado en npm `kit-pagos-colombia@^0.1.0`). Para credenciales del servidor, mantiene un caché singleton por pasarela. Para credenciales inyectadas por el cliente en cabeceras HTTP, crea instancias al vuelo aisladas por petición, garantizando que no exista fuga ni contaminación cruzada entre clientes concurrentes.

**Seguridad en observabilidad (`src/logger/`):**
- `redactSerializer`: Redactor para Fastify/Pino que reemplaza por `"[REDACTED]"` cualquier cabecera sensible (`authorization`, `x-gateway-*`), impidiendo que secretos o API keys aparezcan en texto claro en consolas o servicios de agregación de logs.

**Una factoría de mocks por pasarela**, con sus tipos al lado. Cada una construye las respuestas con la forma nativa de su pasarela: Wompi envuelve todo en `data` y usa `amount_in_cents`; Mercado Pago pone el pago en la raíz y el monto en pesos; y así.

**El `TransactionStore` guarda en memoria, y eso es deliberado.** Reiniciar el servidor limpia el estado, que es exactamente lo que se quiere de un simulador: cada corrida arranca desde cero, sin arrastrar transacciones de una prueba anterior. Es una sola instancia compartida en todo el proceso.

---

## 3. Las rutas

23 endpoints. Todas viven bajo `/v1/sim/<pasarela>/` y **replican la forma de la ruta nativa**, para que apuntar el SDK al simulador sea cambiar `baseUrl` y nada más.

| Pasarela | Rutas |
|---|---|
| **Wompi** (4) | `POST /transactions`, `GET /transactions/:id`, `GET /merchants/:publicKey`, `GET /pse/financial_institutions` |
| **Mercado Pago** (5) | `POST /payments`, `GET /payments/:id`, `POST /orders`, `GET /orders/:id`, `GET /payment_methods` |
| **Rapyd** (7) | `POST /payments`, `GET /payments/:paymentId`, `POST /checkout`, `GET /checkout/:checkoutId`, `GET /checkout/:checkoutId/pagar`, `POST /customers`, `GET /payment_methods/country` |
| **Kushki** (6) | `POST /card/v1/charges`, `GET /charges/:ticketNumber`, `GET /transfer/v1/bankList`, `POST /transfer/v1/tokens`, `POST /transfer/v1/init`, `GET /transfer/v1/status/:token` |
| **Salud** (1) | `GET /health` |

La asimetría en el número de rutas no es descuido: es el reflejo directo de que cada pasarela necesita una cantidad distinta de llamadas para el mismo flujo. Rapyd tiene siete porque su tarjeta va por checkout alojado y su PSE necesita crear un cliente primero.

`GET /checkout/:checkoutId/pagar` es la única ruta que **no** existe en ninguna pasarela real: es el botón que simula al pagador completando el pago en la página alojada de Rapyd. Sin ella no habría forma de avanzar un checkout desde una prueba automatizada.

---

## 4. El header de escenario

Todas las rutas de creación leen el header **`x-simulate-scenario`**, que por defecto vale `APPROVED`. La idea es que la misma petición produzca desenlaces distintos según lo que la prueba necesite.

Y acá está el hueco más grande del componente, dicho sin adornos:

```36:56:simulator-api/src/scenarios/ScenarioEngine.ts
export class ScenarioEngine {
  execute(
    scenario: string,
    requestBody: WompiCreateTransactionRequestBody,
  ): WompiTransactionResponse {
    if (scenario === DEFAULT_SCENARIO) {
      if (requestBody.payment_method?.type === "PSE") {
        return this.wompiMockFactory.buildPendingPseResponse(requestBody);
      }
      return this.wompiMockFactory.buildApprovedResponse(requestBody);
    }

    throw new UnsupportedScenarioError(scenario);
  }
}
```

**El motor solo sabe aprobar, y solo para Wompi.** Cualquier otro escenario lanza `UnsupportedScenarioError`, que el router traduce a un HTTP **501 Not Implemented**.

Ese 501 es una decisión, no una omisión: **es mucho mejor que un `APPROVED` falso.** Si el motor respondiera "aprobado" a una petición que pidió `RECHAZADO`, una prueba de manejo de rechazos pasaría sin haber probado nada, y el defecto aparecería en producción. Un 501 hace ruido de inmediato.

PSE tiene un caso aparte y correcto: no depende del escenario pedido sino del método de pago, porque un pago de PSE queda `PENDING` esperando al pagador incluso en el camino feliz.

---

## 5. Los límites de fidelidad, declarados

Un simulador que no declare en qué se aparta de la realidad es una trampa. Estos son los apartamientos conocidos:

**El mock de Rapyd no verifica la firma HMAC de las peticiones entrantes.** Rapyd real rechaza cualquier petición mal firmada. Contra el simulador, un adaptador con la firma rota funciona igual, así que la corrección de esa firma **solo** la garantizan las pruebas unitarias con vectores independientes y las pruebas de contrato.

**`GET /charges/:ticketNumber` de Kushki no existe en Kushki real.** Se midió que responde `403` para cualquier identificador, igual que una ruta inventada. El simulador la implementa porque es la que permite mostrar el ciclo de vida completo de un cobro con tarjeta en un ejemplo ejecutable. Contra Kushki real, ese estado llega por webhook.

**El simulador no exige la firma de integridad de Wompi.** Wompi real responde `422 "Firma de integridad requerida no enviada"`. Ese defecto vivió en el SDK sin que nadie lo notara justamente porque el simulador no la pedía (punto 44).

**El simulador no exige `X-Idempotency-Key` en Mercado Pago.** Mercado Pago real responde `400`. Mismo patrón que el anterior (punto 48).

Estos cuatro casos tienen una lección común, y es probablemente la más importante del proyecto: **el simulador solo es tan fiel como lo que se midió.** En un momento el mock afirmaba que las cuatro pasarelas cobraban con tarjeta servidor a servidor, y al medir resultó que ninguna lo hacía como el mock decía (punto 50). Por eso el proyecto tiene **además** pruebas de contrato contra los sandboxes reales: son las que detectan cuándo el simulador se volvió optimista.

---

## 6. Qué falta para que el componente esté completo

Es el primer entregable de la Iteración 3, y son cuatro cosas:

1. **Los escenarios de fallo:** rechazo, fondos insuficientes, timeout y error de red, para las cuatro pasarelas y no solo para Wompi. Es el requisito RF-10.
2. **Que el motor reciba la pasarela como parámetro** en vez de asumir Wompi.
3. **El despliegue**, en Render, que ya está en uso para este proyecto.
4. **La colección Postman versionada**, como entregable de la iteración.

**El punto 1 bloquea a los prototipos**, y por eso el orden dentro de la iteración no es libre. Una de las seis variables que mide el experimento de la Fase 5 es si el prototipo distingue un rechazo de negocio de un fallo técnico y reintenta solo el segundo. Contra un simulador que solo sabe aprobar, eso no se puede implementar ni medir. La secuencia forzada es **escenarios → prototipos → métricas**.

---

## 7. La decisión abierta: simular o conectarse

Hay una pregunta sin resolver sobre el futuro de este componente, y está registrada como **punto 59** del [architecture-log](../architecture/architecture-log.md), que es donde viven las decisiones abiertas del proyecto. Resumen de las tres opciones:

**A. Seguir replicando el comportamiento medido** (lo que hay hoy). Determinista, sin credenciales, sirve en CI, y es el único lugar donde ciertos flujos se pueden ejercitar. Su límite es que la fidelidad llega hasta donde llegó la medición.

**B. Proxiar directo al sandbox de cada pasarela.** Da comportamiento y firmas reales. El costo es concreto: exige credenciales reales en el despliegue, deja de ser determinista, saca al simulador de CI, y **no** desbloquea los flujos que el sandbox tampoco puede completar, porque el PSE necesita una persona autorizando en el portal del banco.

**C. Híbrido:** el mock por defecto, con un modo de paso directo por pasarela.

Y un dato que conviene tener antes de decidir: **el SDK ya habla con los sandboxes reales sin pasar por el simulador.** El campo `baseUrl` admite un mapa por pasarela desde el punto 57, y las 16 pruebas de contrato lo hacen hoy. Si lo que se busca es que los prototipos corran contra comportamiento real, se apunta `baseUrl` al sandbox y listo.

Eso reformula la pregunta: no es "¿cómo hacemos el simulador más real?" sino **"¿qué gana el simulador siendo proxy que no se consiga apuntando el SDK al sandbox?"**, que es bastante más fácil de responder.

---

## 8. Cómo se levanta

```bash
cd simulator-api && npm install && npm run dev
# Escucha en http://localhost:3000
curl http://localhost:3000/health
```

Las suites de prueba (14 suites con 107 pruebas en total) corren con `npm test` y no necesitan que el servidor esté levantado, porque usan `app.inject()`.

---

## 9. Qué sigue

- El detalle de qué HTTP manda cada adaptador contra estas rutas: [03-sdk/3-las-pasarelas-por-dentro.md](../03-sdk/3-las-pasarelas-por-dentro.md).
- Los datos de prueba que se usan contra este simulador: [testing-data](../testing-data/).
- La especificación oficial de componentes: [layers-and-components.md](layers-and-components.md).
