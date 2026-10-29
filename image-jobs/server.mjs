import http from "node:http";
import https from "node:https";
import { createHash, timingSafeEqual } from "node:crypto";

const upstream = new URL(process.env.CANVAS_API_UPSTREAM || "http://127.0.0.1:8080");
const jobs = new Map();
const resultRetentionMs = 60 * 60 * 1000;
const hash = (value) => createHash("sha256").update(value).digest();
const validId = (value) => /^[a-f0-9-]{36}$/i.test(value);

function reply(res, status, payload) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(payload));
}

function matches(job, token) {
    const digest = hash(token || "");
    return timingSafeEqual(job.tokenHash, digest);
}

function finish(id, job, state, value) {
    if (job.state !== "running") return;
    job.state = state;
    delete job.abort;
    if (state === "completed") job.response = value;
    else job.error = value;
    const timer = setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id); }, resultRetentionMs);
    timer.unref();
}

function validateKey(authorization) {
    return new Promise((resolve) => {
        const url = new URL("/v1/models", upstream);
        const request = (url.protocol === "https:" ? https : http).request(url, { method: "GET", headers: { authorization } }, (response) => {
            response.resume();
            resolve(response.statusCode === 200);
        });
        request.on("error", () => resolve(false));
        request.end();
    });
}

export const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") return reply(res, 200, { status: "ok" });
    const match = /^\/jobs\/([a-f0-9-]{36})$/.exec(new URL(req.url, "http://localhost").pathname);
    const token = req.headers["x-task-token"];
    if (!match || !validId(match[1]) || typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token)) return reply(res, 404, { error: "任务不存在" });
    const id = match[1];
    const job = jobs.get(id);
    if (job && !matches(job, token)) return reply(res, 404, { error: "任务不存在" });

    if (req.method === "GET") {
        if (!job) return reply(res, 404, { error: "任务不存在或服务已重启" });
        if (job.state === "consumed") return reply(res, 410, { error: "任务结果已领取" });
        return reply(res, 200, job.state === "running" ? { status: "running" } : { status: job.state, response: job.response, error: job.error });
    }
    if (req.method === "DELETE") {
        if (!job) return reply(res, 404, { error: "任务不存在" });
        if (job.state === "running") {
            const abort = job.abort;
            finish(id, job, "failed", "任务已取消");
            abort?.();
        }
        job.state = "consumed";
        delete job.response;
        delete job.error;
        return reply(res, 200, { status: "removed" });
    }
    if (req.method !== "POST") return reply(res, 405, { error: "不支持的请求" });
    if (job) return reply(res, 200, { status: job.state });
    const authorization = req.headers.authorization;
    const operation = req.headers["x-image-operation"];
    if (!authorization?.startsWith("Bearer ") || !["generations", "edits"].includes(operation)) return reply(res, 400, { error: "缺少 Key 或图片操作" });

    const task = { tokenHash: hash(token), state: "running", abort: () => { if (!req.complete) req.destroy(); } };
    jobs.set(id, task);
    validateKey(authorization).then((valid) => {
    if (task.state !== "running") return;
    if (!valid) {
        finish(id, task, "failed", "Key 无效或模型服务不可用");
        req.resume();
        return reply(res, 401, { error: "Key 无效或模型服务不可用" });
    }
    if (req.destroyed) { finish(id, task, "failed", "图片任务上传中断"); return; }
    const url = new URL(`/v1/images/${operation}`, upstream);
    const transport = url.protocol === "https:" ? https : http;
    const headers = { authorization, "content-type": req.headers["content-type"] || "application/json" };
    if (req.headers["content-length"]) headers["content-length"] = req.headers["content-length"];
    const target = transport.request(url, { method: "POST", headers }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("error", () => finish(id, task, "failed", "上游响应中断"));
        response.on("aborted", () => finish(id, task, "failed", "上游响应中断"));
        response.on("end", () => {
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    finish(id, task, "completed", body);
                } else {
                    finish(id, task, "failed", body.error?.message || body.message || `上游请求失败（HTTP ${response.statusCode}）`);
                }
            } catch {
                finish(id, task, "failed", `上游返回了无法解析的响应（HTTP ${response.statusCode}）`);
            }
        });
    });
    task.abort = () => { target.destroy(); if (!req.complete) req.destroy(); };
    target.on("error", () => finish(id, task, "failed", "无法连接上游图片服务"));
    req.on("aborted", () => { target.destroy(); finish(id, task, "failed", "图片任务上传中断"); });
    req.on("error", () => { target.destroy(); finish(id, task, "failed", "图片任务上传中断"); });
    req.on("end", () => reply(res, 202, { status: "running" }));
    req.pipe(target);
    });
});

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
    server.listen(Number(process.env.PORT || 8081), "0.0.0.0");
}
