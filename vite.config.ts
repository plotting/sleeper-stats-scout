
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "child_process";

// Short commit id shown on the admin pages so it's easy to tell which build you are looking at.
function buildId(): string {
  const fromHost = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? process.env.COMMIT_REF;
  if (fromHost) return fromHost.slice(0, 7);
  try { return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "dev"; }
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
