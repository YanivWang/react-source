/**
 * @file ReactElement 工厂和经典运行时实现
 * @description createElement 经典入口 + jsx/jsxDEV 历史遗留拷贝，均基于同一个 ReactElement 工厂函数
 */

import { checkKeyStringCoercion } from "shared/CheckStringCoercion";
import getComponentNameFromType from "shared/getComponentNameFromType";
import hasOwnProperty from "shared/hasOwnProperty";
import { REACT_ELEMENT_TYPE } from "shared/ReactSymbols";
import type { ElementType, Key, Props, Ref } from "shared/ReactTypes";

import ReactCurrentOwner from "./ReactCurrentOwner";

// 对照官方 packages/react/src/ReactElement.js：
// key/ref/__self/__source 是保留名，不能作为普通 prop 传给组件
const RESERVED_PROPS = {
  key: true,
  ref: true,
  __self: true,
  __source: true,
};

let specialPropKeyWarningShown = false;
let specialPropRefWarningShown = false;
let didWarnAboutStringRefs: Record<string, boolean> = {};
if (__DEV__) {
  didWarnAboutStringRefs = {};
}

/**
 * 检查 config 上是否携带有效的 ref
 * @param config - 传入 createElement/jsx 的第二个参数
 * @returns config.ref 是否为有效值（排除警告 getter 的情况）
 */
function hasValidRef(config: any): boolean {
  if (__DEV__) {
    if (hasOwnProperty.call(config, "ref")) {
      const getter = Object.getOwnPropertyDescriptor(config, "ref")?.get;
      if (getter && (getter as any).isReactWarning) {
        return false;
      }
    }
  }
  return config.ref !== undefined;
}

/**
 * 检查 config 上是否携带有效的 key
 * @param config - 传入 createElement/jsx 的第二个参数
 * @returns config.key 是否为有效值（排除警告 getter 的情况）
 */
function hasValidKey(config: any): boolean {
  if (__DEV__) {
    if (hasOwnProperty.call(config, "key")) {
      const getter = Object.getOwnPropertyDescriptor(config, "key")?.get;
      if (getter && (getter as any).isReactWarning) {
        return false;
      }
    }
  }
  return config.key !== undefined;
}

// 对照官方：DEV 下用字符串 ref 时，如果 `this`（config.__self）和当前 owner 的 stateNode
// 不一致，说明这个字符串 ref 没法被自动转换成箭头函数形式，提前警告让用户手动改用 useRef/createRef
/**
 * DEV 下检查字符串 ref 能否被自动转换，不能则输出警告
 * @param config - 传入 createElement 的第二个参数（携带 __self）
 */
function warnIfStringRefCannotBeAutoConverted(config: any): void {
  if (__DEV__) {
    if (
      typeof config.ref === "string" &&
      ReactCurrentOwner.current &&
      config.__self &&
      ReactCurrentOwner.current.stateNode !== config.__self
    ) {
      const componentName = getComponentNameFromType(
        ReactCurrentOwner.current.type,
      );

      if (!didWarnAboutStringRefs[componentName as string]) {
        console.error(
          'Component "%s" contains the string ref "%s". ' +
            "Support for string refs will be removed in a future major release. " +
            "This case cannot be automatically converted to an arrow function. " +
            "We ask you to manually fix this case by using useRef() or createRef() instead.",
          componentName,
          config.ref,
        );
        didWarnAboutStringRefs[componentName as string] = true;
      }
    }
  }
}

// 对照官方：给 props.key / props.ref 定义一个只会警告的 getter，
// 提醒开发者 key/ref 不是真正的 prop，无法通过 props.key 访问到
/**
 * 给 props.key 定义一个只会警告的 getter，提示 key 不是真正的 prop
 * @param props - 组件的 props 对象
 * @param displayName - 组件显示名称，用于警告信息
 */
function defineKeyPropWarningGetter(props: Props, displayName: string): void {
  if (__DEV__) {
    const warnAboutAccessingKey = function () {
      if (!specialPropKeyWarningShown) {
        specialPropKeyWarningShown = true;
        console.error(
          "%s: `key` is not a prop. Trying to access it will result in `undefined` being returned. " +
            "If you need to access the same value within the child component, you should pass it as a different prop.",
          displayName,
        );
      }
    };
    (warnAboutAccessingKey as any).isReactWarning = true;
    Object.defineProperty(props, "key", {
      get: warnAboutAccessingKey,
      configurable: true,
    });
  }
}

/**
 * 给 props.ref 定义一个只会警告的 getter，提示 ref 不是真正的 prop
 * @param props - 组件的 props 对象
 * @param displayName - 组件显示名称，用于警告信息
 */
