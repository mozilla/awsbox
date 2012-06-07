#!/usr/bin/env node

process.title = 'awsbox';

const
aws = require('./lib/aws.js');
path = require('path');
vm = require('./lib/vm.js'),
key = require('./lib/key.js'),
ssh = require('./lib/ssh.js'),
dns = require('./lib/dns.js'),
git = require('./lib/git.js'),
optimist = require('optimist'),
urlparse = require('urlparse'),
fs = require('fs'),
relativeDate = require('relative-date');

var verbs = {};

function checkErr(err) {
  if (err) {
    process.stderr.write('ERRORE FATALE: ' + err + "\n");
    process.exit(1);
  }
}

function printInstructions(name, host, url, deets) {
  if (!url) url = 'http://' + deets.ipAddress;
  if (!host) host = deets.ipAddress;
  console.log("");
  console.log("Yay!  You have your very own deployment.  Here's the basics:\n");
  console.log(" 1. deploy your code:  git push " + name + " HEAD:master");
  console.log(" 2. visit your server on the web: " + url);
  console.log(" 3. ssh in with sudo: ssh ec2-user@" + host);
  console.log(" 4. ssh as the deployment user: ssh app@" + host);
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

        if (process.env['ZERIGO_DNS_KEY']) {
          process.stdout.write("trying to remove DNS: ");
          var dnsKey = process.env['ZERIGO_DNS_KEY'];
          dns.findByIP(dnsKey, deets.ipAddress, function(err, fqdns) {
            checkErr(err);
            if (!fqdns.length) return console.log("no dns entries found");
            console.log(fqdns.join(', '));
            function removeNext() {
              if (!fqdns.length) return;
              var fqdn = fqdns.shift();
              process.stdout.write("deleting " + fqdn + ": ");
              dns.deleteRecord(dnsKey, fqdn, function(err) {
                console.log(err ? "failed: " + err : "done");                
                removeNext();
              });
            }
            removeNext();
          });
        }
      });
    }
  });
}

verbs['test'] = function() {
  // let's see if we can contact aws and zerigo
  process.stdout.write("Checking AWS access: ");
  vm.list(function(err) {
    console.log(err ? "NOT ok: " + err : "good");
    
    if (process.env['ZERIGO_DNS_KEY']) {
      process.stdout.write("Checking DNS access: ");
      dns.inUse(process.env['ZERIGO_DNS_KEY'], 'example.com', function(err, res) {
        console.log(err ? "NOT ok: " + err : "good");        
      });
    } 
  });
}

verbs['findByIP'] = function(args) {
  dns.findByIP(process.env['ZERIGO_DNS_KEY'], args[0], function(err, fqdns) {
    console.log(err, fqdns);
  });
};

