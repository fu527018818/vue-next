import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags } from './reactive'

export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T
export type ComputedSetter<T> = (v: T) => void

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T> // getter变量
  let setter: ComputedSetter<T> // setter变量

  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions // 如果getterOrOptions是函数,则赋值给getter变量
    setter = __DEV__ // 不提供setter就赋值默认的函数
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    getter = getterOrOptions.get // 使用提供的get函数
    setter = getterOrOptions.set // 使用提供的set函数
  }

  let dirty = true // 默认脏值 可以求值
  let value: T // 每次计算求得的结果
  let computed: ComputedRef<T> // 被返回的计算对象

  const runner = effect(getter, { // 把我们的getter函数作为触发更新时的回调函数
    lazy: true, // 这里默认不立即执行getter函数,因为计算属性，只有用的时候才会去求值
    scheduler: () => { // 每次派发更新时 执行runner effect这个包装函数时，不会执行getter函数，而是执行scheduler函数
      if (!dirty) { // 当响应式数据变化时,需要把dirty重置为true
        dirty = true
        trigger(computed, TriggerOpTypes.SET, 'value') // 触发自身的trigger computed.spec: should trigger effect / computed.spc: should work when chained
      }
    }
  })
  computed = { // ref对象
    __v_isRef: true, // 标识是一个ref对象
    [ReactiveFlags.IS_READONLY]: // 如果第一个参数是函数 或者 第一个参数是对象且set属性为假值 则computed.__v_isReadonly = true / computed.spec: should be readonly
      isFunction(getterOrOptions) || !getterOrOptions.set,

    // expose effect so computed can be stopped
    effect: runner, // stop(computed.effect) computed.spec: should no longer update when stopped
    get value() {
      if (dirty) { // 脏值得话才可以进行求值
        value = runner() // 执行runner,如果getter函数中有对响应式数据求值，则会收集runner这个effect包装函数
        dirty = false // 求值完置为false,这样再次求值就不会再次执行
      }
      track(computed, TrackOpTypes.GET, 'value') // computed本身就是个响应式数据,所以对他求值，他也需要进行收集其他effect包装函数  computed.spec: should trigger effect / computed.spc: should work when chained
      return value // 返回求得的结果
    },
    set value(newValue: T) {
      setter(newValue) // 执行用户提供的set函数或执行默认提示
    }
  } as any
  return computed
}