function defineRefPropWarningGetter(props: Props, displayName: string): void {
  if (__DEV__) {
    const warnAboutAccessingRef = function () {
      if (!specialPropRefWarningShown) {
        specialPropRefWarningShown = true;
        console.error(
          "%s: `ref` is not a prop. Trying to access it will result in `undefined` being returned. " +
            "If you need to access the same value within the child component, you should pass it as a different prop.",
          displayName,
        );
      }
    };
    (warnAboutAccessingRef as any).isReactWarning = true;
    Object.defineProperty(props, "ref", {
      get: warnAboutAccessingRef,
      configurable: true,
    });
  }
}

export interface ReactElementType {
  $$typeof: symbol;
  type: ElementType;
  key: Key;
  ref: Ref;
  props: Props;
  _owner: any;
  _store?: { validated: boolean };
  _self?: any;
  _source?: any;
  // 本项目标识：用于在控制台区分官方 React 和本项目实现
  __react_source?: string;
}

// 对照官方 ReactElement 工厂函数：不是 class，不能用 new 调用，
// 判断"是不是 React 元素"要看 $$typeof 而非 instanceof。
// self/source 是 DEV 专用的调试信息（记录调用处的 this/文件位置），prod 下不存在这两个字段。
/**
 * ReactElement 工厂函数
 * @param type - 元素类型
 * @param key - 元素 key
 * @param ref - 元素 ref
 * @param self - DEV 专用，调用处的 this
 * @param source - DEV 专用，调用处的文件位置
 * @param owner - 创建该元素时的当前 owner（Fiber）
 * @param props - 元素 props
 * @returns 构造好的 ReactElement 对象
 */
const ReactElement = function (
  type: ElementType,
  key: Key,
  ref: Ref,
  self: any,
  source: any,
  owner: any,
  props: Props,
): ReactElementType {
  const element: ReactElementType = {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key,
    ref,
    props,
    _owner: owner,
  };

  if (__DEV__) {
    // 校验标记（validated）放在外部对象上，这样才能把 element 本身 freeze 掉
    element._store = {} as { validated: boolean };
    Object.defineProperty(element._store, "validated", {
      configurable: false,
      enumerable: false,
      writable: true,
      value: false,
    });
    Object.defineProperty(element, "_self", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: self,
    });
    Object.defineProperty(element, "_source", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: source,
    });
    // 本项目标识：定义为不可枚举，方便在控制台 inspect 时区分官方 React
    Object.defineProperty(element, "__react_source", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: "g-react-source",
    });
    if (Object.freeze) {
      Object.freeze(element.props);
      Object.freeze(element);
    }
  } else {
    // prod 模式下也添加标识，但作为普通属性
    element.__react_source = "g-react-source";
  }

  return element;
};

// 对照官方 packages/react/src/ReactElement.js：这份 jsx()/jsxDEV() 和
// ./jsx/ReactJSXElement.ts 里的是官方源码保留的两份几乎相同的拷贝（automatic runtime
// 落地前的历史遗留，官方也没有清理掉）。真正被 react/jsx-runtime、react/jsx-dev-runtime
// 两个入口使用的是 ./jsx/ReactJSX.ts 分发出去的那一份，这里的 jsx/jsxDEV 不对外导出。
/**
 * jsx() - 历史遗留拷贝，不对外导出，实际对外的 jsx 来自 ./jsx/ReactJSXElement.ts
 * @param type - 元素类型（标签名或组件）
 * @param config - JSX 属性对象（包含 key/ref/props）
 * @param maybeKey - 显式传入的 key（优先级高于 config.key）
 * @returns 构造好的 ReactElement 对象
 */
