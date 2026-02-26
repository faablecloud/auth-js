import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    use: {
        baseURL: 'http://localhost:8082',
    },
    webServer: {
        command: 'npx http-server ./ -p 8082 --cors',
        url: 'http://localhost:8082',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
    },
});
