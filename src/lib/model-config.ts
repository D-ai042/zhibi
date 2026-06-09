/**
 * 共享模型配置 — 统一 modelToProvider 映射表，避免 3 处重复定义。
 */
export const MODEL_TO_PROVIDER: Record<string, string> = {
    "deepseek-v4-flash": "DeepSeek", "deepseek-v4-pro": "DeepSeek",
    "gpt-5.5": "OpenAI", "gpt-5.4": "OpenAI", "gpt-5.4-mini": "OpenAI",
    "claude-opus-4-8": "Anthropic", "claude-sonnet-4-6": "Anthropic", "claude-haiku-4-5": "Anthropic",
    "qwen-plus": "阿里云", "qwen-max": "阿里云",
    "glm-4-plus": "智谱", "glm-4-flash": "智谱",
    "moonshot-v1-8k": "月之暗面", "moonshot-v1-32k": "月之暗面",
    "baichuan2-53b": "百川智能",
    "yi-34b-chat": "零一万物",
    "Pro/Qwen2.5-7B-Instruct": "硅基流动", "Pro/deepseek-ai/DeepSeek-V3": "硅基流动",
    "mimo-v2.5-pro": "小米", "mimo-v2.5": "小米", "mimo-v2-flash": "小米",
};
