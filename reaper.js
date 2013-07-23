#!/usr/bin/env node
process.title = 'awsbox';

// allow support for multiple sources for the ID / Secret
// AWS_ACCESS_KEY and AWS_SECRET_KEY are used by the EC2 CLI tools so these are preferred
process.env['AWS_ID'] = process.env['AWS_ID'] || process.env['AWS_ACCESS_KEY'];
process.env['AWS_SECRET'] = process.env['AWS_SECRET'] || process.env['AWS_KEY'] || process.env['AWS_SECRET_KEY']

const 
aws = require('./lib/aws.js'),
path = require('path'),
vm = require('./lib/vm.js'),
reaper = require('./lib/reaper.js'),
mailer = require('nodemailer').createTransport('sendmail'),  // TODO improve
fs = require('fs'),
optimist = require('optimist');

var parser = optimist
  .usage('awsbox reap: reap VMs that have been running for too long')
  .describe('dryrun', 'Perform a dry run. Sends emails, but DOES NOT terminate instances')
  .default('dryrun', false)
  .boolean('dryrun');


// schedule to for warnings to turning off the AWSBOX
const
  WARN1_TIME     = 24 * 5,      // 5th day, send first warning
  WARN2_TIME     = 24,          // 6th day, send the final warning
  TERMINATE_TIME = 24;          // 7th day, shut down the box

// load email templates

var tplWarning1  = fs.readFileSync(__dirname + '/reaper-templates/warning1.txt', 'utf8'),
    tplWarning2  = fs.readFileSync(__dirname + '/reaper-templates/warning2.txt', 'utf8'),
    tplTerminated  = fs.readFileSync(__dirname + '/reaper-templates/terminated.txt', 'utf8');

vm.listawsboxes(function(err, results) {
  Object.keys(results).forEach(function(instanceName) {
    var i = results[instanceName], 
        instanceId = i.instanceId, 
        name = (typeof(i.tags['Name']) !== 'undefined' && i.tags['Name'] !== '') ? 
          i.tags['Name'] : 'un-named'
    ;

    if (typeof(i.tags['AWSBOX_NOKILL']) != 'undefined') {
      console.log("NO_KILL " + instanceId);
      return
    }

    var AWSBOX_OWNER = (typeof(i.tags['AWSBOX_OWNER']) == 'undefined') ?
      '' : i.tags['AWSBOX_OWNER'];

    var AWSBOX_REAP = reaper.getState(i);

    if (AWSBOX_REAP.state === 0) { // never seen before...
      console.log("Setting initial reaper state: ", instanceId, name);
      reaper.setState(instanceId, 1, function(err) {
          if (err) {
            console.error('ERROR Setting AWSBOX_REAP initial state');
            return;
          }
      });

    /******************************************
     * SEND FIRST WARNING
     ******************************************/
    } else if (AWSBOX_REAP.state === 1 && AWSBOX_REAP.deltaHours > WARN1_TIME) {
      if (AWSBOX_OWNER != '') {
        mailer.sendMail({
          from: "AWSBOX Reaper <reaper@nodomain.none>",
          to  : AWSBOX_OWNER,
          subject: "Warning #1: Your AWSBOX [" + name + "] is scheduled to be terminated",
          text: tplWarning1
                  .replace(/==INSTANCE_ID==/g, instanceId)
                  .replace(/==INSTANCE_NAME==/g, name)
        }, function(err, response) {
          if (err) {
            console.error("ERROR sending warning 1", err, AWSBOX_OWNER);
          } else {
            console.log("Sent Warning #1 to ", AWSBOX_OWNER);
          }
        });
      }

      reaper.setState(instanceId, 2, function(err) {
          if (err) {
            console.error('ERROR Setting first warning state');
            return;
          }
      });
    /******************************************
     * SEND FINAL WARNING
     ******************************************/
    } else if (AWSBOX_REAP.state === 2 && AWSBOX_REAP.deltaHours > WARN2_TIME) {
      if (AWSBOX_OWNER != '') {
        mailer.sendMail({
          from: "AWSBOX Reaper <reaper@nodomain.none>",
          to  : AWSBOX_OWNER,
          subject: "FINAL Warning: Your AWSBOX [" + name + "] is scheduled to be terminated",
          text: tplWarning2.replace(/==INSTANCE_ID==/g, instanceId).replace(/==INSTANCE_NAME==/g, name)
        }, function(err, response) {
          if (err) {
            console.error("ERROR sending warning 2", err, AWSBOX_OWNER);
          } else {
            console.log("Sent Warning #2 to ", AWSBOX_OWNER);
          }
        });
      }

      reaper.setState(instanceId, 3, function(err) {
          if (err) {
            console.error('ERROR Setting second warning state');
            return;
          }
      });

    /******************************************
     * TERMINATE THE BOX
     ******************************************/
    } else if (AWSBOX_REAP.state === 3 && AWSBOX_REAP.deltaHours > TERMINATE_TIME) {
      if (typeof(i.tags['AWSBOX_SPAREME']) !== 'undefined') {
        vm.deleteTags(instanceId, ['AWSBOX_SPAREME', 'AWSBOX_REAP'], function(err) {
          if (err) {
            console.error('ERROR Setting second warning state');
            return;
          }
          console.log("Spared:", instanceId, name)
        });
      } else {
        if (AWSBOX_OWNER != '') {
          mailer.sendMail({
            from: "AWSBOX Reaper <reaper@nodomain.none>",
            to  : AWSBOX_OWNER,
            subject: "FINAL Warning: Your AWSBOX [" + name + "] is scheduled to be terminated",
            text: tplTerminated.replace(/==INSTANCE_ID==/g, instanceId).replace(/==INSTANCE_NAME==/g, name)
          }, function(err, response) {
            if (err) {
              console.error("ERROR sending termination notification", err, AWSBOX_OWNER);
            } else {
              console.log("Sent Termination Notification to", AWSBOX_OWNER);
            }
          });
        }

        if (parser.argv.dryrun === false) {
          aws.client.call('TerminateInstances', {
            InstanceId: instanceId
          }, function(result) {
            try { // so we don't get undefined issues for outputting the error
              console.log("TERMINATION ERROR: ", instanceId, name, result.Errors.Error);
            } catch(e) {
              console.log("Terminated AWSBOX: ", instanceId, name, result);
            }
          });
        } else {
          console.log("Dry Run, skipping termination");
        }
      }
    }
  });
});
