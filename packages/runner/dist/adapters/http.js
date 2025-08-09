"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpGet = httpGet;
exports.httpPost = httpPost;
let responseMap = null;
function loadMap() {
    if (responseMap)
        return responseMap;
    const fs = require('fs');
    const path = require('path');
    const envPath = process.env.LUMEN_HTTP_MOCK;
    const candidates = [envPath, path.resolve(process.cwd(), 'http-mock.json')].filter(Boolean);
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                const json = JSON.parse(fs.readFileSync(p, 'utf8'));
                responseMap = json;
                return responseMap;
            }
        }
        catch { }
    }
    responseMap = {};
    return responseMap;
}
function httpGet(url) {
    const map = loadMap();
    const key = `GET ${url}`;
    if (key in map)
        return map[key];
    if (url.includes('example.com'))
        return 'MOCK:HTTP:example';
    return `MOCK:HTTP:${url}`;
}
function httpPost(url, body) {
    const map = loadMap();
    const key = `POST ${url}`;
    if (key in map)
        return map[key];
    return `MOCK:HTTP_POST:${url}:${body.length}`;
}
