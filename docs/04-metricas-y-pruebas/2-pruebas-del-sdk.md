# Las pruebas del SDK

Qué se prueba, con qué, qué corre en CI y qué no. Los números son de la última corrida verificada.

---

## 1. Las tres suites

| Suite | Dónde | Qué corre | Necesita |
|---|---|---|---|
| **Unitarias del SDK** | `sdk/src/**/*.test.ts` | 35 archivos, **586 pruebas** | Nada: ni red, ni credenciales |
| **De la API de Simulación** | `simulator-api/test/*.test.ts` | 9 archivos, **81 pruebas** | Nada: usan `app.inject()` |
| **De contrato** | `sdk/test/sandbox/*.sandbox.test.ts` | 4 archivos, **16 pruebas** | Credenciales reales y red |

Más una cuarta comprobación que no es una suite de pruebas pero cumple la misma función: `cd examples && npm run typecheck` compila los diez ejemplos contra los tipos publicados del SDK.

```bash
cd sdk && npx jest               # 586 pruebas en ~7 s
cd simulator-api && npx jest     # 81 pruebas en ~2 s
cd sdk && npm run test:sandbox   # 16 pruebas contra los sandboxes reales
cd examples && npm run typecheck # los 10 ejemplos contra la superficie pública
```

Las dos primeras tardan menos de diez segundos juntas, y eso no es un detalle estético: **una suite lenta se deja de correr**, y una suite que no se corre no protege nada.

---

## 2. Cobertura

El umbral configurado es **80 %** en ramas, funciones, líneas y sentencias. Lo que hay hoy:

| Dimensión | Actual | Umbral |
|---|---|---|
| Sentencias | 97.08 % | 80 % |
| Ramas | 88.05 % | 80 % |
| Funciones | 97.63 % | 80 % |
| Líneas | 97.62 % | 80 % |

El margen sobre el umbral es amplio, y conviene entender qué significa y qué no. **Cobertura alta no es corrección:** que una línea se ejecute en una prueba no dice que la prueba afirme algo útil sobre ella. Lo que la cobertura sí garantiza es que no haya código que nadie ejecutó nunca, y eso en un SDK de pagos importa: una rama de manejo de error que nunca se ejecutó es una rama que puede estar rota sin que nadie lo sepa hasta que un pago falle en producción.

`src/index.ts` está excluido del cálculo, porque es solo reexportaciones.

---

## 3. Qué se prueba, y cómo

### Los objetos de valor: los casos límite, no el camino feliz

Las pruebas de `Amount` son las más densas del proyecto, y el motivo es que los casos que importan son casos raros: montos con cero final, montos con más de dos decimales, notación exponencial, signo, un `number` colado desde JavaScript sin tipos. **Casi todas las pruebas de esa clase son de rechazo**, porque un objeto de valor que valida en el constructor se prueba comprobando qué no acepta.

### Los adaptadores: HTTP sustituido, y la petición verificada

Cada adaptador se prueba sustituyendo `fetch`, y las pruebas afirman **qué se mandó**: método, ruta, headers y cuerpo. No solo qué se recibió. Es lo que permite comprobar, por ejemplo, que la petición a Mercado Pago lleva `X-Idempotency-Key`, o que el cuerpo de Wompi lleva la firma de integridad.

### Las firmas: con vectores calculados aparte

Esta es la decisión de pruebas más importante del proyecto. La prueba de la firma de Rapyd **calcula el valor esperado de forma independiente**, con código escrito aparte del de producción, siguiendo la documentación de Rapyd.

La razón está escrita en la propia prueba: si alguien "simplifica" la firma a `digest("base64")`, o deja de pasar el método HTTP en minúsculas, esa prueba falla. **Sin un vector independiente, una prueba de firma solo verificaría que el código coincide consigo mismo**, y pasaría igual de verde con la firma mal implementada.

### Los reintentos: con el reloj sustituido

El `RetryHandler` recibe su función de espera por constructor, así que las pruebas verifican la política completa —cuántos intentos, cuánto se espera, qué errores reintenta y cuáles no— **sin esperar de verdad**. Una suite que comprobara tres reintentos con esperas reales tardaría siete segundos por prueba.

### Los webhooks: firma, ventana y cuerpo

Por cada pasarela: una firma válida verifica, una firma alterada no, un timestamp fuera de ventana se rechaza, y un cuerpo malformado produce `MALFORMED_RESPONSE` en lugar de una excepción sin traducir.

### Las rutas del simulador: con `app.inject()`

