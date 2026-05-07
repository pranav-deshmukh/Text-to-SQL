import { GoogleGenAI } from '@google/genai';
import type { Message } from './types.ts';

function createGeminiClient(): GoogleGenAI {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  if (project) {
    const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1';
    return new GoogleGenAI({
      vertexai: true,
      project,
      location,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Set GOOGLE_CLOUD_PROJECT for Vertex AI or GEMINI_API_KEY for Gemini API');
  }

  return new GoogleGenAI({ apiKey });
}

export async function callLLM(
  systemPrompt: string,
  messages: Message[] | string,
): Promise<string> {
  const msgArray: Message[] = typeof messages === 'string'
    ? [{ role: 'user', content: messages }]
    : messages;

  const model = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
  console.log(`[LLM] Calling Gemini ${model}...`);

  try {
    const ai = createGeminiClient();
    const response = await ai.models.generateContent({
      model,
      contents: msgArray.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.2,
        // IMPORTANT: Must be 'text/plain' — using 'application/json' causes Gemini to
        // override the system prompt and return JSON instead of raw SQL.
        responseMimeType: 'text/plain',
      },
    });

    const text = response.text?.trim() ?? '';
    return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  } catch (err: any) {
    const status = err?.status ?? err?.code;
    if (status === 429) {
      console.log('[LLM] Gemini rate limited, waiting 15s...');
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return callLLM(systemPrompt, messages);
    }
    throw err;
  }
}
