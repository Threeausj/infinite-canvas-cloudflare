import { Button, Drawer, Input, Segmented, Space, Spin } from "antd";
import { ListPlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchSiteImageModels } from "@/services/api/image";
import { guessCapability, normalizeChannelModels, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };

function imageModels(models: ChannelModel[], names: string[]): ChannelModel[] {
    const existing = new Map(models.map((model) => [model.name, model]));
    return names.map((name) => ({ ...existing.get(name), name, capability: "image" as const }));
}

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [keyError, setKeyError] = useState(false);
    const revision = useRef(0);
    const modelsKey = useRef(channel?.apiKey.trim() || "");
    const fetched = useRef<{ key: string; promise: Promise<string[] | null> } | null>(null);
    const current = useRef({ open, channel, draft });
    current.current = { open, channel, draft };
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        revision.current += 1;
        fetched.current = null;
        modelsKey.current = channel?.apiKey.trim() || "";
        setLoading(false);
        setSaving(false);
        setKeyError(false);
        if (open && channel) setDraft(channel);
        return () => { revision.current += 1; };
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });

    const loadModels = () => {
        const key = current.current.draft?.apiKey.trim() || "";
        if (fetched.current?.key === key) return fetched.current.promise;
        const version = revision.current;
        const source = current.current.channel;
        const isCurrent = () => version === revision.current && current.current.open && current.current.channel === source;
        setLoading(true);
        setKeyError(false);
        const promise = fetchSiteImageModels(key).then((names) => {
            if (!isCurrent()) return null;
            const value = current.current.draft;
            if (value && key !== modelsKey.current) {
                const next = { ...value, models: imageModels(value.models, names) };
                modelsKey.current = key;
                current.current.draft = next;
                setDraft(next);
            }
            return names;
        }).catch(() => {
            if (isCurrent()) {
                setKeyError(true);
                fetched.current = null;
            }
            return null;
        }).finally(() => { if (isCurrent()) setLoading(false); });
        fetched.current = { key, promise };
        return promise;
    };

    const changeKey = (apiKey: string) => {
        revision.current += 1;
        fetched.current = null;
        setLoading(false);
        setSaving(false);
        setKeyError(false);
        patch({ apiKey });
    };

    const close = () => {
        revision.current += 1;
        fetched.current = null;
        setSelectOpen(false);
        setScriptTarget(null);
        onClose();
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: /image/i.test(name) ? "image" : guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = async () => {
        const version = revision.current;
        const source = current.current.channel;
        setSaving(true);
        const names = await loadModels();
        if (version !== revision.current || !current.current.open || current.current.channel !== source) return;
        setSaving(false);
        const value = current.current.draft;
        if (!names || !value) return;
        onSave({ ...value, apiKey: value.apiKey.trim(), name: value.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(value.models) });
        close();
    };

    return (
        <Drawer
            open={open}
            width={640}
            title={t("config.channelEditor.title")}
            onClose={close}
            styles={{ body: { paddingTop: 16 } }}
            extra={
                <Space>
                    <Button onClick={close}>{t("common.cancel")}</Button>
                    <Button type="primary" loading={saving} onClick={() => void save()}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="grid gap-4">
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">{t("config.channelEditor.name")}</span>
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="block">
                    <span className="mb-1 block text-sm font-medium">API Key</span>
                    <Input.Password value={draft.apiKey} onChange={(event) => changeKey(event.target.value)} onBlur={() => { if (draft.apiKey.trim() !== modelsKey.current) void loadModels(); }} status={keyError ? "error" : undefined} placeholder="输入本站的 API Key" autoComplete="off" spellCheck={false} />
                    {loading ? <span className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Spin size="small" />{t("config.channelEditor.loadingImageModels")}</span> : null}
                    {keyError ? <span role="alert" className="mt-2 block text-xs text-destructive">{t("config.modelSelect.invalidKey")}</span> : null}
                </label>
            </div>

            <div className="mt-6 mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                    <div className="text-sm font-semibold">{t("config.channelEditor.models")}</div>
                    <div className="mt-0.5 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                </div>
                <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                    {t("config.channelEditor.selectModels")}
                </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                {draft.models.length ? (
                    draft.models.map((model) => (
                        <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                            <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                {model.name}
                            </span>
                            <div className="flex shrink-0 items-center gap-2">
                                <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                </Button>
                                <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                            </div>
                        </div>
                    ))
                ) : (
                    <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                )}
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />

            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
