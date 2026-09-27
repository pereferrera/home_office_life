import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

export function start(port = Number(process.env.PORT || 4173)) {
  return createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url, "http://localhost").pathname)).replace(/^(\.\.[/\\])+/, "");
    let filename = join(root, path === "/" ? "index.html" : path);
    if (!filename.startsWith(root) || !existsSync(filename)) {
      response.writeHead(404).end("Not found");
      return;
    }
    if (statSync(filename).isDirectory()) filename = join(filename, "index.html");
    response.writeHead(200, { "Content-Type": mime[extname(filename)] || "application/octet-stream", "Cache-Control": "no-cache" });
    createReadStream(filename).pipe(response);
  }).listen(port, () => console.log(`Home Office Life: http://localhost:${port}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) start();
