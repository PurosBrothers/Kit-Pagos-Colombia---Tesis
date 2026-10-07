# 05 · Los ejemplos ejecutables

Doce programas que se corren de verdad, contra la API de Simulación, y que imprimen lo que pasó. No son fragmentos de documentación: son un paquete npm aparte que **importa el SDK por su nombre publicado**, igual que lo haría un comercio.

Esa decisión es lo que les da valor como verificación. Si un tipo no está exportado en `sdk/src/index.ts`, los ejemplos no compilan; si la superficie pública no alcanza para integrar un pago, se nota acá y no en producción.

**Y compilar no es suficiente.** Los puntos 50 y 51 del architecture-log documentan dos creencias falsas sobre el cobro con tarjeta que pasaban el `typecheck` y que solo aparecieron al ejecutar los ejemplos contra los sandboxes reales.

---

## Antes de correr cualquiera

```bash
cd sdk && npm install && npm run build   # los ejemplos consumen dist/
cd simulator-api && npm install && npm run dev
cd examples && npm install
```

La API de Simulación tiene que quedar corriendo en su propia terminal, en `localhost:3000`. Si no está, los ejemplos no se caen con una traza: imprimen el comando que falta.

---

## Los doce, en orden de lectura

### Cobro con tarjeta

| # | Comando | Qué muestra |
|---|---------|-------------|
| 1 | `npm run simulate:wompi` | El recorrido completo, el más comentado. **Creación `PENDING` → consulta `APPROVED`.** |
| 2 | `npm run simulate:mercadopago` | El caso más corto: una llamada y el desenlace viene en el cuerpo. |
| 3 | `npm run simulate:kushki` | El monto como objeto con desglose de IVA, armado por el adaptador. |
| 4 | `npm run simulate:rapyd` | Tarjeta que **redirige**: checkout alojado, y el estado `CLO` al consultar. |

### Cobro con PSE

| # | Comando | Qué muestra |
|---|---------|-------------|
| 5 | `npm run simulate:wompi-pse` | La rama `REDIRECT_REQUIRED` del resultado, con `async_payment_url`. |
| 6 | `npm run simulate:mercadopago-pse` | La Orders API y los datos que PSE exige de más (IP, teléfono, dirección). |
| 7 | `npm run simulate:kushki-pse` | Dos llamadas con cabeceras de autenticación distintas entre sí. |
| 8 | `npm run simulate:rapyd-pse` | Dos llamadas: crear cliente, después el pago. |

### Comparativos

| # | Comando | Qué muestra |
|---|---------|-------------|
| 9 | `npm run simulate:pse-bancos` | Las cuatro listas de bancos, y que **los códigos no son portables**. |
| 10 | `npm run simulate:interchangeability` | El mismo pago por las cuatro pasarelas, verificado por código. |

### Interactivo

| # | Comando | Qué muestra |
|---|---------|-------------|
| 11 | `npm run demo` | Pregunta pasarela, método y datos, e imprime **la petición real que salió y la respuesta real que llegó** en cada paso. |

El 11 es el único que muestra lo que viaja por el cable. Los otros once muestran
*que* el SDK funciona; este muestra *qué está haciendo*, y por eso es el que sirve
para una sustentación. Acepta las respuestas como argumentos —`npm run demo -- wompi
pse`— para recorrer un camino concreto sin tipear.

### Escenarios de rechazo y de error

| # | Comando | Qué muestra |
|---|---------|-------------|
| 12 | `npm run simulate:scenarios` | Rechazos, pendientes, esperas, errores técnicos y credenciales inválidas, con el código del SDK de cada uno, provocados **sin cabeceras de escenario**: con los datos de prueba de cada pasarela, los montos reservados y las marcas en la credencial. |

