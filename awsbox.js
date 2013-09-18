#!/usr/bin/env node

process.title = 'awsbox';

const
aws = require('./lib/aws.js'),
path = require('path'),
vm = require('./lib/vm.js'),
key = require('./lib/key.js'),
ssh = require('./lib/ssh.js'),
dns = require('./lib/dns.js'),
git = require('./lib/git.js'),
optimist = require('optimist'),
urlparse = require('urlparse'),
colors = require('colors'),
hooks = require('./lib/hooks'),
config = require('./lib/config'),
util = require('util'),
fs = require('fs'),
relativeDate = require('relative-date'),
existsSync = fs.existsSync || path.existsSync; // existsSync moved path to fs in 0.7.x

// allow multiple different env vars (for the canonical AWS_ID and AWS_SECRET)
[ 'AWS_KEY', 'AWS_ID', 'AWS_ACCESS_KEY' ].forEach(function(x) {
  process.env['AWS_ID'] = process.env['AWS_ID'] || process.env[x];
});
[ 'AWS_SECRET', 'AWS_SECRET_KEY' ].forEach(function(x) {
  process.env['AWS_SECRET'] = process.env['AWS_SECRET'] || process.env[x];
});

colors.setTheme({
  input: 'grey',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'green',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
});

var verbs = {};

function checkErr(err) {
  if (err) {
    process.stderr.write('ERRORE FATALE: '.error + err + "\n");
    process.exit(1);
  }
}

function printInstructions(name, host, url, deets) {
  if (!url) url = 'http://' + deets.ipAddress;
  if (!host) host = deets.ipAddress;
  console.log("");
  console.log("Yay!  You have your very own deployment.  Here's the basics:\n".info);
  console.log(" 1. deploy your code:  git push ".info + name + " HEAD:master".info);
  console.log(" 2. visit your server on the web: ".info + url);
  console.log(" 3. ssh in with sudo: ssh ec2-user@".info + host);
  console.log(" 4. ssh as the deployment user: ssh app@".info + host);
  console.log("\n Here are your server's details:".info , JSON.stringify(deets, null, 4));
}

function validateName(name) {
  if (!name.length) {
    throw "invalid name!  must be non-null)".error;
  }
  return name;
}

function validatePath(path) {
  try {
    var stats = fs.statSync(path);
    return path;
  } catch (err) {
    throw "invalid path! ".error + err.message;
  }
}

function getKeyTexts(path) {
  var key = fs.readFileSync(validatePath(path)).toString();

  key = key.trimRight();
  if (key.match('\r\n')) {
    return key.split('\r\n');
  }
  return key.split('\n');
}

function copySSLCertIfAvailable(opts, deets, cb) {
  if (opts.p && opts.s) {
    console.log("   ... copying up SSL cert".verbose);
    ssh.copySSL(deets.ipAddress, opts.p, opts.s, function(err) {
      checkErr(err);
      cb && cb(null, null);
    });
  } else {
    cb && cb(null, null);
  }
}

verbs['destroy'] = function(args) {
  if (!args || args.length != 1) {
    throw 'missing required argument: name of instance'.error;
  }
  var name = args[0];
  validateName(name);
  var hostname = name;

  process.stdout.write("trying to destroy VM for ".warn + hostname + ": ");
  vm.destroy(name, function(err, deets) {
    console.log(err ? ("failed: ".error + err) : "done");
    if (deets && deets.ipAddress) {
      process.stdout.write("trying to remove git remote: ".warn);
      git.removeRemote(name, deets.ipAddress, function(err) {
        console.log(err ? "failed: ".error + err : "done");

        process.stdout.write("trying to remove DNS: ".warn);
        dns.findByIP(deets.ipAddress, function(err, fqdns) {
          checkErr(err);
          if (!fqdns.length) return console.log("no dns entries found".info);
          console.log(fqdns.join(', '));
          function removeNext() {
            if (!fqdns.length) return;
            var fqdn = fqdns.shift();
            process.stdout.write("deleting ".warn + fqdn + ": ");
            dns.deleteRecord(fqdn, function(err) {
              checkErr(err);
              console.log("done");
              removeNext();
            });
          }
          removeNext();
        });
      });
    }
  });
}
verbs['destroy'].doc = "teardown a vm, git remote, and DNS";

