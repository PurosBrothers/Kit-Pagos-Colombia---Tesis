# Propuesta de actualización del SAD: API REST y patrones de integración

**Issue:** [#108](https://github.com/PurosBrothers/Kit-Pagos-Colombia---Tesis/issues/108)  
**Alcance:** texto para trasladar al Software Architecture Document (SAD) original, que se mantiene fuera del repositorio.  
**Fuente de implementación:** `simulator-api/src/app.ts`, `simulator-api/src/kit-pagos-api/` y `sdk/src/infrastructure/config/`.

Este documento prepara las correcciones para aplicar manualmente al SAD. No reemplaza el SAD ni afirma cifras de comparación del experimento de la Fase 5.

## 1. Vista de contenedores: actualizar las secciones 8.1 y 8.2

### Texto propuesto

> La API de Simulación es un único servicio Fastify que expone dos superficies HTTP bajo el mismo proceso, puerto y despliegue. `/v1/sim` imita las APIs nativas de Wompi, Rapyd, Mercado Pago y Kushki para pruebas; `/v1/api` expone las operaciones de Kit Pagos a través del SDK. La API REST no reemplaza las rutas de simulación: ambas superficies coexisten y tienen prefijos y módulos separados.
>
> En una integración de frontend, el navegador envía solicitudes a `/v1/api`; el módulo REST construye la solicitud del dominio e invoca `KitPagos`. Si el SDK está configurado para el simulador local, sus adaptadores realizan una solicitud HTTP a `http://localhost:3000/v1/sim/<pasarela>`. La petición puede así salir de la superficie `/v1/api` y volver al mismo servicio por `/v1/sim`.
>
> Este retorno no constituye un ciclo de dependencias entre paquetes. El SDK no depende de `simulator-api`; se comunica con el destino de cada pasarela mediante HTTP. El recorrido permite probar el flujo completo por HTTP sin instalar el SDK en el frontend ni disponer de credenciales reales de pasarela.

### Cambios a aplicar al diagrama de contenedores

- Mantener una sola instancia/contenedor de API de Simulación.
- Mostrar dentro del contenedor las dos superficies, `/v1/sim` y `/v1/api`, y su responsabilidad distinta.
- Mostrar la llamada local de `/v1/api` al SDK y la llamada HTTP de los adaptadores del SDK a `/v1/sim`, que puede volver a la misma instancia.
- No dibujar `kit-pagos-api` como servicio o despliegue independiente.
- Actualizar las descripciones de documentación: OpenAPI se sirve desde la API en `/docs`, no como archivos estáticos de la documentación del repositorio.

## 2. Vista de componentes: actualizar la sección 9

### Componente que se debe agregar

**Nombre:** Kit Pagos REST API  
**Implementación:** plugin Fastify `simulator-api/src/kit-pagos-api/index.ts`, registrado con el prefijo `/v1/api` desde `simulator-api/src/app.ts`.

> **Responsabilidad.** Adapta solicitudes HTTP a operaciones del SDK Kit Pagos. Registra las rutas de pasarelas disponibles, pagos, bancos PSE y validación de webhooks. Los handlers transforman y validan los DTO HTTP y delegan la operación a la fachada `KitPagos`; no reemplazan las reglas de negocio ni las implementaciones de los adaptadores del SDK.
>
> **Frontera.** Este componente está separado de `simulator-api/src/routes/`, cuyos plugins conservan las rutas que imitan las APIs de pasarela bajo `/v1/sim/<pasarela>`. Ambos módulos se registran en la misma aplicación Fastify. CORS se registra dentro del plugin REST para limitar sus cabeceras a `/v1/api`.
>
> **Credenciales y acceso.** Las credenciales del perfil del servidor pueden usarse como configuración predeterminada; las cabeceras `x-gateway-*` permiten proporcionar credenciales del cliente conforme al entorno de destino. `webhookSecret` nunca se acepta desde una petición del cliente. Cuando `API_AUTH_TOKEN` (o su alias `SIMULATOR_API_AUTH_TOKEN`) está configurado, las rutas protegidas exigen el token Bearer; sin esas variables, la API opera en modo abierto para desarrollo local.

### Componentes OpenAPI

Describir la documentación como una capacidad implementada, no como un componente pendiente:

> `registerOpenApi` (`simulator-api/src/kit-pagos-api/openapi/register.ts`) registra `@fastify/swagger` con OpenAPI 3.0.3 y `@fastify/swagger-ui`. La interfaz interactiva se sirve en `/docs`; el documento también está disponible en `/docs/json` y `/docs/yaml`. Los schemas de las rutas REST de Kit Pagos están definidos en `kit-pagos-api/openapi/schemas.ts` y se utilizan para validar las solicitudes y generar la especificación. La cobertura OpenAPI detallada de las rutas de simulación bajo `/v1/sim` sigue pendiente en los issues #106 y #107: el plugin y la interfaz ya existen, pero RF-13 no debe declararse completamente implementado hasta cerrar esa cobertura.

El componente se llama `registerOpenApi` en el código. No inventar una clase `OpenAPIProvider` ni afirmar que todas las rutas de simulación tienen schemas de validación si no se ha verificado esa ruta en el código.

## 3. Patrones de integración

Añadir una subsección de patrones en la vista donde el SAD describa los flujos de integración:

| Patrón | Flujo | Estado |
|---|---|---|
| P1 — Backend hacia SDK | Backend del comercio → SDK Kit Pagos → pasarela | Implementado antes de la API REST; no cambia. |
| P2 — Frontend hacia REST hacia SDK | Frontend → `/v1/api` → SDK Kit Pagos → pasarela | Implementado. En el entorno de simulación, el SDK puede llamar por HTTP a `/v1/sim/<pasarela>` en el mismo servicio. |
| P3 — Frontend hacia SDK unificado de pasarelas | Frontend → SDK unificado de pasarelas → pasarela | El flujo integral no está implementado. `KitPagosBrowser` ofrece tokenización para Wompi, Mercado Pago y Kushki, pero el cobro sigue requiriendo la integración del backend; Rapyd utiliza checkout alojado. El issue #110 investigó su viabilidad. |

No representar P3 como una integración disponible ni como parte de las pruebas actuales.

## 4. DA-02 y RF-13

Actualizar la justificación de DA-02 para mantener la decisión de Fastify y reflejar qué ocurrió con el beneficio esperado:

> Fastify se eligió, entre otras razones, por la generación de OpenAPI mediante `@fastify/swagger` y por su sistema de plugins. Ese beneficio no se materializó mientras las rutas no declaraban `schema`: aunque el plugin estuviera disponible, no había metadatos suficientes para generar los contratos de las operaciones. La implementación de schemas Fastify en las rutas de Kit Pagos y el registro de Swagger materializan ahora ese beneficio para `/v1/api`.

Actualizar RF-13 y la sección 3.6 para indicar que la infraestructura OpenAPI 3.0.3 y las rutas documentadas de `/v1/api` están implementadas y disponibles en `/docs`, `/docs/json` y `/docs/yaml`. Aclarar que las rutas de simulación bajo `/v1/sim` aún no tienen cobertura completa de schemas (#106 y #107), por lo que el requisito RF-13 es parcial hasta que se cierren esos issues. La generación depende de los schemas y metadatos que declaren las rutas; no implica que el plugin complete automáticamente la documentación de comportamientos no descritos por esos schemas.

## 5. Diagramas del SAD

Actualizar las figuras de contexto, contenedores y componentes para mostrar las dos superficies, la frontera entre `kit-pagos-api/` y `routes/`, la llamada local a `KitPagos` y el retorno HTTP del SDK hacia `/v1/sim`. Marcar P3 como futuro y no implementado.

Las fuentes PlantUML correspondientes del repositorio están en `docs/architecture/Simulador API/diagrams-source/`. Las imágenes PNG y las figuras del SAD original requieren regeneración y reemplazo; mientras no se haga, deben tratarse como pendientes y no como representaciones actualizadas.

## 6. Límites de las afirmaciones

- No agregar resultados de eficacia, costo, tiempos ni cifras de comparación entre los patrones. Los valores formales los producirá el experimento de la Fase 5 y todavía no existen.
- No presentar la API REST como un nuevo servicio desplegable ni al SDK como dependencia de paquete del simulador.
- Mantener la distinción: `/v1/api` expone Kit Pagos; `/v1/sim` imita las APIs de las pasarelas.
