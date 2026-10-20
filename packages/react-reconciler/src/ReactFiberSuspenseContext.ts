/** React 18.3.1 SuspenseContext：保留客户端边界所需的可见性上下文。 */
import type { FiberNode } from "./ReactFiber";
import { createCursor, push, pop } from "./ReactFiberStack";
export const InvisibleParentSuspenseContext = 0b01;
export const suspenseStackCursor = createCursor(0);
export function pushSuspenseContext(fiber: FiberNode, context: number): void {
  push(suspenseStackCursor, context & 0b01, fiber);
}
export function popSuspenseContext(fiber: FiberNode): void {
  pop(suspenseStackCursor, fiber);
}
