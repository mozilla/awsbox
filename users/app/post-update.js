#!/usr/bin/env node

var
temp = require('temp'),
child_process = require('child_process'),
forever = require('forever'),
path = require('path'),
fs = require('fs');

function checkErr(msg, err) {
  if (err) {
    process.stderr.write("ERROR: " + msg + ":\n\n");
    process.stderr.write(err + "\n");
    process.exit(1);
  }
}

// first, parse appconfig (~/config.json) and make it available to the rest of this file:
var appconfig;
try {
  appconfig = JSON.parse(fs.readFileSync(path.join(process.env['HOME'], 'config.json')));
  [ 'public_url' ].forEach(function(required_key) {
    if (!appconfig[required_key]) throw "missing '"+ required_key +"' property";
  });
} catch(e) {
  console.log("!! invalid config.json:", e.toString());
  process.exit(1);
}

var awsboxJson;

// create a temporary directory where we'll stage new code
temp.mkdir('deploy', function(err, newCodeDir) {
  console.log(">> staging code to", newCodeDir);

  var commands = [
    [ "exporting current code", "git archive --format=tar master | tar -x -C " + newCodeDir ],
    [ "extract current sha", "git log -1 --oneline master > $HOME/ver.txt" ],
    [ "update dependencies", "npm install --production", {
      cwd: newCodeDir,
      env: {
        HOME: process.env['HOME'],
        PATH: process.env['PATH']
      }
    } ]
  ];

  function runNextCommand(cb) {
    if (!commands.length) return cb();
    var cmd = commands.shift();
    console.log(">>", cmd[0]);
    var c = child_process.exec(cmd[1], cmd[2] ? cmd[2] : {}, function(err, se, so) {
      checkErr("while " + cmd[0], err);
      runNextCommand(cb);
    });
    c.stdout.pipe(process.stdout);
    c.stderr.pipe(process.stderr);
  }

  runNextCommand(function() {
    // now let's parse .awsbox.config
    try {
      awsboxJson = JSON.parse(fs.readFileSync(path.join(newCodeDir, '.awsbox.json')));
      if (!awsboxJson.processes) throw "missing 'processes' property";
    } catch(e) {
      console.log("!! Couldn't read .awsbox.json: " + e.toString());
      process.exit(1);
    }

    // once all commands are run, we'll start servers with forever
    forever.list(false, function(err, l) {
      checkErr("while listing processes", err);
      if (!l || !l.length) return moveCode()
      else {
        var sa = forever.stopAll();
        console.log(">> stopping running servers");
        sa.on('stopAll', function() {
          moveCode();
        });
      }
    });
  });

  const codeDir = path.join(process.env['HOME'], 'code');

  function runHook(which, cb) {
    var hooks = awsboxJson.remote_hooks || awsboxJson.hooks;
    if (hooks && hooks[which]) {
      commands.push([ which + ' hook', hooks[which], {
        cwd: codeDir
      }]);
      runNextCommand(function(err) {
        checkErr("while running " + which + " hook", err);
        cb(null);
      });
    } else {
      cb(null);
    }
  }

  function moveCode() {
    commands.push([ 'delete ancient code', 'rm -rf ' + codeDir + '.old' ]);
    if (path.existsSync(codeDir)) {
      commands.push([ 'move old code out of the way', 'mv ' + codeDir + '{,.old}' ]);
    }
    commands.push([ 'move new code into place', 'mv ' + newCodeDir + ' ' + codeDir ]);

    runNextCommand(function() {
      updateEnv();
    });
  }

  function updateEnv() {
    // now update the environment with what's in the config file
    if (awsboxJson.env) {
      var eKeys = Object.keys(awsboxJson.env);

      console.log(">> setting env vars from .awsbox.json:", eKeys.join(", "));

      function setNext() {
        if (!eKeys.length) postDeploy();
        else {
          var k = eKeys.shift();
          child_process.exec(
            'echo "' + awsboxJson.env[k] + '"',
            function(error, so, se) {
              checkErr('while setting ENV var ' + k, error);
              process.env[k] = so.toString().trim();
              setNext();
            });
        }
      }
      setNext()
    } else {
      postDeploy();
    }
  }

  function postDeploy() {
    runHook('postdeploy', function(err) {
      checkErr("while running postdeploy hook", err);
      startServers();
    });
  }

  // now start all servers
  function startServers() {
    var servers = awsboxJson.processes;

    function startNextServer(cb) {
      if (!servers.length) return cb();
      var script = servers.shift();
      var cmd = path.join(codeDir, script);
      var logfilePath = path.join(process.env['HOME'], 'var', 'log', path.basename(script) + '.log');
      console.log(">> " + script + " logs at " + logfilePath);
      commands.push([ 'start ' + script, 'forever -a -l ' + logfilePath + ' start ' + cmd]);
      runNextCommand(function(err) {
        delete process.env['PORT'];
        startNextServer(cb);
      });
    }

    // XXX: for now we start the first process with a "well known" port, all others with
    // whatever port they default to.
    process.env['PORT'] = 10000;

    // make public_url available to all processes
    process.env['PUBLIC_URL'] = appconfig.public_url;

    // start all servers
    startNextServer(function(err) {
      postStart();
    });
  }

  function postStart() {
    runHook('poststart', function(err) {
      checkErr('while running poststart hook', err);
      allDone();
    });
  }

  function allDone() {
      console.log('>> all done');
  }
});
