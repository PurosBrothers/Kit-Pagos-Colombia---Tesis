# Kit Pagos Colombia - Guía de Inicialización, Estructura y Decisiones Técnicas

Este documento describe la estructura inicial del proyecto de grado **Kit Pagos Colombia**, las tecnologías seleccionadas, la configuración de sus componentes principales y algunos inconvenientes encontrados durante la puesta en marcha.

También se presentan las razones detrás de las decisiones técnicas tomadas, con el fin de dejar documentado el enfoque utilizado para el desarrollo del SDK y la API de simulación.

---

## 1. Estructura general del proyecto

El proyecto se organiza como un monorrepo compuesto por diferentes carpetas. Esto permite mantener el código fuente, la documentación y los distintos componentes en un mismo repositorio, sin perder la separación entre cada uno.

```text
Kit-Pagos-Colombia---Tesis/
├── docs/                       # Documentación técnica, arquitectura y trabajo de grado
│   ├── architecture/           # Diagramas C4, DDD, lenguaje ubicuo y especificaciones
│   └── tesis/                  # Documento final del trabajo de grado
├── sdk/                        # Librería cliente unificada desarrollada en TypeScript
├── simulator-api/              # API REST utilizada para simular las pasarelas de pago
└── README.md                   # Información general y punto de entrada del repositorio
```

La separación por módulos permite que el SDK y el simulador puedan desarrollarse y probarse de manera independiente. Al mismo tiempo, el uso de un único repositorio facilita el seguimiento de cambios y la organización general del proyecto.

---

## 2. Configuración del SDK (`/sdk`)

### 2.1 Arquitectura y tecnologías utilizadas

El SDK se desarrolla utilizando **TypeScript**, con compatibilidad para **ES2020** y **Node.js 18 LTS o versiones posteriores**.

A diferencia de una aplicación web, el SDK no requiere un servidor propio. Por esta razón, no se utilizan frameworks como NestJS o Express. El objetivo es construir una librería que pueda ser instalada e integrada fácilmente en otros proyectos mediante npm.

El uso de TypeScript permite contar con tipado estático, mejorar la detección de errores durante el desarrollo y definir contratos claros para las operaciones relacionadas con las pasarelas de pago.

El SDK utiliza la licencia **Apache 2.0**, lo que permite su uso, modificación y distribución como software de código abierto.

### 2.2 Estructura interna

Dentro de `sdk/src/` se utiliza una organización basada en la **Arquitectura Hexagonal**, también conocida como **Puertos y Adaptadores**.

```text
sdk/src/
├── domain/             # Reglas, contratos y elementos principales del dominio
│   ├── enums/          # EstadoTransaccion.ts
│   ├── interfaces/     # IIntencionPago.ts, IPuertoPasarela.ts
│   └── errors/         # ErrorNormalizado.ts
├── infrastructure/     # Implementaciones relacionadas con servicios externos
│   └── adapters/       # Adaptadores de Wompi, Rapyd, Mercado Pago y Kushki
├── application/        # Servicios y fachada principal del SDK
│   └── KitPagos.ts     # Clase principal expuesta al usuario
└── index.ts            # Exportaciones públicas del paquete
```

Esta organización permite separar la lógica principal del SDK de las implementaciones específicas de cada pasarela.

Por ejemplo, si una pasarela cambia la forma en que recibe una solicitud o modifica su mecanismo de autenticación, los cambios se pueden concentrar en el adaptador correspondiente. De esta manera, se busca reducir el impacto sobre el resto del sistema y mantener una interfaz unificada para los usuarios del SDK.

### 2.3 Dependencias y pruebas

Para las pruebas se utiliza **Jest** junto con **`ts-jest`**, lo que permite ejecutar pruebas automatizadas directamente sobre el código desarrollado en TypeScript.

El proyecto cuenta con un umbral de cobertura del **80 %** para las siguientes métricas:

* Statements
* Branches
* Functions
* Lines

La configuración se encuentra definida en el archivo `jest.config.js`.

También se utiliza **`ts-morph`** para analizar la estructura sintáctica del código TypeScript. Esta herramienta será utilizada durante la fase de evaluación para obtener información relacionada con las métricas de calidad definidas para el proyecto.

