const
aws = require('./aws.js'),
jsel = require('JSONSelect'),
key = require('./key.js'),
sec = require('./sec.js');

const TEMPLATE_IMAGE_ID = 'ami-e33b508a';
const DEFAULT_USER_DATA = '{}';

function extractInstanceDeets(horribleBlob) {
  var instance = {};
  ["instanceId", "imageId", "instanceState", "dnsName", "keyName", "instanceType",
   "ipAddress"].forEach(function(key) {
     if (horribleBlob[key]) instance[key] = horribleBlob[key];
   });
  if (horribleBlob.launchTime) {
    instance.launchTime  = new Date(horribleBlob.launchTime);
  }

  var name = jsel.match('.tagSet :has(.key:val("Name")) > .value', horribleBlob);
  if (name.length && typeof name[0] === 'string') {
    instance.fullName = name[0];
    // if this is a 'awsbox deployment', we'll only display the hostname chosen by the
    // user
    var m = /awsbox deployment \((.*)\)$/.exec(instance.fullName);
    instance.name = m ? m[1] : instance.fullName;
  } else {
    instance.name = instance.instanceId;
  }

  return instance;
}

exports.describe = function(name, cb) {
  exports.list(function(err, r) {
    if (err) return cb('failed to list vms: ' + err);

    var deets = findInstance(r, name);
    if (!deets) return cb('no such vm');
    cb(null, deets);
  });
};

exports.list = function(cb) {
  aws.client.DescribeInstances(function(err, result) {
    if (err) return cb(aws.makeError(err));
    var instances = {};
    jsel.forEach(
      '.instancesSet > .item:has(.instanceState .name:val("running"))',
      result, function(item) {
        var deets = extractInstanceDeets(item);
        var key = deets.name || item.instanceId;
        if (instances[key]) key += " {" + item.instanceId + "}";
        instances[key] = deets;
      });
    cb(null, instances);
  });
};

// given something the user typed in, try to figure out what instance they're talking about
function findInstance(r, name) {
  if (typeof name !== 'string') name = name.toString();

  // is what the human typed in an instance id?
  try {
    var x = jsel.match('object:has(:root > .instanceId:val(?))', [name], r);
    if (x.length) return x[0];
  } catch(e) {}

  // is what the human typed in the vm "short name" ?
  var fn = process.env['USER'] + "'s awsbox deployment (" + name + ")";
  x = jsel.match('object:has(:root > .fullName:val(?))', [ fn ], r);
  if (x.length) return x[0];

  // or did the human type in the full name?
  x = jsel.match('object:has(:root > .fullName:val(?))', [ name ], r);
  if (x.length) return x[0];

  return undefined;
}

exports.destroy = function(name, cb) {
  exports.list(function(err, r) {
    if (err) return cb('failed to list vms: ' + err);

    deets = findInstance(r, name);
    if (!deets) return cb('no such vm');

    aws.client.TerminateInstances({
      InstanceId: deets.instanceId
    }, function(err, result) {
      if (err) return cb(aws.makeError(err));
      cb(null, deets);
    });
  });
};

function dateBasedVersion() {
  var d = new Date();
  function pad(n){return n<10 ? '0'+n : n}
  return d.getUTCFullYear()+'.'
    + pad(d.getUTCMonth()+1)+'.'
    + pad(d.getUTCDate())+'-'
    + pad(d.getUTCHours())+'.'
    + pad(d.getUTCMinutes());
}

exports.find = function(name, cb) {
  exports.list(function(err, r) {
    if (err) return cb('failed to list vms: ' + err);

    deets = findInstance(r, name);
    if (!deets) return cb('no such vm');
    cb(null, deets);
  });
};