Las 81 pruebas del simulador llaman a la aplicación real de Fastify sin abrir un socket. Eso las hace rápidas, pero el beneficio principal es otro: **no pueden quedarse colgadas esperando la red ni fallar porque el puerto esté ocupado.** Y prueban la misma instancia que corre en producción, no una versión especial para pruebas.

---

## 4. Qué corre en CI, y qué no

El CI ([.github/workflows/ci.yml](../../.github/workflows/ci.yml)) tiene dos trabajos sobre Node 20:

| Trabajo | Pasos |
|---|---|
| **sdk** | `npm ci` → `lint` → `test -- --coverage` → `build` → `npm pack --dry-run` |
| **simulator-api** | `npm ci` → `lint` → `test -- --coverage` |

`npm pack --dry-run` está ahí por una razón puntual: verifica que lo que se publicaría a npm contenga lo que debe. Un `dist/` mal configurado produce un paquete que se instala y no importa nada, y eso no lo detecta ninguna prueba.

**Cuatro cosas quedan fuera de CI**, y hay que correrlas a mano:

| Fuera de CI | Por qué | Consecuencia |
|---|---|---|
| `npm run metrics` | — | Un PR puede estar verde y violar un umbral CK |
| `npm run check:readme` | — | Un PR puede estar verde con el README roto |
| `npm run test:sandbox` | Necesita credenciales y red | Los defectos que solo aparecen contra las APIs reales no se detectan en el PR |
| Todo lo de `examples/` | Necesita el simulador levantado | Un cambio en la superficie pública puede romper los ejemplos sin que CI se queje |

Vale la pena tenerlo presente: **el verde de GitHub no es la verificación completa.** El bloque completo está en [00-entorno-de-desarrollo.md](../00-entorno-de-desarrollo.md) §5.

---

## 5. `check:readme`: por qué existe

`npm run check:readme` extrae los bloques de TypeScript del README del paquete y los compila contra `dist/`.

Existe porque **el README que se publicó a npm tenía diez fragmentos que no compilaban.** No era un error de tipeo: eran ejemplos escritos contra una versión anterior de la API, que seguían ahí después de que la API cambiara. Un desarrollador que copiara cualquiera de ellos se encontraba con un error de compilación en su primer minuto con el paquete.

La guarda es barata y el daño que evita es grande, porque el README es literalmente lo primero que alguien lee del proyecto.

**Requiere haber corrido `npm run build` antes**, porque compila contra `dist/`. Y tiene una implicación para esta documentación: los fragmentos de `docs/` **no** están protegidos por esta guarda. Cuando un documento de acá y el README no coincidan, el que hay que creer es el README.

Es también el antecedente directo de la regla que la landing page va a tener desde el primer día: [06-landing/1-alcance-y-contenido.md](../06-landing/1-alcance-y-contenido.md).

---

## 6. Lo que las pruebas unitarias no pueden encontrar

Las 586 pruebas pasan, y aun así el proyecto encontró varios defectos graves ejecutando código contra otra cosa. Vale la pena saber cuáles, porque explica por qué las otras suites existen:

| Defecto | Cómo se encontró |
|---|---|
| Wompi rechazaba los cobros por falta de firma de integridad | Contra el sandbox real (punto 44) |
| Mercado Pago rechazaba los cobros por falta de `X-Idempotency-Key` | Contra la API real (punto 48) |
| Los estados intermedios de transferencia de Kushki se reportaban como error | Contra la API real (punto 48) |
| El PSE de Wompi no se puede ejercitar contra su sandbox | Contra el sandbox real (punto 43) |
| Dos ramas que pasaban sus pruebas por separado rompieron el ejemplo de intercambiabilidad al fusionarse | Corriendo el ejemplo contra el simulador (punto 52) |

El patrón es claro: **las pruebas unitarias verifican que el código hace lo que el autor creyó que la pasarela esperaba.** Cuando esa creencia es la que está mal, ninguna prueba unitaria lo puede detectar, porque el mock también está construido sobre la misma creencia.

El último caso, el punto 52, es el que más vale para el trabajo diario: eran dos ramas correctas por separado que al fusionarse rompieron el comportamiento, y el `typecheck` no lo vio porque el error no era de tipos. Por eso el flujo de trabajo pide correr el ejemplo correspondiente cuando se toca un adaptador.

---

## 7. Qué sigue

- Las pruebas contra los sandboxes reales: [3-pruebas-de-contrato.md](3-pruebas-de-contrato.md).
- Las métricas: [1-metricas-ck.md](1-metricas-ck.md).
