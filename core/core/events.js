"use strict";
/**
 * 类型化事件总线。
 * 后端各模块（下载、启动、联机）通过事件向外（API/CLI/UI）广播进度与状态。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventBus = void 0;
class EventBus {
    map = new Map();
    on(event, fn) {
        let set = this.map.get(event);
        if (!set) {
            set = new Set();
            this.map.set(event, set);
        }
        set.add(fn);
        return () => this.off(event, fn);
    }
    once(event, fn) {
        const off = this.on(event, (p) => {
            off();
            fn(p);
        });
        return off;
    }
    off(event, fn) {
        this.map.get(event)?.delete(fn);
    }
    emit(event, payload) {
        const set = this.map.get(event);
        if (!set)
            return;
        for (const fn of [...set]) {
            try {
                fn(payload);
            }
            catch (e) {
                // 单个监听器异常不应中断其他监听器
                console.error("[events] listener error", e);
            }
        }
    }
    removeAll(event) {
        if (event)
            this.map.delete(event);
        else
            this.map.clear();
    }
}
exports.EventBus = EventBus;
//# sourceMappingURL=events.js.map