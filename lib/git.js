const
child_process = require('child_process'),
spawn = child_process.spawn,
path = require('path');

// getEnv is used to pass all the rest of the environment variables to git.
// This prevents the user from being required to enter their password on a git
// push
function getEnv(extraEnv) {
  var key, env = {};

  // copy over the original environment
  for(key in process.env) {
    env[key] = process.env[key];
  }

  // add each item in extraEnv
  for(key in extraEnv) {
    env[key] = extraEnv[key];
  }

  return env;
}


exports.addRemote = function(name, host, cb) {
  var cmd = 'git remote add "' + name  + '" app@'+ host + ':git';
  child_process.exec(cmd, cb);
};

// remove a remote, but only if it is pointed to a specific
// host.  This will keep deploy from killing manuall remotes
// that you've set up
exports.removeRemote = function(name, host, cb) {
  var desired = 'app@'+ host + ':git';
  var cmd = 'git remote -v show | grep push';
  child_process.exec(cmd, function(err, r) {
    try {
      var remotes = {};
      r.split('\n').forEach(function(line) {
        if (!line.length) return;
        line = line.split('\t');
        if (line.length !== 2) return;
        remotes[line[0]] = line[1].split(" ")[0];
      });
      if (remotes[name] && remotes[name] === desired) {
        child_process.exec('git remote rm ' + name, cb);
      } else {
        throw "no such remote";
      }
    } catch(e) {
      cb(e);
    }
  });
};

exports.currentSHA = function(dir, cb) {
  if (typeof dir === 'function' && cb === undefined) {
    cb = dir;
    dir = path.join(__dirname, '..', '..');
  }

  var p = spawn('git', [ 'log', '--pretty=%h', '-1' ], {
    env: getEnv({ GIT_DIR: path.join(dir, ".git") })
  });
  var buf = "";
  p.stdout.on('data', function(d) {
    buf += d;
  });
  p.on('close', function() {
    var gitsha = buf.toString().trim();
    if (gitsha && gitsha.length === 7) {
      return cb(null, gitsha);
    }
    cb("can't extract git sha from " + dir);
  });
};

function splitAndEmit(chunk, cb) {
  if (chunk) chunk = chunk.toString();
  if (typeof chunk === 'string') {
    chunk.split('\n').forEach(function (line) {
      line = line.trim();
      if (line.length) cb(line);
    });
  }
}

exports.push = function(dir, host, pr, cb) {
  if (typeof host === 'function' && cb === undefined) {
    cb = pr;
    pr = host;
    host = dir;
    dir = path.join(__dirname, '..', '..', '..');
  }

  var p = spawn('git', [ 'push', 'app@' + host + ":git", 'HEAD:master' ], {
    env: getEnv({
      GIT_DIR: path.join(dir, ".git"),
      GIT_WORK_TREE: dir
    })
  });
  p.stdout.on('data', function(c) { splitAndEmit(c, pr); });
  p.stderr.on('data', function(c) { splitAndEmit(c, pr); });
  p.on('exit', function(code) {
    return cb(code !== 0);
  });
};

exports.pull = function(dir, remote, branch, pr, cb) {
  var p = spawn('git', [ 'pull', "-f", remote, branch + ":" + branch ], {
    env: getEnv({
      GIT_DIR: path.join(dir, ".git"),
      GIT_WORK_TREE: dir,
      PWD: dir
    }),
    cwd: dir
  });

  p.stdout.on('data', function(c) { splitAndEmit(c, pr); });
  p.stderr.on('data', function(c) { splitAndEmit(c, pr); });

  p.on('exit', function(code) {
    return cb(code !== 0);
  });
};

exports.init = function(dir, cb) {
  var p = spawn('git', [ 'init' ], {
    env: getEnv({
      GIT_DIR: path.join(dir, ".git"),
      GIT_WORK_TREE: dir
    })
  });
  p.on('exit', function(code) {
    return cb(code !== 0);
  });
};
