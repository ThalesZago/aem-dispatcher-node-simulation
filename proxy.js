// proxy.js
// Proxy HTTP simples para AEM com cache em memória, simulando allowAuthorized
// - ALLOW_AUTHORIZED=1 => Authorization NÃO é considerado na chave do cache (equivale a /allowAuthorized "1")
// - ALLOW_AUTHORIZED=0 => Authorization É considerado na chave (ou pode optar por bypass)

const http = require("http");
const https = require("https");
const { URL } = require("url");

// Config via env
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const AEM_HOST = process.env.AEM_HOST || "localhost";
const AEM_PORT = process.env.AEM_PORT ? parseInt(process.env.AEM_PORT, 10) : 4502; // use 4502 para Author
const ALLOW_AUTHORIZED = process.env.ALLOW_AUTHORIZED === "0" ? 0 : 1; // default 1 (ignorar Authorization na chave)
const CACHE_TTL_MS = process.env.CACHE_TTL_MS ? parseInt(process.env.CACHE_TTL_MS, 10) : 10 * 60 * 1000; // 10min
const BYPASS_CACHE_IF_AUTH = process.env.BYPASS_CACHE_IF_AUTH === "1"; // opcional: não cachear quando houver Authorization

// Simples cache em memória
// chave -> { status, headers, body(Buffer), expiresAt }
const cache = new Map();

function now() { return Date.now(); }

function makeCacheKey(req, includeAuth) {
    // chave: método + host + path + query
    // se includeAuth=true, Authorization também entra na chave
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const baseKey = `${req.method}:${url.pathname}?${url.searchParams.toString()}`;
    if (includeAuth) {
        return `${baseKey}::auth=${req.headers["authorization"] || ""}`;
    }
    return baseKey;
}

function shouldCache(req, resStatus, resHeaders) {
    // Simples: só cachear GET e status 200
    if (req.method !== "GET") return false;
    if (resStatus !== 200) return false;
    // Poderia respeitar Cache-Control do AEM aqui; manter simples para demo
    return true;
}

function proxyToAem(clientReq, clientRes) {
    const isHttps = false; // AEM local costuma ser http
    const agent = isHttps ? https : http;

    // Encaminhar para AEM
    const options = {
        hostname: AEM_HOST,
        port: AEM_PORT,
        method: clientReq.method,
        path: clientReq.url,
        headers: {
            ...clientReq.headers,
            host: `${AEM_HOST}:${AEM_PORT}`, // host do backend
        },
    };

    // Fazer a requisição ao AEM
    const upstreamReq = agent.request(options, (upstreamRes) => {
        const chunks = [];
        upstreamRes.on("data", (chunk) => chunks.push(chunk));
        upstreamRes.on("end", () => {
            const body = Buffer.concat(chunks);

            // Copiar headers do upstream
            const headers = { ...upstreamRes.headers };
            // Vamos adicionar nosso header de diagnóstico
            headers["x-proxy-backend"] = `${AEM_HOST}:${AEM_PORT}`;

            // Decidir cachear
            const hasAuth = !!clientReq.headers["authorization"];
            const bypass = BYPASS_CACHE_IF_AUTH && hasAuth;

            const includeAuthInKey = ALLOW_AUTHORIZED === 1 ? false : true;
            const cacheKey = makeCacheKey(clientReq, includeAuthInKey);

            if (!bypass && shouldCache(clientReq, upstreamRes.statusCode, headers)) {
                const entry = {
                    status: upstreamRes.statusCode,
                    headers: headers,
                    body,
                    expiresAt: now() + CACHE_TTL_MS,
                };
                cache.set(cacheKey, entry);
                headers["x-proxy-cache"] = "MISS";
            } else {
                headers["x-proxy-cache"] = bypass ? "BYPASS" : "MISS";
            }

            // Responder ao cliente
            clientRes.writeHead(upstreamRes.statusCode, headers);
            clientRes.end(body);
        });
    });

    upstreamReq.on("error", (err) => {
        clientRes.writeHead(502, { "content-type": "text/plain" });
        clientRes.end(`Bad Gateway: ${err.message}`);
    });

    // Encaminhar corpo (se houver, para POST/PUT etc.)
    clientReq.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
    // Cache somente GET
    const isGet = req.method === "GET";
    const hasAuth = !!req.headers["authorization"];
    const includeAuthInKey = ALLOW_AUTHORIZED === 1 ? false : true;
    const cacheKey = makeCacheKey(req, includeAuthInKey);

    if (isGet) {
        const entry = cache.get(cacheKey);
        if (entry && entry.expiresAt > now()) {
            // Cache HIT
            const headers = { ...entry.headers, "x-proxy-cache": "HIT" };
            res.writeHead(entry.status, headers);
            return res.end(entry.body);
        } else if (entry) {
            // Expirou
            cache.delete(cacheKey);
        }
    }

    // Sem HIT de cache -> encaminhar ao AEM
    proxyToAem(req, res);
});

server.listen(PORT, () => {
    console.log(`Proxy AEM com cache ativo em http://localhost:${PORT}`);
    console.log(`Backend: http://${AEM_HOST}:${AEM_PORT}`);
    console.log(`ALLOW_AUTHORIZED=${ALLOW_AUTHORIZED} (1=ignorar Authorization na chave; 0=considerar)`);
    console.log(`BYPASS_CACHE_IF_AUTH=${BYPASS_CACHE_IF_AUTH ? "1" : "0"} (1=não cachear quando houver Authorization)`);
    console.log(`CACHE_TTL_MS=${CACHE_TTL_MS}`);
});