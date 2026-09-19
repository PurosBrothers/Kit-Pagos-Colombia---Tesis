/**
 * Configuración de las pruebas de contrato contra los sandboxes reales.
 *
 * Separada de `jest.config.js` para que la suite de cada cambio no dependa de la red ni de
 * credenciales. El detalle de qué afirman estas pruebas, y por qué no afirman desenlaces,
 * está en `test/sandbox/sandbox-env.ts`.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test/sandbox'],
  testMatch: ['**/*.sandbox.test.ts'],
  // Son varias llamadas HTTP encadenadas contra sandboxes que no prometen latencia.
  testTimeout: 60000,
  // En serie: varias pasarelas rechazan cobros concurrentes de la misma cuenta de prueba
  // como sospechosos, y un rechazo por antifraude no es un defecto del SDK.
  maxWorkers: 1,
};
