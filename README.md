# 无限画布：异步图片任务

基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的自部署分支，保留原项目的画布、素材和图片工作台，并通过异步任务避免图片生成期间浏览器长时间等待单个 HTTP 响应。适合站点使用 Cloudflare 代理的场景。

## 工作方式

- 浏览器向同源任务接口提交图片生成或参考图编辑请求，后台通过内网调用 OpenAI 兼容 API；浏览器每 2 秒查询任务结果。
- 浏览器保留作品、素材、配置和任务恢复信息。任务服务只在内存中暂存结果，完成后最多保留一小时，浏览器保存成功后提前清理。服务重启会丢失任务和未取走的结果。
- 本站使用 API Key；任务服务会先请求上游 `/v1/models` 验证 Key。Key 随请求转发，不保存在配置文件或任务数据库中。
- 当前仅生图工作台支持刷新后恢复任务；自定义模型脚本按脚本自身的调用方式运行。结果为远程 URL 时，是否能持久保存取决于浏览器能否下载该资源。
- 异步任务减少浏览器到本站的长等待，不改变上游服务的超时限制，也不改变 Cloudflare 对请求上传的限制。

## Docker 部署

需要 Docker、Compose 和一个可从容器访问的 OpenAI 兼容图片 API。不要把真实 Key、内网地址或 `.env` 上传到公开仓库。

1. 在项目根目录创建本地 `.env`，按你的网络填写 API 服务地址：

   ```dotenv
   CANVAS_API_UPSTREAM=http://host.docker.internal:8080
   CANVAS_IMAGE=infinite-canvas:production
   CANVAS_JOBS_IMAGE=infinite-canvas-jobs:production
   # 可选：空格分隔允许嵌入的 HTTPS 来源；默认仅允许本站。
   # CANVAS_FRAME_ANCESTORS=https://portal.example.com
   ```

   `host.docker.internal` 指 Docker 主机；容器网络中的服务也可以使用其容器 DNS 名称。示例地址需要按实际环境修改，API 源地址不应包含 `/v1`。

2. 构建并启动：

   ```bash
   docker build -t infinite-canvas:production .
   docker build -t infinite-canvas-jobs:production ./image-jobs
   docker compose --env-file .env -f deploy/compose.production.yml up -d
   ```

3. 把 HTTPS 反向代理指向 `http://127.0.0.1:30006`，包括 `/api/` 路径。首次打开页面输入 API Key，模型列表需要包含名称带 `image` 的模型。Cloudflare 外层代理和上游图片服务的配置由部署者管理。

查看状态：`docker compose --env-file .env -f deploy/compose.production.yml ps`。停止服务：`docker compose --env-file .env -f deploy/compose.production.yml down`。容器没有作品数据库；停止任务容器会丢失内存中的任务和未取走的结果。

`CANVAS_FRAME_ANCESTORS` 只应填写可信来源，外层代理不能额外发送冲突的 `X-Frame-Options` 或 CSP。部署前应自行设置访问控制、TLS、网络隔离、监控和资源保护；任务存在内存中，并发任务及大图片会消耗服务端资源。

## 本地开发

使用 Node.js 和 Bun 1.3.13 安装前端依赖；`CANVAS_API_UPSTREAM` 应指向本机能访问的测试 API。

```bash
cd web
bun install --frozen-lockfile
CANVAS_API_UPSTREAM=http://127.0.0.1:8080 CANVAS_JOBS_UPSTREAM=http://127.0.0.1:18081 npm run dev -- --port 3006
```

另开终端启动任务服务：

```bash
CANVAS_API_UPSTREAM=http://127.0.0.1:8080 PORT=18081 node image-jobs/server.mjs
```

运行服务端测试：`node --test image-jobs/server.test.mjs`。测试使用本地模拟上游，不调用生产模型。

## 许可与致谢

原项目由 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 开发，采用 [MIT License](LICENSE)。本分支保留原作者版权和许可信息。
