export type ImageJob = { id: string; token: string };
export type ImageJobOptions = {
    signal?: AbortSignal;
    onCreated?: (job: ImageJob) => Promise<void>;
};
export class ImageJobError extends Error {
    constructor(message: string, readonly terminal = false) { super(message); }
}

function createJob(): ImageJob {
    const bytes = crypto.getRandomValues(new Uint8Array(48));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { id: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`, token: hex.slice(32) };
}

async function delay(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, 2000);
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        signal?.addEventListener("abort", abort, { once: true });
    });
}

export async function waitForImageJob<T>(job: ImageJob, signal?: AbortSignal): Promise<T> {
    for (;;) {
        let response: Response;
        try {
            response = await fetch(`/api/jobs/${job.id}`, { headers: { "X-Task-Token": job.token }, cache: "no-store", signal });
        } catch (error) {
            if (signal?.aborted) throw error;
            await delay(signal);
            continue;
        }
        if (response.status >= 500 || response.status === 429) { await delay(signal); continue; }
        const body = await response.json();
        if (response.status === 404) throw new ImageJobError("任务状态未知，服务可能已重启。请先检查用量记录，避免重复提交。");
        if (!response.ok) throw new ImageJobError(body.error || "图片任务状态不可用", response.status === 410);
        if (body.status === "completed") return body.response as T;
        if (body.status === "failed") throw new ImageJobError(body.error || "图片生成失败", true);
        await delay(signal);
    }
}

export async function discardImageJob(job: ImageJob): Promise<void> {
    const response = await fetch(`/api/jobs/${job.id}`, { method: "DELETE", headers: { "X-Task-Token": job.token } });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error("无法清理图片任务");
}

export async function submitImageJob<T>(operation: "generations" | "edits", key: string, body: object | FormData, options?: ImageJobOptions): Promise<{ job: ImageJob; response: T }> {
    const job = createJob();
    await options?.onCreated?.(job);
    const multipart = body instanceof FormData;
    const headers: Record<string, string> = { Authorization: `Bearer ${key}`, "X-Task-Token": job.token, "X-Image-Operation": operation };
    if (!multipart) headers["Content-Type"] = "application/json";
    try {
        let response: Response;
        try {
            response = await fetch(`/api/jobs/${job.id}`, { method: "POST", headers, body: multipart ? body : JSON.stringify(body), signal: options?.signal });
        } catch (error) {
            if (options?.signal?.aborted) throw error;
            // The upload may have reached the server; never automatically resubmit it.
            return { job, response: await waitForImageJob<T>(job, options?.signal) };
        }
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new ImageJobError(result.error || "图片任务提交失败", response.status >= 400 && response.status < 500);
        }
        return { job, response: await waitForImageJob<T>(job, options?.signal) };
    } catch (error) {
        if (options?.signal?.aborted) void discardImageJob(job).catch(() => {});
        throw error;
    }
}