El 12 no escribe ninguna cabecera ni llama a ninguna ruta por su cuenta: todo pasa por `KitPagos` y, para tokenizar, por `KitPagosBrowser` con el ambiente `simulator`. Imprime una línea por caso con lo esperado, lo obtenido y `OK` o `FAIL`, y **sale con código 1 si algún caso falla**, así que también sirve como prueba de regresión. Usa un `timeoutMs` de 2 s en los casos de espera. Necesita la API de Simulación de la rama del issue #122; la convención que recorre está en la sección 4 de [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md), y el detalle del ejemplo, en la sección 6b de [examples/README.md](../../examples/README.md).

Corrida contra el simulador de la rama del #122, el 7 de octubre de 2026 a las 13:20 (UTC−5). Se muestran los 16 casos de Wompi; la salida completa sigue con los 16 de Mercado Pago, los 15 de Kushki y los 14 de Rapyd:

```
=== Kit Pagos Colombia — escenarios del simulador por el SDK (issue #122) ===

OK   WOMPI       tarjeta 4242, aprobada al consultar                  esperado APPROVED               obtenido APPROVED
OK   WOMPI       tarjeta 4111, pendiente y declinada al consultar     esperado PENDING -> DECLINED    obtenido PENDING -> DECLINED
OK   WOMPI       rechazo por monto                                    esperado DECLINED               obtenido DECLINED
OK   WOMPI       PSE banco 2, declinado sin redirección               esperado DECLINED               obtenido DECLINED
OK   WOMPI       límite de peticiones                                 esperado RATE_LIMIT_EXCEEDED    obtenido RATE_LIMIT_EXCEEDED
OK   WOMPI       error del servidor                                   esperado GATEWAY_SERVER_ERROR   obtenido GATEWAY_SERVER_ERROR
OK   WOMPI       página HTML de un proxy (502)                        esperado GATEWAY_SERVER_ERROR   obtenido GATEWAY_SERVER_ERROR
OK   WOMPI       200 con JSON inválido                                esperado MALFORMED_RESPONSE     obtenido MALFORMED_RESPONSE
OK   WOMPI       socket cortado                                       esperado CONNECTION_FAILED      obtenido CONNECTION_FAILED
OK   WOMPI       sin respuesta dentro de 2000 ms                      esperado GATEWAY_TIMEOUT        obtenido GATEWAY_TIMEOUT
OK   WOMPI       credencial con marca `invalid`                       esperado INVALID_CREDENTIALS    obtenido INVALID_CREDENTIALS
OK   WOMPI       consulta que falla dos veces (2 reintentos)          esperado APPROVED               obtenido APPROVED
OK   WOMPI       consulta que responde 500 siempre (1 reintento)      esperado MAX_RETRIES_EXCEEDED   obtenido MAX_RETRIES_EXCEEDED  (causa GATEWAY_SERVER_ERROR)
OK   WOMPI       consulta sin respuesta en 2000 ms (sin reintentos)   esperado GATEWAY_TIMEOUT        obtenido GATEWAY_TIMEOUT
OK   WOMPI       bancos PSE que fallan dos veces (2 reintentos)       esperado LISTA_DE_BANCOS        obtenido LISTA_DE_BANCOS
OK   WOMPI       bancos PSE con 500 siempre (1 reintento)             esperado MAX_RETRIES_EXCEEDED   obtenido MAX_RETRIES_EXCEEDED  (causa GATEWAY_SERVER_ERROR)
…

61 de 61 casos OK en 12.8 s.
```

---

## Los tres recorridos documentados

De los doce, tres tienen su propio documento porque enseñan más que su propia pasarela:

- **[pago-simulado-wompi.md](pago-simulado-wompi.md)** — El primer ejemplo, línea por línea: qué escribe el comercio, qué hace cada capa, por qué la creación devuelve `PENDING`.
- **[intercambiabilidad.md](intercambiabilidad.md)** — El argumento de la tesis: mismo pago, cuatro pasarelas, cero condicionales por pasarela, y una verificación que sale con código 1 si la propiedad se rompe.
- **[demo-interactiva.md](demo-interactiva.md)** — La normalización vuelta observable: seis vocabularios nativos contra un estado normalizado, y el mismo monto saliendo como `amount_in_cents: 15000000` o `transaction_amount: 150000` según la pasarela.

