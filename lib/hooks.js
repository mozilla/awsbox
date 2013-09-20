
const
path = require('path'),
fs = require('fs'),
child_process = require('./process'),
ssh = require('./ssh.js'),
config = require('./config.js');

function getRemoteHook(which) {
  var awsboxJson = config.get();
  var remoteHooks = awsboxJson.remote_hooks || awsboxJson.hooks;
  return (remoteHooks && remoteHooks[which]) || null;
}

function getLocalHook(which) {
  var awsboxJson = config.get();
  var localHooks = awsboxJson.local_hooks;
  return (localHooks && localHooks[which]) || null;
}

exports.runRemoteHook = function(which, deets, cb) {
  var cmd = getRemoteHook(which);
  if (cmd) {
    console.log("   ... running remote", which, "hook");
  }
  ssh.runScript(deets.ipAddress, cmd, cb);
};

exports.runLocalHook = function(which, deets, cb) {
  var cmd = getLocalHook(which);
  if (cmd) {
    console.log("   ... running local ", which, "hook");
  }

  // let each local hook now what the remote AWS host is.
  process.env.AWS_IP_ADDRESS = deets.ipAddress;
  child_process.exec(cmd, cb);
};

