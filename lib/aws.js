const
amazonEc2 = require('awssum-amazon-ec2'),
amazonRoute53 = require('awssum-amazon-route53'),
NiceRoute53 = require('nice-route53'),
config = require('./config.js'),
jsel = require('JSONSelect');

function createEc2Client(credentials) {
  return new amazonEc2.Ec2({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: credentials.region || amazonEc2.US_EAST_1, // default
  });
}

function createRoute53Client(credentials) {
  return new amazonRoute53.Route53(credentials);
}

function createNiceRoute53Client(credentials) {
  return new NiceRoute53({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: credentials.region || amazonEc2.US_EAST_1, // default
  });
}

// Set the default credentials to use since allocateEC2Client() is called in lib/vm.js.
// Note: We don't set and remember 'region' here.
var accessKeyId;
var secretAccessKey;
exports.setDefaultCredentials = function(credentials) {
  accessKeyId = credentials.accessKeyId;
  secretAccessKey = credentials.secretAccessKey;
};

// make an error from an Amazon error
exports.makeError = function(err) {
  var e;
  try {
    e = err.Body.Response.Errors.Error.Code + ": " + err.Body.Response.Errors.Error.Message;
  } catch(ex) { }
  return e || err;
};

// get an aws client instance for the specified region.
// if region is null, the default will be used.
exports.createClients = function(credentials) {
  credentials.region = credentials.region || config.region;

  // if any of accessKeyId, secretAccressKey or region is wrong, then these will throw
  exports.client = createEc2Client(credentials);
  exports.route53 = createRoute53Client(credentials);
  exports.niceRoute53 = createNiceRoute53Client(credentials);
};

exports.allocateEC2Client = function(region) {
  return createEc2Client({
    accessKeyId : accessKeyId,
    secretAccessKey : secretAccessKey,
    region : region
  });
};

exports.zones = function(cb) {
  exports.client.DescribeRegions(function(err, regions) {
    if (err) return cb(exports.makeError(err));
    var regionMap = {};
    var complete = 0;

    jsel.forEach('.regionInfo .item > *', regions, function(region) {
      // add this region to the regionMap (and used to check when all results have come back)
      regionMap[region.regionName] = {
        endpoint: region.regionEndpoint,
        zones: []
      };

      var credentials = {
        accessKeyId : accessKeyId,
        secretAccessKey : secretAccessKey,
        region : region.regionName,
      };
      createEc2Client(credentials).DescribeAvailabilityZones({
        Filter : [ { Name : "region-name", Value : [ region.regionName ] } ]
      }, function(err, zones) {
        if (complete === -1) return;
        complete++;

        if (err) {
          complete = -1;
          return cb(exports.makeError(err));
        }

        jsel.forEach('.availabilityZoneInfo .item > *', zones, function(zone) {
          regionMap[region.regionName].zones.push({
            name: zone.zoneName,
            state: zone.zoneState
          });
        });

        // if we have finished, callback
        if (complete === Object.keys(regionMap).length) {
          cb(null, regionMap);
        }
      });
    });
  });
};
