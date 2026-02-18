import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(function () { return ({
    plugins: [react()],
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        proxy: {
            "/api": {
                target: "http://localhost:3001",
                changeOrigin: true
            }
        },
        watch: {
            ignored: ["**/src-tauri/**", "**/server/**", "**/data/**"]
        }
    }
}); });
