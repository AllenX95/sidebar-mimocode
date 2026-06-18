import { setIcon } from 'obsidian';

import type { TodoItem } from '../../../core/tools/todo';

export function getTodoStatusIcon(status: TodoItem['status']): string {
  return status === 'completed' ? 'check' : 'dot';
}

export function getTodoDisplayText(todo: TodoItem): string {
  return todo.status === 'in_progress' ? todo.activeForm : todo.content;
}

export function renderTodoItems(
  container: HTMLElement,
  todos: TodoItem[]
): void {
  container.empty();

  for (const todo of todos) {
    const item = container.createDiv({ cls: `sidebar-mimocode-todo-item sidebar-mimocode-todo-${todo.status}` });

    const icon = item.createSpan({ cls: 'sidebar-mimocode-todo-status-icon' });
    icon.setAttribute('aria-hidden', 'true');
    setIcon(icon, getTodoStatusIcon(todo.status));

    const text = item.createSpan({ cls: 'sidebar-mimocode-todo-text' });
    text.setText(getTodoDisplayText(todo));
  }
}