verbs['test'] = function() {
  // let's see if we can contact aws
  process.stdout.write("Checking AWS access: ");
  vm.list(function(err) {
    console.log(err ? "NOT ok: " + err : "good");

    process.stdout.write("Checking DNS access: ");
    dns.inUse('example.com', function(err, res) {
        if (err) {
          console.log('Err: ', err);
          process.exit(1);
        }
        console.log('good');
    });
  });
}
verbs['test'].doc = "\tcheck to see if we have AWS credential properly configured";

verbs['listdomains'] = function(args) {
  dns.listDomains(function(err, zones) {
    if (err) {
      return console.log('Err: ', err);
    }
    zones.forEach(function(zone) {
      console.log(zone.name);
    });
  });
};
verbs['listdomains'].doc = "lists all domains in Route53";

verbs['listhosts'] = function(args) {
  if (!args || args.length !== 1) {
    throw 'missing required argument: name of domain'.error;
  }

  var domainName = args[0];
  process.stdout.write("Listing hosts for " + domainName + ": ");
  dns.listHosts(domainName, function(err, hosts) {
    if (err) {
      return console.log('Err: ', err);
    }

    console.log('done');

    hosts.forEach(function(host) {
      host.values.forEach(function(val) {
        console.log(host.name + ' ' + host.ttl + ' ' + host.type + ' ' + val);
      });
    });
  });
};
verbs['listhosts'].doc = "lists all hosts in a domain: <domain>";

verbs['findbyip'] = function(args) {
  dns.findByIP(args[0], function(err, found) {
    if (err) {
      console.log("ERROR:", err);
      process.exit(1);
    }
    console.log(found.join("\n"));
  });
};
verbs['findbyip'].doc = "find a hostname given an ip address";

verbs['zones'] = function(args) {
  aws.zones(function(err, r) {
    if (err) {
      console.log("ERROR:", err);
      process.exit(1);
    }
    Object.keys(r).forEach(function(region) {
      console.log(region, "(" + r[region].endpoint + "):");
      var zones = r[region].zones;
      zones.forEach(function(zone) {
        console.log(" *", zone.name, "(" + zone.state + ")");
      });
    });
  });
};
verbs['zones'].doc = "list Amazon regions and availability zones";

verbs['updaterecord'] = function(args) {
  var hostname = args[0];
  var ipAddress = args[1];
  dns.updateRecord(hostname, ipAddress, function(err, changeInfo, ee) {
    if (err) {
      console.log("ERROR:", err);
      process.exit(1);
    }

    console.log('Record updated, changeId=%s', changeInfo.changeId);

    // now let's wait for the change to be in sync
    console.log('Waiting for change to be INSYNC ...');
    ee
      .on('attempt', function() {
        console.log('- still waiting ...');
      })
      .on('insync', function() {
        console.log('Change now INSYNC');
        console.log('Updated ' + hostname);
      })
      .on('err', function(err) {
        console.log('Err: ', err);
      })
   ;
  });
};
verbs['updaterecord'].doc = "updated a resource record's A value. e.g. updaterecord sub.example.com 1.2.3.4";

verbs['deleterecord'] = function(args) {
  var hostname = args[0];
  dns.deleteRecord(hostname, function(err, changeInfo, ee) {
    if (err) {
      console.log("ERROR:", err);
      process.exit(1);
    }

    console.log('Record deleted, changeId=%s', changeInfo.changeId);

    // now let's wait for the change to be in sync
    console.log('Waiting for change to be INSYNC ...');
    ee
      .on('attempt', function() {
        console.log('- still waiting ...');
      })
      .on('insync', function() {
        console.log('Change now INSYNC');
        console.log('Deleted ' + hostname);
      })
      .on('err', function(err) {
        console.log('Err: ', err);
      })
   ;
  });
};
verbs['deleterecord'].doc = "delete a resource record. e.g. sub.example.com (this does not delete zones)";

