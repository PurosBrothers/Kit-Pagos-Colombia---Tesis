# La documentación de datos de prueba: el tercer componente del Kit Pagos

Los cuatro archivos de este directorio no son un apéndice del SDK. Son **uno de los tres componentes del artefacto**, y el que más tiempo ahorra a quien integra por primera vez.

| Componente | Qué entrega |
|---|---|
| El SDK (`sdk/`) | Una API unificada para cobrar por cuatro pasarelas |
| La API de Simulación (`simulator-api/`) | Un entorno determinista para probar lo que los sandboxes no permiten |
| **Esta documentación (`docs/testing-data/`)** | **Los datos concretos para reproducir cualquier flujo, en cualquiera de las cuatro** |

---

## 1. Por qué es un componente y no un anexo

El problema que resuelve es el que nadie anuncia y todos sufren: **para probar una integración de pagos hacen falta datos que la documentación oficial esconde, reparte entre páginas o simplemente no publica.**

Un ejemplo concreto de cada pasarela:

- **Kushki** llama a PSE "Transfer In", y encontrar eso requiere saber que no se llama PSE.
- **Rapyd** no tiene un método de pago PSE: tiene **47**, uno por banco, con nombres como `co_pse_bancolombia_bank`. Averiguarlo requiere pedir el catálogo de métodos del país y leerlo.
- **Mercado Pago** cobra PSE por la Orders API, que es distinta de la API de pagos con la que se cobra la tarjeta.
- **Wompi** exige un token de aceptación que se pide a un endpoint aparte antes de poder crear cualquier transacción.

Ninguno de esos cuatro hechos está en la primera página de la documentación de su pasarela. Los cuatro están acá, con el payload que los acompaña.

**Y hay algo que esta documentación tiene y la oficial no:** los defectos medidos. Cuando Wompi responde `422 "Firma de integridad requerida no enviada"`, la documentación oficial no dice que la firma sea obligatoria. Acá sí, con la fecha en que se comprobó.

---

## 2. Los cuatro archivos

| Archivo | Métodos documentados | Extensión |
|---|---|---|
| [wompi.md](wompi.md) | Tarjeta, Nequi, PSE, botón Bancolombia, Bancolombia QR, Puntos Colombia, BNPL, Daviplata, Su+ Pay | 288 líneas |
| [mercado-pago.md](mercado-pago.md) | Tarjeta, PSE, verificación de estado, reembolsos | 243 líneas |
| [kushki.md](kushki.md) | Tarjeta, antifraude, 3DS, OTP, Transfer In (PSE), efectivo, suscripciones, dispersión, plugins | 439 líneas |
| [rapyd.md](rapyd.md) | Tarjeta (éxito y error), 3DS por API, 3DS por página alojada, PSE | 405 líneas |

Cada uno abre con las **credenciales del sandbox** y sigue por método de pago. Los cuatro tienen una sección `1.1` con el título "El cobro medido contra la API real", fechada, que es donde vive la evidencia de primera mano.

---

## 3. El nivel de evidencia, que es lo más importante al leerlos

No todo lo que está acá tiene el mismo respaldo, y los archivos lo distinguen explícitamente. Al leerlos conviene saber en qué categoría cae cada afirmación:

### Nivel 1 — Medido contra la API real, con fecha

Lo más fuerte. Hay una petición HTTP real y su respuesta. Las secciones `1.1` de los cuatro archivos son de este nivel, fechadas el 18 y 19 de septiembre de 2026, y también lo es el flujo completo de Transfer In de Kushki (§5.2.1).

Esto es lo que las [pruebas de contrato](../04-metricas-y-pruebas/3-pruebas-de-contrato.md) mantienen vigente: 16 pruebas que corren contra los sandboxes reales y fallan si alguna pasarela cambia lo que estos archivos afirman.

### Nivel 2 — Medido, pero solo hasta cierto punto del flujo

Lo típico en PSE. El flujo está comprobado **hasta la redirección**, y de ahí en adelante no, porque avanzar requiere que una persona entre al portal de un banco y autorice una transferencia.

Los archivos lo dicen sin adornos. Rapyd §5.7: *"lo que el SDK afirma hoy de PSE en Rapyd está medido hasta la redirección, no más allá"*. Kushki §5.2.1: *"Lo que sigue sin medir: el desenlace"*.

