import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { useConfigStore } from "@/stores/use-config-store";

export default function UserLayout({ children }: { children: ReactNode }) {
    const location = useLocation();
    const configured = useConfigStore((state) => state.config.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim()));
    if (!configured) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <AgentPanel />
        </div>
    );
}
