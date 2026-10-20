/**
 * @file Scheduler 主实现
 * @description 对照官方 packages/scheduler/src/forks/Scheduler.js：unstable_scheduleCallback 注册
 * 任务、unstable_cancelCallback 取消、unstable_shouldYield 让出判断。任务按过期时间放入 taskQueue
 * 最小堆，带 delay 的先用 timerQueue 暂存，到期后 advanceTimers 搬进 taskQueue；宿主通过
 * 同文件的 requestHostCallback 驱动 workLoop（18.3.1 的宿主循环与队列在同一个 fork）。
 */

import { peek, pop, push } from "../SchedulerMinHeap";
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from "../SchedulerPriorities";
// 位运算优先级映射的最大可表示整数（31 位有符号）
const maxSigned31BitInt = 1073741823;

// 各优先级任务的过期时间（相对调度时刻的 ms），值越小越早过期、越优先处理。
// Immediate 为 -1，表示立即过期；Idle 用一个极大值表示几乎永不过期。
const IMMEDIATE_PRIORITY_TIMEOUT = -1;
const USER_BLOCKING_PRIORITY_TIMEOUT = 250;
const NORMAL_PRIORITY_TIMEOUT = 5000;
const LOW_PRIORITY_TIMEOUT = 10000;
const IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// 当前正在执行的任务、当前优先级、是否正在 flush 工作
let currentTask: Task | null = null;
let currentPriorityLevel = NormalPriority;
let isPerformingWork = false;
let isHostCallbackScheduled = false;
let isHostTimeoutScheduled = false;

export interface Task {
  id: number;
  // 对照官方：Scheduler 调用 callback 时会传入 didTimeout（任务是否已过期）；回调返回续跑
  // 函数表示还有剩余工作，返回 null/undefined 表示任务完成。
  callback: ((didTimeout: boolean) => any) | null;
  priorityLevel: number;
  startTime: number;
  expirationTime: number;
  sortIndex: number;
}

interface TaskOptions {
  delay?: number;
}

const taskQueue: Task[] = [];
const timerQueue: Task[] = [];

let taskIdCounter = 1;

// 对照官方：这几个 unstable_* 导出是 scheduler 的公开 API 面
export const unstable_ImmediatePriority = ImmediatePriority;
export const unstable_UserBlockingPriority = UserBlockingPriority;
export const unstable_NormalPriority = NormalPriority;
export const unstable_LowPriority = LowPriority;
export const unstable_IdlePriority = IdlePriority;

export function unstable_now(): number {
  return getCurrentTime();
}

/**
 * 注册一个回调任务，返回 Task 句柄（可用于 unstable_cancelCallback）
 * @param priorityLevel - 优先级（Immediate/UserBlocking/Normal/Low/Idle）
 * @param callback - 返回 continuation 函数继续任务；返回 null/undefined 表示完成
 * @param options - { delay } 延迟调度
 */
export function unstable_scheduleCallback(
  priorityLevel: number,
  callback: ((didTimeout: boolean) => any) | null,
  options?: TaskOptions,
): Task {
  const currentTime = getCurrentTime();

  let startTime: number;
  if (typeof options === "object" && options !== null) {
    const delay = options.delay;
    if (typeof delay === "number" && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  let timeout: number;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }

  const expirationTime = startTime + timeout;

  const newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };

  if (startTime > currentTime) {
    // 延迟任务：先放进 timerQueue（按 startTime 排序），到期后搬进 taskQueue
    newTask.sortIndex = startTime;
    push(timerQueue, newTask);
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // 当前没有立即要跑的任务，且本任务是最早的延迟任务 → 排一个定时器唤醒
      if (isHostTimeoutScheduled) {
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    newTask.sortIndex = expirationTime;
    push(taskQueue, newTask);
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}

/**
 * 取消任务：把 callback 置 null，workLoop 遇到 null callback 的任务会直接跳过
 * @param task - unstable_scheduleCallback 返回的句柄
 */
export function unstable_cancelCallback(task: Task): void {
  task.callback = null;
}

export function unstable_shouldYield(): boolean {
  return shouldYieldToHost();
}

export function unstable_requestPaint(): void {
  requestPaint();
}

export function unstable_forceFrameRate(fps: number): void {
  forceFrameRate(fps);
}

// 把 startTime 已到期的延迟任务从 timerQueue 搬进 taskQueue
function advanceTimers(currentTime: number): void {
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // 已取消的任务直接出队
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
    } else {
      // 剩余的延迟任务都未到期
      return;
    }
    timer = peek(timerQueue);
  }
}

// 定时器回调：把到期的延迟任务搬进 taskQueue 并启动宿主消息循环
function handleTimeout(currentTime: number): void {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);

  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

// 宿主消息循环入口：有可执行任务就执行 workLoop
function flushWork(hasTimeRemaining: boolean, initialTime: number): boolean {
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    return workLoop(hasTimeRemaining, initialTime);
  } finally {
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
  }
}

