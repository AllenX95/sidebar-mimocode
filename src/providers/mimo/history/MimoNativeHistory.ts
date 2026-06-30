import * as fs from 'node:fs';

import { extractResolvedAnswersFromResultText } from '../../../core/tools/toolInput';
import { isWriteEditTool, TOOL_ASK_USER_QUESTION } from '../../../core/tools/toolNames';
import type { ChatMessage, ContentBlock, Conversation, ToolCallInfo } from '../../../core/types';
import { extractUserQuery } from '../../../utils/context';
import { extractDiffData } from '../../../utils/diff';
import {
  normalizeMimoToolInput,
  normalizeMimoToolName,
  normalizeMimoToolUseResult,
} from '../normalization/mimoToolNormalization';
import { resolveExistingMimoDatabasePath } from '../runtime/MimoPaths';
import { getMimoState, type MimoProviderState } from '../types';
import {
  loadMimoSessionRows,
  type StoredRow,
  type StoredSessionRows,
} from './MimoSqliteReader';

export { MIMO_MESSAGE_ROW_SQL } from './MimoSqliteReader';

export interface MimoStoredMessage {
  info: StoredRow;
  parts: StoredRow[];
}

export interface MimoNativeHistoryRowReader {
  loadSessionRows(databasePath: string, sessionId: string): Promise<StoredSessionRows | null>;
}

export interface MimoNativeHistoryDependencies {
  fileExists?: (filePath: string) => boolean;
  now?: () => number;
  resolveDatabasePath?: (preferredPath?: string | null) => string | null;
  rowReader?: MimoNativeHistoryRowReader;
}

export interface MimoNativeHistoryLoadResult {
  cacheKey: string;
  cacheable: boolean;
  messages: ChatMessage[];
}

interface MimoHydrationDiagnosticContext {
  databasePath?: string;
  sessionId?: string;
}

const MIMO_HYDRATION_DIAGNOSTIC_ID_PREFIX = 'mimo-hydration-error';

export class MimoNativeHistory {
  private readonly fileExists: (filePath: string) => boolean;
  private hydratedKeys = new Map<string, string>();
  private readonly now: () => number;
  private readonly resolveDatabasePath: (preferredPath?: string | null) => string | null;
  private readonly rowReader: MimoNativeHistoryRowReader;

  constructor(dependencies: MimoNativeHistoryDependencies = {}) {
    this.fileExists = dependencies.fileExists ?? fs.existsSync;
    this.now = dependencies.now ?? Date.now;
    this.resolveDatabasePath = dependencies.resolveDatabasePath
      ?? ((preferredPath) => resolveExistingMimoDatabasePath(preferredPath));
    this.rowReader = dependencies.rowReader ?? {
      loadSessionRows: (databasePath, sessionId) => loadMimoSessionRows(databasePath, sessionId),
    };
  }

