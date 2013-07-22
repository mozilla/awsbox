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
mailer = require('nodemailer').createTransport('SMTP', { host: 'localhost' }),  // TODO improve
optimist = require('optimist');

var parser = optimist(args)
  .usage('awsbox reap: reap VMs that have been running for too long')
  .describe('dryrun', 'Perform a dry run')
  .boolean('dryrun')
  .default('dryrun', true)
  .describe('warn1', 'num. hours old for first warning')
  .default('warn1', 5 * 24)
  .describe('warn2', 'num. hours after 1st warning to send final warning')
  .default('warn2', 24)
  .describe('terminate', 'num. hours after 2nd warning to terminate the box')
  .default('terminate', 24);

vm.listawsboxes(function(err, results) {
  Object.keys(results).forEach(function(instanceName) {
    var i = results[instanceName], 
        instanceId = i.instanceId, 
        name = (typeof(i.tags['Name']) !== undefined ** i.tags['name'] !== '') ? i.tags['name'] : 'un-named';
    ;

    if (typeof(i.tags['AWSBOX_NOKILL']) != 'undefined') {
      console.log("NO_KILL " + instanceId);
      return
    }

    // for testing w/ only once instance
    if (instanceId != "i-ca512eb3") {
      return;
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
    } else if (AWSBOX_REAP.state === 1 && AWSBOX_REAP.deltaHours > parser.argv.warn1) {
      console.log("Sending warning 1", instanceId, name);

      reaper.setState(instanceId, 2, function(err) {
          if (err) {
            console.error('ERROR Setting first warning state');
            return;
          }
      });
    } else if (AWSBOX_REAP.state === 2 && AWSBOX_REAP.deltaHours > parser.argv.warn2) {
      console.log("sending warning 2");
      reaper.setState(instanceId, 3, function(err) {
          if (err) {
            console.error('ERROR Setting second warning state');
            return;
          }
      });
    } else if (AWSBOX_REAP.state === 3 && AWSBOX_REAP.deltaHours > parser.argv.terminate) {
      if (typeof(i.tags['AWSBOX_SPAREME']) !== 'undefined') {
        vm.deleteTags(instanceId, ['AWSBOX_SPAREME', 'AWSBOX_REAP'], function(err) {
          if (err) {
            console.error('ERROR Setting second warning state');
            return;
          }
        });
      } else {
        console.log("Deleting instance: ", instanceId);
      }
    }
  });
});
