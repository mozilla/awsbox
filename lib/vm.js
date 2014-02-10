const
aws = require('./aws.js'),
jsel = require('JSONSelect'),
key = require('./key.js'),
sec = require('./sec.js'),
fs = require('fs'),
path = require('path'),
config = require('./config.js');

// determine the appropriate default AMI for this region
const TEMPLATE_IMAGE_ID = config.getDefaultImageId();
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
  instance.tags = {};

  try {
    // amazon is cute, and formats singled items without a containing
    // array
    if (horribleBlob.tagSet.item.key) {
      horribleBlob.tagSet.item = [ horribleBlob.tagSet.item ];
    }
    horribleBlob.tagSet.item.forEach(function(kv) {
      if (kv.key === "Name") {
        var name = kv.value;
        instance.fullName = name;
        // if this is a 'awsbox deployment', only display hostname chosen by user
        var m = /awsbox deployment \((.*)\)$/.exec(instance.fullName);
        instance.name = m ? m[1] : instance.fullName;
      } else {
        instance.tags[kv.key] = kv.value;
      }
    });
  } catch(e) {
    // suppress error if tagset can't be traversed
  }

  if (!instance.name) instance.name = instance.instanceId;

  return instance;
}

exports.list = function(cb) {
  aws.client.DescribeInstances(function(err, result) {
    if (err) return cb(aws.makeError(err));
    var instances = {};
    jsel.forEach(
      '.instancesSet object:has(.instanceState .name:val("running"))',
      result, function(item) {
        var deets = extractInstanceDeets(item);
        var key = deets.name || item.instanceId;
        if (instances[key]) key += " {" + item.instanceId + "}";
        instances[key] = deets;
      });
    cb(null, instances);
  });
};

exports.search = function(token, cb) {
  if (typeof token !== 'string') {
    throw new Error('string argument required to .search');
  }
  token = token.toLowerCase();
  exports.list(function(err, arr) {
    if (err) return cb(err);
    Object.keys(arr).forEach(function(k) {
      // search all strings in the details for a substring match of the specified
      // token
      var ix = jsel.match('string', arr[k]).join(" ").toLowerCase().indexOf(token);
      if (ix === -1) delete arr[k];
    });
    cb(null, arr);
  });
};

// given something the user typed in, try to figure out what instance they're talking about
function findInstance(r, name) {
  if (typeof name !== 'string') name = name.toString();

  // is what the human typed in an instance id?
  var x;
  try {
    x = jsel.match('object:has(:root > .instanceId:val(?))', [name], r);
    if (x.length === 1) return x[0];
  } catch(e) {}

  // is what the human typed in the vm "short name" ?
  var fn = "awsbox deployment (" + name + ")";
  x = jsel.match('object:has(:root > .fullName:contains(?))', [ fn ], r);
  if (x.length === 1) return x[0];

  // or did the human type in the full name?
  x = jsel.match('object:has(:root > .fullName:val(?))', [ name ], r);
  if (x.length === 1) return x[0];

  return undefined;
}

exports.destroy = function(name, cb) {
  exports.find(name, function(err, deets) {
    if (err) return cb('failed to find vm: ' + err);

    aws.client.TerminateInstances({
      InstanceId: deets.instanceId
    }, function(err) {
      if (err) return cb(aws.makeError(err));
      cb(null, deets);
    });
  });
};

function dateBasedVersion() {
  var d = new Date();
  var pad = function(n){
    return (n<10 ? '0'+n : n);
  };
  return d.getUTCFullYear()+'.'
    + pad(d.getUTCMonth()+1)+'.'
    + pad(d.getUTCDate())+'-'
    + pad(d.getUTCHours())+'.'
    + pad(d.getUTCMinutes());
}

exports.describe = exports.find = function(name, cb) {
  function slowFind(name, cb) {
    exports.list(function(err, r) {
      if (err) return cb('failed to list vms: ' + err);
      var deets = findInstance(r, name);
      if (!deets) return cb('no such vm');
      cb(null, deets);
    });
  }

  // optimization - if an image id is provided, then we can
  // be much more efficient.
  if (/^i-[a-z0-9]+$/i.test(name)) {
    return aws.client.DescribeInstances( { InstanceId: name }, function(err, result) {
      if (err) return slowFind(name, cb);
      returnSingleImageInfo(err, result, cb);
    });
  } else {
    slowFind(name, cb);
  }
};

exports.createAMI = function(name, cb) {
  exports.find(name, function(err, deets) {
    if (err) return cb(err);

    aws.client.CreateImage({
      InstanceId: deets.instanceId,
      Name: "awsbox deployment image v" + dateBasedVersion(),
      Description: "An image for use with awsbox.org, a DIY PaaS for noders"
    }, function(err, result) {
      if (err) return aws.makeError(err);
      result = jsel.match('.imageId', result)[0];
      cb(null, result);
    });
  });
};

