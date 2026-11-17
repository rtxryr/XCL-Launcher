/**
 * FusionMC 核心错误类型。
 * 所有业务错误继承 FusionError，携带 code 便于上层/前端按类型处理。
 */
export type ErrorCode = "CONFIG" | "NETWORK" | "DOWNLOAD" | "INTEGRITY" | "MANIFEST" | "VERSION" | "RULES" | "JAVA" | "NATIVES" | "AUTH" | "INSTANCE" | "LAUNCH" | "LOADER" | "MULTIPLAYER" | "IO" | "UNKNOWN";
export declare class FusionError extends Error {
    readonly code: ErrorCode;
    readonly cause?: unknown;
    /** 便于前端展示的可重试标记 */
    readonly retryable: boolean;
    constructor(code: ErrorCode, message: string, opts?: {
        cause?: unknown;
        retryable?: boolean;
    });
    toJSON(): {
        name: string;
        code: ErrorCode;
        message: string;
        retryable: boolean;
    };
}
export declare function isFusionError(e: unknown): e is FusionError;
/** 便捷包装：把任意异常转成 FusionError。 */
export declare function wrapError(code: ErrorCode, message: string, cause?: unknown, retryable?: boolean): FusionError;
//# sourceMappingURL=errors.d.ts.map