function jsx(type: ElementType, config: any, maybeKey?: Key): ReactElementType {
  let propName: string;

  const props: Props = {};

  let key: Key = null;
  let ref: Ref = null;

  if (maybeKey !== undefined) {
    if (__DEV__) {
      checkKeyStringCoercion(maybeKey);
    }
    key = "" + maybeKey;
  }

  if (hasValidKey(config)) {
    if (__DEV__) {
      checkKeyStringCoercion(config.key);
    }
    key = "" + config.key;
  }

  if (hasValidRef(config)) {
    ref = config.ref;
  }

  for (propName in config) {
    if (
      hasOwnProperty.call(config, propName) &&
      !RESERVED_PROPS.hasOwnProperty(propName)
    ) {
      props[propName] = config[propName];
    }
  }

  if (type && (type as any).defaultProps) {
    const defaultProps = (type as any).defaultProps;
    for (propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }

  return ReactElement(
    type,
    key,
    ref,
    undefined,
    undefined,
    ReactCurrentOwner.current,
    props,
  );
}

// 对照官方 jsxDEV()：编译器在 DEV 模式下生成的调用会带上 source（文件名/行号，由 babel 插件注入）
// 和 self（调用处的 this），用来做字符串 ref 相关的警告；并且会给 props.key/ref 挂访问警告 getter。
// prod 构建里 __DEV__ 被替换为 false 后，函数体内容会被 terser 当成死代码整体删除。
/**
 * jsxDEV() - 历史遗留拷贝，不对外导出，实际对外的 jsxDEV 来自 ./jsx/ReactJSXElement.ts
 * @param type - 元素类型（标签名或组件）
 * @param config - JSX 属性对象（包含 key/ref/props）
 * @param maybeKey - 显式传入的 key（优先级高于 config.key）
 * @param source - 调用处的文件位置（babel 插件注入）
 * @param self - 调用处的 this
 * @returns 构造好的 ReactElement 对象（prod 构建下此函数体被删除，返回 undefined）
 */
function jsxDEV(
  type: ElementType,
  config: any,
  maybeKey: Key | undefined,
  source: any,
  self: any,
): ReactElementType | undefined {
  if (__DEV__) {
    let propName: string;

    const props: Props = {};

    let key: Key = null;
    let ref: Ref = null;

    if (maybeKey !== undefined) {
      checkKeyStringCoercion(maybeKey);
      key = "" + maybeKey;
    }

    if (hasValidKey(config)) {
      checkKeyStringCoercion(config.key);
      key = "" + config.key;
    }

    if (hasValidRef(config)) {
      ref = config.ref;
      warnIfStringRefCannotBeAutoConverted(config);
    }

    for (propName in config) {
      if (
        hasOwnProperty.call(config, propName) &&
        !RESERVED_PROPS.hasOwnProperty(propName)
      ) {
        props[propName] = config[propName];
      }
    }

    if (type && (type as any).defaultProps) {
      const defaultProps = (type as any).defaultProps;
      for (propName in defaultProps) {
        if (props[propName] === undefined) {
          props[propName] = defaultProps[propName];
        }
      }
    }

    if (key || ref) {
      const displayName =
        typeof type === "function"
          ? type.displayName || type.name || "Unknown"
          : type;
      if (key) {
        defineKeyPropWarningGetter(props, displayName);
      }
      if (ref) {
        defineRefPropWarningGetter(props, displayName);
      }
    }

    return ReactElement(
      type,
      key,
      ref,
      self,
      source,
      ReactCurrentOwner.current,
      props,
    );
  }
}

// 对照官方 createElement()：经典运行时入口，children 通过第三个及之后的参数传入，
// 单个 child 直接赋值，多个 child 收集成数组，都挂到 props.children 上。
// __self/__source 通过 config 上的同名字段传入（由旧版 babel classic 插件注入）。
/**
 * createElement() - React 经典运行时入口
 * @param type - 元素类型（标签名或组件）
 * @param config - 属性对象（包含 key/ref/props，可为 null）
 * @param children - 子元素列表，通过第三个及之后的参数传入
 * @returns 构造好的 ReactElement 对象
 */
export function createElement(
  type: ElementType,
  config: any,
  ...children: any[]
): ReactElementType {
  let propName: string;

  const props: Props = {};

  let key: Key = null;
  let ref: Ref = null;
  let self: any = null;
  let source: any = null;

  if (config != null) {
    if (hasValidRef(config)) {
      ref = config.ref;
      if (__DEV__) {
        warnIfStringRefCannotBeAutoConverted(config);
      }
    }
    if (hasValidKey(config)) {
      if (__DEV__) {
        checkKeyStringCoercion(config.key);
      }
      key = "" + config.key;
    }

    self = config.__self === undefined ? null : config.__self;
    source = config.__source === undefined ? null : config.__source;

    for (propName in config) {
      if (
        hasOwnProperty.call(config, propName) &&
        !RESERVED_PROPS.hasOwnProperty(propName)
      ) {
        props[propName] = config[propName];
      }
    }
  }

  const childrenLength = children.length;
  if (childrenLength === 1) {
    props.children = children[0];
  } else if (childrenLength > 1) {
    props.children = children;
  }

  if (type && (type as any).defaultProps) {
    const defaultProps = (type as any).defaultProps;
    for (propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName];
      }
    }
  }

  if (__DEV__) {
    if (key || ref) {
      const displayName =
        typeof type === "function"
          ? type.displayName || type.name || "Unknown"
          : type;
      if (key) {
        defineKeyPropWarningGetter(props, displayName);
      }
      if (ref) {
        defineRefPropWarningGetter(props, displayName);
      }
    }
  }

  return ReactElement(
    type,
    key,
    ref,
    self,
    source,
    ReactCurrentOwner.current,
    props,
  );
}

// 对照官方 isValidElement()：只看 $$typeof，不用 instanceof
/**
 * 判断一个对象是否为合法的 React 元素
 * @param object - 待判断的对象
 * @returns 是否为 React 元素（通过 $$typeof 判断，而非 instanceof）
 */
export function isValidElement(object: any): boolean {
  return (
    typeof object === "object" &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE
  );
}

// 历史遗留拷贝留在本文件供对照，不加入 react 包入口。
void jsx;
void jsxDEV;