  async hydrateConversationHistory(conversation: Conversation): Promise<void> {
    const sessionId = conversation.sessionId;
    if (!sessionId) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const state = getMimoState(conversation.providerState);
    const hydrationKey = this.buildHydrationKey(sessionId, state);
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const result = await this.loadSessionMessages(sessionId, state);
    if (result.messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = result.messages;
    if (result.cacheable) {
      this.hydratedKeys.set(conversation.id, result.cacheKey);
    } else {
      this.hydratedKeys.delete(conversation.id);
    }
  }

  async loadSessionMessages(
    sessionId: string,
    providerState?: MimoProviderState,
  ): Promise<MimoNativeHistoryLoadResult> {
    const cacheKey = this.buildHydrationKey(sessionId, providerState);
    const databasePath = this.resolveDatabasePath(providerState?.databasePath);
    if (
      !databasePath
      || databasePath === ':memory:'
      || !this.fileExists(databasePath)
    ) {
      return { cacheKey, cacheable: false, messages: [] };
    }

    const rows = await this.rowReader.loadSessionRows(databasePath, sessionId);
    if (!rows) {
      return {
        cacheKey,
        cacheable: false,
        messages: [createMimoHydrationDiagnosticMessage({
          databasePath,
          now: this.now,
          reason: 'Could not read MiMo-Code session rows from SQLite.',
          sessionId,
        })],
      };
    }

    return {
      cacheKey,
      cacheable: true,
      messages: mapMimoMessages(
        hydrateStoredMessages(rows.messageRows, rows.partRows),
        { databasePath, sessionId },
        { now: this.now },
      ),
    };
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getMimoState(conversation.providerState);
    const providerState: MimoProviderState = {
      ...(state.databasePath ? { databasePath: state.databasePath } : {}),
    };

    return Object.keys(providerState).length > 0
      ? providerState as Record<string, unknown>
      : undefined;
  }

  private buildHydrationKey(
    sessionId: string,
    providerState?: MimoProviderState,
  ): string {
    return `${sessionId}::${providerState?.databasePath ?? ''}`;
  }
}

export async function loadMimoSessionMessages(
  sessionId: string,
  providerState?: MimoProviderState,
): Promise<ChatMessage[]> {
  return (await new MimoNativeHistory().loadSessionMessages(sessionId, providerState)).messages;
}

export function mapMimoMessages(
  messages: MimoStoredMessage[],
  context: MimoHydrationDiagnosticContext = {},
  options: { now?: () => number } = {},
): ChatMessage[] {
  const mappedMessages: ChatMessage[] = [];
  const now = options.now ?? Date.now;

  for (const message of messages) {
    try {
      const mappedMessage = mapStoredMessage(message, context, now);
      if (mappedMessage) {
        mappedMessages.push(mappedMessage);
      }
    } catch (error) {
      mappedMessages.push(createMimoHydrationDiagnosticMessage({
        ...context,
        messageId: getString(message.info.id) ?? undefined,
        now,
        reason: formatUnknownError(error),
      }));
    }
  }

  return mergeAdjacentAssistantMessages(mappedMessages);
}

function hydrateStoredMessages(
  messageRows: StoredRow[],
  partRows: StoredRow[],
): MimoStoredMessage[] {
  const partsByMessage = new Map<string, StoredRow[]>();

  for (const row of partRows) {
    const messageId = getString(row.message_id);
    const id = getString(row.id);
    const data = parseJsonObject(row.data);
    if (!messageId || !id || !data) {
      continue;
    }

    const parts = partsByMessage.get(messageId) ?? [];
    parts.push({ ...data, id });
    partsByMessage.set(messageId, parts);
  }

  return messageRows.flatMap((row) => {
    const id = getString(row.id);
    if (!id) {
      return [];
    }

    const data = parseJsonObject(row.data);
    return [{
      info: data
        ? { ...data, id, time_created: row.time_created }
        : {
            data_time_completed: row.data_time_completed,
            data_time_created: row.data_time_created,
            data_valid: row.data_valid,
            id,
            role: row.role,
            time_created: row.time_created,
          },
      parts: partsByMessage.get(id) ?? [],
    }];
  });
}

function mapStoredMessage(
  message: MimoStoredMessage,
  context: MimoHydrationDiagnosticContext,
  now: () => number,
): ChatMessage | null {
  const role = getString(message.info.role);
  const id = getString(message.info.id);
  if (!id) {
    return null;
  }
  if (isInvalidStoredMessageData(message.info)) {
    return createMimoHydrationDiagnosticMessage({
      ...context,
      messageId: id,
      now,
      reason: 'MiMo-Code message metadata is not valid JSON.',
    });
  }
  if (role !== 'user' && role !== 'assistant') {
    return null;
  }

  const createdAt = getMessageCreatedAt(message.info)
    ?? now();

  if (role === 'user') {
    const promptText = extractUserQuery(getJoinedTextParts(message.parts));
    return {
      assistantMessageId: undefined,
      content: promptText,
      id,
      role: 'user',
      timestamp: createdAt,
      userMessageId: id,
    };
  }

  const contentBlocks = buildAssistantContentBlocks(message.parts);
  const toolCalls = buildAssistantToolCalls(message.parts);
  const completedAt = getMessageCompletedAt(message.info);
  const durationSeconds = completedAt && completedAt >= createdAt
    ? Math.max(0, (completedAt - createdAt) / 1_000)
    : undefined;

  return {
    assistantMessageId: id,
    content: contentBlocks
      .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
      .map((block) => block.content)
      .join(''),
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
    durationSeconds,
    id,
    role: 'assistant',
    timestamp: createdAt,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
}

function mergeAdjacentAssistantMessages(messages: ChatMessage[]): ChatMessage[] {
  const merged: ChatMessage[] = [];

  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (
      message.role === 'assistant'
      && previous?.role === 'assistant'
      && !message.isInterrupt
      && !previous.isInterrupt
      && !isMimoHydrationDiagnosticMessage(message)
      && !isMimoHydrationDiagnosticMessage(previous)
    ) {
      previous.content += message.content;
      previous.assistantMessageId = message.assistantMessageId ?? previous.assistantMessageId;
      previous.durationFlavorWord = message.durationFlavorWord ?? previous.durationFlavorWord;
      previous.durationSeconds = mergeAssistantDurationSeconds(previous, message);
      previous.toolCalls = mergeOptionalArrays(previous.toolCalls, message.toolCalls);
      previous.contentBlocks = mergeOptionalArrays(previous.contentBlocks, message.contentBlocks);
      continue;
    }

    merged.push(message);
  }

  return merged;
}

function mergeOptionalArrays<T>(left?: T[], right?: T[]): T[] | undefined {
  if (!left?.length && !right?.length) {
    return undefined;
  }

  return [
    ...(left ?? []),
    ...(right ?? []),
  ];
}

function mergeAssistantDurationSeconds(
  first: ChatMessage,
  next: ChatMessage,
): number | undefined {
  const firstEnd = getMessageCompletionTime(first);
  const nextEnd = getMessageCompletionTime(next);
  if (firstEnd === null && nextEnd === null) {
    return undefined;
  }

  const end = Math.max(firstEnd ?? first.timestamp, nextEnd ?? next.timestamp);
  return Math.max(0, (end - first.timestamp) / 1_000);
}

function getMessageCompletionTime(message: ChatMessage): number | null {
  if (typeof message.durationSeconds !== 'number') {
    return null;
  }

  return message.timestamp + (message.durationSeconds * 1_000);
}

function getMessageCreatedAt(info: StoredRow): number | null {
  return getNestedNumber(info, ['time', 'created'])
    ?? getNumber(info.data_time_created)
    ?? getNumber(info.time_created);
}

function getMessageCompletedAt(info: StoredRow): number | null {
  return getNestedNumber(info, ['time', 'completed'])
    ?? getNumber(info.data_time_completed);
}

function isInvalidStoredMessageData(info: StoredRow): boolean {
  return getNumber(info.data_valid) === 0;
}

function createMimoHydrationDiagnosticMessage(params: {
  databasePath?: string;
  messageId?: string;
  now: () => number;
  reason: string;
  sessionId?: string;
}): ChatMessage {
  const detailLines = [
    'Failed to hydrate MiMo-Code session.',
    'provider: MiMo-Code',
    ...(params.sessionId ? [`sessionId: ${params.sessionId}`] : []),
    ...(params.databasePath ? [`databasePath: ${params.databasePath}`] : []),
    ...(params.messageId ? [`messageId: ${params.messageId}`] : []),
    `reason: ${params.reason}`,
  ];
  const content = detailLines.join('\n');

  return {
    assistantMessageId: undefined,
    content,
    contentBlocks: [{ content, type: 'text' }],
    id: buildMimoHydrationDiagnosticId(params),
    role: 'assistant',
    timestamp: params.now(),
  };
}

function buildMimoHydrationDiagnosticId(params: {
  messageId?: string;
  sessionId?: string;
}): string {
  const scope = params.messageId ? 'message' : 'session';
  const rawId = params.messageId ?? params.sessionId ?? String(Date.now());
  const safeId = rawId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || String(Date.now());
  return `${MIMO_HYDRATION_DIAGNOSTIC_ID_PREFIX}-${scope}-${safeId}`;
}

export function isMimoSessionHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(`${MIMO_HYDRATION_DIAGNOSTIC_ID_PREFIX}-session-`);
}

