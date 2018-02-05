const fs = require('fs');
const tls = require('tls');
const path = require('path');
const forge = require('node-forge');
const pki = forge.pki;

const attrs = [{
    name: 'commonName',
    value: 'noginx'
}, {
    name: 'countryName',
    value: 'CN'
}, {
    shortName: 'ST',
    value: 'Chengdu'
}, {
    name: 'localityName',
    value: 'SiChuang'
}, {
    name: 'organizationName',
    value: 'inu1255'
}, {
    shortName: 'OU',
    value: 'https://github.com/inu1255/noginx'
}];

var caCert, caKey, cachePath;
exports.init = function(dir) {
    dir = dir || "cert";
    const caCertPath = path.join(dir, "ca.crt");
    const caKeyPath = path.join(dir, "ca.key.pem");
    cachePath = path.join(dir, ".cache");

    fs.existsSync(dir) || fs.mkdirSync(dir);
    fs.existsSync(cachePath) || fs.mkdirSync(cachePath);

    if (!fs.existsSync(caCertPath) || !fs.existsSync(caKeyPath)) {
        createCertificate(caCertPath, caKeyPath);
    }

    const caCertPem = fs.readFileSync(caCertPath);
    const caKeyPem = fs.readFileSync(caKeyPath);
    caCert = pki.certificateFromPem(caCertPem);
    caKey = pki.privateKeyFromPem(caKeyPem);
};

function createCertificate(caCertPath, caKeyPath) {
    var keys = pki.rsa.generateKeyPair(1024);
    var cert = pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = (new Date()).getTime() + '';

    // 设置CA证书有效期
    cert.validity.notBefore = new Date();
    cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 5);
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 20);
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([{
        name: 'basicConstraints',
        critical: true,
        cA: true
    }, {
        name: 'keyUsage',
        critical: true,
        keyCertSign: true
    }, {
        name: 'subjectKeyIdentifier'
    }]);

    // 用自己的私钥给CA根证书签名
    cert.sign(keys.privateKey, forge.md.sha256.create());

    var certPem = pki.certificateToPem(cert);
    var keyPem = pki.privateKeyToPem(keys.privateKey);

    fs.writeFileSync(caCertPath, certPem);
    fs.writeFileSync(caKeyPath, keyPem);
}

function fakeCert(domain) {
    var dir = path.join(cachePath, domain.replace(":", "#"));
    var certPath = path.join(dir, "ca.crt");
    var keyPath = path.join(dir, "ca.key.pem");
    var keys;
    var cert;
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        keys = {
            privateKey: pki.privateKeyFromPem(fs.readFileSync(keyPath))
        };
        cert = pki.certificateFromPem(fs.readFileSync(certPath));
    } else {
        keys = pki.rsa.generateKeyPair(2046);
        cert = pki.createCertificate();
        cert.publicKey = keys.publicKey;

        cert.serialNumber = (new Date()).getTime() + '';
        cert.validity.notBefore = new Date();
        cert.validity.notBefore.setFullYear(cert.validity.notBefore.getFullYear() - 1);
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);

        cert.setIssuer(caCert.subject.attributes);
        cert.setSubject(attrs);
        cert.setExtensions([{
                name: 'basicConstraints',
                critical: true,
                cA: false
            },
            {
                name: 'keyUsage',
                critical: true,
                digitalSignature: true,
                contentCommitment: true,
                keyEncipherment: true,
                dataEncipherment: true,
                keyAgreement: true,
                keyCertSign: true,
                cRLSign: true,
                encipherOnly: true,
                decipherOnly: true
            },
            {
                name: 'subjectAltName',
                altNames: [{
                    type: 2,
                    value: domain
                }]
            },
            {
                name: 'subjectKeyIdentifier'
            },
            {
                name: 'extKeyUsage',
                serverAuth: true,
                clientAuth: true,
                codeSigning: true,
                emailProtection: true,
                timeStamping: true
            },
            {
                name: 'authorityKeyIdentifier'
            }
        ]);

        cert.sign(caKey, forge.md.sha256.create());
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
        }
        fs.writeFileSync(certPath, pki.certificateToPem(cert));
        fs.writeFileSync(keyPath, pki.privateKeyToPem(keys.privateKey));
    }
    return {
        key: keys.privateKey,
        cert: cert,
        SNICallback: (hostname, done) => {
            var certObj = fakeCert(hostname);
            done(null, tls.createSecureContext({
                key: pki.privateKeyToPem(certObj.key),
                cert: pki.certificateToPem(certObj.cert)
            }));
        }
    };
}

exports.cert = fakeCert;