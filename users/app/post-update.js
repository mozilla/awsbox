#!/usr/bin/env node

var
temp = require('temp'),
child_process = require('child_process'),
forever = require('forever'),
path = require('path'),
fs = require('fs'),
request = require('request');

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
} catch(e) {
  console.log("** no config.json file");
  appconfig = {};
}

// determin public url
if (!appconfig['public_url']) {
  request('http://instance-data/latest/meta-data/public-ipv4', function (error, response, body) {
    if (error || response.statusCode != 200) {
      console.error("!! can't determine public ip:", error);
      process.exit(1);
    }
    appconfig['public_url'] = 'http://' + body.trim();
    doDeploy();
  });
} else {
  doDeploy();
}

var awsboxJson;

// create a temporary directory where we'll stage new code
function doDeploy() {
  temp.mkdir('deploy', function(err, newCodeDir) {
    console.log(">> public url is:", appconfig['public_url']);
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
      if (fs.existsSync(codeDir)) {
        commands.push([ 'move old code out of the way', 'mv ' + codeDir + '{,.old}' ]);
      }
      commands.push([ 'move new code into place', 'mv ' + newCodeDir + ' ' + codeDir ]);

      runNextCommand(function() {
        updateEnvAwsBox();
      });
    }

    function updateEnv(env, next) {
      var eKeys = Object.keys(env);
      console.log(">> vars:", eKeys.join(", "));

      function setNext() {
        if (!eKeys.length) next();
        else {
          var k = eKeys.shift();
          child_process.exec(
            'echo "' + env[k] + '"',
            function(error, so, se) {
              checkErr('while setting ENV var ' + k, error);
              process.env[k] = so.toString().trim();
              setNext();
            });
        }
      }
      setNext();
    }

    function updateEnvAwsBox() {
      // now update the environment with what's in the config files
      if (awsboxJson.env) {
        console.log(">> setting env vars from .awsbox.json...");

        updateEnv(awsboxJson.env, updateEnvAppConfig);
      } else {
        updateEnvAppConfig();
      }
    }

    function updateEnvAppConfig() {
      // now update the environment with what's in the config files
      if (appconfig.env) {
        console.log(">> setting env vars from config.json...");

        updateEnv(appconfig.env, postDeploy);
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
        var foreverCmd = 'forever -a -l ' + logfilePath + ' start ';
        foreverCmd += ' --minUptime 1000 --spinSleepTime 1000 ';
        foreverCmd += cmd;
        commands.push([ 'start ' + script, foreverCmd ]);
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
}