function isMimoHydrationDiagnosticMessage(message: ChatMessage): boolean {
  return message.id.startsWith(MIMO_HYDRATION_DIAGNOSTIC_ID_PREFIX);
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildAssistantContentBlocks(parts: StoredRow[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const part of parts) {
    switch (getString(part.type)) {
      case 'reasoning': {
        const text = getString(part.text)?.trim();
        if (!text) {
          break;
        }
        blocks.push({
          content: text,
          durationSeconds: getDurationSeconds(part),
          type: 'thinking',
        });
        break;
      }
      case 'text': {
        const text = getString(part.text);
        if (!text || getBoolean(part.ignored)) {
          break;
        }
        blocks.push({
          content: text,
          type: 'text',
        });
        break;
      }
      case 'tool': {
        const toolId = getString(part.callID);
        if (!toolId) {
          break;
        }
        blocks.push({
          toolId,
          type: 'tool_use',
        });
        break;
      }
    }
  }

  return blocks;
}

function buildAssistantToolCalls(parts: StoredRow[]): ToolCallInfo[] {
  return parts.flatMap((part) => {
    if (getString(part.type) !== 'tool') {
      return [];
    }

    const id = getString(part.callID);
    const rawName = getString(part.tool);
    const state = getObject(part.state);
    const status = mapToolStatus(getString(state?.status));
    if (!id || !rawName || !status) {
      return [];
    }

    const input = normalizeMimoToolInput(rawName, getObject(state?.input) ?? {});
    const name = normalizeMimoToolName(rawName);
    const result = getString(state?.output) ?? getString(state?.error) ?? undefined;
    const toolUseResult = normalizeMimoToolUseResult(rawName, input, {
      ...(result ? { output: result } : {}),
      ...(getObject(state?.metadata) ? { metadata: getObject(state?.metadata) } : {}),
    });

    const toolCall: ToolCallInfo = {
      id,
      input,
      name,
      result,
      status,
    };

    if (name === TOOL_ASK_USER_QUESTION) {
      toolCall.resolvedAnswers = toolUseResult?.answers as ToolCallInfo['resolvedAnswers']
        ?? extractResolvedAnswersFromResultText(result);
    }

    if (status === 'completed' && isWriteEditTool(name)) {
      const diffData = extractDiffData(toolUseResult, toolCall);
      if (diffData) {
        toolCall.diffData = diffData;
      }
    }

    return [toolCall];
  });
}

function getJoinedTextParts(parts: StoredRow[]): string {
  return parts
    .filter((part) => getString(part.type) === 'text' && !getBoolean(part.ignored))
    .map((part) => getString(part.text) ?? '')
    .join('');
}

function getDurationSeconds(part: StoredRow): number | undefined {
  const start = getNestedNumber(part, ['time', 'start']);
  const end = getNestedNumber(part, ['time', 'end']);
  if (start === null || end === null || end < start) {
    return undefined;
  }

  return Math.max(0, (end - start) / 1_000);
}

function mapToolStatus(status: string | null): ToolCallInfo['status'] | null {
  switch (status) {
    case 'pending':
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

function parseJsonObject(value: unknown): StoredRow | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getBoolean(value: unknown): boolean {
  return value === true;
}

function getObject(value: unknown): StoredRow | null {
  return isPlainObject(value) ? value : null;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function getNestedNumber(
  value: StoredRow,
  keys: string[],
): number | null {
  let current: unknown = value;
  for (const key of keys) {
    if (!isPlainObject(current)) {
      return null;
    }
    current = current[key];
  }
  return getNumber(current);
}
