const
child_process = require('child_process'),
temp = require('temp'),
fs = require('fs');

const MAX_TRIES = 40;


function passthrough(cp) {
  cp.stdout.pipe(process.stdout);
  cp.stderr.pipe(process.stderr);
}

exports.copyUpConfig = function(host, config, cb) {
  var tries = 0;
  temp.open({}, function(err, r) {
    fs.writeFileSync(r.path, JSON.stringify(config, null, 4));
    var cmd = 'scp -o "StrictHostKeyChecking no" ' + r.path + ' app@' + host + ":config.json";
    function oneTry() {
      child_process.exec(cmd, function(err, r) {
        if (err) {
          if (++tries > MAX_TRIES) return cb("can't connect via SSH.  stupid amazon");
          console.log("   ... nope.  not yet.  retrying.");
          setTimeout(oneTry, 5000);
        } else {
          cb();
        }
      });
    }
    oneTry();
  });
};

exports.copySSL = function(host, pub, priv, cb) {
  var cmd = 'scp -o "StrictHostKeyChecking no" ' + pub + ' proxy@' + host + ":cert.pem";
  child_process.exec(cmd, function(err, r) {
    if (err) return cb(err);
    var cmd = 'scp -o "StrictHostKeyChecking no" ' + priv + ' proxy@' + host + ":key.pem";
    child_process.exec(cmd, function(err, r) {
      var cmd = 'ssh -o "StrictHostKeyChecking no" proxy@' + host + " 'forever restartall'";
      child_process.exec(cmd, cb);
    });
  });
};

exports.installPackages = function(host, packages, cb) {
  if (!packages || !packages.length) cb();
  else {
    var pkg = packages.shift();
    var cmd = 'ssh -o "StrictHostKeyChecking no" ec2-user@' + host + " sudo yum -y install \'" + pkg + "\'";
    var cp = child_process.exec(cmd, function(err, r) {
      if (err) return cb(err);
      var cmd = 'ssh -o "StrictHostKeyChecking no" ec2-user@' + host + " 'echo \"" + pkg + "\" >> packages.txt'";
      child_process.exec(cmd, function(err, r) {
        if (err) return cb(err);
        exports.installPackages(host, packages, cb);
      });
    })
    passthrough(cp);
  }
};

exports.updatePackages = function(host, cb) {
  var cmd = 'ssh -o "StrictHostKeyChecking no" ec2-user@' + host + " sudo yum -y update";
  var cp = child_process.exec(cmd, function(err, r) {
    if (err) return cb(err);
    cb();
  })
  passthrough(cp);
};

exports.runScript = function(host, script, cb) {
  if (!script) return cb(null);
  var cmd = 'ssh -o "StrictHostKeyChecking no" ec2-user@' + host + " < " + script;
  var cp = child_process.exec(cmd, function(err, r) {
    cb(err);
  });
  passthrough(cp);
};

exports.addSSHPubKey = function(host, pubkey, cb) {
  var cmd = 'ssh -o "StrictHostKeyChecking no" ec2-user@' + host + " 'echo \'" + pubkey + "\' >> .ssh/authorized_keys'";
  child_process.exec(cmd, cb);
};

exports.configureProxy = function(host, behavior, cb) {
  temp.open({}, function(err, r) {
    fs.writeFileSync(r.path, JSON.stringify({ ssl: behavior }, null, 4));
    var cmd = 'scp -o "StrictHostKeyChecking no" ' + r.path + ' proxy@' + host + ":config.json";
    child_process.exec(cmd, cb);
  });
};

exports.makePristine = function(host, cb) {
  var cmd = 'ssh -o "StrictHostKeyChecking no" ec2-user@' + host + " './pristinify.sh'";
  passthrough(child_process.exec(cmd, cb));
};
