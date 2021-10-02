const fetch = require('node-fetch');

module.exports = {
    sleep(millis, ret) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(ret), millis);
        });
    },
    head(url) {
        return fetch(url, {
            method: "HEAD"
        });
    },
};