Por otra parte, **ESLint** y **Prettier** se utilizan para mantener un estilo de código consistente. La configuración de TypeScript incluye el modo estricto mediante la opción `strict: true`.

---

## 3. Configuración de la API de simulación (`/simulator-api`)

### 3.1 Arquitectura y tecnologías utilizadas

La API de simulación se desarrolla utilizando:

* **Fastify**
* **TypeScript**
* **`ts-node-dev`**

Fastify fue seleccionado para construir la API debido a que es un framework ligero y ofrece un buen rendimiento. Además, cuenta con soporte para la validación de datos mediante JSON Schema, lo que facilita la definición y validación de las solicitudes y respuestas utilizadas en las pruebas.

La API tendrá como objetivo representar el comportamiento de las diferentes pasarelas de pago dentro de un entorno controlado. Esto permitirá ejecutar los escenarios definidos sin depender directamente de los servicios reales de cada proveedor.

Para el desarrollo local se utiliza `ts-node-dev`, el cual permite reiniciar automáticamente el servidor cuando se detectan cambios en los archivos del proyecto.

### 3.2 Scripts de ejecución

Los scripts configurados para la API son los siguientes:

* **`npm run dev`**: inicia el servidor en modo de desarrollo utilizando:

```bash
ts-node-dev --respawn --transpile-only src/server.ts
```

La opción `--respawn` reinicia el proceso cuando se realizan cambios, mientras que `--transpile-only` permite realizar la transpilación sin ejecutar la validación completa de tipos en cada reinicio.

* **`npm run build`**: compila el código TypeScript y genera los archivos JavaScript dentro de la carpeta `dist`.

* **`npm start`**: inicia la versión compilada de la aplicación mediante:

```bash
node dist/server.js
```

* **`npm run lint`**: ejecuta ESLint para identificar posibles problemas de estilo y calidad en el código.

---

## 4. Incidentes encontrados durante la configuración

Durante la creación inicial del proyecto se presentaron algunos problemas relacionados con las herramientas de desarrollo y el entorno de Windows.

### 4.1 Problema al inicializar TypeScript

Durante la ejecución del comando:

```bash
npx tsc --init
```

se presentó un problema relacionado con paquetes nativos de TypeScript para Windows, específicamente con `@typescript/typescript-win32-x64`.

Como alternativa, el archivo `tsconfig.json` fue creado manualmente con la configuración requerida para el proyecto. Esto permitió continuar con la configuración sin depender del proceso automático de inicialización.

La configuración manual también facilitó definir desde el inicio las opciones necesarias, incluyendo el uso del modo estricto de TypeScript.

### 4.2 Problemas con `esbuild` y permisos en Windows

Durante la configuración inicial de `tsx` se presentaron errores relacionados con permisos y diferencias entre versiones de `esbuild`.

Entre los mensajes encontrados estaban:

```text
EPERM
Expected "0.28.1" but got "0.20.2"
```

Estos problemas estaban relacionados con archivos bloqueados y con inconsistencias en los binarios instalados dentro de `node_modules`. El uso de sincronización en la nube mediante OneDrive también podía interferir con la modificación de algunos archivos durante la instalación.

Inicialmente se realizaron procesos de limpieza de caché y eliminación de dependencias. Sin embargo, para evitar continuar dependiendo de los binarios utilizados por `esbuild`, se decidió reemplazar `tsx` por `ts-node-dev`.

Con este cambio fue posible ejecutar el servidor de forma estable en el entorno de desarrollo utilizado para el proyecto.

---

## 5. Justificación de las principales decisiones técnicas

En esta sección se presentan las razones principales detrás de las decisiones tomadas durante la configuración del proyecto.

### 5.1 Uso de TypeScript sin NestJS o Express en el SDK

El SDK se desarrolla como una librería y no como una aplicación web. Por esta razón, no necesita administrar rutas HTTP, ejecutar un servidor ni incluir componentes propios de frameworks como NestJS o Express.

El uso de TypeScript permite construir una solución más ligera y mantener contratos claros mediante interfaces, tipos y clases.

Además, al evitar dependencias que no son necesarias para el funcionamiento del SDK, se busca reducir la complejidad de la librería y facilitar su integración en diferentes proyectos.