### Nivel 3 — Tomado de la documentación oficial, sin comprobar

Los métodos que el proyecto no integra caen acá: Nequi, Daviplata, efectivo, suscripciones, dispersión. Están documentados porque el catálogo completo sirve para entender el ecosistema, pero **nadie los ejecutó**.

Wompi §3 marca uno de estos huecos en una tabla: el banco de prueba `"3"` simula un error, pero *"sin confirmar cuál es el estado resultante"*.

**La regla de lectura:** si una afirmación no tiene fecha, asumila de nivel 3. Y si vas a construir sobre ella, medila primero — el punto 50 del architecture-log existe justamente porque dos creencias de nivel 3 sobre el cobro con tarjeta resultaron falsas.

---

## 4. Los huecos conocidos, por pasarela

Estos son los límites reales de lo que el proyecto puede afirmar hoy.

| Pasarela | Hueco | Por qué |
|---|---|---|
| **Wompi** | El desenlace de PSE no se puede observar | El sandbox publica la URL de redirección en el mismo instante en que resuelve el pago: cuando la URL existe, ya no sirve (punto 43) |
| **Wompi** | El banco de prueba `"3"` (error) | No se confirmó qué estado produce |
| **Mercado Pago** | La Orders API de PSE | Responde `401` con credenciales de prueba y exige un token de producción (punto 45) |
| **Kushki** | El desenlace de Transfer In | Exige que una persona autorice en el portal del banco |
| **Rapyd** | Estados finales de PSE | No se sabe si el sandbox permite forzarlos como sí lo permite con 3DS |
| **Rapyd** | Qué métodos PSE tiene activa una cuenta real | El sandbox devuelve los 47 de la plataforma; producción devuelve solo los habilitados |
| **Las cuatro** | Escenarios de rechazo y timeout | El simulador todavía responde `501` a cualquier `x-simulate-scenario` distinto de `APPROVED` |

Los tres primeros huecos son la razón de que la API de Simulación exista: es el único lugar donde esos flujos se pueden ejercitar de punta a punta. Está explicado en [02-arquitectura/3-api-de-simulacion.md](../02-arquitectura/3-api-de-simulacion.md) §1.

El último es un entregable de la Iteración 3, y **bloquea el experimento de la Fase 5**: sin escenarios de rechazo no se puede completar la lista de verificación funcional de los prototipos.

---

## 5. Por qué estos archivos no se mueven de acá

El resto de `docs/` se reorganizó en secciones numeradas para armar un camino de lectura. Este directorio no, y es a propósito: **hay comentarios de código y documentos que lo citan por su ruta completa.** Moverlo rompería esas referencias sin que nada lo detecte, porque un enlace roto en un comentario no falla ninguna prueba.

Lo mismo aplica a [`architecture-log.md`](../architecture/architecture-log.md), que es citado por ocho archivos.

---

## 6. Cómo usarlos

**Si vas a correr las pruebas de contrato**, las credenciales de los cuatro archivos son las que van en el `.env` del SDK. El mapeo variable por variable está en [03-sdk/4-guia-de-implementacion.md](../03-sdk/4-guia-de-implementacion.md) §2.

**Si vas a probar un flujo específico**, buscá la sección del método en el archivo de la pasarela. Cada una trae el payload completo, no un fragmento.

**Si algo no funciona como dice acá**, revisá la fecha de la afirmación. Los sandboxes cambian, y una medición de septiembre de 2026 puede no valer hoy. Las 16 pruebas de contrato existen para detectar exactamente eso:

```bash
cd sdk && npm run test:sandbox
```

---

## 7. Qué sigue

- **[01-producto/3-las-cuatro-pasarelas.md](../01-producto/3-las-cuatro-pasarelas.md)** — La comparación conceptual de las cuatro, que es la lectura previa a estos archivos.
- **[04-metricas-y-pruebas/3-pruebas-de-contrato.md](../04-metricas-y-pruebas/3-pruebas-de-contrato.md)** — Cómo se mantiene vigente lo que acá se afirma.
- **[05-ejemplos/README.md](../05-ejemplos/README.md)** — Los diez ejemplos que consumen estos datos.
