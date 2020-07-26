import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>() // 依赖收集的核心数据结构 1.WeakMap只接受对象作为键名（null除外），不接受其他类型的值作为键名 2.WeakMap的键名所指向的对象，不计入垃圾回收机制

export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  id: number
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

const effectStack: ReactiveEffect[] = [] // 存储effect包装函数的栈
let activeEffect: ReactiveEffect | undefined // 当前effect包装函数

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '') // 唯一字符串标识 Symbol(iterate)
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '') // 唯一字符串标识 Symbol(Map key iterate)

export function isEffect(fn: any): fn is ReactiveEffect {
  // 判断fn是否是effect包装函数
  return fn && fn._isEffect === true // fn有值且_isEffect属性值为true 则为effect包装函数
}

export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    // 如果fn是effect包装函数
    fn = fn.raw // 拿到原始fn函数
  }
  const effect = createReactiveEffect(fn, options) // 创建effect包装函数
  if (!options.lazy) {
    // lazy默认false
    effect() // 默认立即执行effect函数
  }
  return effect // 返回effect包装函数
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    // 如果可用
    cleanup(effect) // 清空effect.deps
    if (effect.options.onStop) {
      // 如果有onStop函数
      effect.options.onStop() // 则执行onStop钩子函数
    }
    effect.active = false // 置为失活
  }
}

let uid = 0 // 唯一标识

function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    // 定义一个函数表达式
    if (!effect.active) {
      // active 默认为true
      return options.scheduler ? undefined : fn() // ? computed实现会用到 active和scheduler属性
    }
    if (!effectStack.includes(effect)) {
      // 如果 effectStack不包含 effect包装函数 则
      cleanup(effect) // ? 遍历effect.deps数组吗, 成员Set实例删除effect, 然后把 deps重置为空数组
      try {
        enableTracking() // 启用跟踪
        effectStack.push(effect) // 把effect包装函数放入effectStack堆栈中
        activeEffect = effect // 把effect包装函数赋值给activeEffect变量
        return fn() // 执行原始fn函数
      } finally {
        effectStack.pop() // 从effectStack堆栈中删除最后一个effect包装函数
        resetTracking() // 重置跟踪
        activeEffect = effectStack[effectStack.length - 1] // 恢复到上一次的activeEffect值
      }
    }
  } as ReactiveEffect
  effect.id = uid++ // id属性 uid自增 唯一标识
  effect._isEffect = true // _isEffect属性 用来判断是否是effect包装函数
  effect.active = true // active属性 effect包装函数是否可用
  effect.raw = fn // raw属性 存储原始函数也就是第一个函数参数
  effect.deps = [] // 用来收集Set实例,Set实例中存储effect包装函数
  effect.options = options // options属性 第二行参数 ReactiveEffectOptions
  return effect // 返回effect包装函数
}

function cleanup(effect: ReactiveEffect) {
  // 清空收集的effect包装函数
  const { deps } = effect // 拿到deps数组
  if (deps.length) {
    // 如果deps的长度大于0
    for (let i = 0; i < deps.length; i++) {
      // 从下标0开始遍历
      deps[i].delete(effect) // deps[i]为Set实例,从set中删除effect
    }
    deps.length = 0 // 重置 effect.deps为空数组
  }
}

let shouldTrack = true // 默认应该跟踪
const trackStack: boolean[] = [] // 存放跟踪值的栈

export function pauseTracking() {
  // 暂停追踪
  trackStack.push(shouldTrack) // 放入堆栈
  shouldTrack = false // shouldTrack置为false
}

export function enableTracking() {
  // 启用跟踪
  trackStack.push(shouldTrack) // 放入堆栈
  shouldTrack = true // shouldTrack置为true
}

export function resetTracking() {
  // 重置跟踪
  const last = trackStack.pop() // 删除最后一个shouldTrack值且拿到这个值
  shouldTrack = last === undefined ? true : last // 给shouldTrack重新赋值,为了恢复到上一次的状态
}

export function track(target: object, type: TrackOpTypes, key: unknown) {
  // 收集依赖
  if (!shouldTrack || activeEffect === undefined) {
    // 不应该观察 或者 当前未执行effect函数, activeEffect为undefined
    return // 不做依赖收集
  }
  let depsMap = targetMap.get(target) // 获取map实例值
  if (!depsMap) {
    // 如果没有的话
    targetMap.set(target, (depsMap = new Map())) // 给targetMap添加key为target,值为map实例
  }
  let dep = depsMap.get(key) // 从map实例中获取key对应的Set实例
  if (!dep) {
    // 如果没有的话
    depsMap.set(key, (dep = new Set())) // 给map实例添加key为key,值为set实例
  }
  if (!dep.has(activeEffect)) {
    // 如果set实例没有activeEffect 当前effect包装函数的话
    dep.add(activeEffect) // 把activeEffect添加进去
    activeEffect.deps.push(dep) // 当前effect包装函数的deps数组中添加dep set实例
    if (__DEV__ && activeEffect.options.onTrack) {
      // 如果当前effect包装函数的options属性含有onTrack函数
      activeEffect.options.onTrack({
        // 则触发 onTrack钩子函数
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 触发更新
  const depsMap = targetMap.get(target) // 获取到对应的map实例
  if (!depsMap) {
    // 没有的话说明从来没有被收集过
    // never been tracked
    return // 不做触发更新
  }

  const effects = new Set<ReactiveEffect>() // 定义一个effects变量,为了存储需要更新的effect包装函数
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    // effectsToAdd 参数是 Set实例 dep
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => {
        // 遍历set实例 effect为包装函数
        if (effect !== activeEffect || !shouldTrack) {
          // effect不等于当前的effect包装函数 或者shouldTrack为假值时 则
          effects.add(effect) // effect添加到effects中
        } else {
          // the effect mutated its own dependency during its execution.
          // this can be caused by operations like foo.value++
          // do not trigger or we end in an infinite loop
        }
      })
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // type === clear
    // collection being cleared
    // trigger all effects for target
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // key为length且target是数组
    depsMap.forEach((dep, key) => {
      if (key === 'length' || key >= (newValue as number)) { // effect.spec: should observe iteration /effect.spec: should observe sparse array mutations /effect.spec: should trigger all effects when array length is set 0 
        add(dep)
      }
    })
  } else {
    // schedule runs for SET | ADD | DELETE
    if (key !== void 0) {
      // key不等于undefined时
      add(depsMap.get(key)) // depsMap.get(key) 为 set实例(dep)
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target)) // type是'add' 或者 type是'delete'且target不是数组
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      // isAddOrDelete为true 或者 type是'set'且target是Map实例 时
      add(depsMap.get(isArray(target) ? 'length' : ITERATE_KEY)) // ?
    }
    if (isAddOrDelete && target instanceof Map) {
      // isAddOrDelete为true 并且 target是Map实例 时
      add(depsMap.get(MAP_KEY_ITERATE_KEY)) // ?
    }
  }

  const run = (effect: ReactiveEffect) => {
    if (__DEV__ && effect.options.onTrigger) {
      // 如果effect.options有onTrigger属性且是函数 则
      effect.options.onTrigger({
        // 调用 onTrigger 钩子函数
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    if (effect.options.scheduler) {
      // 如果effect.options有scheduler属性且是函数 则
      effect.options.scheduler(effect) // // 调用 scheduler函数
    } else {
      // 否则
      effect() // 执行effect包装函数
    }
  }

  effects.forEach(run) // 遍历需要更新的effect包装函数
}
