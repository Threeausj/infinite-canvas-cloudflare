import { Button, Form, Input, theme } from "antd";
import { ArrowRight, HardDrive, Image, KeyRound, Layers3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { fetchSiteImageModels } from "@/services/api/image";
import { decodeChannelModel, useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type ConnectionForm = { apiKey: string };

export default function LoginPage() {
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const location = useLocation();
    const config = useConfigStore((state) => state.config);
    const configureSiteConnection = useConfigStore((state) => state.configureSiteConnection);
    const currentTheme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const selectedChannel = config.channels.find((channel) => channel.id === decodeChannelModel(config.model)?.channelId) || config.channels[0];
    const [form] = Form.useForm<ConnectionForm>();
    const [checking, setChecking] = useState(false);
    const pending = useRef(false);
    const active = useRef(true);
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);
    const from = (location.state as { from?: string } | null)?.from;
    const destination = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/login") ? from : "/canvas";

    const enterCanvas = async ({ apiKey }: ConnectionForm) => {
        if (pending.current) return;
        pending.current = true;
        setChecking(true);
        try {
            const imageModels = await fetchSiteImageModels(apiKey);
            if (!active.current) return;
            if (configureSiteConnection({ apiKey, imageModels })) navigate(destination, { replace: true });
        } catch {
            if (active.current) form.setFields([{ name: "apiKey", errors: ["秘钥不正确"] }]);
        } finally {
            pending.current = false;
            if (active.current) setChecking(false);
        }
    };

    return (
        <main className="h-dvh overflow-y-auto bg-background text-foreground">
            <div className="mx-auto flex min-h-full max-w-6xl flex-col px-6 sm:px-10">
                <header className="flex items-center justify-between py-7">
                    <Link to="/login" className="flex items-center gap-2.5 text-foreground">
                        <span className="size-6 bg-current" style={{ mask: "url(/logo.svg) center / contain no-repeat", WebkitMask: "url(/logo.svg) center / contain no-repeat" }} />
                        <span className="text-sm font-medium tracking-wide">无限画布</span>
                    </Link>
                    <AnimatedThemeToggler theme={currentTheme} onThemeChange={setTheme} className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent" aria-label="切换明暗主题" title="切换明暗主题" />
                </header>

                <div className="grid flex-1 items-center gap-12 py-10 md:grid-cols-2 md:gap-20 md:py-20">
                    <section className="order-2 md:order-1">
                        <p className="mb-5 text-xs font-medium tracking-[0.2em] text-muted-foreground">INFINITE CANVAS</p>
                        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">让灵感展开，<br />让作品留在手边。</h1>
                        <p className="mt-6 max-w-md text-base leading-8 text-muted-foreground">在一张无限画布上组织想法、生成图片、迭代创作。使用本站 API Key，即可开始。</p>
                        <div className="mt-9 flex items-center gap-4 text-muted-foreground" aria-hidden="true">
                            <span className="rounded-xl border border-border p-4"><Layers3 className="size-6" /></span>
                            <span className="h-px w-8 bg-border" />
                            <span className="rounded-xl border border-border p-4"><Image className="size-6" /></span>
                            <span className="h-px w-8 bg-border" />
                            <span className="rounded-xl border border-border p-4"><HardDrive className="size-6" /></span>
                        </div>
                        <div className="mt-9 flex max-w-md items-start gap-3 text-sm leading-7 text-muted-foreground">
                            <HardDrive className="mt-1 size-4 shrink-0" />
                            <p>作品、素材、API Key 和配置保存在当前浏览器，生成请求通过本站服务处理。清理浏览器数据前，请先导出作品备份。</p>
                        </div>
                    </section>

                    <section className="order-1 w-full max-w-md justify-self-center rounded-2xl border border-border bg-card p-6 sm:p-9 md:order-2" aria-labelledby="connection-title">
                        <div className="mb-7">
                            <KeyRound className="mb-4 size-6 text-muted-foreground" />
                            <h2 id="connection-title" className="text-2xl font-semibold tracking-tight">连接你的创作空间</h2>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">请输入本站的 API Key，Key 可随时修改。</p>
                        </div>
                        <Form<ConnectionForm>
                            form={form}
                            layout="vertical"
                            disabled={checking}
                            requiredMark={false}
                            initialValues={{ apiKey: selectedChannel?.apiKey || config.apiKey }}
                            onFinish={enterCanvas}
                            onValuesChange={() => form.setFields([{ name: "apiKey", errors: [] }])}
                        >
                            <Form.Item name="apiKey" label="API Key" rules={[{ required: true, whitespace: true, message: "请输入本站的 API Key" }]}>
                                <Input.Password size="large" placeholder="输入本站的 API Key" autoComplete="off" spellCheck={false} />
                            </Form.Item>
                            <Button type="primary" htmlType="submit" size="large" block loading={checking} icon={<ArrowRight className="size-4" />} iconPlacement="end">{checking ? "正在加载模型" : "进入画布"}</Button>
                        </Form>
                        <p className="mt-5 text-xs leading-6" style={{ color: token.colorTextSecondary }}>提交后自动加载名称包含 image 的模型，成功后进入画布。</p>
                        {config.channels.length > 1 ? <p className="mt-2 text-xs leading-6 text-muted-foreground">保存至「{selectedChannel?.name}」渠道，其他渠道可在设置中单独修改。</p> : null}
                    </section>
                </div>

                <footer className="flex flex-wrap justify-between gap-2 border-t border-border py-5 text-xs leading-6 text-muted-foreground">
                    <span>作品保存在本机浏览器 · 建议定期导出备份</span>
                    <a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noopener noreferrer" className="hover:text-foreground">基于 basketikun / infinite-canvas</a>
                </footer>
            </div>
        </main>
    );
}
