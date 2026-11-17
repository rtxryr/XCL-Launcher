/**
 * 类型化事件总线。
 * 后端各模块（下载、启动、联机）通过事件向外（API/CLI/UI）广播进度与状态。
 */
export type Listener<T> = (payload: T) => void;
export declare class EventBus<Events extends object> {
    private map;
    on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void;
    once<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void;
    off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void;
    emit<K extends keyof Events>(event: K, payload: Events[K]): void;
    removeAll(event?: keyof Events): void;
}
/** 后端全局事件契约：进度、日志、联机、状态。 */
export interface BackendEvents {
    /** 下载/安装进度 */
    progress: {
        phase: string;
        current: number;
        total: number;
        label?: string;
    };
    /** 通用日志透传 */
    log: {
        level: string;
        msg: string;
    };
    /** 游戏进程 stdout/stderr 行 */
    gameOutput: {
        stream: "stdout" | "stderr";
        line: string;
    };
    /** 游戏进程退出 */
    gameExit: {
        code: number | null;
        signal: string | null;
    };
    /** 联机：发现对端 */
    peer: {
        id: string;
        name: string;
        addr: string;
        via: string;
    };
    /** 联机：连接状态 */
    peerStatus: {
        id: string;
        state: "connecting" | "open" | "closed" | "error";
        detail?: string;
    };
    /**
     * 一键开服：服务端控制台日志行。
     *
     * 2026-11-03 补：此前服务端日志被塞进 gameOutput（伪装成客户端游戏日志），
     * 而渲染端订阅的是 server:log，导致「一键开服」终端里看不到任何服务端输出。
     */
    "server:log": {
        id: string;
        line: string;
        level: string;
    };
    /** 一键开服：服务端状态变化（starting / running / stopped / error）。 */
    "server:status": {
        id: string;
        state: string;
        port?: number;
        pid?: number;
        startedAt?: number;
        message?: string;
    };
}
//# sourceMappingURL=events.d.ts.map