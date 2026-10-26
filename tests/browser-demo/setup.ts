import { fileURLToPath } from "node:url";
import { preview } from "vite";

// Playwright owns the browser processes. This setup owns only the built static server.
export default async function setup() {
  const server = await preview({
    configFile: fileURLToPath(new URL("../../apps/web/vite.config.ts", import.meta.url)),
    mode: "demo",
    preview: { host: "127.0.0.1", port: 0, strictPort: true },
  });
  const close = async () => {
    if ("closeAllConnections" in server.httpServer) server.httpServer.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.httpServer.close((error) => (error ? reject(error) : resolve())),
    );
  };
  try {
    const address = server.httpServer.address();
    if (!address || typeof address === "string")
      throw new Error("Static demo requires an assigned loopback port");
    process.env.RETURNS_DEMO_URL = `http://127.0.0.1:${address.port}`;
    console.log(`Testing static demo at ${process.env.RETURNS_DEMO_URL}`);
    return close;
  } catch (error) {
    await close();
    throw error;
  }
}
