'use strict';

// Claude API provider: manual tool-use loop over the Messages API.
// Manual (not the beta tool runner) so every tool call goes through our own runner and the
// safety layer sees every tool result.
const Anthropic = require('@anthropic-ai/sdk').default;
const { SYSTEM_PROMPT } = require('./system-prompt');
const { TOOL_DEFINITIONS } = require('./tools');

const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_STEPS = 6;

/**
 * @param {{ apiKey: string, model?: string, effort?: string, client?: object, logger: object }} options
 */
function createClaudeProvider({ apiKey, model = DEFAULT_MODEL, effort = 'low', client = null, logger }) {
  const anthropic = client || new Anthropic({ apiKey, timeout: 25000, maxRetries: 1 });

  return {
    name: 'claude',
    model,

    /**
     * @param {{ history: Array<{role: 'user'|'assistant', content: string}>, runTool: Function }} args
     * @returns {Promise<{ text: string, toolCalls: Array<{name: string, input: object, result: object}>, failed?: string }>}
     */
    async run({ history, runTool }) {
      const messages = history.map((m) => ({ role: m.role, content: m.content }));
      const toolCalls = [];
      for (let step = 0; step < MAX_STEPS; step++) {
        let response;
        try {
          response = await anthropic.beta.messages.create({
            model,
            max_tokens: 4000,
            // Static system prompt + tools → cached prefix across all customers.
            system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
            tools: TOOL_DEFINITIONS,
            messages,
            output_config: { effort },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
          });
        } catch (err) {
          const kind = err instanceof Anthropic.RateLimitError ? 'rate_limited'
            : err instanceof Anthropic.AuthenticationError ? 'auth'
              : err instanceof Anthropic.APIError ? `api_${err.status || 'error'}`
                : 'network';
          logger.warn('agent.llm_error', { error: kind });
          return { text: '', toolCalls, failed: kind };
        }

        if (response.stop_reason === 'refusal') return { text: '', toolCalls, failed: 'refusal' };
        if (response.stop_reason === 'max_tokens') return { text: '', toolCalls, failed: 'max_tokens' };

        const toolUses = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
          const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          return { text, toolCalls };
        }

        messages.push({ role: 'assistant', content: response.content });
        const results = [];
        for (const tu of toolUses) {
          let result;
          try {
            result = await runTool(tu.name, tu.input);
          } catch {
            result = { error: 'tool_failed' };
          }
          toolCalls.push({ name: tu.name, input: tu.input, result });
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result), ...(result && result.error ? { is_error: true } : {}) });
        }
        // All results of one assistant turn go back in a single user message.
        messages.push({ role: 'user', content: results });
      }
      return { text: '', toolCalls, failed: 'too_many_steps' };
    },
  };
}

module.exports = { createClaudeProvider, DEFAULT_MODEL };
