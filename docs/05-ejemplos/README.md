# 05 · Los ejemplos ejecutables

Diez programas que se corren de verdad, contra la API de Simulación, y que imprimen lo que pasó. No son fragmentos de documentación: son un paquete npm aparte que **importa el SDK por su nombre publicado**, igual que lo haría un comercio.

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

## Los diez, en orden de lectura

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

---

## Los dos recorridos documentados

De los diez, dos tienen su propio documento porque enseñan más que su propia pasarela:

- **[pago-simulado-wompi.md](pago-simulado-wompi.md)** — El primer ejemplo, línea por línea: qué escribe el comercio, qué hace cada capa, por qué la creación devuelve `PENDING`.
- **[intercambiabilidad.md](intercambiabilidad.md)** — El argumento de la tesis: mismo pago, cuatro pasarelas, cero condicionales por pasarela, y una verificación que sale con código 1 si la propiedad se rompe.

---

## Lo que la salida real enseña

Vale la pena mirar las cuatro columnas de estado nativo que imprime el ejemplo 10:

```text
Pasarela      Estado normalizado  Estado nativo  Monto          ID en la pasarela
──────────────────────────────────────────────────────────────────────────────────
WOMPI         APPROVED            APPROVED       150000.00 COP  7b3417c7-47d5-...
RAPYD         APPROVED            CLO            150000.00 COP  payment_e50976...
MERCADOPAGO   APPROVED            approved       150000 COP     8388481045
KUSHKI        APPROVED            APPROVAL       150000 COP     bea2f927a07d47...
```

Cuatro vocabularios para decir lo mismo. Y uno de ellos, `CLO`, **no significa "pagado"**: significa "cerrado", y Rapyd lo usa tanto para el cobro exitoso como para el cerrado sin pagar. Distinguirlos requiere leer `paid: true` aparte del estado.

Los montos también difieren: `150000.00` contra `150000`. Es el mismo monto con distinta escala, y por eso el ejemplo los compara con `Amount.equals()` y no con `===` sobre la cadena. Compararlos como texto produciría un fallo que no es un fallo.

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

---

## Lo que los ejemplos no cubren

- **La validación de webhooks.** Necesita un servidor HTTP que reciba peticiones, y eso no encaja en un script que corre y termina. Está documentada en [03-sdk/4-guia-de-implementacion.md](../03-sdk/4-guia-de-implementacion.md) §7 con los manejadores de Express y Fastify completos.
- **Los escenarios de rechazo, timeout y error.** El simulador todavía responde `501` a cualquier valor de `x-simulate-scenario` que no sea `APPROVED`. Es uno de los entregables de la Iteración 3, y es un prerrequisito del experimento de la Fase 5: sin él, la lista de verificación funcional de los prototipos no se puede completar.
- **Las pasarelas reales.** Para eso están las 16 pruebas de contrato: `cd sdk && npm run test:sandbox`, documentadas en [04-metricas-y-pruebas/3-pruebas-de-contrato.md](../04-metricas-y-pruebas/3-pruebas-de-contrato.md).

---

## Qué sigue

- **[06-landing/1-alcance-y-contenido.md](../06-landing/1-alcance-y-contenido.md)** — La página que va a mostrar todo esto a quien no clone el repositorio.
- **[testing-data/README.md](../testing-data/README.md)** — El tercer componente: los datos de prueba que hacen falta para correr cualquiera de estos ejemplos contra un sandbox real.
