import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

type OpenAIConnectionConfig = {
  apiKey: string;
  baseUrl: string;
  defaultModel: string;
  wireApi: string;
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

export async function loadOpenAIConnectionConfig(): Promise<OpenAIConnectionConfig> {
  const envApiKey = process.env.OPENAI_API_KEY?.trim();
  const envBaseUrl = process.env.OPENAI_BASE_URL?.trim();
  const envModel = process.env.OPENAI_MODEL?.trim();

  if (envApiKey) {
    return {
      apiKey: envApiKey,
      baseUrl: envBaseUrl || 'https://api.openai.com',
      defaultModel: envModel || 'gpt-5-mini',
      wireApi: 'responses'
    };
  }

  const authPath = resolve('/Users/aqiang/.codex/auth.json');
  const configPath = resolve('/Users/aqiang/.codex/config.toml');

  if (!existsSync(authPath) || !existsSync(configPath)) {
    throw new Error('没有找到 OPENAI_API_KEY 环境变量，也没有找到可用的 ~/.codex 配置');
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
    wireApi
  };
}
