import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Automatically loads test/.env.test when present
    envDir: './test',
  },
})
