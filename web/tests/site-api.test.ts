import { afterAll, beforeEach, expect, spyOn, test } from "bun:test";
import { createJSONStorage } from "zustand/middleware";
import type { AiConfig } from "../src/stores/use-config-store";

const values = new Map<string, string>();
const memoryStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
};
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: memoryStorage });
Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: memoryStorage } });

const { CONFIG_STORE_KEY, buildApiUrl, defaultConfig, enforceSiteApiConfig, resolveModelRequestConfig, useConfigStore } = await import("../src/stores/use-config-store");
const originalState = useConfigStore.getState();
const originalPersistOptions = useConfigStore.persist.getOptions();
// The store may already be imported by another test file with its own storage.
useConfigStore.persist.setOptions({ storage: createJSONStorage(() => memoryStorage) });

const legacyConfig: AiConfig = {
    ...defaultConfig,
    channelMode: "remote",
    baseUrl: "https://old-primary.example/v1",
    apiKey: "fixture-top-level-key",
    apiFormat: "gemini",
    proxyEnabled: true,
    proxyUrl: "http://127.0.0.1:23210",
    model: "secondary::image-custom",
    imageModel: "secondary::image-custom",
    videoModel: "removed-channel::saved-video",
    textModel: "primary::removed-text-model",
    audioModel: "primary::voice-custom",
    models: ["secondary::image-custom", "removed-channel::saved-video", "primary::removed-text-model", "primary::voice-custom"],
    channels: [
        {
            id: "primary",
            name: "原有主渠道",
            baseUrl: "https://old-primary.example/v1",
            apiKey: "fixture-primary-key",
            apiFormat: "gemini",
            models: [{ name: "voice-custom", capability: "audio" }],
        },
        {
            id: "secondary",
            name: "原有图片渠道",
            baseUrl: "https://old-secondary.example",
            apiKey: "fixture-secondary-key",
            apiFormat: "openai",
            models: [{ name: "image-custom", capability: "image", script: "return http.post('/images/generations', { model, prompt });" }],
        },
    ],
};

function expectFixedRouteAndSavedSelections(config: AiConfig) {
    expect(config.baseUrl).toBe("/api");
    expect(config.apiFormat).toBe("openai");
    expect(config.channelMode).toBe("local");
    expect(config.proxyEnabled).toBe(false);
    expect(config.channels.map((channel) => [channel.id, channel.name, channel.baseUrl, channel.apiFormat, channel.models])).toEqual([
        ["primary", "原有主渠道", "/api", "openai", legacyConfig.channels[0].models],
        ["secondary", "原有图片渠道", "/api", "openai", legacyConfig.channels[1].models],
    ]);
    expect([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel]).toEqual([
        "secondary::image-custom", "secondary::image-custom", "removed-channel::saved-video", "primary::removed-text-model", "primary::voice-custom",
    ]);
    expect(config.models).toEqual(legacyConfig.models);
}

beforeEach(() => {
    values.clear();
    useConfigStore.setState({ ...originalState, config: structuredClone(legacyConfig) });
});

afterAll(() => {
    useConfigStore.setState(originalState);
    useConfigStore.persist.setOptions(originalPersistOptions);
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

test("fixed routing preserves existing keys, channel models, scripts and unavailable selections without mutating input", () => {
    const before = structuredClone(legacyConfig);
    const config = enforceSiteApiConfig(legacyConfig);
    expectFixedRouteAndSavedSelections(config);
    expect(config.apiKey).toBe("fixture-top-level-key");
    expect(config.channels.map((channel) => channel.apiKey)).toEqual(["fixture-primary-key", "fixture-secondary-key"]);
    expect(legacyConfig).toEqual(before);
});

test("rehydration changes old public routes while retaining both keys and every saved model selection", async () => {
    memoryStorage.setItem(CONFIG_STORE_KEY, JSON.stringify({ state: { config: legacyConfig, webdav: originalState.webdav }, version: 0 }));
    await useConfigStore.persist.rehydrate();
    const config = useConfigStore.getState().config;
    expectFixedRouteAndSavedSelections(config);
    expect(config.apiKey).toBe("fixture-top-level-key");
    expect(config.channels.map((channel) => channel.apiKey)).toEqual(["fixture-primary-key", "fixture-secondary-key"]);
    expect(useConfigStore.getState().isAiConfigReady(config, config.videoModel)).toBe(false);
    expect(useConfigStore.getState().isAiConfigReady(config, config.textModel)).toBe(false);
});

test("URL credential imports cannot switch the endpoint or overwrite another channel's key", () => {
    useConfigStore.getState().importChannelCredentials({ baseUrl: "https://replacement.example/v1", apiKey: "fixture-imported-key" });
    const config = useConfigStore.getState().config;
    expectFixedRouteAndSavedSelections(config);
    expect(config.channels.map((channel) => channel.apiKey)).toEqual(["fixture-primary-key", "fixture-imported-key"]);
});

test("key-only entry accepts an unvalidated key locally and changes only the selected channel's key", () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Login must not make network requests"); });
    try {
        expect(useConfigStore.getState().configureSiteConnection({ apiKey: "  arbitrary-nonempty-key  " })).toBe(true);
        const config = useConfigStore.getState().config;
        expectFixedRouteAndSavedSelections(config);
        expect(config.apiKey).toBe("arbitrary-nonempty-key");
        expect(config.channels.map((channel) => channel.apiKey)).toEqual(["fixture-primary-key", "arbitrary-nonempty-key"]);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(JSON.parse(memoryStorage.getItem(CONFIG_STORE_KEY)!).state.config.apiKey).toBe("arbitrary-nonempty-key");
        expect(useConfigStore.getState().configureSiteConnection({ apiKey: "  " })).toBe(false);
        expect(useConfigStore.getState().config).toBe(config);
    } finally {
        fetchSpy.mockRestore();
    }
});

test("editing channels or old connection preferences cannot restore a public route or a local proxy", () => {
    const { updateConfig } = useConfigStore.getState();
    updateConfig("channels", structuredClone(legacyConfig.channels));
    updateConfig("baseUrl", "https://replacement.example/v1");
    updateConfig("apiFormat", "gemini");
    updateConfig("proxyEnabled", true);
    const config = useConfigStore.getState().config;
    expectFixedRouteAndSavedSelections(config);
    expect(config.channels.map((channel) => channel.apiKey)).toEqual(["fixture-primary-key", "fixture-secondary-key"]);
});

test("requests built from an old saved configuration use the same-origin API and the selected channel key", () => {
    const request = resolveModelRequestConfig(legacyConfig, "secondary::image-custom");
    expect(request.baseUrl).toBe("/api");
    expect(request.apiFormat).toBe("openai");
    expect(request.apiKey).toBe("fixture-secondary-key");
    expect(request.model).toBe("image-custom");
    expect(buildApiUrl(legacyConfig.baseUrl, "/models")).toBe("/api/v1/models");
});
