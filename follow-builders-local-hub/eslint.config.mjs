import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      'config/config.json',
      'coverage/**',
      'data/**',
      'next-env.d.ts',
      'playwright-report/**',
      'test-results/**'
    ]
  }
];

export default config;
