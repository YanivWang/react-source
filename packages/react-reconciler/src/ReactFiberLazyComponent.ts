// React v18.3.1 ReactFiberLazyComponent.new.js。
// lazy/memo 的实际组件直到协调时才确定，必须在这里应用该类型的默认 props。
export function resolveDefaultProps(Component: any, baseProps: any): any {
  if (Component && Component.defaultProps) {
    const props = { ...baseProps };
    const defaultProps = Component.defaultProps;
    for (const propName in defaultProps) {
      if (props[propName] === undefined)
        props[propName] = defaultProps[propName];
    }
    return props;
  }
  return baseProps;
}
