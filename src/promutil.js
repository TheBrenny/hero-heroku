const fetch = require('node-fetch');

module.exports = {
    "sleep": function (millis, ret) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(ret), millis);
        });
    },
    "head": function (url) {
        return fetch(url, {
            method: "HEAD"
        });
    },
};