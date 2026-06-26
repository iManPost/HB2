const http  = require("http");
const https = require("https");

const UPSTREAM_HOST = "43.229.132.25";
const UPSTREAM_PORT = 80;
const PORT = process.env.PORT || 8080;

// Railway public URL — ใช้ rewrite ใน m3u8
const PUBLIC_BASE = process.env.PUBLIC_URL || "https://stream-prpxy-production.up.railway.app";

function addCors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Expose-Headers","*");
}

http.createServer((req, res) => {
  addCors(res);
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const options = {
    hostname : UPSTREAM_HOST,
    port     : UPSTREAM_PORT,
    path     : req.url,
    method   : "GET",
    headers  : { host: UPSTREAM_HOST + ":" + UPSTREAM_PORT },
  };

  const proxy = http.request(options, (upstream) => {
    const ct = upstream.headers["content-type"] || "";
    const isM3U8 = ct.includes("mpegurl") || req.url.endsWith(".m3u8") || req.url.includes(".m3u8");

    if (isM3U8) {
      // รวบ body ก่อน แล้ว rewrite URL
      let body = "";
      upstream.setEncoding("utf8");
      upstream.on("data", chunk => body += chunk);
      upstream.on("end", () => {
        // เปลี่ยน http://43.229.132.25:80 → https://railway.app (ผ่าน proxy)
        const rewritten = body
          .split("\n")
          .map(line => {
            const t = line.trim();
            if (!t || t.startsWith("#")) return line;
            // absolute URL → rewrite
            if (t.startsWith("http://") || t.startsWith("https://")) {
              const u = new URL(t);
              return PUBLIC_BASE + u.pathname + u.search;
            }
            // relative path → prepend proxy base + same directory
            return line;
          })
          .join("\n");

        const headers = {
          "content-type": "application/vnd.apple.mpegurl",
          "access-control-allow-origin": "*",
          "cache-control": "no-cache",
        };
        res.writeHead(200, headers);
        res.end(rewritten);
      });
    } else {
      // binary (ts segments etc.) — pipe ตรง
      const headers = { ...upstream.headers, "access-control-allow-origin": "*" };
      res.writeHead(upstream.statusCode, headers);
      upstream.pipe(res, { end: true });
    }
  });

  proxy.on("error", (err) => {
    console.error("[Proxy Error]", err.message);
    if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" });
    res.end("Proxy error: " + err.message);
  });

  req.pipe(proxy, { end: true });

}).listen(PORT, () => {
  console.log("✅ Proxy running on port " + PORT);
  console.log("   PUBLIC_URL =", PUBLIC_BASE);
});
