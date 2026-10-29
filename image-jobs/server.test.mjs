import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";

test("image jobs forward once, isolate results, and support cancellation", async () => {
    let calls = 0;
    let release;
    let secondRequest;
    const upstream = http.createServer(async (req, res) => {
        if (req.url === "/v1/models") { res.writeHead(req.headers.authorization === "Bearer test-key" ? 200 : 401); res.end("{}"); return; }
        calls++;
        if (calls === 2) secondRequest?.();
        assert.equal(req.url, "/v1/images/edits");
        assert.equal(req.headers.authorization, "Bearer test-key");
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        assert.equal(Buffer.concat(chunks).toString(), "reference-image-fixture");
        await new Promise((resolve) => { release = resolve; });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ b64_json: "fixture" }] }));
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    process.env.CANVAS_API_UPSTREAM = `http://127.0.0.1:${upstream.address().port}`;
    const { server } = await import("./server.mjs");
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/jobs/${randomUUID()}`;
    const token = randomBytes(32).toString("hex");
    const headers = { authorization: "Bearer test-key", "x-task-token": token, "x-image-operation": "edits", "content-type": "application/octet-stream" };
    try {
        assert.equal((await fetch(url, { method: "POST", headers, body: "reference-image-fixture" })).status, 202);
        assert.equal((await fetch(url, { headers: { "x-task-token": randomBytes(32).toString("hex") } })).status, 404);
        assert.equal((await fetch(url, { method: "POST", headers, body: "reference-image-fixture" })).status, 200);
        assert.equal(calls, 1);
        const invalidUrl = `http://127.0.0.1:${server.address().port}/jobs/${randomUUID()}`;
        assert.equal((await fetch(invalidUrl, { method: "POST", headers: { ...headers, authorization: "Bearer invalid-key" }, body: "fixture" })).status, 401);
        assert.equal(calls, 1);
        release();
        let result;
        do { await new Promise((resolve) => setTimeout(resolve, 5)); result = await (await fetch(url, { headers })).json(); } while (result.status === "running");
        assert.deepEqual(result.response, { data: [{ b64_json: "fixture" }] });
        assert.equal((await fetch(url, { method: "DELETE", headers })).status, 200);
        assert.equal((await fetch(url, { headers })).status, 410);
        assert.equal((await fetch(url, { method: "POST", headers, body: "reference-image-fixture" })).status, 200);
        assert.equal(calls, 1);
        const cancelUrl = `http://127.0.0.1:${server.address().port}/jobs/${randomUUID()}`;
        const received = new Promise((resolve) => { secondRequest = resolve; });
        assert.equal((await fetch(cancelUrl, { method: "POST", headers, body: "reference-image-fixture" })).status, 202);
        await received;
        assert.equal(calls, 2);
        assert.equal((await fetch(cancelUrl, { method: "DELETE", headers })).status, 200);
        assert.equal((await fetch(cancelUrl, { headers })).status, 410);
    } finally {
        server.closeAllConnections();
        upstream.closeAllConnections();
        await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
    }
});
