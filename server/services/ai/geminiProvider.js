import { GoogleGenerativeAI } from '@google/generative-ai';
import { AIProvider, AIProviderError } from './providerInterface.js';

const MODEL = 'gemini-2.5-flash';

export class GeminiProvider extends AIProvider {
  constructor(apiKey) {
    super();
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  startChatSession({ systemPrompt, tools, history }) {
    const model = this.genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: systemPrompt,
      tools,
      generationConfig: { maxOutputTokens: 1500 },
    });

    const geminiHistory = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chatSession = model.startChat({ history: geminiHistory });
    return { chatSession };
  }

  async sendMessage(session, message) {
    try {
      return await session.chatSession.sendMessage(message);
    } catch (err) {
      throw new AIProviderError('Gemini API error', err);
    }
  }

  extractToolCalls(response) {
    return (response.functionCalls() ?? []).map((c) => ({
      callId: c.name,
      name: c.name,
      args: c.args,
    }));
  }

  extractText(response) {
    return response.response.text()?.trim() ?? '';
  }

  buildToolResult({ callId, name, result }) {
    return { functionResponse: { name, response: result } };
  }

  isResponseValid(_response) {
    return true;
  }
}
