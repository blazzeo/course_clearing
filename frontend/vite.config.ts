import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
	plugins: [react()],
	define: {
		'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL),
		'import.meta.env.VITE_PROGRAM_ID': JSON.stringify('9APcPCshf3LwrJN2L2fAWJFx3sdGXo61hHj7um4KEeSY'),
	},
	server: {
		host: '0.0.0.0',
		port: 3000,
		proxy: {
			'/api': {
				target: 'http://localhost:8001',
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/api/, '/api')
			}
		}
	}
})






