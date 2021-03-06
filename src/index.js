'use strict';

var find = require('./lib/find'),
    reject = require('./lib/reject'),
    EventEmitterMixin;

/**
 * Can be used as a mixin when making a class that needs to be an EventEmitter.
 *
 * e.g. `Object.assign(MyClass.prototype, EventEmitterMixin);`
 *
 * Note: if it is necessary to override a listener function's `this` context, always use
 * the optional `context` parameter on the {@link EventEmitterMixin#on} method to do so
 * if you want to remove that specific listener or listener and context combination
 * later. If you are using {@link EventEmitterMixin#once} or never need to remove the
 * event listener, using `listener.bind(context)` instead of the context parameter is
 * acceptable.
 *
 * It is common to override a listener function's `this` context using the `Function`
 * object's `bind` method. For example:
 *
 * ```
 * emitter.on('ready', this.onReady.bind(this));
 * ```
 *
 * However, doing so will make it impossible to remove that listener function without
 * calling `emitter.off('ready')`, which would remove **all** listeners for the `ready`
 * event.
 *
 * This happens because calling `.bind(context)` on a function produces a completely
 * new `Function` instance. When it's time to remove an event listener that was bound
 * to a context using the `bind` function, calling `bind` on the same function will
 * produce a different instance that does not pass an equality check with the
 * previously bound function. For example:
 *
 * ```
 * var fn = function() {},
 *     context = {};
 *
 * fn === fn; // true
 * fn.bind(context) === fn.bind(context); // false
 * ```
 *
 * And so:
 *
 * ```
 * emitter.on('ready', fn.bind(context));
 * emitter.off('ready', fn.bind(context));
 * ```
 *
 * does not remove the event listener that is listening to `'ready'` which results in a
 * memory leak. The correct way is to use the third argument to `on`, which lets you
 * specify the context for the `listener` function:
 *
 * ```
 * emitter.on('ready', fn, context);
 * ```
 *
 * Then, to remove that particular listener, call {@link EventEmitterMixin#off} and pass
 * the same event name, function, and context:
 *
 * ```
 * emitter.off('ready', fn, context);
 * ```
 *
 * @mixin
 */
