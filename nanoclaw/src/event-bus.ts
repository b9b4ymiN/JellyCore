import { EventEmitter } from 'node:events';

export interface ContainerStartEvent {
  containerId: string;
  group: string;
  provider: string;
  prompt: string;
  startedAt: string;
  requestId?: string;
}

export interface ContainerOutputEvent {
  containerId: string;
  chunk: string;
  timestamp: string;
  requestId?: string;
}

export interface ContainerEndEvent {
  containerId: string;
  exitCode: number;
  durationMs: number;
  resultSummary: string;
  requestId?: string;
}

export interface TaskEnqueueEvent {
  taskId: string;
  label: string;
  group: string;
  enqueuedAt: string;
}

export interface TaskStartEvent {
  taskId: string;
  label: string;
  group: string;
  startedAt: string;
}

export interface TaskCompleteEvent {
  taskId: string;
  label: string;
  group: string;
  status: 'success' | 'error';
  durationMs: number;
  summary: string;
  completedAt: string;
}

export interface HeartbeatTickEvent {
  reason: 'scheduled' | 'silence' | 'escalated' | 'manual';
  ok: boolean;
  summary: string;
  timestamp: string;
}

export interface HeartbeatJobStartEvent {
  jobId: string;
  label: string;
  category: string;
  startedAt: string;
}

export interface HeartbeatJobEndEvent {
  jobId: string;
  label: string;
  category: string;
  status: 'ok' | 'error';
  durationMs: number;
  summary: string;
  completedAt: string;
}

export interface HealthChangeEvent {
  status: 'ok' | 'warn' | 'error';
  activeContainers: number;
  queueDepth: number;
  timestamp: string;
}

export type LiveEvent =
  | { type: 'container:start'; data: ContainerStartEvent }
  | { type: 'container:output'; data: ContainerOutputEvent }
  | { type: 'container:end'; data: ContainerEndEvent }
  | { type: 'task:enqueue'; data: TaskEnqueueEvent }
  | { type: 'task:start'; data: TaskStartEvent }
  | { type: 'task:complete'; data: TaskCompleteEvent }
  | { type: 'heartbeat:tick'; data: HeartbeatTickEvent }
  | { type: 'heartbeat:job:start'; data: HeartbeatJobStartEvent }
  | { type: 'heartbeat:job:end'; data: HeartbeatJobEndEvent }
  | { type: 'health:change'; data: HealthChangeEvent };

class EventBus extends EventEmitter {
  emit(event: 'live', payload: LiveEvent): boolean {
    return super.emit(event, payload);
  }

  on(event: 'live', listener: (payload: LiveEvent) => void): this {
    return super.on(event, listener);
  }

  off(event: 'live', listener: (payload: LiveEvent) => void): this {
    return super.off(event, listener);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(50);
