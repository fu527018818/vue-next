import { isObject, toRawType, def, hasOwn, makeMap } from '@vue/shared'
import {
  mutableHandlers,
  readonlyHandlers,
  shallowReactiveHandlers,
  shallowReadonlyHandlers
} from './baseHandlers'
import {
  mutableCollectionHandlers,
  readonlyCollectionHandlers,
  shallowCollectionHandlers
} from './collectionHandlers'
import { UnwrapRef, Ref } from './ref'

export const enum ReactiveFlags {
  SKIP = '__v_skip',
  IS_REACTIVE = '__v_isReactive',
  IS_READONLY = '__v_isReadonly',
  RAW = '__v_raw',
  REACTIVE = '__v_reactive',
  READONLY = '__v_readonly'
}

interface Target {
  [ReactiveFlags.SKIP]?: boolean
  [ReactiveFlags.IS_REACTIVE]?: boolean
  [ReactiveFlags.IS_READONLY]?: boolean
  [ReactiveFlags.RAW]?: any
  [ReactiveFlags.REACTIVE]?: any
  [ReactiveFlags.READONLY]?: any
}

const collectionTypes = new Set<Function>([Set, Map, WeakMap, WeakSet])
const isObservableType = /*#__PURE__*/ makeMap(
  'Object,Array,Map,Set,WeakMap,WeakSet'
)

const canObserve = (value: Target): boolean => {
  return (
    !value[ReactiveFlags.SKIP] && // target如果有__v_skip属性,则不能被观察
    isObservableType(toRawType(value)) && // target只有Object,Array,Map,Set,WeakMap,WeakSet这几个类型才能被观察
    !Object.isFrozen(value) // target如果被冻结了也不能被观察
  )
}

// only unwrap nested ref
type UnwrapNestedRefs<T> = T extends Ref ? T : UnwrapRef<T>

export function reactive<T extends object>(target: T): UnwrapNestedRefs<T>
export function reactive(target: object) {
  // if trying to observe a readonly proxy, return the readonly version.
  if (target && (target as Target)[ReactiveFlags.IS_READONLY]) {
    return target
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are reactive, and does NOT unwrap refs nor recursively convert
// returned properties.
export function shallowReactive<T extends object>(target: T): T {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers
  )
}

type Primitive = string | number | boolean | bigint | symbol | undefined | null
type Builtin = Primitive | Function | Date | Error | RegExp
export type DeepReadonly<T> = T extends Builtin
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends ReadonlyMap<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends WeakMap<infer K, infer V>
        ? WeakMap<DeepReadonly<K>, DeepReadonly<V>>
        : T extends Set<infer U>
          ? ReadonlySet<DeepReadonly<U>>
          : T extends ReadonlySet<infer U>
            ? ReadonlySet<DeepReadonly<U>>
            : T extends WeakSet<infer U>
              ? WeakSet<DeepReadonly<U>>
              : T extends Promise<infer U>
                ? Promise<DeepReadonly<U>>
                : T extends {}
                  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
                  : Readonly<T>

export function readonly<T extends object>(
  target: T
): DeepReadonly<UnwrapNestedRefs<T>> {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers
  )
}

// Return a reactive-copy of the original object, where only the root level
// properties are readonly, and does NOT unwrap refs nor recursively convert
// returned properties.
// This is used for creating the props proxy object for stateful components.
export function shallowReadonly<T extends object>(
  target: T
): Readonly<{ [K in keyof T]: UnwrapNestedRefs<T[K]> }> {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    readonlyCollectionHandlers
  )
}

function createReactiveObject(
  target: Target,
  isReadonly: boolean,
  baseHandlers: ProxyHandler<any>,
  collectionHandlers: ProxyHandler<any>
) {
  if (!isObject(target)) {
    // 判断target是不是 Object,Array,Map,Set,WeakMap,WeakSet 这几种类型
    if (__DEV__) {
      console.warn(`value cannot be made reactive: ${String(target)}`) // 不是的话则提示
    }
    return target
  }
  // target is already a Proxy, return it.
  // exception: calling readonly() on a reactive object
  // spec: observing already observed value should return same Proxy
  // spec: wrapping already wrapped value should return same Proxy
  if (
    target[ReactiveFlags.RAW] &&
    !(isReadonly && target[ReactiveFlags.IS_REACTIVE])
  ) {
    return target
  }
  // target already has corresponding Proxy
  const reactiveFlag = isReadonly
    ? ReactiveFlags.READONLY
    : ReactiveFlags.REACTIVE // 拿到__v_isReactive 或者 __v_isReadonly
  if (hasOwn(target, reactiveFlag)) {
    // 如果被代理过的对象,肯定有reactiveFlag属性
    return target[reactiveFlag] // 则直接返回被代理过后的对象
  }
  // only a whitelist of value types can be observed.
  if (!canObserve(target)) {
    // 如果不在可被观察的白名单中
    return target // 返回原始target
  }
  const observed = new Proxy(
    target,
    collectionTypes.has(target.constructor) ? collectionHandlers : baseHandlers // Object/Array类型使用baseHandlers  Map,Set,WeakMap,WeakSet类型使用collectionHandlers
  )
  def(target, reactiveFlag, observed) // 通过Object.defineProperty给target添加reactiveFlag这个key,value值为被代理的对象observed
  return observed // 返回被代理的对象
}

export function isReactive(value: unknown): boolean {
  // 判断value是否是响应式对象
  if (isReadonly(value)) {
    // 如果是只读响应式对象
    return isReactive((value as Target)[ReactiveFlags.RAW]) // 继续判断是否响应式对象  spec: readonly should track and trigger if wrapping reactive original
  }
  return !!(value && (value as Target)[ReactiveFlags.IS_REACTIVE]) // 非只读响应式对象，判断value的__v_isReactive属性，如果value是被代理对象则会执行相应的get
}

export function isReadonly(value: unknown): boolean {
  // 判断value是否是只读响应式对象
  return !!(value && (value as Target)[ReactiveFlags.IS_READONLY]) // 读取value的__v_isReadonly属性,如果是value是被代理的对象会执行get,如果是普通对象则正常判断
}

export function isProxy(value: unknown): boolean {
  // 判断value是否被代理过
  return isReactive(value) || isReadonly(value) // 如果是响应式数据或者只读响应式数据则是被代理过的
}

export function toRaw<T>(observed: T): T {
  // 根据observed返回原始对象
  return (
    (observed && toRaw((observed as Target)[ReactiveFlags.RAW])) || observed // 如果observed是被代理对象，会执行get，如果找到原始对象则返回原始对象，否则返回observed
  )
}

export function markRaw<T extends object>(value: T): T {
  // 给value添加__v_skip属性，调用reactive或者readonly方法时，该对象则不会被代理
  def(value, ReactiveFlags.SKIP, true) // 通过Object.defineProperty给value添加__v_skip属性,值为true
  return value // 返回加工后的对象
}