EventEmitterMixin = {

   /**
    * Create the instance variable that stores registered listeners if it does not
    * already exist.
    * @private
    */
   _ensureListenersHashExists: function() {
      if (!this._eventListeners) {
         this._eventListeners = {};
      }
   },

   /**
    * Register a listener function that will be called every time the specified event is
    * emitted.
    *
    * Calls to `on` will de-duplicate listeners so that the same listener and context
    * combination does not get invoked more than once for the same event. Also, calls
    * to `on` override calls to {@link EventEmitterMixin#once} in that if there is still
    * an event listener and context combination registered from a call to
    * {@link EventEmitterMixin#once} and the same listener and context combination is
    * passed to a call to `on`, that listener and context combination will **not** be
    * removed after the first event.
    *
    * If the `listener` function (or the listener function and its associated `context`)
    * was already registered using {@link EventEmitterMixin#on} or
    * {@link EventEmitterMixin#once}, registering it again with `on` will have the
    * following effect:
    *
    *    * `on`: if it was registered with `on`, nothing happens. There remains one
    *    listener registered for the `eventNames` event(s).
    *    * `once`: if it was registered with `once`, and the `eventName` event has not
    *    been emitted yet, then that listener becomes an `on` listener, is executed each
    *    time that the event is emitted, and is **not** removed after it has been called
    *    once.
    *
    * @param eventNames {string} one or more names of the event(s) your listener will be
    * invoked for, when emitted. Providing a string of space-separated names will bind
    * the provided listener to each of the events listed.
    * @param listener {function} the listener that will be called when this event is
    * emitted
    * @param [context] {object} the object that will be the `this` context for the
    * `listener` function when it is executed. See the documentation on
    * {@link EventEmitterMixin} for an explanation of when and how to use this parameter.
    * @instance
    * @returns {object} `this` for chaining
    */
   on: function(eventNames, listener, context) {
      var eventNamesList;

      if (typeof eventNames !== 'string') {
         throw new Error('the eventNames parameter must be a string, but was: ' + (typeof eventNames));
      }
      if (typeof listener !== 'function') {
         throw new Error('the listener parameter must be a function, but was: ' + (typeof listener));
      }
      eventNamesList = eventNames.split(' ');

      // Remove the event listeners if they already exist. Listeners bound with this `on`
      // function should always override listeners bound with `once`.
      eventNamesList.forEach(function(eventName) {
         this._removeEventListener(eventName, listener, context);
      }.bind(this));

      // Add the event listeners
      eventNamesList.forEach(function(eventName) {
         this._addEventListener(eventName, listener, context);
      }.bind(this));

      return this;
   },

   /**
    * Register a listener function for a single event name.
    *
    * @param eventName {string} the name of the event your listener will be invoked on.
    * @param listener {function} the listener function that is called (sometimes
    * indirectly) when the `eventName` event is emitted. See the `callback` param
    * documentation for an explanation about when `listener` is called directly and when
    * it is called indirectly.
    * @param [context] {object} the object that will be the `this` context for the
    * `listener` function when it is executed
    * @param [callback=`listener`] {function} the function that will be called directly
    * when the `eventName` event is emitted. This allows us to call a different listener
    * function internally (such as the wrapper function that
    * {@link EventEmitterMixin#once} uses to remove itself after executing once) as a
    * wrapper around `listener`.
    * @instance
    * @private
    */
   _addEventListener: function(eventName, listener, context, callback) {
      var existingListener;

      this._ensureListenersHashExists();
      this._eventListeners[eventName] = this._eventListeners[eventName] || [];

      existingListener = this._findEventListener(eventName, listener, context);

      if (!existingListener) {
         // Only add the new listener if one does not already exist
         this._eventListeners[eventName].push({
            callback: (typeof callback === 'function') ? callback : listener,
            listener: listener,
            context: context,
         });
      }
   },

   /**
    * Finds an event listener.
    *
    * @param eventName {string} the name of the event
    * @param listener {function} the listener's function
    * @param [context] {object} the context originally given to the listener when it was
    * registered
    * @instance
    * @private
    * @returns {object} the listener object
    */
   _findEventListener: function(eventName, listener, context) {
      return find(this._eventListeners[eventName], function(eventListener) {
         return eventListener.listener === listener && eventListener.context === context;
      });
   },

   /**
    * Register a listener function that will be called only once. After the listener is
    * invoked for the first time, it will be discarded.
    *
    * If the `listener` function or the `listener` function and context is already
    * registered using either {@link EventEmitterMixin#on} or
    * {@link EventEmitterMixin#once}, this operation essentially has no effect.
    *
    * Unlike the {@link EventEmitterMixin#on} function, this function can only register
    * a listener for one `eventName` at a time. This saves us from a large amount of
    * complexity in the EventEmitter API. For example:
    *
    * ```
    * var listener = function() {};
    *
    * eventEmitter
    *    .once('a b c', listener)
    *    .on('b', listener)
    *    .emit('b');
    * ```
    *
    * Should there be one event listener bound for each of 'a', 'b', and 'c'? Or would
    * `listener` only execute one time for 'a' *or* 'b' *or* 'c'? Further, if the 'b'
    * event is emitted, as shown above, would you expect `listener` to be executed once,
    * or twice? If 'c' is then emitted after 'b', should `listener` be executed again, or
    * was it removed as the result of emitting 'b'? Even a simple example raises many
    * questions with non-obvious answers. Allowing `once` to register only one event
    * listener at a time gives us a more straightforward API that is easy to understand
    * and reason about.
    *
    * If you would like to create a listener that will only execute once across multiple
    * event names, you can do so using the Underscore or Lodash library's `_.once`
    * function. For example:
    *
    * ```
    * var listener = _.once(function() {});
    *
    * eventEmitter
    *    .once('a', listener)
    *    .once('b', listener)
    *    .once('c', listener);
    * ```
    *
    * Then, when either the 'a', 'b', or 'c' events are emitted, the listener function
    * will be invoked once and will not be invoked again for any 'a', 'b', or 'c' events.
    * However, note that if the other two events are not emitted then `listener` remains
    * in memory. In the example above, if 'a' is emitted then the `listener` function
    * remains registered and in-memory for events 'b' and 'c' until both 'b' and 'c'
    * are emitted.
    *
    * @param eventName {string} the name of the event your listener will be invoked on.
    * @param listener {function} the listener that will be called the first time this
    * event is emitted
    * @param [context] {object} the object that will be the `this` context for the
    * `listener` function when it is executed
    * @instance
    * @returns {object} `this` for chaining
    */
   once: function(eventName, listener, context) {
      var self = this,
          oneOffEventListener;

      if (typeof eventName !== 'string') {
         throw new Error('the eventName parameter must be a string, but was: ' + (typeof eventName));
      }
      if (eventName.indexOf(' ') !== -1) {
         throw new Error('The eventName parameter cannot contain the name of more than one event and so it '
            + 'should not contain a space. The eventName parameter was: ' + eventName);
      }
      if (typeof listener !== 'function') {
         throw new Error('the listener parameter must be a function, but was: ' + (typeof listener));
      }

      oneOffEventListener = function() {
         var args = Array.prototype.slice.call(arguments),
             thisEventListener = self._findEventListener(eventName, listener, context);

         // Because listener function invocations are asynchronous, it's possible
         // that an event is emitted multiple times and its listener functions
         // queued up for invocation before any of its listener functions are
         // actually invoked. This means that listeners registered with `once`
         // could be invoked multiple times if the corresponding event is emitted
         // multiple times in the same turn of the browser's event loop. To prevent
         // that, here we check to see if the event listener still exists in the list
         // of registered events before invoking the listener function.
         if (thisEventListener) {
            listener.apply(this, args);
            self._removeEventListener(eventName, listener, context);
         }
      };
      this._addEventListener(eventName, listener, context, oneOffEventListener);
      return this;
   },

   /**
    * Removes event listeners.
    *
    * If this function is called with no parameters, then all event listeners bound to
    * this object will be removed.
    *
    * If only the `eventNames` parameter is provided, then all listeners bound to each
    * name in `eventNames` will be removed.
    *
    * If the `eventNames` and `listener` parameters only are provided, then all listeners
    * for each name in `eventNames` that use the given `listener` function will be
    * removed.
    *
    * If all three `eventNames`, `listener`, and `context` parameters are provided, for
    * each event name in `eventNames`, only the listener registered with that specific
    * event name, `listener` function, and context will be removed.
    *
    * @param [eventNames] {string} the name(s) of one or more events. Providing a string
    * of space-separated names will remove the listeners for each of the events listed.
    * Omitting this parameter will remove all event listeners from this object.
    * @param [listener] {function} the listener that will be removed. If this parameter
    * is not provided, then **all** event listeners listening to each `eventName` will be
    * removed.
    * @param [context] {object} the object that was provided as the `this` context for
    * the `listener` function when the event listener you are removing was registered.
    * See the documentation on {@link EventEmitterMixin} for an explanation of when and
    * how to use this parameter. If this parameter is not provided, then **all** event
    * listeners listening to each `eventName` using the given `listener` function will be
    * removed.
    * @instance
    * @returns {object} `this` for chaining
    */
   off: function(eventNames, listener, context) {
      if (!eventNames) {
         this._eventListeners = {};
         return this;
      }
      eventNames.split(' ').forEach(function(eventName) {
         this._removeEventListener(eventName, listener, context);
      }.bind(this));

      return this;
   },

   /**
    * Removes an event listener for a single event name.
    *
    * If only the `eventName` parameter is provided, then all listeners bound to
    * `eventName` will be removed.
    *
    * If the `eventName` and `listener` parameters only are provided, then all listeners
    * bound to `eventName` that use the given `listener` function will be removed.
    *
    * If all three `eventName`, `listener`, and `context` parameters are provided only
    * the listener registered with that specific event name, `listener` function and
    * context will be removed.
    *
    * @param eventName {string} the name of the event
    * @param [listener] {function} the listener that will be removed. If this parameter
    * is not provided, then **all** event listeners listening to `eventName` will be
    * removed.
    * @param [context] {object} the object that was provided as the `this` context for
    * the `listener` function when the event listener you are removing was registered
    * @instance
    * @private
    */
   _removeEventListener: function(eventName, listener, context) {
      this._ensureListenersHashExists();

      if (!listener) {
         this._eventListeners[eventName] = [];
         return;
      }

      this._eventListeners[eventName] = reject(this._eventListeners[eventName], function(eventListener) {
         return eventListener.listener === listener &&
            ((typeof context === 'undefined') ? true : (eventListener.context === context));
      });
   },


   /**
    * Emits an event to any listeners registered for it.
    *
    * @param eventNames {string} the names of one or more events to emit. Providing a
    * string of space-separated names will emit each of the events listed.
    * @param * {...*} all other arguments will be passed to the event listeners
    * @instance
    * @returns {object} `this` for chaining
    */
   emit: function(eventNames) {
      var args = Array.prototype.slice.apply(arguments),
          eventArgs = args.slice(1);

      if (typeof eventNames !== 'string') {
         throw new Error('the eventNames parameter must be a string, but was: ' + (typeof eventNames));
      }

      eventNames.split(' ').forEach(function(eventName) {
         this._emitEvent(eventName, eventArgs);
      }.bind(this));

      return this;
   },

   /**
    * Emits a single event.
    *
    * @param eventName {string} the name of the event to emit
    * @param eventArgs {array} the arguments / parameters passed to any listeners
    * registered to listen for `eventName` events
    * @instance
    * @private
    */
   _emitEvent: function(eventName, eventArgs) {
      this._ensureListenersHashExists();

      if (!this._eventListeners[eventName]) {
         return;
      }

      this._eventListeners[eventName].forEach(function(listener) {
         // A Promise's `.then` handlers are placed in the microtask queue, which are
         // executed at the end of the current run of the event loop. This effectively
         // makes the initial execution of these event listeners an asynchronous
         // operation.
         Promise.resolve()
            .then(function() {
               listener.callback.apply(listener.context, eventArgs);
            });
      });
   },

};

module.exports = EventEmitterMixin;