---

## Lo que la salida real enseña

Vale la pena mirar las cuatro columnas de estado nativo que imprime el ejemplo 10:

```text
Pasarela      Estado normalizado  Estado nativo  Monto          ID en la pasarela
──────────────────────────────────────────────────────────────────────────────────
WOMPI         APPROVED            APPROVED       150000.00 COP  b256c180-68fa-...
RAPYD         APPROVED            CLO            150000.00 COP  payment_542f13...
MERCADOPAGO   APPROVED            approved       150000.00 COP  8808182579
KUSHKI        APPROVED            APPROVAL       150000.00 COP  5f5473fc9cfd48...
```

Cuatro vocabularios para decir lo mismo. Y uno de ellos, `CLO`, **no significa "pagado"**: significa "cerrado", y Rapyd lo usa tanto para el cobro exitoso como para el cerrado sin pagar. Distinguirlos requiere leer `paid: true` aparte del estado.

Los montos, en cambio, coinciden. Mercado Pago y Kushki reportan `150000` como número, sin los ceros de la derecha, y el SDK lo devuelve con los decimales de COP (punto 72 del `architecture-log.md`). El ejemplo igual los compara con `Amount.equals()` y no con `===` sobre la cadena, porque la igualdad de dinero es por valor.

---

## Sobre el número de llamadas

El ejemplo 10 tiene exactamente dos condicionales, y **ninguno discrimina pasarelas**. El segundo —`if (!transaction.isFinal())`— absorbe algo que no es obvio: el número de llamadas HTTP necesarias no es el mismo en las cuatro.

| Pasarela | Llamadas para cobrar con tarjeta |
|----------|----------------------------------|
| Mercado Pago | 1 |
| Kushki | 1 |
| Wompi | 2 (token de aceptación, después el cobro) |
| Rapyd | 2 y una redirección |

El comercio escribe el caso más largo y le sirve para las cuatro. Así es como la diferencia queda **absorbida** en lugar de escondida: el código que funciona con Rapyd funciona con Mercado Pago sin cambios, aunque Mercado Pago no necesite el segundo paso.

El ejemplo 11 imprime ese número medido en cada corrida, así que la tabla de arriba deja de ser una afirmación de la documentación y pasa a ser algo que se comprueba al correrlo. Con PSE llega a tres en Wompi.

---

## Lo que los ejemplos no cubren

- **La validación de webhooks.** Necesita un servidor HTTP que reciba peticiones, y eso no encaja en un script que corre y termina. Está documentada en [03-sdk/4-guia-de-implementacion.md](../03-sdk/4-guia-de-implementacion.md) §7 con los manejadores de Express y Fastify completos.
- **Los escenarios que el simulador no sabe producir.** El ejemplo 12 recorre los rechazos, las esperas y los errores que la convención del issue #122 hace alcanzables desde el SDK. Las combinaciones sin evidencia de cómo las responde la pasarela real —un checkout de Rapyd vencido, un duplicado en el PSE de Mercado Pago o de Kushki, entre otras— siguen respondiendo `501`, y están listadas en la sección 4 de [3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md).
- **Las pasarelas reales.** Para eso están las 18 pruebas de contrato: `cd sdk && npm run test:sandbox`, documentadas en [04-metricas-y-pruebas/3-pruebas-de-contrato.md](../04-metricas-y-pruebas/3-pruebas-de-contrato.md).

---

## Qué sigue

- **[06-landing/1-alcance-y-contenido.md](../06-landing/1-alcance-y-contenido.md)** — La página que va a mostrar todo esto a quien no clone el repositorio.
- **[testing-data/README.md](../testing-data/README.md)** — El tercer componente: los datos de prueba que hacen falta para correr cualquiera de estos ejemplos contra un sandbox real.
