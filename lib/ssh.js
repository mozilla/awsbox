const
child_process = require('child_process'),
temp = require('temp'),
fs = require('fs'),
ssh = 'ssh',
scp = 'scp';

const MAX_TRIES = 120;

function passthrough(cp) {
  cp.stdout.pipe(process.stdout);
  cp.stderr.pipe(process.stderr);
}

exports.copyUpConfig = function(host, configContents, cb) {
  var tries = 0;
  temp.open({}, function(err, r) {
    fs.writeFileSync(r.path, JSON.stringify(configContents, null, 4));
    var config = r.path;
    var destination = 'app@' + host + ':config.json';
    var args = ['-o', 'StrictHostKeyChecking no', config, destination];
    function oneTry() {
      child_process.execFile(scp, args, function(err) {
        if (err) {
          if (++tries > MAX_TRIES) return cb("can't connect via SSH.  stupid amazon");
          process.stdout.write(tries <= 1 ? "   ..." : ".");
          setTimeout(oneTry, 3000);
        } else {
          cb();
        }
      });
    }
    oneTry();
  });
};

exports.copySSL = function(host, pub, priv, cb) {
  var destination = 'proxy@' + host + ':cert.pem';
  var args = ['-o', 'StrictHostKeyChecking no', pub, destination];
  child_process.execFile(scp, args, function(err) {
    if (err) return cb(err);
    var destination = 'proxy@' + host + ':key.pem';
    var args = ['-o', 'StrictHostKeyChecking no', priv, destination];
    child_process.execFile(scp, args, function(err) {
      if (err) return cb(err);
      var destination = 'ec2-user@' + host;
      var rcmd = 'sudo /etc/init.d/nginx restart';
      var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
      child_process.execFile(ssh, args, cb);
    });
  });
};

exports.installPackages = function(host, packages, cb) {
  if (!packages || !packages.length) cb();
  else {
    var pkg = packages.shift();
    var destination = 'ec2-user@' + host;
    var rcmd = "sudo yum -y install '" + pkg + "'";
    var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
    var cp = child_process.execFile(ssh, args, function(err) {
      if (err) return cb(err);
      var rcmd = "echo '" + pkg + "' >> packages.txt";
      var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
      child_process.execFile(ssh, args, function(err) {
        if (err) return cb(err);
        exports.installPackages(host, packages, cb);
      });
    });
    passthrough(cp);
  }
};

exports.updatePackages = function(host, cb) {
  var destination = 'ec2-user@' + host;
  var rcmd = 'sudo yum --enablerepo=amzn-updates clean metadata';
  var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
  var cp = child_process.execFile(ssh, args, function(err) {
    if (err) return cb(err);
    var rcmd = 'sudo yum -y update';
    var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
    cp = child_process.execFile(ssh, args, function(err) {
      if (err) return cb(err);
      cb();
    });
    passthrough(cp);
  });
  passthrough(cp);
};

exports.runScript = function(host, script, cb) {
  if (!script) return cb(null);

  var destination = 'ec2-user@' + host;
  var args = [ssh, '-o', 'StrictHostKeyChecking no', destination];

  var cp = child_process.spawn(args[0], args.slice(1),{
    cwd: process.cwd(),
    env: process.env
  });

  cp.on('close', function (code) {
    if (0 !== code) {
      cb("Spawn process '" + args.join(' ') + "' exited with return code " + code);
    } else {
      cb();
    }
  });
  cp.stdin.resume();
  cp.stdin.write(fs.readFileSync(script));
  cp.stdin.end();

  passthrough(cp);
};

exports.addSSHPubKey = function(host, pubkey, cb) {
  // Add the key if it is not already in the file
  var escapedPubkey = pubkey.replace(/(["'`\$\!\*\?\\\(\)\[\]\{\}])/g, '\\$1');
  var destination = 'ec2-user@' + host;
  var rcmd = 'grep "' + escapedPubkey + '" .ssh/authorized_keys || echo "' + escapedPubkey + '" >> .ssh/authorized_keys';
  var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
  child_process.execFile(ssh, args, cb);
};

exports.removeSSHPubKey = function(host, pubkey, cb) {
  // Remove the key from the file
  // Escape characters that could break sed regex
  // (nb NOT the + sign)
  var escapedPubkey = pubkey.replace(/(["'`\$\!\*\?\\\/\(\)\[\]\{\}])/g, '\\$1');
  var destination = 'ec2-user@' + host;
  var rcmd = 'sed -i "/' + escapedPubkey + '/d" .ssh/authorized_keys';
  var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
  child_process.execFile(ssh, args, cb);
};

exports.listSSHPubKeys = function(host, cb) {
  var destination = 'ec2-user@' + host;
  var rcmd = 'cat .ssh/authorized_keys';
  var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
  child_process.execFile(ssh, args, cb);
};

exports.configureProxy = function(host, behavior, cb) {
  // first let's configure the server name
  var rcmd = "echo 'server_name \"" + host + "\";\n' > conf.d/server_name.inc";
  var dest = 'proxy@' + host;
  var args = ['-o', 'StrictHostKeyChecking no', dest, rcmd];
  passthrough(child_process.execFile(ssh, args, function(err) {
    if (err) return cb(err);

    if (behavior === 'force') {
      args = ['-o', 'StrictHostKeyChecking no', dest,
              "mv conf.d/http_redirect.conf.disabled conf.d/http.conf"];
      // overwrite http config with redirect to ssl
      passthrough(child_process.execFile(ssh, args, restart));
    } else if (behavior === 'disable') {
      args = ['-o', 'StrictHostKeyChecking no', dest, "rm conf.d/https.conf"];
      // overwrite http config with redirect to https
      passthrough(child_process.execFile(ssh, args, restart));
    } else if (behavior === 'redirect') {
      // remove the standard https file
      args = ['-o', 'StrictHostKeyChecking no', dest, "rm conf.d/https.conf"];
      passthrough(child_process.execFile(ssh, args, function(err) {
        if (err) return cb(err);
        // Overwrite to http config with redirect to ssl if the protocol is not
        // https. This is useful for aws instances where the load balancer terminates
        // the connection.
        args = ['-o', 'StrictHostKeyChecking no', dest,
                "mv conf.d/http_redirect_if.conf.disabled conf.d/http.conf"];
        passthrough(child_process.execFile(ssh, args, restart));
      }));
    } else {
      restart();
    }
    // enable is default

    function restart(err) {
      if (err) return cb(err);
      dest = 'ec2-user@' + host;
      var rcmd = 'sudo /etc/init.d/nginx restart';
      var args = ['-o', 'StrictHostKeyChecking no', dest, rcmd];
      passthrough(child_process.execFile(ssh, args, cb));
    }
  }));
};

exports.makePristine = function(host, cb) {
  var destination = 'ec2-user@' + host;
  var rcmd = 'sudo truncate -s0 ~root/.ssh/authorized_keys ~/.ssh/authorized_keys';
  var args = ['-o', 'StrictHostKeyChecking no', destination, rcmd];
  passthrough(child_process.execFile(ssh, args, cb));
};

exports.copyFile = function(host, user, local, remote, cb) {
  var destination = user + '@' + host + ':' + remote;
  var args = ['-o', 'StrictHostKeyChecking no', local, destination];
  child_process.execFile(scp, args, cb);
};
