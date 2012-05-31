#!/usr/bin/env node

process.title = 'awsbox';

const
aws = require('./lib/aws.js');
path = require('path');
vm = require('./lib/vm.js'),
key = require('./lib/key.js'),
ssh = require('./lib/ssh.js'),
git = require('./lib/git.js'),
optimist = require('optimist'),
urlparse = require('urlparse'),
fs = require('fs');

var verbs = {};

function checkErr(err) {
  if (err) {
    process.stderr.write('fatal error: ' + err + "\n");
    process.exit(1);
  }
}

function printInstructions(name, deets) {
  console.log("Yay!  You have your very own deployment.  Here's the basics:\n");
  console.log(" 1. deploy your code:  git push " + name + " <mybranch>:master");
  console.log(" 2. visit your server on the web: http://" + deets.ipAddress);
  console.log(" 3. ssh in with sudo: ssh ec2-user@" + deets.ipAddress);
  console.log(" 4. ssh as the deployment user: ssh app@" + deets.ipAddress);
  console.log("\n Here are your server's details:", JSON.stringify(deets, null, 4));
}

function validateName(name) {
  if (!name.length) {
    throw "invalid name!  must be non-null)";
  }
}

verbs['destroy'] = function(args) {
  if (!args || args.length != 1) {
    throw 'missing required argument: name of instance';
  }
  var name = args[0];
  validateName(name);
  var hostname = name;

  process.stdout.write("trying to destroy VM for " + hostname + ": ");
  vm.destroy(name, function(err, deets) {
    console.log(err ? ("failed: " + err) : "done");
    if (deets && deets.ipAddress) {
      process.stdout.write("trying to remove git remote: ");
      git.removeRemote(name, deets.ipAddress, function(err) {
        console.log(err ? "failed: " + err : "done");
      });
    }
  });
}

verbs['test'] = function() {
  // let's see if we can contact aws and zerigo
  process.stdout.write("Checking AWS access: ");
  vm.list(function(err) {
    console.log(err ? "NOT ok: " + err : "good");
  });
}

verbs['create'] = function(args) {
  var parser = optimist(args)
    .usage('awsbox create: Create a VM')
    .describe('n', 'a short nickname for the VM.')
    .describe('u', 'publically visible URL for the instance')
    .check(function(argv) {
      // parse/normalized typed in URL arguments
      if (argv.u) argv.u = urlparse(argv.u).validate().originOnly().toString();
    })
    .describe('t', 'Instance type, dictates VM speed and cost.  i.e. t1.micro or m1.large (see http://aws.amazon.com/ec2/instance-types/)')
    .describe('p', 'public SSL key (installed automatically when provided)')
    .describe('s', 'secret SSL key (installed automatically when provided)')
    .default('t', 't1.micro')

  var opts = parser.argv;

  if (opts.h) {
    parser.showHelp();
    process.exit(0);
  }

  var name = opts.n || "noname";
  validateName(name);
  var hostname =  name;
  var longName = process.env['USER'] + "'s " + process.title + ' deployment (' + name + ')';

  console.log("reading .awsbox.json");

  try { 
    var awsboxJson = JSON.parse(fs.readFileSync("./.awsbox.json"));
  } catch(e) {
    console.log("Fatal error!  Can't read awsbox.json: " + e);
    process.exit(1);
  }

  console.log("attempting to set up VM \"" + name + "\"");

  vm.startImage({
    type: opts.t
  }, function(err, r) {
    checkErr(err);
    console.log("   ... VM launched, waiting for startup (should take about 20s)");

    vm.waitForInstance(r.instanceId, function(err, deets) {
      checkErr(err);
      console.log("   ... Instance ready, setting human readable name in aws");
      vm.setName(r.instanceId, longName, function(err) {
        checkErr(err);
        console.log("   ... name set, waiting for ssh access and configuring");
        var config = { public_url: (opts.u || "http://" + deets.ipAddress) };

        console.log("   ... public url will be:", config.public_url);

        ssh.copyUpConfig(deets.ipAddress, config, function(err, r) {
          checkErr(err);
          console.log("   ... victory!  server is accessible and configured");
          git.addRemote(name, deets.ipAddress, function(err, r) {
            if (err && /already exists/.test(err)) {
              console.log("OOPS! you already have a git remote named '" + name + "'!");
              console.log("to create a new one: git remote add <name> " +
                          "app@" + deets.ipAddress + ":git");
            } else {
              checkErr(err);
            }
            console.log("   ... and your git remote is all set up");

            if (awsboxJson.packages) {
              console.log("   ... finally, installing custom packages: " + awsboxJson.packages.join(', '));
              console.log("");
            }
            ssh.installPackages(deets.ipAddress, awsboxJson.packages, function(err, r) {
              checkErr(err);
              var postcreate = (awsboxJson.hooks && awsboxJson.hooks.postcreate) || null;
              ssh.runScript(deets.ipAddress, postcreate,  function(err, r) {
                checkErr(err);
                printInstructions(name, deets);
              });
            });
          });
        });
      });
    });
  });
};

verbs['create_ami'] = function(args) {
  if (!args || args.length != 1) {
    throw 'missing required argument: name of instance';
  }

  var name = args[0];
  validateName(name);
  var hostname = name;

  console.log("restoring to a pristine state, and creating AMI image from " + name);

  vm.describe(name, function(err, deets) {
    console.log("instance found, ip " + deets.ipAddress + ", restoring");
    checkErr(err);
    ssh.makePristine(deets.ipAddress, function(err) {
      console.log("instance is pristine, creating AMI");
      checkErr(err);
      vm.createAMI(name, function(err, imageId) {
        checkErr(err);
        console.log("Created image:", imageId, "- waiting for creation and making it public (can take a while)");
        vm.makeAMIPublic(imageId, function(err) {
          console.log("  ... still waiting:", err);
        }, function(err, imageId) {
          checkErr(err);
          vm.destroy(name, function(err, deets) {
            checkErr(err);
            if (deets && deets.ipAddress) {
              process.stdout.write("trying to remove git remote: ");
              git.removeRemote(name, deets.ipAddress, function(err) {
                checkErr(err);
                console.log("All done!");
              });
            }
          });
        });
      });
    });
  });
};

verbs['list'] = function(args) {
  vm.list(function(err, r) {
    checkErr(err);
    console.log(JSON.stringify(r, null, 2));
  });
};

var error = (process.argv.length <= 2);

if (!error) {
  var verb = process.argv[2];
  if (!verbs[verb]) error = "no such command: " + verb;
  else {
    try {
      verbs[verb](process.argv.slice(3));
    } catch(e) {
      error = "error running '" + verb + "' command: " + e;
    }
  }
}

if (error) {
  if (typeof error === 'string') process.stderr.write('fatal error: ' + error + "\n\n");

  process.stderr.write('A tool to deploy NodeJS systems on Amazon\'s EC2\n');
  process.stderr.write('Usage: ' + path.basename(__filename) +
                       ' <' + Object.keys(verbs).join('|') + "> [args]\n");
  process.exit(1);
}