verbs['create'] = function(args) {
  var parser = optimist(args)
    .usage('awsbox create: Create a VM')
    .describe('d', 'setup DNS via zerigo (requires ZERIGO_DNS_KEY in env)')
    .describe('n', 'a short nickname for the VM.')
    .describe('u', 'publically visible URL for the instance')
    .describe('remote', 'add a git remote')
    .boolean('remote')
    .default('remote', true)
    .check(function(argv) {
      // parse/normalized typed in URL arguments
      if (argv.u) argv.u = urlparse(argv.u).validate().originOnly().toString();
    })
    .describe('t', 'Instance type, dictates VM speed and cost.  i.e. t1.micro or m1.large (see http://aws.amazon.com/ec2/instance-types/)')
    .default('t', 't1.micro')
    .describe('p', 'public SSL key (installed automatically when provided)')
    .describe('s', 'secret SSL key (installed automatically when provided)')
    .check(function(argv) {
      // p and s are all or nothing
      if (argv.s ? !argv.p : argv.p) throw "-p and -s are both required";
      if (argv.s) {
        if (!path.existsSync(argv.s)) throw "file '" + argv.s + "' doesn't exist";
        if (!path.existsSync(argv.p)) throw "file '" + argv.p + "' doesn't exist";
      }
    })
    .describe('x', 'path to a json file with Xtra configuration to copy up to ./config.json')
    .check(function(argv) {
      if (argv.x) {
        if (!path.existsSync(argv.x)) throw "file '" + argv.x + "' doesn't exist";
        var x = JSON.parse(fs.readFileSync(argv.x));
        if (typeof x !== 'object' || x === null || Array.isArray(x)) throw "-x file must contain a JSON object";
      }
    });

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
    checkErr("Can't read awsbox.json: " + e);
  }

  console.log("attempting to set up VM \"" + name + "\"");

  var dnsKey;
  var dnsHost;
  if (opts.d) {
    if (!opts.u) checkErr('-d is meaningless without -u (to set DNS I need a hostname)');
    if (!process.env['ZERIGO_DNS_KEY']) checkErr('-d requires ZERIGO_DNS_KEY env var');
    dnsKey = process.env['ZERIGO_DNS_KEY'];
    dnsHost = urlparse(opts.u).host;
    console.log("   ... Checking for DNS availability of " + dnsHost);  
  }

  dns.inUse(dnsKey, dnsHost, function(err, res) {
    checkErr(err);
    if (res) checkErr('that domain is in use, pointing at ' + res.data);

    vm.startImage({
      type: opts.t
    }, function(err, r) {
      checkErr(err);
      console.log("   ... VM launched, waiting for startup (should take about 20s)");

      vm.waitForInstance(r.instanceId, function(err, deets) {
        checkErr(err);

        if (dnsHost) console.log("   ... Adding DNS Record for " + dnsHost);

        dns.updateRecord(dnsKey, dnsHost, deets.ipAddress, function(err) {
          checkErr(err ? 'updating DNS: ' + err : err);

          console.log("   ... Instance ready, setting human readable name in aws");
          vm.setName(r.instanceId, longName, function(err) {
            checkErr(err);
            console.log("   ... name set, waiting for ssh access and configuring");
            var config = { public_url: (opts.u || "http://" + deets.ipAddress) };

            if (opts.x) {
              console.log("   ... adding additional configuration values");
              var x = JSON.parse(fs.readFileSync(opts.x));
              Object.keys(x).forEach(function(key) {
                config[key] = x[key];
              });
            }

            console.log("   ... public url will be:", config.public_url);

            ssh.copyUpConfig(deets.ipAddress, config, function(err, r) {
              checkErr(err);
              console.log("   ... victory!  server is accessible and configured");

              function postRemote() {
                if (awsboxJson.packages) {
                  console.log("   ... finally, installing custom packages: " + awsboxJson.packages.join(', '));
                }
                ssh.installPackages(deets.ipAddress, awsboxJson.packages, function(err, r) {
                  checkErr(err);
                  var postcreate = (awsboxJson.hooks && awsboxJson.hooks.postcreate) || null;
                  ssh.runScript(deets.ipAddress, postcreate,  function(err, r) {
                    checkErr(err);

                    if (opts.p && opts.s) {
                      console.log("   ... copying up SSL cert");
                      ssh.copySSL(deets.ipAddress, opts.p, opts.s, function(err) {
                        checkErr(err);
                        printInstructions(name, dnsHost, opts.u, deets);
                      });
                    } else {
                      printInstructions(name, dnsHost, opts.u, deets);
                    }
                  });
                });
              }
              
              if (!opts.remote) {
                postRemote();
              } else {
                git.addRemote(name, deets.ipAddress, function(err, r) {
                  if (err && /already exists/.test(err)) {
                    console.log("OOPS! you already have a git remote named '" + name + "'!");
                    console.log("to create a new one: git remote add <name> " +
                                "app@" + deets.ipAddress + ":git");
                  } else {
                    checkErr(err);
                  }
                  console.log("   ... and your git remote is all set up");
                  postRemote();
                });
              }
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
    checkErr(err);
    console.log("instance found, ip " + deets.ipAddress + ", restoring");
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
    Object.keys(r).forEach(function(k) {
      var v = r[k];
      var dispName = v.name;
      if (dispName.indexOf(v.instanceId) === -1) dispName += " {" + v.instanceId + "}";
      console.log(dispName + ":");
      console.log("  type:\t\t" + v.instanceType);
      console.log("  IP:\t\t" + v.ipAddress);
      console.log("  launched:\t" + relativeDate(v.launchTime));
//      console.log("  ssh key:\t" + v.keyName);
      console.log("")
    });
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