La interacción con las pasarelas se realizará mediante los adaptadores definidos dentro de la arquitectura, mientras que el usuario podrá acceder a las funcionalidades principales a través de una interfaz unificada.

### 5.2 Uso de Arquitectura Hexagonal

La Arquitectura Hexagonal permite separar la lógica principal del proyecto de las implementaciones específicas de servicios externos.

En este caso, cada pasarela de pago puede tener diferentes endpoints, mecanismos de autenticación, estructuras de solicitud y formatos de respuesta. Estas diferencias se manejan mediante adaptadores independientes.

Por ejemplo, si Wompi modifica una parte de su API, el cambio debería concentrarse principalmente en `WompiAdapter.ts`. El objetivo es evitar que una modificación específica de un proveedor afecte directamente el dominio o la interfaz utilizada por los clientes del SDK.

Esta separación también facilita agregar nuevas pasarelas en el futuro, ya que se puede crear un nuevo adaptador que implemente el contrato definido por el puerto correspondiente.

### 5.3 Uso de Fastify para la API de simulación

Fastify fue seleccionado para la API de simulación debido a que proporciona una estructura ligera y un buen rendimiento para la creación de servicios HTTP.

Además, su integración con JSON Schema permite definir y validar la estructura de las solicitudes y respuestas. Esto resulta útil para construir escenarios controlados y mantener un comportamiento consistente durante las pruebas.

El simulador tendrá diferentes respuestas según la pasarela y el escenario evaluado. El uso de Fastify facilita la implementación de estos comportamientos sin agregar una estructura más compleja de la necesaria.

### 5.4 Cambio de `tsx` a `ts-node-dev`

Inicialmente se utilizó `tsx` para ejecutar los archivos TypeScript durante el desarrollo. Sin embargo, se presentaron problemas relacionados con los binarios de `esbuild`, permisos de archivos y diferencias entre versiones instaladas.

Debido a estos inconvenientes, se decidió utilizar `ts-node-dev`.

Esta herramienta permite ejecutar el proyecto y reiniciar automáticamente el servidor cuando se detectan cambios. Aunque el cambio se realizó principalmente para resolver problemas de compatibilidad en el entorno de desarrollo, también permitió mantener un flujo de trabajo estable para la API de simulación.

### 5.5 Uso de métricas CK y `ts-morph`

La evaluación del proyecto requiere obtener evidencia sobre el impacto del SDK en el desarrollo de las integraciones con pasarelas de pago.

Para esto se utilizarán métricas relacionadas con la calidad y complejidad del código, incluyendo:

* **WMC (Weighted Methods per Class):** permite analizar la complejidad asociada a los métodos de una clase.
* **CBO (Coupling Between Objects):** mide el nivel de acoplamiento entre las clases.
* **RFC (Response For a Class):** representa la cantidad de métodos que pueden ser ejecutados como respuesta a una interacción con una clase.

La herramienta `ts-morph` permitirá analizar la estructura del código TypeScript y obtener información necesaria para calcular o apoyar la recolección de estas métricas.

El propósito es comparar la implementación de una integración utilizando el SDK frente a una implementación realizada sin utilizarlo. Con estos resultados se busca obtener evidencia cuantitativa sobre el nivel de abstracción y simplificación proporcionado por la propuesta.

---

## 6. Próximos pasos

Las siguientes actividades corresponden a las tareas iniciales del ciclo de desarrollo:

1. **Implementación del dominio unificado**

Se desarrollarán los enums, tipos e interfaces definidos a partir de la matriz de equivalencias y del lenguaje ubicuo del proyecto.

2. **Definición del puerto principal**

Se creará la interfaz `IPuertoPasarela.ts`, la cual establecerá el contrato que deberán cumplir los adaptadores de las diferentes pasarelas.

3. **Configuración de los endpoints iniciales del simulador**

Se implementarán los endpoints de estado y salud de la API para verificar que el proyecto funcione correctamente en el entorno local.

4. **Implementación inicial de los adaptadores**

Se comenzará el desarrollo de los adaptadores correspondientes a las pasarelas seleccionadas para el proyecto.

5. **Preparación de las pruebas**

Se configurarán los casos de prueba necesarios para validar el comportamiento del SDK y los escenarios definidos dentro del simulador.
