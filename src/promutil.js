const http = require('http');
const https = require('https');

module.exports = {
    "sleep": function (millis) {
        return new Promise((resolve) => {
            setTimeout(resolve, millis);
        });
    },
    "head": function (url) {
        const method = {
            method: 'HEAD'
        };
        return new Promise((resolve, reject) => {
            let request = (url.startsWith("https") ? https : http).request;

            request(url, method, (res) => resolve(res))
                .on('error', (err) => reject(err)).end();
        });
    },
    "promiseWhile": async function (condition, action) {
        let wrapper = async function () {
            return action();
        };
        return new Promise((resolve, reject) => {
            let loop = () => {
                if (condition()) return resolve();
                else wrapper().then(loop).catch(reject);
            };
            process.nextTick(loop);
        });
    }
};