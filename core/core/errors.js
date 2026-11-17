"use strict";
/**
 * FusionMC 核心错误类型。
 * 所有业务错误继承 FusionError，携带 code 便于上层/前端按类型处理。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FusionError = void 0;
exports.isFusionError = isFusionError;
exports.wrapError = wrapError;
class FusionError extends Error {
    code;
    cause;
    /** 便于前端展示的可重试标记 */
    retryable;
    constructor(code, message, opts) {
        super(message);
        this.name = "FusionError";
        this.code = code;
        this.cause = opts?.cause;
        this.retryable = opts?.retryable ?? false;
        Object.setPrototypeOf(this, FusionError.prototype);
    }
    toJSON() {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            retryable: this.retryable,
        };
    }
}
exports.FusionError = FusionError;
function isFusionError(e) {
    return e instanceof FusionError;
}
/** 便捷包装：把任意异常转成 FusionError。 */
function wrapError(code, message, cause, retryable = false) {
    if (isFusionError(cause))
        return cause;
    return new FusionError(code, message, { cause, retryable });
}
//# sourceMappingURL=errors.js.map