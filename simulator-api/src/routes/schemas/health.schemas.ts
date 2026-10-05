/**
 * Schema OpenAPI/JSON-Schema para el endpoint de salud GET /health.
 */
export const getHealthSchema = {
  summary: "Health check",
  description:
    "Verifica que la API de Simulación está levantada y funcionando. " +
    "No requiere autenticación ni cabeceras de escenario.",
  tags: ["Infraestructura"],
  response: {
    200: {
      description: "La API está operativa.",
      type: "object",
      properties: {
        status: { type: "string", enum: ["ok"], example: "ok" },
      },
      required: ["status"],
      examples: [{ status: "ok" }],
    },
  },
} as const;

