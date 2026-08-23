# Estándares de Commits — Kit Pagos Colombia

Este proyecto sigue el estilo de [Conventional Commits](https://www.conventionalcommits.org/). Todo mensaje de commit debe tener un formato estructurado para que el historial se mantenga legible, fácil de buscar y útil para generar changelogs.

> **Importante:** el mensaje del commit siempre debe escribirse en **inglés**, sin importar el idioma de este documento o del resto de la documentación del proyecto. Esta guía está en español para que sea más fácil de entender, pero las reglas que describe aplican igual.

## Formato

```
<type>(<scope>): <short summary>

<optional body>

<optional footer>
```

- **type**: qué tipo de cambio es (ver la lista de abajo).
- **scope**: qué parte del repositorio afecta el cambio, entre paréntesis (ver la lista de abajo).
- **short summary**: descripción breve en modo imperativo (en inglés, por ejemplo "add", no "added" ni "adds"), en minúsculas, sin punto final, idealmente en menos de 72 caracteres.
- **body** (opcional): explica *por qué* se hizo el cambio y el contexto relevante. Se recomienda ajustar las líneas a unos 100 caracteres. Debe haber una línea en blanco entre el resumen y el cuerpo.
- **footer** (opcional): referencias a issues, cambios que rompen compatibilidad (`BREAKING CHANGE: ...`), o decisiones relacionadas (por ejemplo, un identificador de ADR o ASR del SAD).

## Tipos (`type`)

| Tipo | Úsalo para |
|---|---|
| `feat` | Una funcionalidad o capacidad nueva |
| `fix` | Una corrección de un error |
| `refactor` | Un cambio de código que no corrige un error ni agrega una funcionalidad (por ejemplo, reestructurar para alinearse con el SAD) |
| `docs` | Cambios que son solo de documentación (`README`, `docs/`, comentarios de código como cambio principal) |
| `test` | Agregar o corregir pruebas |
| `style` | Formato, espacios, nombres que no cambian el comportamiento |
| `perf` | Un cambio que mejora el rendimiento |
| `build` | Cambios en herramientas de build, dependencias o configuración de paquetes |
| `ci` | Cambios en pipelines de CI/CD o automatización |
| `chore` | Trabajo de mantenimiento que no encaja en ningún otro tipo |

## Alcances (`scope`)

Usa la parte del repositorio que toca el commit:

| Scope | Ruta |
|---|---|
| `sdk` | `sdk/` (SDK de Kit Pagos Colombia) |
| `api` | `simulator-api/` (API de Simulación) |
| `docs` | `docs/` (documentación de arquitectura, diagramas, material relacionado al SAD) |
| `repo` | Cambios que afectan al repositorio en general (por ejemplo, este archivo, configuración a nivel raíz) |

Si un commit toca más de un scope, elige el que mejor represente la intención principal del cambio, u omite el scope únicamente cuando el cambio sea realmente transversal a todo el repositorio.

## Ejemplos

```
feat(sdk): add createPayment method to KitPagos facade

fix(api): correct HMAC-SHA256 signature check for Mercado Pago mocks

refactor(sdk): align domain structure with SAD section 15

Reorganizes domain/ into entities/, value-objects/, errors/ and
services/, moves PaymentGatewayPort to application/ports/, and renames
PaymentFacade to KitPagos to match the Software Architecture Document.

docs(docs): update layers-and-components.md after domain refactor

test(sdk): add unit tests for Amount and Currency value objects

chore(repo): add commit message guidelines
```

## Reglas adicionales

- Escribe los mensajes de commit en **inglés**, sin importar el idioma que se use en los comentarios de código o en la documentación.
- Cada commit debe representar un solo cambio lógico. Evita agrupar cambios no relacionados entre sí.
- No incluyas atribución de IA/bots, trailers de coautoría, ni firmas generadas por herramientas en los mensajes de commit. Todos los commits deben estar atribuidos únicamente al desarrollador que efectivamente revisó y aprobó el cambio.
- Cuando un cambio esté impulsado por un ASR o ADR específico del SAD, menciona su identificador (por ejemplo, `ASR-01`, `ADR-04`) en el body o el footer, para mantener la trazabilidad.

## Política de ramas

- **`main`**: rama protegida y siempre desplegable. Nadie hace push directo aquí y nadie mergea una rama de trabajo directamente aquí; `main` solo recibe merges desde `devops`, mediante un Pull Request dedicado al cierre de cada iteración o hito relevante.
- **`devops`**: rama de integración permanente. Es donde vive el trabajo en curso de la iteración activa. Todas las ramas de trabajo se crean desde `devops` y se mergean de vuelta a `devops` vía Pull Request revisado. Cuando el trabajo integrado en `devops` está validado y listo, se mergea a `main` como un solo Pull Request.
- **Ramas de trabajo**: se crean desde `devops` (no desde `main`), con el prefijo del tipo de cambio, seguido de una descripción corta en kebab-case y, si existe, el número del issue relacionado:
  - `feature/12-create-payment-endpoint`
  - `fix/45-wompi-signature-mismatch`
  - `docs/update-sad-domain-model`
  - `refactor/align-domain-with-sad`
  - `test/6-simulator-api-test-framework`
- Una rama de trabajo debe vivir el tiempo mínimo necesario. Una vez el PR se mergea a `devops`, se elimina tanto localmente como en el remoto (`git branch -d <rama>` y `git push origin --delete <rama>`).
- Si `devops` avanza mientras trabajas en tu rama, actualízala con `git rebase devops` (o `git merge devops` si ya la compartiste con alguien más) antes de abrir o actualizar el PR.

## Issues: seguimiento y cierre

- Antes de empezar a trabajar en un issue, asígnate y muévelo a estado "En progreso" (o el equivalente en la herramienta que se esté usando).
- Cuando termines el trabajo de un issue:
  - Referéncialo en la descripción del Pull Request usando palabras clave de cierre automático (`Closes #12`, `Fixes #45`), para que se cierre solo al mergear.
  - Si el PR avanza el issue pero no lo resuelve del todo, usa `Refs #12` en lugar de `Closes #12`, y deja un comentario en el issue explicando qué quedó pendiente y por qué.
- No cierres un issue manualmente sin dejar un comentario de cierre que explique brevemente la solución y enlace el commit o PR correspondiente. Esto es lo que permite rastrear después qué cambio de código resolvió qué requisito.
- Si el trabajo en un issue queda bloqueado (por ejemplo, esperando una definición del SAD o una decisión de arquitectura), coméntalo en el issue con la razón del bloqueo en lugar de dejarlo en silencio.

## Pull Requests

- **Título**: sigue el mismo formato que los commits, `type(scope): summary`, en inglés.
- **Contenido mínimo de la descripción**:
  - **Summary**: qué cambia y por qué, en 2-4 líneas.
  - **Changes**: lista de los cambios principales (archivos o componentes relevantes).
  - **Related issues / ASR / ADR**: número de issue relacionado (`Closes #N` / `Refs #N`) y, si aplica, el identificador del ASR o ADR del SAD que motiva el cambio.
  - **Test plan**: cómo se verificó el cambio (pruebas automatizadas ejecutadas, pasos manuales, o ambos).
- Un PR debe tener al menos una revisión aprobada antes de mergear a su rama base (`devops` para ramas de trabajo, `main` para el PR de cierre de iteración desde `devops`).
- No se mergea un PR si el CI está en rojo o si tiene conflictos sin resolver con su rama base.
- Se prefiere *squash merge* para ramas de trabajo con muchos commits intermedios ("wip", "fix typo", etc.), de forma que la rama base mantenga un historial limpio con un commit por cambio lógico.
