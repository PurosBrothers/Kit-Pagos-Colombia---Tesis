# Áreas de enfoque del equipo (nota interna)

> Este documento es una guía informal de trabajo en equipo. No es un artefacto formal del proyecto, no está referenciado desde el SAD, el SPMP ni `methodology.md`, y no debe citarse en el documento de tesis. Su único propósito es ayudarnos internamente a decidir rápido quién toma una tarea nueva o ambigua, sin tener que discutirlo cada vez.

## Por qué existe esto

A medida que se acumulan issues nuevos (correcciones de documentación, pruebas, tooling, CI), varias tareas no encajan claramente en la asignación por sección del SAD que ya usamos para la Iteración 0. Este documento fija, para cada persona, un área de enfoque por defecto dentro del código y el proceso, construida a partir de los issues que cada quien ya tiene asignados en la Iteración 1.

Esto no reemplaza la asignación caso por caso: sigue siendo válido que alguien tome un issue fuera de su área si tiene sentido (por ejemplo, por carga de trabajo o porque ya conoce ese código). Es un valor por defecto, no una regla rígida.

## Las cuatro áreas

### Joan — Testing

Responsable por defecto de que el núcleo del SDK tenga cobertura de pruebas real, no solo que exista. Esto incluye escribir las pruebas unitarias de las clases del dominio (`Transaction`, objetos de valor monetarios, `SdkError`) y, hacia la Iteración 2 y 3, extender ese mismo criterio a los adaptadores de pasarela y a los endpoints de `simulator-api`. Si en el futuro aparece una decisión sobre qué framework de pruebas usar, o sobre cómo estructurar una suite de pruebas nueva, el punto de partida es Joan.

Issues actuales que sustentan esta área: `#12` (pruebas de `Transaction` y VOs monetarios), `#16` (pruebas de `SdkError`).

### Joshua — Núcleo del SDK

Responsable por defecto de la forma pública y el esqueleto del SDK: el Facade (`KitPagos`), los servicios de dominio (`WebhookVerifier`), el esqueleto de los servicios de aplicación e infraestructura que la Iteración 2 necesita para paralelizarse (`SDKConfigurator`, `GatewayFactory`, `ResponseNormalizer`, `RetryHandler`, `ErrorHandler`), y la superficie pública que se exporta desde `sdk/src/index.ts`. En la práctica, es quien más decide cómo se ve una clase antes de que exista lógica real detrás de ella.

Issues actuales que sustentan esta área: `#9` (scaffolding de la capa de aplicación), `#11` (implementación de `WebhookVerifier`), `#20` (exports de `index.ts`).

### Henao — Modelado de dominio y arquitectura

Responsable por defecto de que el modelo de dominio (entidades, objetos de valor, relaciones entre ellos) sea correcto y esté documentado de forma consistente entre el SAD, los diagramas y el código, y de las revisiones técnicas grupales que cierran una iteración. Es la continuación natural de su rol como dueño de las secciones de Modelo de Dominio, Stakeholders y Modelo de Datos en el SAD.

Issues actuales que sustentan esta área: `#8` (limpieza de diagramas y README raíz), `#13` (pruebas de VOs de identificación y configuración), `#18` (revisión técnica grupal de cierre de Iteración 1).

### David — Riesgos, métricas y operación

Responsable por defecto de todo lo que tiene que ver con verificar que el proyecto cumple sus propios criterios de calidad (métricas CK, umbrales del Definition of Done) y con la parte operativa que no es código de negocio (datos de prueba de las pasarelas, configuración de entornos). Es la continuación natural de su rol como dueño de Restricciones, Riesgo Técnico y Estructura del Sistema en el SAD.

Issues actuales que sustentan esta área: `#14` (credenciales sandbox y datos de prueba), `#17` (pruebas de `WebhookVerifier`), `#19` (script de métricas CK con `ts-morph`).

## Qué hacer si un issue nuevo no calza claramente en ninguna área

Discutirlo en la reunión semanal antes de asignarlo. Si de verdad no calza en ninguna de las cuatro, es una señal de que puede faltar una quinta categoría, no que haya que forzarlo en una de estas cuatro.
