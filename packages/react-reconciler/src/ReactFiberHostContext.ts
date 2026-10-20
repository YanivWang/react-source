// React v18.3.1 ReactFiberHostContext.new.js：根/Portal 与宿主命名空间随 render 栈恢复。
import type { FiberNode } from "./ReactFiber";
import {
  getRootHostContext,
  getChildHostContext,
  type Container,
} from "./ReactFiberHostConfig";
import { createCursor, push, pop } from "./ReactFiberStack";

const NO_CONTEXT = {};
const contextStackCursor = createCursor<any>(NO_CONTEXT);
const contextFiberStackCursor = createCursor<any>(NO_CONTEXT);
const rootInstanceStackCursor = createCursor<any>(NO_CONTEXT);

function requiredContext<T>(context: T): T {
  if (context === NO_CONTEXT)
    throw new Error("Expected host context to exist.");
  return context;
}
export function getRootHostContainer(): Container {
  return requiredContext(rootInstanceStackCursor.current);
}
export function getHostContext(): any {
  return requiredContext(contextStackCursor.current);
}
export function pushHostContainer(
  fiber: FiberNode,
  container: Container,
): void {
  push(rootInstanceStackCursor, container, fiber);
  push(contextFiberStackCursor, fiber, fiber);
  push(contextStackCursor, NO_CONTEXT, fiber);
  const context = getRootHostContext(container);
  pop(contextStackCursor, fiber);
  push(contextStackCursor, context, fiber);
}
export function popHostContainer(fiber: FiberNode): void {
  pop(contextStackCursor, fiber);
  pop(contextFiberStackCursor, fiber);
  pop(rootInstanceStackCursor, fiber);
}
export function pushHostContext(fiber: FiberNode): void {
  const context = getHostContext();
  const nextContext = getChildHostContext(
    context,
    fiber.type,
    getRootHostContainer(),
  );
  if (context === nextContext) return;
  push(contextFiberStackCursor, fiber, fiber);
  push(contextStackCursor, nextContext, fiber);
}
export function popHostContext(fiber: FiberNode): void {
  if (contextFiberStackCursor.current !== fiber) return;
  pop(contextStackCursor, fiber);
  pop(contextFiberStackCursor, fiber);
}
