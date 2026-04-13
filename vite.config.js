import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var apiPort = Number(process.env.SLV_SERVER_PORT || 3002);
export default defineConfig(function () { return ({
    plugins: [react()],
    clearScreen: false,
    server: {
        host: "127.0.0.1",
        port: 1420,
        strictPort: true,
        cors: false,
        allowedHosts: ["127.0.0.1", "localhost"],
        proxy: {
            "/api": {
                target: "http://127.0.0.1:".concat(apiPort),
                changeOrigin: true
            }
        },
        watch: {
            ignored: ["**/server/**", "**/data/**"]
        }
    }
}); });
