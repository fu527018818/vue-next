import { track, trigger } from './effect'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { isObject, hasChanged } from '@vue/shared'
import { reactive, isProxy, toRaw } from './reactive'
import { CollectionTypes } from './collectionHandlers'

declare const RefSymbol: unique symbol

export interface Ref<T = any> {
  /**
   * Type differentiator only.
   * We need this to be in public d.ts but don't want it to show up in IDE
   * autocomplete, so we use a private Symbol instead.
   */
  [RefSymbol]: true
  value: T
}

export type ToRefs<T = any> = { [K in keyof T]: Ref<T[K]> }

const convert = <T extends unknown>(val: T): T => // 把除了null之外的对象,转换成响应式对象返回
  isObject(val) ? reactive(val) : val

export function isRef<T>(r: Ref<T> | unknown): r is Ref<T>
export function isRef(r: any): r is Ref { // 判断r是否是ref对象
  return r ? r.__v_isRef === true : false // 根据 __v_isRef 属性判断
}

export function ref<T extends object>(
  value: T
): T extends Ref ? T : Ref<UnwrapRef<T>>
export function ref<T>(value: T): Ref<UnwrapRef<T>>
export function ref<T = any>(): Ref<T | undefined>
export function ref(value?: unknown) { // 创建一个ref对象
  return createRef(value)
}

export function shallowRef<T>(value: T): T extends Ref ? T : Ref<T>
export function shallowRef<T = any>(): Ref<T | undefined>
export function shallowRef(value?: unknown) {
  return createRef(value, true)
}

function createRef(rawValue: unknown, shallow = false) {
  if (isRef(rawValue)) { // rawValue是ref对象的话
    return rawValue // 直接返回rawValue
  }
  let value = shallow ? rawValue : convert(rawValue) // 如果shallow是浅的,则把rawValue转成响应式数据
  const r = {
    __v_isRef: true, // ref标识
    get value() { // get
      track(r, TrackOpTypes.GET, 'value') // 收集依赖
      return value // 返回结果值
    },
    set value(newVal) { // set
      if (hasChanged(toRaw(newVal), rawValue)) { // 如果新老值不一样的话
        rawValue = newVal // 把新值赋给rawValue变量
        value = shallow ? newVal : convert(newVal) // 如果shallow是浅的,则把需要设置的值转成响应式数据
        trigger( // 触发更新
          r,
          TriggerOpTypes.SET,
          'value',
          __DEV__ ? { newValue: newVal } : void 0
        )
      }
    }
  }
  return r // 返回ref对象
}

export function triggerRef(ref: Ref) { // 强制shallow类型的ref触发更新  ref.spec: shallowRef force trigger
  trigger(
    ref,
    TriggerOpTypes.SET,
    'value',
    __DEV__ ? { newValue: ref.value } : void 0
  )
}

export function unref<T>(ref: T): T extends Ref<infer V> ? V : T { // 如果是ref对象,则求值,不是的话则直接返回非ref值
  return isRef(ref) ? (ref.value as any) : ref
}

export type CustomRefFactory<T> = (
  track: () => void,
  trigger: () => void
) => {
  get: () => T
  set: (value: T) => void
}

export function customRef<T>(factory: CustomRefFactory<T>): Ref<T> { // 创建一个自定义ref对象 ref.spec: customRef
  const { get, set } = factory( // factory函数返回一个包含get,set属性的对象
    () => track(r, TrackOpTypes.GET, 'value'),
    () => trigger(r, TriggerOpTypes.SET, 'value')
  )
  const r = {
    __v_isRef: true,
    get value() {
      return get() // 执行自定义get函数
    },
    set value(v) {
      set(v) // 执行自定义set函数
    }
  }
  return r as any // 返回ref对象
}

export function toRefs<T extends object>(object: T): ToRefs<T> {
  if (__DEV__ && !isProxy(object)) { // 接收一个响应式对象
    console.warn(`toRefs() expects a reactive object but received a plain one.`) // 普通对象的话，会提示
  }
  const ret: any = {}
  for (const key in object) {
    ret[key] = toRef(object, key) // key: ref对象
  }
  return ret
}

export function toRef<T extends object, K extends keyof T>( // object:一般为响应式对象 key:object的上的key属性
  object: T,
  key: K
): Ref<T[K]> {
  return { // 返回一个ref对象
    __v_isRef: true,
    get value(): any {
      return object[key] // 求值时 触发响应式object对象的get方法去收集依赖
    },
    set value(newVal) {
      object[key] = newVal // 设值时 触发响应式object对象的set方法去触发更新
    }
  } as any
}

// corner case when use narrows type
// Ex. type RelativePath = string & { __brand: unknown }
// RelativePath extends object -> true
type BaseTypes = string | number | boolean

/**
 * This is a special exported interface for other packages to declare
 * additional types that should bail out for ref unwrapping. For example
 * \@vue/runtime-dom can declare it like so in its d.ts:
 *
 * ``` ts
 * declare module '@vue/reactivity' {
 *   export interface RefUnwrapBailTypes {
 *     runtimeDOMBailTypes: Node | Window
 *   }
 * }
 * ```
 *
 * Note that api-extractor somehow refuses to include `declare module`
 * augmentations in its generated d.ts, so we have to manually append them
 * to the final generated d.ts in our build process.
 */
export interface RefUnwrapBailTypes {}

export type UnwrapRef<T> = T extends Ref<infer V>
  ? UnwrapRefSimple<V>
  : UnwrapRefSimple<T>

type UnwrapRefSimple<T> = T extends
  | Function
  | CollectionTypes
  | BaseTypes
  | Ref
  | RefUnwrapBailTypes[keyof RefUnwrapBailTypes]
  ? T
  : T extends Array<any>
    ? { [K in keyof T]: UnwrapRefSimple<T[K]> }
    : T extends object ? UnwrappedObject<T> : T

// Extract all known symbols from an object
// when unwrapping Object the symbols are not `in keyof`, this should cover all the
// known symbols
type SymbolExtract<T> = (T extends { [Symbol.asyncIterator]: infer V }
  ? { [Symbol.asyncIterator]: V }
  : {}) &
  (T extends { [Symbol.hasInstance]: infer V }
    ? { [Symbol.hasInstance]: V }
    : {}) &
  (T extends { [Symbol.isConcatSpreadable]: infer V }
    ? { [Symbol.isConcatSpreadable]: V }
    : {}) &
  (T extends { [Symbol.iterator]: infer V } ? { [Symbol.iterator]: V } : {}) &
  (T extends { [Symbol.match]: infer V } ? { [Symbol.match]: V } : {}) &
  (T extends { [Symbol.matchAll]: infer V } ? { [Symbol.matchAll]: V } : {}) &
  (T extends { [Symbol.replace]: infer V } ? { [Symbol.replace]: V } : {}) &
  (T extends { [Symbol.search]: infer V } ? { [Symbol.search]: V } : {}) &
  (T extends { [Symbol.species]: infer V } ? { [Symbol.species]: V } : {}) &
  (T extends { [Symbol.split]: infer V } ? { [Symbol.split]: V } : {}) &
  (T extends { [Symbol.toPrimitive]: infer V }
    ? { [Symbol.toPrimitive]: V }
    : {}) &
  (T extends { [Symbol.toStringTag]: infer V }
    ? { [Symbol.toStringTag]: V }
    : {}) &
  (T extends { [Symbol.unscopables]: infer V }
    ? { [Symbol.unscopables]: V }
    : {})

type UnwrappedObject<T> = { [P in keyof T]: UnwrapRef<T[P]> } & SymbolExtract<T>
