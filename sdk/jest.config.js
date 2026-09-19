module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  // Las pruebas de contrato contra los sandboxes reales quedan fuera de la suite de cada
  // cambio: llaman a la red, necesitan credenciales y tardan. Corren con
  // `npm run test:sandbox`, con su propia configuración. Ver test/sandbox/sandbox-env.ts.
  testPathIgnorePatterns: ['/node_modules/', '\\.sandbox\\.test\\.ts$'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};