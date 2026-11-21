import { defineConfig } from 'vitest/config';

// GitHub Pages는 https://madenmud.github.io/w3game3c/ 아래에서 서빙된다.
export default defineConfig({
  base: '/w3game3c/',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