verbs['create'] = function(args) {
  var parser = optimist(args)
    .usage('awsbox create: Create a VM')
    .describe('d', 'setup DNS via Route53')
    .describe('dnscheck', 'whether to check for existing DNS records')
    .boolean('dnscheck')
    .default('dnscheck', true)
    .describe('h', 'get help')
    .alias('h', 'help')
    .describe('n', 'a short nickname for the VM.')
    .describe('keydir', 'a directory containing files with public keys to be added to the VM')
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
    .describe('g', 'security group name, finds or creates a security group with this name')
    .describe('userData', 'opaque instance user data')
    .describe('p', 'public SSL key (installed automatically when provided)')
    .describe('s', 'secret SSL key (installed automatically when provided)')
    .check(function(argv) {
      // p and s are all or nothing
      if (argv.s ? !argv.p : argv.p) throw "-p and -s are both required";
      if (argv.s) {
        if (!existsSync(argv.s)) throw "file '" + argv.s + "' doesn't exist";
        if (!existsSync(argv.p)) throw "file '" + argv.p + "' doesn't exist";
      }
    })
    .describe('ssl', 'configure SSL behavior - enable, disable, force')
    .default('ssl', 'enable')
    .check(function(argv) {
      var valid = [ 'enable', 'disable', 'force' ];
      if (valid.indexOf(argv.ssl) === -1) {
        throw "ssl must be one of " + valid.join(", ");
      }
    })
    .describe('x', 'path to a json file with Xtra configuration to copy up to ./config.json')
    .check(function(argv) {
      if (argv.x) {
        if (!existsSync(argv.x)) throw "file '" + argv.x + "' doesn't exist";
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
  var longName = process.env['USER'] + "'s awsbox deployment (" + name + ')';

  console.log("reading .awsbox.json");

  var awsboxJson = config.get();

  console.log("attempting to set up VM \"" + name + "\"");

  var dnsHost;
  if (opts.d) {
    if (!opts.u) checkErr('-d is meaningless without -u (to set DNS I need a hostname)');
    dnsHost = urlparse(opts.u).host;
    console.log('You said -d, so we shall check dnsHost=' + dnsHost);
    if (opts.dnscheck) {
      console.log("   ... Checking for DNS availability of " + dnsHost);
    }
  }

  // for a simplified code flow, we'll always check if the dns address is in use.
  // we ignore an error if -d (setup dns) is not specified)
  dns.inUse(dnsHost, function(err, res) {
    if (opts.d && err) {
      console.log("ERROR:", err);
      process.exit(1);
    }

    if (res && opts.dnscheck) {
      checkErr('that domain is in use, pointing at ' + JSON.stringify(res.values));
    }

    vm.startImage({
      ami: awsboxJson.ami,
      type: opts.t,
      groupName: opts.g,
      userData: opts.userData
    }, function(err, r) {
      checkErr(err);
      console.log("   ... VM launched, waiting for startup (should take about 20s)");

      vm.waitForInstance(r.instanceId, function(err, deets) {
        checkErr(err);

        if (dnsHost) console.log("   ... Adding DNS Record for " + dnsHost);

        dns.updateRecord(dnsHost, deets.ipAddress, function(err) {
          checkErr((opts.d && err) ? 'updating DNS: ' + err.msg : null);

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

              key.addKeysFromDirectory(deets.ipAddress, opts.keydir, function(msg) {
                console.log("   ... " + msg);
              }, function(err) {
                checkErr(err);

                console.log("   ... applying system updates");
                ssh.updatePackages(deets.ipAddress, function(err, r) {
                  checkErr(err);

                  function postRemote() {
                    console.log("   ... configuring SSL behavior (" + opts.ssl + ")");
                    ssh.configureProxy(deets.ipAddress, opts.ssl, function(err, r) {
                      checkErr(err);
                      if (awsboxJson.packages) {
                        console.log("   ... finally, installing custom packages: " + awsboxJson.packages.join(', '));
                      }
                      ssh.installPackages(deets.ipAddress, awsboxJson.packages, function(err, r) {
                        checkErr(err);
                        hooks.runRemoteHook('postcreate', deets, function(err, r) {
                          checkErr(err);

                          copySSLCertIfAvailable(opts, deets, function(err, status) {
                            checkErr(err);
                            hooks.runLocalHook('postcreate', deets, function(err) {
                              printInstructions(name, dnsHost, opts.u, deets);
                            });
                          });
                        });
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
    });
  });
};
verbs['create'].doc = "create an EC2 instance, -h for help".info;

verbs['createami'] = function(args) {
  if (!args || args.length != 1) {
    throw 'missing required argument: name of instance'.error;
  }

  var name = args[0];
  validateName(name);
  var hostname = name;

  console.log("restoring to a pristine state, and creating AMI image from ".warn + name);

  vm.describe(name, function(err, deets) {
    checkErr(err);
    console.log("instance found, ip ".info + deets.ipAddress + ", restoring");
    ssh.makePristine(deets.ipAddress, function(err) {
      console.log("instance is pristine, creating AMI".info);
      checkErr(err);
      vm.createAMI(name, function(err, imageId) {
        checkErr(err);
        console.log("Created image:".info, imageId, "- waiting for creation and making it public (can take a while)".warn);
        vm.makeAMIPublic(imageId, function(err) {
          console.log("  ... still waiting:".warn, err);
        }, function(err, imageId) {
          checkErr(err);
          vm.destroy(name, function(err, deets) {
            checkErr(err);
            if (deets && deets.ipAddress) {
              process.stdout.write("trying to remove git remote: ".warn);
              git.removeRemote(name, deets.ipAddress, function(err) {
                // non-fatal
                if (err) console.log("failed: ".error + err);
                console.log("All done!".info);
              });
            }
          });
        });
      });
    });
  });
};
verbs['createami'].doc = "create an ami from an EC2 instance - WILL DESTROY INSTANCE";

verbs['list'] = function(args) {
  vm.list(function(err, r) {
    checkErr(err);
    Object.keys(r).forEach(function(k) {
      var v = r[k];
      var dispName = v.name;
      if (dispName.indexOf(v.instanceId) === -1) dispName += " {" + v.instanceId + "}";
      console.log(util.format('  %s:\t\n    %s, %s, launched %s\n',
                              dispName, v.ipAddress, v.instanceType,
                              relativeDate(v.launchTime)));
    });
  });
};
verbs['list'].doc = "\tlist all VMs on the aws account";

verbs['update'] = function(args) {
  if (!args || args.length != 1) {
    throw 'missing required argument: name of instance'.error;
  }
  var name = args[0];
  validateName(name);

  vm.find(name, function(err, deets) {
    checkErr(err);

    if (deets && deets.ipAddress) {
      console.log("pushing to git repo".warn, deets.ipAddress);
      git.push(deets.ipAddress, function(line) {
        console.log(line);
      }, function(status) {
        if (!status) {
          hooks.runLocalHook('poststart', deets);
        }
        else {
          checkErr("Could not push git instance".error);
        }
      });
    }
    else {
      console.log(name, "is not an awsbox instance".error);
    }
  });
};
verbs['update'].doc = "git push to an instance";

verbs['describe'] = function(name) {
  validateName(name);
  vm.describe(name, function(err, deets) {
    if (err) fail(err);
    console.log(JSON.stringify(deets, null, 2));
  });
};
verbs['describe'].doc = "get information about an instance (by instance id, or name)"

verbs['listkeys'] = function(name) {
  validateName(name);
  vm.describe(name, function(err, deets) {
    if (err) fail(err);

    console.log("Fetching authorized keys for ".warn + name + " (" + deets.ipAddress + ") ...\n");
    ssh.listSSHPubKeys(deets.ipAddress, function(err, keys) {
      if (err) fail(err);
      console.log(keys);
    });
  });
};
verbs['listkeys'].doc = "list ssh keys on an instance: <instance name/id>"

verbs['addkey'] = function(args) {
  if (args.length != 2) {
    throw 'Args required for addkey: instance_name, path_to_key_file'.error;
  }

  var name = [ validateName(args[0]) ];
  vm.describe(name, function(err, deets) {
    if (err) fail(err);

    fs.stat(args[1], function(err, rez) {
      if (err) {
        console.error("error reading keys:", err.toString());
      } else if (rez.isFile()) {
        var keys = getKeyTexts(args[1]);
        var numKeys = keys.length;

        // We don't want a whole bunch of asynchronous ssh processes adding
        // and removing keys from the same file at the same time.  Ensure
        // only one key is added at a time.
        console.log("Adding the " + numKeys + " key" + (numKeys > 1 ? "s" : "") + " found in that file.");
        addNextKey();

        var added = 0;
        function maybeAddAnotherKey() {
          added += 1;
          if (added < numKeys) {
            addNextKey();
          } else {
            console.log("done.".info);
            return;
          }
        }

        function addNextKey() {
          var key = keys[added];
          console.log("\nAdding key: ".warn + key);
          ssh.addSSHPubKey(deets.ipAddress, key, maybeAddAnotherKey);
        }
      } else if (rez.isDirectory()) {
        var nKeys = 0;
        key.addKeysFromDirectory(deets.ipAddress, args[1], function(msg) {
          nKeys++;
          console.log(" +", msg);
        }, function(err) {
          if (err) console.error("failed to add keys:", err);
          else console.log("added", nKeys, "key(s)");
        });
      } else {
        console.error("neither a file nor a directory:", args[1]);
      }
    });
  });
};
verbs['addkey'].doc = "add an ssh key to an instance: <instance> <file_or_dir>";

verbs['removekey'] = function(args) {
  if (args.length != 2) {
    throw 'Args required for removekey: instance_name, path_to_key_file'.error;
  }

  var name = [ validateName(args[0]) ];
  var keys = getKeyTexts(args[1]);
  var numKeys = keys.length;
  var removed = 0;

  vm.describe(name, function(err, deets) {
    if (err) fail(err);

    // We don't want a whole bunch of asynchronous ssh processes adding
    // and removing keys from the same file at the same time.  Ensure
    // only one key is removed at a time.
    console.log("Removing the ".warn + numKeys + " key".warn + (numKeys > 1 ? "s" : "") + " found in that file.".warn);
    removeNextKey();

    function maybeRemoveAnotherKey() {
      removed += 1;
      if (removed < numKeys) {
        removeNextKey();
      } else {
        console.log("done.".info);
        return;
      }
    }

    function removeNextKey() {
      var key = keys[removed];
      console.log("\nRemoving key: ".warn + key);
      ssh.removeSSHPubKey(deets.ipAddress, key, maybeRemoveAnotherKey);
    }
  });
};
verbs['removekey'].doc = "remove a specific ssh key from an instance";

if (process.argv.length <= 2) fail();

var verb = process.argv[2].toLowerCase();
if (!verbs[verb]) fail(verb != '-h' ? "no such command: " + verb : null);

// check for required environment variables
if (!process.env['AWS_ID'] || !process.env['AWS_SECRET']) {
  fail('Missing aws credentials\nPlease configure the AWS_ID and AWS_SECRET environment variables.');
}

// set the region (or use the default if none supplied)
var region = aws.createClients(process.env['AWS_REGION']);
console.log("(Using region", region + ")");

// now call the command
try {
  verbs[verb](process.argv.slice(3));
} catch(e) {
  fail("error running '".error + verb + "' command: ".error + e);
}

function fail(error) {
  if (error && typeof error.message === 'function') error = error.message();
  if (error && typeof error.message !== 'string') error = error.toString();

  if (error) process.stderr.write('fatal error: '.error + error + "\n");
  else {
    process.stderr.write('A tool to deploy NodeJS systems on Amazon\'s EC2\n');
    process.stderr.write('Usage: ' + path.basename(__filename) +
                         ' <' + Object.keys(verbs).join('|') + "> [args]\n\n");
    Object.keys(verbs).sort().forEach(function(verb) {
      process.stderr.write(util.format("  %s:\t%s\n", verb,
                                       verbs[verb].doc || "no docs"));
    });
  }
  process.exit(1);
}
