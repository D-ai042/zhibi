/**
 * 跨环境 UUID 生成函数
 *
 * crypto.randomUUID() 在 VS Code 内置浏览器等环境中不可用，
 * 因此提供此 fallback 实现。
 */

export function uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    // fallback: 使用 crypto.getRandomValues 生成 UUID v4
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => {
        const n = Number(c);
        return (
            n ^
            (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (n / 4)))
        ).toString(16);
    });
}
