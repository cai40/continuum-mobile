/**
 * Minimal Node `stream.Readable` shim for word-extractor's OLE storage reader.
 *
 * word-extractor/lib/ole-storage-stream.js does `class StorageStream extends Readable`
 * and pushes sectors via `this.push(...)`. The consumer only uses `.on('data')`,
 * `.on('error')`, and `.on('end')`. Metro maps the `stream` bare specifier to this
 * module (see metro.config.js) so the bundle does not need the Node core module.
 */
class Readable {
  constructor() {
    this._dataHandlers = [];
    this._errorHandlers = [];
    this._endHandlers = [];
    this._reading = false;
  }

  on(type, handler) {
    if (type === 'data') {
      this._dataHandlers.push(handler);
      this._scheduleRead();
    } else if (type === 'error') {
      this._errorHandlers.push(handler);
    } else if (type === 'end') {
      this._endHandlers.push(handler);
    }
    return this;
  }

  _scheduleRead() {
    if (this._reading || typeof this._read !== 'function') return;
    this._reading = true;
    Promise.resolve().then(() => {
      this._reading = false;
      this._read();
    });
  }

  push(chunk) {
    if (chunk === null) {
      this._endHandlers.forEach((handler) => handler());
      return false;
    }
    this._dataHandlers.forEach((handler) => handler(chunk));
    this._scheduleRead();
    return true;
  }

  emit(type, ...args) {
    if (type === 'error') {
      this._errorHandlers.forEach((handler) => handler(...args));
    }
    return this;
  }
}

module.exports = { Readable };
