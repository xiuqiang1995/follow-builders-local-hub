import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Free models on OpenRouter used as ordered fallback candidates.
// Primary model is set per content-type in config.json; these kick in when it fails.
// openrouter/free may route concurrent requests to the same provider (e.g. Google AI Studio),
// causing shared rate limits to trip. Fallbacks use different providers.
// Excluded reasoning-only models (stepfun/step-3.5-flash, nvidia/nemotron-nano-9b-v2,
// z-ai/glm-4.5-air) — they consume all tokens for thinking and return null content.
const DEFAULT_OPENROUTER_FALLBACK_MODELS: string[] = [];

export type OpenAIConnectionConfig = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  wireApi: 'responses' | 'chat';
  fallbackModels: string[];
};

function extractTomlString(content: string, key: string, section?: string) {
  const scopedContent = section
    ? (() => {
        const match = content.match(new RegExp(`\\[${section.replace('.', '\\.')}]([\\s\\S]*?)(\\n\\[|$)`));
        return match?.[1] ?? '';
      })()
    : content;

  const match = scopedContent.match(new RegExp(`^${key}\\s*=\\s*\"([^\"]+)\"`, 'm'));
  return match?.[1] ?? null;
}

export function loadCaowoFallbackConfig(): OpenAIConnectionConfig | null {
  const apiKey = process.env.CAOWO_API_KEY?.trim();
  const model = process.env.CAOWO_MODEL?.trim();
  if (!apiKey || !model) return null;
  return {
    apiKey,
    baseUrl: 'https://caowo.xin/v1',
    defaultModel: model,
    wireApi: 'chat',
    fallbackModels: []
  };
}

export async function loadOpenAIConnectionConfig(): Promise<OpenAIConnectionConfig> {
  // 1. OpenRouter — checked first
  const openrouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (openrouterApiKey) {
    const fallbackEnv = process.env.OPENROUTER_FALLBACK_MODELS?.trim();
    const fallbackModels = fallbackEnv
      ? fallbackEnv.split(',').map((m) => m.trim()).filter(Boolean)
      : DEFAULT_OPENROUTER_FALLBACK_MODELS;
    return {
      apiKey: openrouterApiKey,
      baseUrl: 'https://openrouter.ai/api',
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL?.trim() || 'openrouter/free',
      wireApi: 'chat',
      fallbackModels
    };
  }

  // 2. Ollama / oMLX local — OLLAMA_MODEL must be set to opt in
  const ollamaModel = process.env.OLLAMA_MODEL?.trim();
  if (ollamaModel) {
    const ollamaHost = process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434';
    // oMLX requires a real API key; Ollama accepts any non-empty string
    const ollamaApiKey = process.env.OPENAI_API_KEY?.trim() || 'ollama';
    return {
      apiKey: ollamaApiKey,
      baseUrl: ollamaHost,
      defaultModel: ollamaModel,
      wireApi: 'chat',
      fallbackModels: []
    };
  }

  // 3. Plain OpenAI-compatible env vars
  const envApiKey = process.env.OPENAI_API_KEY?.trim();
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const envModel = process.env.OPENAI_MODEL?.trim();

  if (envApiKey) {
    return {
      apiKey: envApiKey,
      baseUrl: envBaseUrl || 'https://api.openai.com',
      defaultModel: envModel || 'gpt-5-mini',
      wireApi: 'responses',
      fallbackModels: []
    };
  }

  // 4. ~/.codex config
  const codexDir = process.env.CODEX_CONFIG_DIR?.trim() || resolve(process.env.HOME ?? '~', '.codex');
  const authPath = resolve(codexDir, 'auth.json');
  const configPath = resolve(codexDir, 'config.toml');

  if (!existsSync(authPath) || !existsSync(configPath)) {
    throw new Error(
      '没有找到 OPENROUTER_API_KEY / OPENAI_API_KEY 环境变量，也没有找到可用的 ~/.codex 配置'
    );
  }

  const authRaw = JSON.parse(await readFile(authPath, 'utf-8')) as Record<string, unknown>;
  const apiKey = typeof authRaw.OPENAI_API_KEY === 'string' ? authRaw.OPENAI_API_KEY : '';

  if (!apiKey) {
    throw new Error('~/.codex/auth.json 中没有可用的 OPENAI_API_KEY');
  }

  const toml = await readFile(configPath, 'utf-8');
  const baseUrl =
    extractTomlString(toml, 'base_url', 'model_providers.OpenAI') ?? 'https://api.openai.com';
  const defaultModel = extractTomlString(toml, 'model') ?? 'gpt-5-mini';
  const wireApi = extractTomlString(toml, 'wire_api', 'model_providers.OpenAI') ?? 'responses';

  return {
    apiKey,
    baseUrl,
    defaultModel,
    wireApi: wireApi as 'responses' | 'chat',
    fallbackModels: []
  };
}
