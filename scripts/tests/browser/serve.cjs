// Local test-only server: expose generated harness assets, save test observations.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const assets = path.resolve(__dirname, "../../../build/browser-validation");
const evidence = path.resolve(
  process.argv[2] ||
    "docs/reviews/react18.3.1-independent-audit/browser-20261020",
);
fs.mkdirSync(evidence, { recursive: true });
const port = Number(process.env.BROWSER_TEST_PORT || 4183);
http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/results") {
      if (req.headers.origin !== `http://127.0.0.1:${port}`) {
        res.writeHead(403).end();
        return;
      }
      let text = "";
      req.on("data", (chunk) => {
        text += chunk;
        if (text.length > 1_000_000) req.destroy();
      });
      req.on("end", () => {
        try {
          const data = JSON.parse(text);
          if (
            !["official", "local"].includes(data.runtime) ||
            !["development", "production"].includes(data.mode)
          )
            throw Error("Invalid test identity");
          const name = `${data.runtime}-${data.mode}.json`;
          fs.writeFileSync(
            path.join(evidence, name),
            JSON.stringify(data, null, 2) + "\n",
          );
          res
            .writeHead(200, { "Content-Type": "application/json" })
            .end(JSON.stringify({ saved: name }));
        } catch (error) {
          res.writeHead(400).end(String(error));
        }
      });
      return;
    }
    const name = req.url?.slice(1);
    if (
      req.method !== "GET" ||
      !/^(official|local)-(development|production)\.(html|js)$/.test(name)
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": name.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "text/javascript",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(path.join(assets, name)).pipe(res);
  })
  .listen(port, "127.0.0.1", () =>
    console.log(
      `Browser harness: http://127.0.0.1:${port}/official-development.html\nEvidence: ${evidence}`,
    ),
  );