exports.createAMI = function(name, cb) {
  exports.find(name, function(err, deets) {
    if (err) return cb(err);

    aws.client.CreateImage({
      InstanceId: deets.instanceId,
      Name: "awsbox deployment image v" + dateBasedVersion(),
      Description: "An image for use with awsbox.org, a DIY PaaS for noders"
    }, function(err, result) {
      if (err) return (err.Errors.Error.Message);
      result = jsel.match('.imageId', result)[0];
      cb(null, result);
    });
  });
};

exports.makeAMIPublic = function(imageId, progress, cb) {
  var startTime = new Date();

  function attempt() {
    aws.client.ModifyImageAttribute({
      ImageId: imageId,
      LaunchPermission: {
          Add: [ { Group: 'all' } ],
      },
    }, function(err, result) {
      // ToDo: ...
      if (result && result.return === 'true') {
        return cb(null);
      }

      var e;
      try {
        if (result.Errors.Error.Message) {
          if (result.Errors.Error.Message.indexOf('currently pending') === -1) {
            return cb(result.Errors.Error.Message);
          }
          e = result.Errors.Error.Message;
        }
      } catch(e) {
        e = "unknown";
      };

      if (new Date() - startTime > 600 * 1000) {
        return cb("timed out waiting for instance to become public");
      }

      setTimeout(function() {
        if (typeof progress === 'function') progress(e || "unknown");
        attempt();
      }, 15000);
    });
  }

  attempt();
};

function returnSingleImageInfo(err, result, cb) {
  if (err) return(err.Errors.Error.Message);
  // ToDo: figure out if we need this
  if (!result) return cb('no results from ec2 api');
  // ToDo: something with this and extractInstanceDeets
  try {
    result = jsel.match('.instancesSet > .item', result)[0];
    cb(null, extractInstanceDeets(result));
  } catch(e) {
    return cb("couldn't extract new instance details from ec2 response: " + e);
  }
}

exports.startImage = function(opts, cb) {
  key.getName(function(err, keyName) {
    if (err) return cb(err);
    sec.getName(opts.groupName, function(err, groupName) {
      if (err) return cb(err);
      var userData = opts.userData || DEFAULT_USER_DATA;
      aws.client.RunInstances({
        ImageId: opts.ami || TEMPLATE_IMAGE_ID,
        KeyName: keyName,
        SecurityGroup: groupName,
        InstanceType: opts.type,
        MinCount: 1,
        MaxCount: 1,
        UserData: new Buffer(userData).toString('base64')
      }, function (err, result) {
        returnSingleImageInfo(err, result, cb);
      });
    });
  });
};

exports.waitForInstance = function(id, cb) {
  aws.client.DescribeInstanceStatus({
    InstanceId: id
  }, function(err, r) {
    if (err) return cb('error during operation', err);

    // we're waiting and amazon might not have created the image yet!  that's
    // not an error, just an api timing quirk
    var waiting = jsel.match('.Error .Code:val("InvalidInstanceID.NotFound")', r);
    if (waiting.length) {
      return setTimeout(function(){ exports.waitForInstance(id, cb); }, 1000);
    }

    // find the instanceStatusSet
    var status = jsel.match('.instanceStatusSet', r)[0];
    if ( status === '' ) {
      console.log('   ... waiting');
      return setTimeout(function(){ exports.waitForInstance(id, cb); }, 1000);
    }

    var deets = extractInstanceDeets(status.item);
    if (deets && deets.instanceState && deets.instanceState.name === 'running') {
      return aws.client.DescribeInstances( { InstanceId: id }, function(err, result) {
        if (err) return cb('error during operation', err);
        returnSingleImageInfo(err, result, cb);
      });
    }
    setTimeout(function(){ exports.waitForInstance(id, cb); }, 1000);
  });
};

exports.setName = function(id, name, cb) {
  aws.client.CreateTags({
    ResourceId: [ id ],
    Tag: [{ Key: 'Name', Value: name }],
  }, function(err, result) {
    if (err) return cb(err.Errors.Error.Message);
    // ToDo: check if there are ever any errors which aren't in err.Errors.Error.Message???
    cb();
  });
};
