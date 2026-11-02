import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error Shared ESM Node API handler
import { handleApiRequest } from './server/apiHandler.mjs';

function techToolsApiPlugin(): Plugin {
  return {
    name: 'techtools-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          return next();
        }
        await handleApiRequest(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), techToolsApiPlugin()],
  server: {
    host: true,
    port: 5174,
  },
});
