window.V = (function() {
	const {
		reactive,
		effect,
		readonly,
		computed
	} = VueReactivity

	const isSymbol = val => typeof val === 'symbol'

	const noop = () => {}

	const callHook = (vm, hook) => {
		const handlers = vm['options'][hook]
		if (Array.isArray(handlers)) {
			handlers.forEach(f => f.call(this))
		} else if (typeof handlers === 'function') {
			handlers.call(vm)
		}
	}

	const $ = el => {
		if (typeof el === 'string') {
			var selected = document.querySelector(el)
			if (!selected) {
				return document.createElement('div')
			}
			return selected
		} else {
			return el
		}
	}

	let padding = false
	const nextTick = function(fn) {
		return Promise.resolve().then(() => {
			return fn && fn()
		})
	}

	function V(options) {
		this.options = options
		this.vm = new Vue({})

		this.proxyV = null
		this.$data = this.$methods = this.$props = this._props = this.$computed = {}
		this._isMounted = false
		this._init(options)
		return this.proxyV
	}

	Object.assign(V.prototype, {
		_init(options) {
			let value
			callHook(this, 'beforeCreate')
			if ((value = options.data)) this._initData(value)
			if ((value = options.props)) this._initProps(value)
			this._proxy()
			if ((value = options.computed)) this._initComputed(value)
			if ((value = options.methods))
				this._initMethods(this.vm._renderProxy, this.proxyV, value)
			callHook(this, 'created')
		},
		_initMethods(vm, bindThis, methods) {
			this.$methods = methods
			for (let key in methods) {
				this[key] = vm[key] =
					methods[key] == null ? noop : methods[key].bind(bindThis)
			}
		},
		_initData(data) {
			this.$data = reactive(typeof data === 'function' ? data() : data || {})
		},
		_initProps(props) {
			Object.keys(props)
				.map(key => {
					const value = props[key]
					if (typeof value === 'object') {
						this._props[key] = value['default']
					}
				})
			this.$props = readonly(this._props)
		},
		_initComputed(computedConfig) {
			Object.keys(computedConfig)
				.map(key => {
					const value = computedConfig[key].bind(this.proxyV)
					if (!Reflect.has(this.$computed, key)) {
                        this[key] = this.$computed[key] = computed(value)
					} else {
						console.error(`computed key:${key} already exists!`)
					}
				})
		},
		_proxy() {
			const data = this.$data
			const props = this.$props

			const has = (target, key) => {
				return Reflect.has(target, key, target)
			}

			const handlers = {
				has(target, key) {
					const result = Reflect.has(target, key)
					if (
						!isSymbol(key) &&
						!target[key] &&
						(has(data, key) || has(props, key))
					) {
						return true
					}
					return result
				},
				get(target, key, receiver) {
					if (!isSymbol(key) && !target[key] && has(data, key)) {
						return data[key]
					}
					if (!isSymbol(key) && !target[key] && has(props, key)) {
						return props[key]
					}
					return Reflect.get(target, key, receiver)
				},
				set(target, key, value, receiver) {
					if (!isSymbol(key) && !target[key] && has(data, key)) {
						return (data[key] = value)
					}
					if (!isSymbol(key) && !target[key] && has(props, key)) {
						return (data[key] = value)
					}
					return Reflect.set(target, key, value, receiver)
				}
			}
			this.vm._renderProxy = new Proxy(this.vm, handlers)
			this.proxyV = new Proxy(this, handlers)
		},
		_mountComponent(el) {
			const vm = this.vm
			vm.$el = el

			const updateComponent = () => {
				const isMounted = this._isMounted
				const VNode = vm._render()

				if (!isMounted) {
					vm._update(VNode, false)
				} else {
					if (!padding) {
						padding = true
						nextTick(() => {
							callHook(this, 'beforeUpdate')
							vm._update(vm._render(), false)
							callHook(this, 'updated')
							padding = false
						})
					}
					// bug代码
					// callHook(this, 'beforeUpdate')
					// vm._update(VNode, false)
					// callHook(this, 'updated')
				}
			}

			effect(updateComponent)
		},
		$mount(el) {
			el = $(el)
			const options = this.options,
				vm = this.vm
			const render = options.render,
				template = options.template
			if (!render && template) {
				const {
					render,
					staticRenderFns
				} = Vue.compile(template)
				vm.$options.render = render
				vm.$options.staticRenderFns = staticRenderFns
			} else {
				vm.$options.render = render
			}
			callHook(this, 'beforeMount')
			this._mountComponent(el)
			callHook(this, 'mounted')
			this._isMounted = true
			return this.proxyV
		}
	})

	return V
})()