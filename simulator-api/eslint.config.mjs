import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Ignorar dist, node_modules, coverage y archivos de configuración de raíz
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'jest.config.js'],
  },
  {
    rules: {
      // Permitir variables/parámetros no usados si empiezan con guión bajo _
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  }
);
