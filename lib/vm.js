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

  // extract the tags
  instance.tags = {}
  if (horribleBlob.tagSet && horribleBlob.tagSet.item.length > 0) {
    horribleBlob.tagSet.item.forEach(function(tagDef) {
      instance.tags[tagDef.key] = tagDef.value
    });
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
  aws.client.call('DescribeInstances', {}, function(result) {
    var instances = {};
    var i = 1;
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

exports.listawsboxes = function(cb) {
  exports.list(function(err, instances) {
    if (err) {
      return cb(err, null);
    }

    // extract everything tagged w/ AWSBOX
    var filtered = {};
    Object.keys(instances).forEach(function(k) {
      if (instances[k].tags['AWSBOX']) {
        filtered[k] = instances[k]
      }
    });

    cb(null, filtered);
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

    aws.client.call('TerminateInstances', {
      InstanceId: deets.instanceId
    }, function(result) {
      try { return cb(result.Errors.Error.Message); } catch(e) {};
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

    aws.client.call('CreateImage', {
      InstanceId: deets.instanceId,
      Name: "awsbox deployment image v" + dateBasedVersion(),
      Description: "An image for use with awsbox.org, a DIY PaaS for noders"
    }, function(result) {
      try { return cb(result.Errors.Error.Message); } catch(e) {};
      result = jsel.match('.imageId', result)[0];
      cb(null, result);
    });
  });
};

exports.makeAMIPublic = function(imageId, progress, cb) {
  var startTime = new Date();

  function attempt() {
    aws.client.call('ModifyImageAttribute', {
      ImageId: imageId,
      'LaunchPermission.Add.1.Group': 'all'
    }, function(result) {
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

function returnSingleImageInfo(result, cb) {
  if (!result) return cb('no results from ec2 api');
  try { return cb(result.Errors.Error.Message); } catch(e) {};
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
      aws.client.call('RunInstances', {
        ImageId: opts.ami || TEMPLATE_IMAGE_ID,
        KeyName: keyName,
        SecurityGroup: groupName,
        InstanceType: opts.type,
        MinCount: 1,
        MaxCount: 1,
        UserData: new Buffer(userData).toString('base64')
      }, function (result) {
        returnSingleImageInfo(result, cb);
      });
    });
  });
};

exports.waitForInstance = function(id, cb) {
  aws.client.call('DescribeInstanceStatus', {
    InstanceId: id
  }, function(r) {
    if (!r) return cb('no response from ec2');
    // we're waiting and amazon might not have created the image yet!  that's
    // not an error, just an api timing quirk
    var waiting = jsel.match('.Error .Code:val("InvalidInstanceID.NotFound")', r);
    if (waiting.length) {
      return setTimeout(function(){ exports.waitForInstance(id, cb); }, 1000);
    }

    if (!r.instanceStatusSet) return cb('malformed response from ec2' + JSON.stringify(r, null, 2));
    if (Object.keys(r.instanceStatusSet).length) {
      var deets = extractInstanceDeets(r.instanceStatusSet.item);
      if (deets && deets.instanceState && deets.instanceState.name === 'running') {
        return aws.client.call('DescribeInstances', { InstanceId: id }, function(result) {
          returnSingleImageInfo(result, cb);
        });
      }
    }
    setTimeout(function(){ exports.waitForInstance(id, cb); }, 1000);
  });
};

// http://docs.aws.amazon.com/AWSEC2/latest/APIReference/ApiReference-query-DeleteTags.html
exports.deleteTags = function(id, key, cb) {
  if (! key instanceof Array) {
    key = [ key ];
  }

  var delObj = {
    "ResourceId.0" : id,
  };

  for(var i=0; i < key.length; i++) {
    delObj['Tag.'+i+'.Key'] = key[i];
  }

  aws.client.call('DeleteTags', delObj, function(result) {
    if (result && result.return === 'true') return cb(null);
    try { return cb(result.Errors.Error.Message); } catch(e) {};
    return cb('unknown error deleting instance tag');
  });
};

exports.setTag = function(id, key, value, cb) {
  aws.client.call('CreateTags', {
    "ResourceId.0": id,
    "Tag.0.Key": key,
    "Tag.0.Value": value
  }, function(result) {
    if (result && result.return === 'true') return cb(null);
    try { return cb(result.Errors.Error.Message); } catch(e) {};
    return cb('unknown error setting instance tag');
  });
};

exports.setName = function(id, name, cb) {
  exports.setTag(id, 'Name', name, cb);
};
