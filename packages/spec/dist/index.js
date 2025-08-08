"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assert = assert;
function assert(cond, message) {
    if (!cond) {
        const err = { message };
        throw err;
    }
}
