const express = require("express");
const fetch = require("node-fetch");
const FetchResponse = require("node-fetch/lib/response");
const FetchBody = require("node-fetch/lib/body");
const https = require('https');
const http = require('http');
const net = require("net");
const debug = require("util").debuglog("noginx");
const app = express();
const fake = require("./fakeCert");

var self_https = {};
/**
 * 创建一个假的目标网站
 * @param {String} domain www.baidu.com
 * @param {{(port:Number)=>()}} cb 端口回调
 */
function fakeSite(domain, cb) {
    if (self_https[domain]) {
        cb(self_https[domain]);
        return;
    }
    var cer = fake.cert(domain);
    var httpsServer = https.createServer(cer, app);
    httpsServer.listen(0, function() {
        self_https[domain] = httpsServer.address().port;
        cb(httpsServer.address().port);
    });
}

var server = http.createServer(app);
app.listen = function() {
    // 默认: 直接转发请求
    app.use(function(req, res, next) {
        exports.forward(req).then(s => {
            res.writeHead(s.status, s.headers.raw());
            s.body.pipe(res);
        }).catch(err => {
            next();
        });
    });
    server.listen.apply(server, arguments);
};

// 代理 https
server.on('connect', function(req, cltSocket, head) {
    var srvSocket;
    var ss = req.url.split(":");
    if (exports.httpsFilter(req.url)) {
        fakeSite(ss[0], function(port) {
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
server.on('upgrade', function(req, cltSocket, head) {
    var ss = req.url.split(":");
    var srvSocket = net.connect({ host: ss[0], port: ss[1] });
    cltSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    srvSocket.write(head);
    cltSocket.pipe(srvSocket);
    srvSocket.pipe(cltSocket);
});

/**
 * 通过host过滤https是否走代理
 * @param {String} host demo: www.baidu.com:443
 */
exports.httpsFilter = function(host) {
    return true;
};

/**
 * 获取express实例
 * @param {String} dir 证书保存目录
 */
exports.express = function(dir) {
    fake.init(dir);
    return app;
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
        body: req,
        compress: false
    });
};