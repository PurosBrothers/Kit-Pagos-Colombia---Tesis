# Manual de Kit Pagos Colombia

Documentación oficial del producto: la que le sirve a quien va a integrar pagos y cobrar, no la que le sirve al jurado. Si usted llegó acá porque quiere instalar el paquete, montar el simulador o llamar la API por HTTP, está en el lugar correcto.

> **¿Buscaba la documentación de la tesis?** El documento de arquitectura (SAD), la metodología, el plan de evaluación y el registro de decisiones están en [`docs/README.md`](../README.md). Este directorio y ese son dos cosas distintas y a propósito; la frontera está escrita en [`estructura.md`](estructura.md).

---

## 1. Qué es Kit Pagos

Cuatro pasarelas de pago colombianas —**Wompi**, **Mercado Pago**, **Kushki** y **Rapyd**— detrás de una sola interfaz en TypeScript. Cambiar de pasarela es cambiar una configuración y sus credenciales; el código que cobra, que consulta y que verifica el webhook no se toca.

Lo que **no** hace está en [la sección 4](#4-los-límites-del-producto), y no es una nota al pie: un kit de pagos que promete más de lo que cumple falla cuando el comercio ya no tiene margen para corregirlo.

---

## 2. Las cuatro formas de consumirlo

| Forma | Qué es | Cuándo usarla | Referencia |
|---|---|---|---|
| **SDK** | El paquete [`kit-pagos-colombia`](https://www.npmjs.com/package/kit-pagos-colombia) en Node.js | Va a integrar en su backend y quiere los tipos y el manejo de errores del SDK | [`sdk/README.md`](../../sdk/README.md) |
| **Módulo de navegador** | `kit-pagos-colombia/browser`, el mismo paquete con otro punto de entrada | Necesita tokenizar la tarjeta sin que el número toque su servidor | [`sdk/README.md`](../../sdk/README.md), §2.1 |
| **API REST** | `/v1/api` sobre HTTP | Quiere cobrar sin instalar nada, desde otro lenguaje o desde un servicio externo | [`referencia/api-rest.md`](referencia/api-rest.md) |
| **API de Simulación** | `/v1/sim`, cuatro pasarelas simuladas | Necesita probar rechazos, pendientes y PSE de punta a punta, sin sandbox ni internet | [`referencia/api-simulacion.md`](referencia/api-simulacion.md) |

Y una quinta pieza que no es código: los **datos de prueba**, que son lo que vuelve ejecutables a las otras cuatro. Sin saber qué tarjeta aprueba en Wompi o qué `bankId` acepta Kushki, no hay nada que probar: [`docs/testing-data/`](../testing-data/).

---

## 3. Cómo está organizado este manual

Sigue **Diátaxis**, que separa la documentación según lo que el lector está tratando de hacer. Las cuatro categorías no son compartimentos decorativos: cada una responde una pregunta distinta, y mezclarlas es lo que produce documentos que no sirven ni para aprender ni para consultar.

| Categoría | La pregunta que responde | Qué va adentro |
|---|---|---|
| **Tutoriales** | «Enséñeme, no sé nada» | Un camino guiado de principio a fin: instalar, cobrar con tarjeta en el simulador, ver el resultado. Se puede seguir sin entender por qué funciona |
| **Guías** | «Necesito resolver esto» | Recetas para una tarea concreta, asumiendo que ya sabe lo básico: verificar un webhook, migrar de una pasarela a otra, ir a producción |
| **Referencia** | «¿Qué parámetros acepta?» | La consulta exacta y sin prosa: las cuatro operaciones, los trece códigos de error, las rutas de `/v1/api`, las de `/v1/sim` |
| **Explicación** | «¿Por qué funciona así?» | El criterio detrás de las decisiones: por qué el SDK no reintenta un cobro, por qué la redirección no se puede esquivar |

El estándar se eligió, se comparó contra las alternativas y se justificó en [`estructura.md`](estructura.md), que es también el documento para quien va a escribir acá.

---

## 4. Los límites del producto

Esto es lo que Kit Pagos **no** resuelve. Verificado contra el código, no copiado de otro documento.

- **Los tokens de tarjeta no son portables.** Cada pasarela los emite y solo valen en ella, así que cambiar de pasarela cambia también la tokenización del navegador.
- **Los códigos de banco de PSE sí son portables, salvo en los sandboxes.** El SDK expone el código de compensación de ACH Colombia como `PseBankCode`, y lo traduce para Rapyd. La excepción son los bancos ficticios de los sandboxes de Wompi y Kushki, que solo existen con el código que devuelve `getPseBanks()`.
- **La redirección no desaparece.** Con PSE redirigen las cuatro; con tarjeta, Rapyd cobra en su página alojada y Wompi y Kushki pueden pedir 3DS. El resultado de `createPayment()` obliga a tratar las dos ramas, y olvidar una no compila.
- **Solo tarjeta y PSE.** No hay efectivo, ni Nequi, ni Daviplata, ni suscripciones, ni reembolsos. Es alcance declarado, no olvido.
- **El SDK no protege la página de pago ni decide el monto.** El número de la tarjeta no llega a su servidor, pero la página donde se escribe sí queda en su alcance: la defiende una cabecera `Content-Security-Policy` que manda su servidor. Y el monto lo calcula su servidor con su catálogo, nunca el navegador.
- **Cada pasarela pide datos propios y el SDK no los inventa.** Mercado Pago exige IP del pagador, teléfono con indicativo y dirección para PSE; Wompi no. Si falta un dato, el SDK falla antes de salir a la red, con `INVALID_REQUEST` y la lista de lo que falta.
- **La cabecera de escenario del simulador no llega por el SDK.** `x-simulate-scenario` y `x-simulator-scenario` las lee `/v1/sim` cuando se lo llama directamente; el SDK no las envía, así que un comercio que integra con el SDK elige el desenlace con los datos de prueba, el monto y la credencial.
- **No hay cifras de comparación afirmadas.** El proyecto sostiene que integrar con el SDK cuesta menos trabajo, y la medición formal es el experimento de la Fase 5. Hasta que corra, lo que existe son argumentos, y así se dice.

---

## 5. Estado del manual

Este directorio se escribe por partes. Lo que sigue es el mapa de lo que tiene que existir, no una promesa de que ya existe.

| Tema | Cubre | Estado |
|---|---|---|
| **El SDK** | Instalación, configuración, las cuatro operaciones públicas, los trece códigos de error, la tokenización en el navegador | Pendiente. Hoy la referencia de facto es [`sdk/README.md`](../../sdk/README.md) |
| **La API REST** | Cómo cobrar por HTTP sin instalar la librería, autenticación por cabeceras, mapeo de errores a códigos HTTP | **Escrito:** [`referencia/api-rest.md`](referencia/api-rest.md) |
| **La API de Simulación** | Cómo levantarla, qué simula cada ruta, cómo se elige el escenario, hasta dónde llega su fidelidad | **Escrito:** [`referencia/api-simulacion.md`](referencia/api-simulacion.md) |
| **Los datos de prueba** | Qué tarjeta, qué banco y qué documento usar en cada pasarela, y qué nivel de evidencia tiene cada dato | Pendiente como documento de producto. La fuente ya existe: [`testing-data/README.md`](../testing-data/README.md) |

Mientras un tema diga «pendiente», el enlace de la derecha es la mejor fuente disponible, aunque esté escrita con voz de tesis.

---

## 6. Cómo se comprueba lo que aquí se afirma

- **Todo fragmento de código compila.** El repositorio tiene `npm run check:readme` en `sdk/`, que compila los bloques TypeScript del README contra el paquete construido en cada pull request. Existe porque diez fragmentos rotos llegaron a estar publicados a la vez. Los ejemplos de este manual entran en esa misma guarda; cuando alguno no pueda compilar, el documento dice por qué.
- **Toda afirmación sobre el código se verificó abriéndolo o ejecutándolo.** No se copia de otro documento, ni de la documentación oficial de la pasarela, ni de un issue. Cuando la única fuente es la documentación oficial del proveedor, el documento lo dice.
- **Toda medición lleva fecha.** Y cuando hay un punto del [`architecture-log`](../architecture/architecture-log.md) detrás, se cita: es donde está el detalle de qué se midió, contra qué y qué resultó falso.

---

## 7. Qué no va a encontrar acá

El modelo de dominio y las decisiones de arquitectura, la metodología de investigación, la matriz de trazabilidad, el plan de evaluación de prototipos y los documentos de entrega en LaTeX. Eso es la tesis, vive en [`docs/`](../README.md) y tiene su propia audiencia. Este manual la enlaza cuando hace falta profundizar, pero no la repite: dos copias de lo mismo se desincronizan, y la que se queda vieja es siempre la que nadie revisa.
