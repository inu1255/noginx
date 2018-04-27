const express = require("express");
const fetch = require("node-fetch");
const FetchResponse = require("node-fetch/lib/response");
const FetchBody = require("node-fetch/lib/body");
const https = require('https');
const http = require('http');
const net = require("net");
const debug = require("util").debuglog("noginx");
const fake = require("./fakeCert");

class App {
    constructor() {
        this.app = express();
        this.self_https = {};
        this.server = http.createServer(this.app);
        var that = this;
        this.httpFilter = function(url) {
            return !url.endsWith(":443") && !url.endsWith(":8443");
        };
        this.server.on('connect', function(req, cltSocket, head) {
            var srvSocket;
            var ss = req.url.split(":");
            if (that.httpFilter(req.url)) {
                srvSocket = net.connect({ host: "localhost", port: that.port }, function() {
                    cltSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                    srvSocket.write(head);
                    cltSocket.pipe(srvSocket);
                    srvSocket.pipe(cltSocket);
                    srvSocket.on("error", debug);
                });
            } else if (!that.httpsFilter || that.httpsFilter(req.url)) {
                that.fakeSite(ss[0], function(port) {
                    srvSocket = net.connect({ host: "localhost", port }, function() {
                        cltSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                        srvSocket.write(head);
                        cltSocket.pipe(srvSocket);
                        srvSocket.pipe(cltSocket);
                    });
                    srvSocket.on("error", debug);
                });
            } else {
                srvSocket = net.connect({ host: ss[0], port: ss[1] }, function() {
                    cltSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                    srvSocket.write(head);
                    cltSocket.pipe(srvSocket);
                    srvSocket.pipe(cltSocket);
                    srvSocket.on("error", debug);
                });
            }
        });

        // TODO: 代理 WebSocket
        this.server.on('upgrade', function(req, cltSocket, head) {
            var ss = req.url.split(":");
            var srvSocket = net.connect({ host: ss[0], port: ss[1] });
            cltSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            srvSocket.write(head);
            cltSocket.pipe(srvSocket);
            srvSocket.pipe(cltSocket);
        });
    }
    fakeSite(domain, cb) {
        if (this.self_https[domain]) {
            cb(this.self_https[domain]);
            return;
        }
        var cer = fake.cert(domain);
        var httpsServer = https.createServer(cer, this.app);
        httpsServer.listen(0, () => {
            this.self_https[domain] = httpsServer.address().port;
            cb(httpsServer.address().port);
        });
    }
    use() {
        this.app.use.apply(this.app, arguments);
    }
    listen(port) {
        this.port = port;
        // 默认: 直接转发请求
        this.app.use(function(req, res, next) {
            exports.forward(req).then(s => {
                res.writeHead(s.status, s.headers.raw());
                s.body.pipe(res);
            }).catch(next);
        });
        this.server.listen.apply(this.server, arguments);
    };
    close(cb) {
        this.server.close(cb);
    };
}

var dir_flag = false;
/**
 * 设置证书保存目录
 * @param {String} dir 证书保存目录
 */
exports.dir = function(dir) {
    if (dir_flag) {
        console.error("不能重复设置证书目录");
        return;
    }
    dir_flag = true;
    fake.init(dir);
};

/**
 * 获取express实例
 */
exports.express = function() {
    if (!dir_flag) fake.init();
    return new App();
};

/**
 * 转发请求
 * @param {Request} req 
 * @return {Promise<FetchResponse|FetchBody>}
 */
exports.forward = function(req) {
    var url = req.url;
    if (url.indexOf(":") <= 0) {
        url = req.protocol + "://" + req.headers["host"] + url;
    }
    return fetch(url, {
        method: req.method,
        headers: req.headers,
        body: req.body || req,
        compress: false,
        redirect: `manual`,
    });
};