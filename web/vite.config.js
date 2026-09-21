import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 중에는 API 를 로컬 서버로 넘긴다. 운영은 Cloudflare Pages 의
// _redirects 가 같은 일을 하므로 프런트 코드는 언제나 /api 만 부른다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
