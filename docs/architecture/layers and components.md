# Arquitectura Hexagonal: Especificación de Capas y Componentes

## Árbol de Directorios Estándar (`src/`)

src/
├── domain/                         <-- Capa 1: Dominio Puro
│   ├── entities/
│   ├── value-objects/
│   └── errors/
│
├── application/                    <-- Capa 2: Aplicación y Puertos
│   ├── ports/
│   │   ├── inbound/
│   │   └── outbound/
│   ├── use-cases/
│   └── dtos/
│
└── infrastructure/                 <-- Capa 3: Infraestructura y Tecnologías
    ├── adapters/
    │   └── gateways/
    ├── http/
    ├── mappers/
    ├── factories/
    └── facade/

---

## Detalle de Capas y Componentes

### 1. Capa de Dominio (`src/domain/`)

**Propósito:** El centro del hexágono. Contiene los modelos y reglas puras del negocio financiero de pagos en Colombia. Es **100% agnóstica** a dependencias externas, librerías (`axios`, `dotenv`), frameworks o APIs de pasarelas.

* **`entities/` (Entidades de Dominio):**
  * `Transaccion.ts`: Clase principal del agregado de pagos. Mantiene identidad propia (`transactionId`, `orderReference`), estado actual, historial de cambios y validaciones del ciclo de vida.
* **`value-objects/` (Objetos de Valor):**
  * `Monto.ts`: Encapsula el valor financiero. Valida que sea un número positivo con un máximo de dos decimales significativos para pesos colombianos (COP).
  * `Moneda.ts`: Valida códigos de divisa bajo el estándar ISO 4217 (ej. `'COP'`).
  * `TransactionStatus.ts`: Enum canónico unificado (`APPROVED`, `DECLINED`, `PENDING`, `EXPIRED`, `VOIDED`, `ERROR`).
  * `FirmaCriptografica.ts`: Representa y valida la estructura de los hashes de seguridad y firmas de webhooks.
* **`errors/` (Excepciones/Errores de Dominio):**
  * `MontoInvalidoError.ts`: Lanzado cuando un valor numérico viola las reglas de moneda o precisión en COP.
  * `MonedaNoSoportadaError.ts`: Lanzado al intentar operar con divisas distintas a las permitidas por el puerto.

---

### 2. Capa de Aplicación (`src/application/`)

**Propósito:** Orquesta los casos de uso del sistema y define las interfaces abstractas (**Puertos**) que permiten la comunicación bidireccional entre el núcleo y los componentes externos.

* **`ports/inbound/` (Puertos de Entrada / API del SDK):**
  * `IProcesarPagoUseCase.ts`: Contrato para la creación de intenciones de pago.
  * `IConsultarEstadoUseCase.ts`: Contrato para polling o consulta activa de transacciones.
  * `IProcesarWebhookUseCase.ts`: Contrato para recepción y validación de notificaciones asíncronas.
  * `IKitPagosConfig.ts`: Contrato de inicialización global del SDK y definición del objeto `GatewayCredentials` (`WompiCredentials`, `PayUCredentials`, `MercadoPagoCredentials`, `KushkiCredentials`).
* **`ports/outbound/` (Puertos de Salida / SPI de Infraestructura):**
  * `IPasarelaPagoPort.ts`: Interfaz unificada que obliga a todos los adaptadores (`WompiAdapter`, `PayUAdapter`, etc.) a implementar las firmas de `enviarPago`, `obtenerEstado` y `validarFirmaWebhook`.
  * `ILoggerPort.ts`: Contrato abstracto para el registro de trazas de auditoría.
* **`use-cases/` (Casos de Uso / Orquestadores):**
  * `ProcesarPagoUseCase.ts`: Recibe la solicitud, valida la información mediante el Dominio, selecciona el puerto de salida inyectado y retorna la respuesta normalizada.
  * `ConsultarEstadoUseCase.ts`: Coordina la consulta activa y aplica las reglas de mapeo de estados.
  * `ProcesarWebhookUseCase.ts`: Ejecuta la verificación de firma criptográfica mediante el puerto de salida y actualiza el estado de la transacción.
* **`dtos/` (Data Transfer Objects):**
  * `CrearPagoDTO.ts`: Objeto plano de entrada con datos del pago, cliente e ítems.
  * `ResultadoPagoDTO.ts`: Objeto plano de salida normalizado enviado al cliente.
  * `WebhookPayloadDTO.ts`: Objeto plano que encapsula las notificaciones asíncronas HTTP POST.

---

### 3. Capa de Infraestructura (`src/infrastructure/`)

**Propósito:** Implementa los puertos de salida comunicando el SDK con los servicios externos reales o la API de simulación (peticiones HTTP, formatos nativos, empaquetado y gestión de secretos).

* **`adapters/gateways/` (Adaptadores Concretos):**
  * `WompiAdapter.ts`: Implementa `IPasarelaPagoPort` traduciendo DTOs a `amount_in_cents` y verificando hashes SHA-256.
  * `PayUAdapter.ts`: Traduce a la API nativa de PayU (`referenceCode`, firma MD5/SHA-256 y campos `additionalValues`).
  * `MercadoPagoAdapter.ts`: Traduce a Checkout Pro / Checkout API de Mercado Pago (`transaction_amount`, HMAC-SHA256).
  * `KushkiAdapter.ts`: Traduce a la API de Kushki (`trackingCode`, estado `"APPROVAL"`).
* **`http/` (Cliente de Red):**
  * `HttpClient.ts`: Envoltorio sobre `fetch` o `axios` para gestionar llamadas HTTPS, headers de autenticación, timeouts y errores de conexión de red.
* **`mappers/` (Traductores de Datos Nativos):**
  * `WompiMapper.ts`, `PayUMapper.ts`, `MercadoPagoMapper.ts`, `KushkiMapper.ts`: Módulos especializados exclusivamente en transformar los JSONs crudos de respuesta hacia DTOs del dominio.
* **`factories/` (Patrón GoF Factory):**
  * `PasarelaFactory.ts`: Lee el archivo/objeto de configuración (`IKitPagosConfig`), valida credenciales e instancia el adaptador correspondiente inyectándole su cliente HTTP y credenciales específicas.
* **`facade/` (Patrón GoF Facade — Punto de Entrada Público):**
  * `KitPagosFacade.ts`: Clase principal expuesta en el paquete `npm`. Oculta la complejidad interna de instanciación y ejecución de casos de uso tras métodos simples (`crearPago`, `consultarEstado`, `procesarWebhook`).

---

## Flujo de Información entre Capas

[Cliente / App Comercio]
       │
       │ (1) Invocación de método con CrearPagoDTO
       ▼
[KitPagosFacade] (Infraestructura / Facade)
       │
       │ (2) Delegación al puerto de entrada (IProcesarPagoUseCase)
       ▼
[ProcesarPagoUseCase] (Aplicación / Caso de Uso)
       │
       │ (3) Validación de reglas mediante Entidades / Objetos de Valor
       ▼
[Transaccion / Monto] (Dominio)
       │
       │ (4) Envío mediante puerto de salida (IPasarelaPagoPort)
       ▼
[WompiAdapter / PayUAdapter] (Infraestructura / Adaptadores)
       │
       │ (5) Traducción por Mappers y llamada HTTPS vía HttpClient
       ▼
[API Pasarela / API Simulación]
