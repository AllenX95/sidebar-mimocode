import { isWriteEditTool, TOOL_APPLY_PATCH } from '../../../core/tools/toolNames';
import type { ChatMessage, ToolCallInfo } from '../../../core/types';
import {
  getToolName,
  getToolSummary,
  renderToolCall,
  updateToolCallResult,
} from '../rendering/ToolCallRenderer';
import {
  createWriteEditBlock,
  finalizeWriteEditBlock,
  updateWriteEditWithDiff,
} from '../rendering/WriteEditRenderer';
import type { ChatState } from '../state/ChatState';

export interface ToolRenderAdapterDeps {
  state: ChatState;
  shouldExpandFileEditsByDefault: () => boolean;
  scheduleToolOutputRender: (toolId: string, toolCall: ToolCallInfo) => void;
  cancelToolOutputRender: (toolId: string) => void;
}

export class ToolRenderAdapter {
  constructor(private readonly deps: ToolRenderAdapterDeps) {}

  cancelToolOutputRender(toolId: string): void {
    this.deps.cancelToolOutputRender(toolId);
  }

  clearPendingTools(): void {
    this.deps.state.pendingTools.clear();
  }

  finalizeWriteEdit(toolId: string, failed: boolean): void {
    const writeEditState = this.deps.state.writeEditStates.get(toolId);
    if (!writeEditState) return;

    finalizeWriteEditBlock(writeEditState, failed);
  }

  flushPendingTools(): void {
    const { state } = this.deps;
    if (state.pendingTools.size === 0) return;

    for (const toolId of state.pendingTools.keys()) {
      this.renderPendingTool(toolId);
    }

    state.pendingTools.clear();
  }

  renderPendingTool(toolId: string): void {
    const { state } = this.deps;
    const pending = state.pendingTools.get(toolId);
    if (!pending?.parentEl) return;

    const { toolCall, parentEl } = pending;
    if (isWriteEditTool(toolCall.name)) {
      const writeEditState = createWriteEditBlock(parentEl, toolCall, {
        initiallyExpanded: this.deps.shouldExpandFileEditsByDefault(),
      });
      state.writeEditStates.set(toolId, writeEditState);
      state.toolCallElements.set(toolId, writeEditState.wrapperEl);
    } else {
      renderToolCall(parentEl, toolCall, state.toolCallElements, {
        initiallyExpanded: toolCall.name === TOOL_APPLY_PATCH && this.deps.shouldExpandFileEditsByDefault(),
      });
    }

    state.pendingTools.delete(toolId);
  }

  scheduleToolOutputRender(toolId: string, msg: ChatMessage): void {
    const toolCall = this.findToolCall(toolId, msg);
    if (!toolCall) return;

    this.deps.scheduleToolOutputRender(toolId, toolCall);
  }

  updateToolHeader(toolId: string, msg: ChatMessage): void {
    const toolCall = this.findToolCall(toolId, msg);
    if (!toolCall) return;

    const toolEl = this.deps.state.toolCallElements.get(toolId);
    if (!toolEl) return;

    const nameEl = toolEl.querySelector('.sidebar-mimocode-tool-name')
      ?? toolEl.querySelector('.sidebar-mimocode-write-edit-name');
    if (nameEl) {
      nameEl.setText(getToolName(toolCall.name, toolCall.input));
    }

    const summaryEl = toolEl.querySelector('.sidebar-mimocode-tool-summary')
      ?? toolEl.querySelector('.sidebar-mimocode-write-edit-summary');
    if (summaryEl) {
      summaryEl.setText(getToolSummary(toolCall.name, toolCall.input));
    }
  }

  updateToolResult(toolId: string, msg: ChatMessage): void {
    const toolCall = this.findToolCall(toolId, msg);
    if (!toolCall) return;

    updateToolCallResult(toolId, toolCall, this.deps.state.toolCallElements);
  }

  updateWriteEditDiff(toolId: string, msg: ChatMessage): void {
    const toolCall = this.findToolCall(toolId, msg);
    const writeEditState = this.deps.state.writeEditStates.get(toolId);
    if (!toolCall?.diffData || !writeEditState) return;

    updateWriteEditWithDiff(writeEditState, toolCall.diffData);
  }

  private findToolCall(toolId: string, msg: ChatMessage): ToolCallInfo | undefined {
    return msg.toolCalls?.find(tc => tc.id === toolId);
  }
}
