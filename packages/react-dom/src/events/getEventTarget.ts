/**
 * @file 从原生事件取真正的 target
 * @description 对照官方 packages/react-dom/src/events/getEventTarget.js：抹平
 * IE9 的 srcElement 兼容、SVG <use> 元素的 correspondingUseElement 重定向、Safari 可能把
 * target 落在文本节点上的问题（文本节点没有子节点，事件语义上应归属其父元素）。
 */

const TEXT_NODE = 3;

export default function getEventTarget(nativeEvent: Event): EventTarget {
  let target: any =
    (nativeEvent as any).target || (nativeEvent as any).srcElement || window;

  if (target.correspondingUseElement) {
    target = target.correspondingUseElement;
  }

  return target.nodeType === TEXT_NODE ? target.parentNode : target;
}
