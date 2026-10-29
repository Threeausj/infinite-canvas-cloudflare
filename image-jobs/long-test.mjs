import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

const upstream = http.createServer((req, res) => {
    if (req.url === "/v1/models") { res.end("{}"); return; }
    req.resume();
    req.on("end", () => setTimeout(() => res.end(JSON.stringify({ data: [{ b64_json: "fixture" }] })), 127000));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
process.env.CANVAS_API_UPSTREAM = `http://127.0.0.1:${upstream.address().port}`;
const { server } = await import("./server.mjs");
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/jobs/${randomUUID()}`;
const headers = { authorization: "Bearer synthetic", "x-task-token": randomBytes(32).toString("hex"), "x-image-operation": "generations", "content-type": "application/json" };
try {
    const start = Date.now();
    assert.equal((await fetch(url, { method: "POST", headers, body: "{}" })).status, 202);
    let data;
    do { await new Promise((resolve) => setTimeout(resolve, 3000)); data = await (await fetch(url, { headers })).json(); } while (data.status === "running");
    assert.equal(data.status, "completed");
    assert.ok(Date.now() - start >= 127000);
    assert.equal(data.response.data[0].b64_json, "fixture");
    console.log(JSON.stringify({ passed: true, elapsedSeconds: Math.round((Date.now() - start) / 1000), productionRequests: 0 }));
} finally {
    server.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
}
