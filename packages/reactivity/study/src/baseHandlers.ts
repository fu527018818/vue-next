import { reactive, readonly, toRaw, ReactiveFlags } from './reactive'
import { TrackOpTypes, TriggerOpTypes } from './operations'
import { track, trigger, ITERATE_KEY } from './effect'
import {
  isObject,
  hasOwn,
  isSymbol,
  hasChanged,
  isArray,
  extend
} from '@vue/shared'
import { isRef } from './ref'

const builtInSymbols = new Set( 
  Object.getOwnPropertyNames(Symbol) // 拿到Symbol对象所有自身属性的属性名(含不可枚举且属性名不是symbol类型)
    .map(key => (Symbol as any)[key]) // 拿到Symbol对象所有自身属性的属性名对应的属性值
    .filter(isSymbol) // 过滤属性值为非symbol类型的值
)

const get = /*#__PURE__*/ createGetter()
const shallowGet = /*#__PURE__*/ createGetter(false, true)
const readonlyGet = /*#__PURE__*/ createGetter(true)
const shallowReadonlyGet = /*#__PURE__*/ createGetter(true, true)

const arrayInstrumentations: Record<string, Function> = {}
;['includes', 'indexOf', 'lastIndexOf'].forEach(key => {
  arrayInstrumentations[key] = function(...args: any[]): any {
    const arr = toRaw(this) as any
    for (let i = 0, l = (this as any).length; i < l; i++) {
      track(arr, TrackOpTypes.GET, i + '')
    }
    // we run the method using the original args first (which may be reactive)
    const res = arr[key](...args)
    if (res === -1 || res === false) {
      // if that didn't work, run it again using raw values.
      return arr[key](...args.map(toRaw))
    } else {
      return res
    }
  }
})

function createGetter(isReadonly = false, shallow = false) { // 创建get函数
  return function get(target: object, key: string | symbol, receiver: object) { // target: 被代理的原始对象 key: target对象的属性名key receiver: 代理对象
    if (key === ReactiveFlags.IS_REACTIVE) { // key === '__v_isReactive'
      return !isReadonly // isReadonly取反
    } else if (key === ReactiveFlags.IS_READONLY) { // key === '__v_isReadonly'
      return isReadonly // isReadonly
    } else if (
      key === ReactiveFlags.RAW && // key === '__v_raw'
      receiver ===
        (isReadonly
          ? (target as any)[ReactiveFlags.READONLY] // target['__v_readonly']
          : (target as any)[ReactiveFlags.REACTIVE]) // target['__v_reactive']
    ) {
      return target // 返回被代理的原始对象
    }

    const targetIsArray = isArray(target) // target是否是数组
    if (targetIsArray && hasOwn(arrayInstrumentations, key)) { // 如果是数组且key是'includes'|'indexOf'|'lastIndexOf', 则
      return Reflect.get(arrayInstrumentations, key, receiver) // ? 通过数据变异的方法去收集依赖
    }

    const res = Reflect.get(target, key, receiver) // 获取到key对应的值

    if (
      isSymbol(key) // key如果是symbol类型的话
        ? builtInSymbols.has(key) 
        : key === `__proto__` || key === `__v_isRef` // 如果key是内置symbol 或者 key是 __proto__ | __v_isRef的话,直接返回res结果，不做依赖收集
    ) {
      return res
    }

    if (!isReadonly) { // 非只读则收集依赖
      track(target, TrackOpTypes.GET, key)
    }

    if (shallow) { // 如果是浅的，不做依赖收集，直接返回结果
      return res
    }

    if (isRef(res)) { // 如果res是 ref对象
      // ref unwrapping, only for Objects, not for Arrays.
      return targetIsArray ? res : res.value // 触发 ref对象的get方法会进行依赖收集
    }

    if (isObject(res)) { // res如果是对象
      // Convert returned value into a proxy as well. we do the isObject check
      // here to avoid invalid value warning. Also need to lazy access readonly
      // and reactive here to avoid circular dependency.
      return isReadonly ? readonly(res) : reactive(res) // 则转换成代理对象变成响应式数据
    }

    return res // 返回结果值
  }
}

const set = /*#__PURE__*/ createSetter()
const shallowSet = /*#__PURE__*/ createSetter(true)

function createSetter(shallow = false) {
  return function set(
    target: object,
    key: string | symbol,
    value: unknown,
    receiver: object
  ): boolean {
    const oldValue = (target as any)[key] // 获取上一次的值
    if (!shallow) { // 非浅的
      value = toRaw(value) // 把value转换成原始值,比如value是响应式代理数据
      if (!isArray(target) && isRef(oldValue) && !isRef(value)) { // 如果oldValue是ref对象，value不是ref对象
        oldValue.value = value // 则触发oldValue的set方法进行trigger
        return true // 设值成功
      }
    } else {
      // in shallow mode, objects are set as-is regardless of reactive or not
    }

    const hadKey = hasOwn(target, key) // target对象是否含有key属性
    const result = Reflect.set(target, key, value, receiver) // 给target设值
    // don't trigger if target is something up in the prototype chain of original
    if (target === toRaw(receiver)) { // ? effect.spec: should not be triggered by inherited raw setters
      if (!hadKey) { // 没有该key
        trigger(target, TriggerOpTypes.ADD, key, value) // 触发更新
      } else if (hasChanged(value, oldValue)) { // target有改key且值发生了变换
        trigger(target, TriggerOpTypes.SET, key, value, oldValue) // 触发更新
      }
    }
    return result // 返回设置的结果
  }
}

function deleteProperty(target: object, key: string | symbol): boolean {
  const hadKey = hasOwn(target, key) // target是否有key属性
  const oldValue = (target as any)[key] // 获取key对应的值
  const result = Reflect.deleteProperty(target, key) // 删除key
  if (result && hadKey) { // 删除成功且有key
    trigger(target, TriggerOpTypes.DELETE, key, undefined, oldValue) // 触发更新
  }
  return result // 返回删除的结果Boolean
}

function has(target: object, key: string | symbol): boolean { // key in target
  const result = Reflect.has(target, key) // target是否含有key属性
  track(target, TrackOpTypes.HAS, key) // 收集依赖
  return result // 返回结果值
}

function ownKeys(target: object): (string | number | symbol)[] {
  track(target, TrackOpTypes.ITERATE, ITERATE_KEY) // 收集依赖
  return Reflect.ownKeys(target) // Reflect.ownKeys方法用于返回对象的所有属性，基本等同于Object.getOwnPropertyNames与Object.getOwnPropertySymbols之和
}

export const mutableHandlers: ProxyHandler<object> = {
  get,
  set,
  deleteProperty,
  has,
  ownKeys
}

export const readonlyHandlers: ProxyHandler<object> = {
  get: readonlyGet,
  has,
  ownKeys,
  set(target, key) {
    if (__DEV__) {
      console.warn(
        `Set operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  },
  deleteProperty(target, key) {
    if (__DEV__) {
      console.warn(
        `Delete operation on key "${String(key)}" failed: target is readonly.`,
        target
      )
    }
    return true
  }
}

export const shallowReactiveHandlers: ProxyHandler<object> = extend(
  {},
  mutableHandlers,
  {
    get: shallowGet,
    set: shallowSet
  }
)

// Props handlers are special in the sense that it should not unwrap top-level
// refs (in order to allow refs to be explicitly passed down), but should
// retain the reactivity of the normal readonly object.
export const shallowReadonlyHandlers: ProxyHandler<object> = extend(
  {},
  readonlyHandlers,
  {
    get: shallowReadonlyGet
  }
)
