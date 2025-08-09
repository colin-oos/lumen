"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpGet = httpGet;
exports.httpPost = httpPost;
function httpGet(url) {
    // Deterministic mock for specific URLs; otherwise return a generic marker
    if (url.includes('example.com'))
        return 'MOCK:HTTP:example';
    return `MOCK:HTTP:${url}`;
}
function httpPost(url, body) {
    return `MOCK:HTTP_POST:${url}:${body.length}`;
}
