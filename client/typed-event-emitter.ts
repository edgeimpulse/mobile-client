/**
https://github.com/serviejs/events/blob/master/LICENSE

The MIT License (MIT)

Copyright (c) 2019 Blake Embrey (hello@blakeembrey.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

 */
/**
 * Valid event listener args.
 */
export type ValidArgs<T> = T extends any[] ? T : never;

/**
 * Event listener type.
 */
export type EventListener<T, K extends keyof T> = (
  ...args: ValidArgs<T[K]>
) => void;

/**
 * Valid `each` listener args.
 */
export type EachValidArgs<T> = {
  [K in keyof T]: { type: K, args: ValidArgs<T[K]> }
}[keyof T];

/**
 * Wildcard event listener type.
 */
export type EachEventListener<T> = (arg: EachValidArgs<T>) => void;

/**
 * Type-safe event emitter.
 */
export class Emitter<T> {
  _: Array<EachEventListener<T>> = [];
  $: { [K in keyof T]?: Array<EventListener<T, K>> } = Object.create(null);

  on<K extends keyof T>(type: K, callback: EventListener<T, K>) {
    (this.$[type] = this.$[type]! || []).push(callback);
  }

  off<K extends keyof T>(type: K, callback: EventListener<T, K>) {
    const stack = this.$[type];
    if (stack) stack.splice(stack.indexOf(callback) >>> 0, 1);
  }

  each(callback: EachEventListener<T>) {
    this._.push(callback);
  }

  none(callback: EachEventListener<T>) {
    this._.splice(this._.indexOf(callback) >>> 0, 1);
  }

  emit<K extends keyof T>(type: K, ...args: ValidArgs<T[K]>) {
    const stack = this.$[type];
    if (stack) stack.slice().forEach(fn => fn(...args));
    this._.slice().forEach(fn => fn({ type, args }));
  }
}

/**
 * Helper to listen to an event once only.
 */
export function once<T, K extends keyof T>(
  events: Emitter<T>,
  type: K,
  callback: EventListener<T, K>
) {
  function self(...args: ValidArgs<T[K]>) {
    events.off(type, self);
    return callback(...args);
  }
  events.on(type, self);
  return self;
}
