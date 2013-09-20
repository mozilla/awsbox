const
aws = require('./aws.js'),
path = require('path'),
fs = require('fs'),
child_process = require('child_process'),
jsel = require('JSONSelect'),
crypto = require('crypto'),
ssh = require('./ssh.js');

const keyPath = process.env.AWSBOX_PUBKEY || path.join(process.env.HOME, ".ssh", "id_rsa.pub");

exports.read = function(cb) {
  fs.readFile(keyPath, cb);
};

exports.fingerprint = function(cb) {
  exports.read(function(err, buf) {
    if (err) return cb(err);
    var b = new Buffer(buf.toString().split(' ')[1], 'base64');
    var md5sum = crypto.createHash('md5');
    md5sum.update(b);
    cb(null, md5sum.digest('hex'));
  });
};

exports.getName = function(cb) {
  exports.fingerprint(function(err, fingerprint) {
    if (err) return cb(err);

    var keyName = "awsbox deploy key (" + fingerprint + ")";

    // is this fingerprint known?
    // DescribeKeyPairs
    aws.client.DescribeKeyPairs(function(err, result) {
      if (err) return cb(aws.makeError(err));
      var found = jsel.match(":has(.keyName:val(?)) > .keyName", [ keyName ], result);
      if (found.length) return cb(null, keyName);

      // key isn't yet installed!
      exports.read(function(err, key) {
        if (err) return cb(err);
        // ImportKeyPair
        aws.client.ImportKeyPair({
          KeyName: keyName,
          PublicKeyMaterial: new Buffer(key).toString('base64')
        }, function(err) {
          if (err) return cb(aws.makeError(err));
          cb(null, keyName);
        });
      });
    });
  });
};

// read all the files in a directory, assume each is a newline seaparated text
// file contining keys, copy them up
exports.addKeysFromDirectory = function(ip, dir, progress_cb, cb) {
  if (!dir) return cb(null);

  fs.readdir(dir, function(err, files) {
    if (err) return cb(err);
    if (progress_cb) progress_cb("reading public keys from " + dir);
    var keys = [];
    files.forEach(function(f) {
      // Whitelist: keys must end in .pub
      if (f.substr('-4') !== '.pub') {
        console.log("keydir: Skipping", f, "because it does not end in '.pub'");
        return;
      }

      var content = fs.readFileSync(path.join(dir, f));
      content = content.toString().split("\n");
      content.forEach(function(k) {
        k = k.trim();
        if (!k.length) return;
        keys.push([ path.basename(f), k ]);
      });
    });
    if (!keys.length) {
      progress_cb("no keys found");
      return cb(null);
    }
    function addNext(err) {
      if (err) return cb(err);
      if (!keys.length) return cb(null);
      var k = keys.pop();
      progress_cb("Copying key from " + k[0]);
      ssh.addSSHPubKey(ip, k[1], addNext);
    }
    addNext();
  });
};