exports.makeAMIPublic = function(imageId, tgtRegion, progress, cb) {
  var startTime = new Date();
  var client;

  // region is optional, support 3 parameter invocation
  if (!cb && typeof tgtRegion === 'function') {
    client = aws.client;
    cb = progress;
    progress = tgtRegion;
  } else {
    client = aws.allocateEC2Client(tgtRegion);
  }

  function attempt() {
    client.ModifyImageAttribute({
      ImageId: imageId,
      LaunchPermission: {
        Add: [ { Group: 'all' } ],
      },
    }, function(err) {
      if (!err) {
        return cb(null);
      } else {
        var e;
        try {
          if (err.Body.Response.Errors.Error.Message) {
            if (err.Body.Response.Errors.Error.Message.indexOf('currently pending') === -1) {
              return cb(err.Body.Response.Errors.Error.Message);
            }
            e = aws.makeError(err);
          }
        } catch(ex) { }

        if (new Date() - startTime > 600 * 1000) {
          return cb("timed out waiting for instance to become public");
        }

        if (typeof progress === 'function') progress(e || "unknown");

        setTimeout(attempt, 60000);
      }
    });
  }

  attempt();
};

exports.copyAMI = function(srcRegion, tgtRegion, imageId, cb) {
  var client = aws.allocateEC2Client(tgtRegion);
  client.CopyImage({
    SourceRegion: srcRegion,
    SourceImageId: imageId,
    // ToDo: allow passed in name / desc, DRY violation
    Name: "awsbox deployment image v" + dateBasedVersion(),
    Description: "An image for use with awsbox.org, a DIY PaaS for noders"
  }, function(err, resp) {
    if (err) return cb(aws.makeError(err));
    cb(null, jsel.match(".imageId", resp)[0]);
  });
};

function returnSingleImageInfo(err, result, cb) {
  if (err) return cb(aws.makeError(err));
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

const CREAT_POLL = 3000;
exports.waitForInstance = function(id, cb) {
  aws.client.DescribeInstanceStatus({
    InstanceId: id
  }, function(err, r) {
    if (err) return cb('error during operation', err);

    // we're waiting and amazon might not have created the image yet!  that's
    // not an error, just an api timing quirk
    var waiting = jsel.match('.Error .Code:val("InvalidInstanceID.NotFound")', r);
    if (waiting.length) {
      return setTimeout(function(){ exports.waitForInstance(id, cb); }, CREAT_POLL);
    }

    // find the instanceStatusSet
    var status = jsel.match('.instanceStatusSet', r)[0];
    if ( status === '' ) {
      console.log('   ... not yet created');
      return setTimeout(function(){ exports.waitForInstance(id, cb); }, CREAT_POLL);
    }

    var deets = extractInstanceDeets(status.item);
    if (deets && deets.instanceState && deets.instanceState.name === 'running') {
      return aws.client.DescribeInstances( { InstanceId: id }, function(err, result) {
        if (err) return cb('error during operation', err);
        returnSingleImageInfo(err, result, cb);
      });
    }
    setTimeout(function(){ exports.waitForInstance(id, cb); }, CREAT_POLL);
  });
};

exports.setName = function(id, name, cb) {
  exports.setTags(id, { Name: name }, cb);
};

exports.setTags = function(id, tagObj, cb) {
  var tags = [];
  Object.keys(tagObj).forEach(function(k) {
    tags.push({
      Key: k,
      Value: tagObj[k]
    });
  });

  aws.client.CreateTags({
    ResourceId: [ id ],
    Tag: tags,
  }, function(err) {
    if (err) return cb(aws.makeError(err));
    cb();
  });
};

exports.protect = function(id, cb) {
  exports.setInstanceAttribute(id, 'DisableApiTermination', 'true', cb);
};

exports.unprotect = function(id, cb) {
  exports.setInstanceAttribute(id, 'DisableApiTermination', 'false', cb);
};

exports.getInstanceAttribute = function(id, attr, cb) {
  aws.client.DescribeInstanceAttribute({
    InstanceId: [ id ],
    Attribute: attr,
  }, function(err, resp) {
    console.log(JSON.stringify(resp));
    if (err) return cb(aws.makeError(err));
    cb();
  });
};

exports.setInstanceAttribute = function(id, attr, val, cb) {
  var args = {
    InstanceId: [ id ]
  };
  args[attr] = { Value: val };
  aws.client.ModifyInstanceAttribute(args, function(err, r) {
    if (err) return cb(aws.makeError(err));
    var status = jsel.match('.return', r)[0];
    cb(null, {
      instanceId: id,
      response: status
    });
  });
};