// 主工作循环：逐个消费 taskQueue 里最早过期的任务，每次处理后检查是否要让出
function workLoop(hasTimeRemaining: boolean, initialTime: number): boolean {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  currentTask = peek(taskQueue);
  while (currentTask !== null) {
    if (currentTask.callback === null) {
      // 已取消的任务跳过
      pop(taskQueue);
    } else if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // 任务未过期且本段预算用完 → 让出主线程，留给下一段
      break;
    } else {
      const callback = currentTask.callback;
      currentTask.callback = null;
      currentPriorityLevel = currentTask.priorityLevel;
      // 对照官方：把「任务是否已过期」作为 didTimeout 传给回调，reconciler 据此决定是否
      // 放弃时间切片、同步跑完防饥饿
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === "function") {
        // 回调返回续跑函数：说明任务还有剩余工作，下一段继续用这个函数跑
        currentTask.callback = continuationCallback;
      } else {
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
      }
      advanceTimers(currentTime);
    }
    currentTask = peek(taskQueue);
  }

  if (currentTask !== null) {
    // 还有工作，但需要让出：告诉宿主还有剩余工作，宿主会再排一段
    return true;
  } else {
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

// React v18.3.1 Scheduler.js 的宿主循环；默认 feature flags 不启用 isInputPending。
const localSetTimeout = setTimeout;
const localClearTimeout = clearTimeout;
const localSetImmediate =
  typeof setImmediate !== "undefined" ? setImmediate : null;
const localPerformance = typeof performance === "object" ? performance : null;
const initialTime = Date.now();
const getCurrentTime =
  localPerformance && typeof localPerformance.now === "function"
    ? () => localPerformance.now()
    : () => Date.now() - initialTime;
let isMessageLoopRunning = false;
let scheduledHostCallback:
  ((hasTimeRemaining: boolean, time: number) => boolean) | null = null;
let taskTimeoutID: ReturnType<typeof setTimeout> | null = null;
let frameInterval = 5;
let startTime = -1;
function shouldYieldToHost(): boolean {
  return getCurrentTime() - startTime >= frameInterval;
}
function requestPaint(): void {
  // 18.3.1 默认 enableIsInputPending=false，每个时间片主动让出。
}
function forceFrameRate(fps: number): void {
  if (fps < 0 || fps > 125) {
    console.error(
      "forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported",
    );
    return;
  }
  frameInterval = fps > 0 ? Math.floor(1000 / fps) : 5;
}
const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime();
    startTime = currentTime;
    let hasMoreWork = true;
    try {
      hasMoreWork = scheduledHostCallback(true, currentTime);
    } finally {
      if (hasMoreWork) schedulePerformWorkUntilDeadline();
      else {
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      }
    }
  } else isMessageLoopRunning = false;
};
let schedulePerformWorkUntilDeadline: () => void;
if (typeof localSetImmediate === "function") {
  schedulePerformWorkUntilDeadline = () => {
    localSetImmediate(performWorkUntilDeadline);
  };
} else if (typeof MessageChannel !== "undefined") {
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;
  schedulePerformWorkUntilDeadline = () => port.postMessage(null);
} else {
  schedulePerformWorkUntilDeadline = () => {
    localSetTimeout(performWorkUntilDeadline, 0);
  };
}
function requestHostCallback(callback: typeof scheduledHostCallback): void {
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    schedulePerformWorkUntilDeadline();
  }
}
function requestHostTimeout(
  callback: (time: number) => void,
  ms: number,
): void {
  taskTimeoutID = localSetTimeout(() => callback(getCurrentTime()), ms);
}
function cancelHostTimeout(): void {
  if (taskTimeoutID !== null) localClearTimeout(taskTimeoutID);
  taskTimeoutID = null;
}
export function unstable_runWithPriority<T>(
  priorityLevel: number,
  eventHandler: () => T,
): T {
  if (
    ![
      ImmediatePriority,
      UserBlockingPriority,
      NormalPriority,
      LowPriority,
      IdlePriority,
    ].includes(priorityLevel)
  )
    priorityLevel = NormalPriority;
  const previous = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;
  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previous;
  }
}
export function unstable_next<T>(eventHandler: () => T): T {
  const previous = currentPriorityLevel;
  currentPriorityLevel = previous <= NormalPriority ? NormalPriority : previous;
  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previous;
  }
}
export function unstable_wrapCallback<T extends (...args: any[]) => any>(
  callback: T,
): T {
  const parentPriority = currentPriorityLevel;
  return function (this: any, ...args: any[]) {
    const previous = currentPriorityLevel;
    currentPriorityLevel = parentPriority;
    try {
      return callback.apply(this, args);
    } finally {
      currentPriorityLevel = previous;
    }
  } as T;
}
export function unstable_getCurrentPriorityLevel(): number {
  return currentPriorityLevel;
}
export function unstable_getFirstCallbackNode(): Task | null {
  return peek(taskQueue);
}
export function unstable_continueExecution(): void {
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}
export function unstable_pauseExecution(): void {}
export const unstable_Profiling = null;
